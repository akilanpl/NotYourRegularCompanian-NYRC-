//! Opt-in authenticated loopback transport. No LAN address can be supplied.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
};
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{broadcast, watch},
    time::{timeout, Duration},
};
const MAX_FRAME: usize = 4096;
const INPUTS: &[&str] = &[
    "touch",
    "hold",
    "double_tap",
    "shake",
    "pickup",
    "put_down",
    "button",
    "voice_event",
    "connection",
    "battery",
    "status",
    "ready",
    "sleep",
    "wake",
];
const OUTPUTS: &[&str] = &[
    "expression",
    "animation",
    "text",
    "sound",
    "speech_request",
    "haptic",
    "brightness",
    "status_indicator",
    "sleep",
    "wake",
];
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Capabilities {
    inputs: Vec<String>,
    outputs: Vec<String>,
}
impl Capabilities {
    fn valid(&self) -> bool {
        self.inputs.len() <= INPUTS.len()
            && self.outputs.len() <= OUTPUTS.len()
            && self.inputs.iter().all(|s| INPUTS.contains(&s.as_str()))
            && self.outputs.iter().all(|s| OUTPUTS.contains(&s.as_str()))
            && self.inputs.iter().collect::<HashSet<_>>().len() == self.inputs.len()
            && self.outputs.iter().collect::<HashSet<_>>().len() == self.outputs.len()
    }
}
fn id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn keys(v: &Value, allowed: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.keys().all(|s| allowed.contains(&s.as_str())))
}
fn number(v: &Value, min: f64, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}
fn text(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.chars().count() <= 512)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    version: u8,
    #[serde(rename = "type")]
    kind: String,
    body_id: String,
    timestamp: String,
    payload: Value,
}
impl Input {
    fn valid(&self) -> bool {
        if self.version != 1
            || !id(&self.body_id)
            || !INPUTS.contains(&self.kind.as_str())
            || self.timestamp.len() > 40
            || chrono::DateTime::parse_from_rfc3339(&self.timestamp).is_err()
        {
            return false;
        }
        let p = &self.payload;
        match self.kind.as_str() {
            "battery" => {
                keys(p, &["percent", "charging"])
                    && number(&p["percent"], 0., 100.)
                    && (p.get("charging").is_none() || p["charging"].is_boolean())
            }
            "connection" => keys(p, &["online"]) && p["online"].is_boolean(),
            "button" => keys(p, &["button"]) && p["button"].as_str().is_some_and(id),
            "voice_event" => {
                keys(p, &["state"]) && matches!(p["state"].as_str(), Some("started" | "stopped"))
            }
            "status" => keys(p, &["message"]) && text(&p["message"]),
            _ => keys(p, &[]),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    version: u8,
    #[serde(rename = "type")]
    kind: String,
    body_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation_id: Option<String>,
    payload: Value,
}
impl Command {
    fn valid(&self) -> bool {
        if self.version != 1
            || !id(&self.body_id)
            || self.correlation_id.as_deref().is_some_and(|s| !id(s))
        {
            return false;
        }
        let p = &self.payload;
        match self.kind.as_str() {
            "expression" => {
                keys(p, &["id", "intensity", "durationMs"])
                    && [
                        "neutral",
                        "attentive",
                        "curious",
                        "happy",
                        "pleased",
                        "thinking",
                        "listening",
                        "speaking",
                        "focused",
                        "waiting",
                        "success",
                        "confused",
                        "concerned",
                        "sleepy",
                        "sleeping",
                        "dizzy",
                        "surprised",
                        "annoyed",
                    ]
                    .contains(&p["id"].as_str().unwrap_or(""))
                    && number(&p["intensity"], 0., 1.)
                    && p["durationMs"]
                        .as_u64()
                        .is_some_and(|n| (1..=60000).contains(&n))
            }
            "animation" => {
                keys(p, &["id"])
                    && [
                        "acknowledge",
                        "attend",
                        "tilt",
                        "settle",
                        "stumble",
                        "celebrate",
                    ]
                    .contains(&p["id"].as_str().unwrap_or(""))
            }
            "sound" => {
                keys(p, &["id"])
                    && ["acknowledge", "confirm", "attention"]
                        .contains(&p["id"].as_str().unwrap_or(""))
            }
            "text" | "speech_request" => keys(p, &["text"]) && text(&p["text"]),
            "haptic" => {
                keys(p, &["intensity", "durationMs"])
                    && number(&p["intensity"], 0., 1.)
                    && p["durationMs"]
                        .as_u64()
                        .is_some_and(|n| (1..=1000).contains(&n))
            }
            "brightness" => keys(p, &["level"]) && number(&p["level"], 0., 1.),
            "status_indicator" => {
                keys(p, &["state"])
                    && ["idle", "connected", "offline", "error", "low_battery"]
                        .contains(&p["state"].as_str().unwrap_or(""))
            }
            "sleep" | "wake" => keys(p, &[]),
            _ => false,
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
enum Frame {
    Hello {
        version: u8,
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "bodyId")]
        body_id: String,
        token: String,
        capabilities: Capabilities,
    },
    Input {
        version: u8,
        #[serde(rename = "messageId")]
        message_id: String,
        event: Input,
    },
    Heartbeat {
        version: u8,
        #[serde(rename = "messageId")]
        message_id: String,
    },
    Ack {
        version: u8,
        #[serde(rename = "messageId")]
        message_id: String,
    },
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportInfo {
    port: u16,
    token: String,
}
pub struct BodyTransport {
    info: TransportInfo,
    stop: watch::Sender<bool>,
    commands: broadcast::Sender<Command>,
}
#[derive(Default)]
pub struct BodyTransportState(Mutex<Option<BodyTransport>>, std::sync::atomic::AtomicU64);
impl Drop for BodyTransportState {
    fn drop(&mut self) {
        if let Some(t) = self.0.get_mut().take() {
            let _ = t.stop.send(true);
        }
    }
}
async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, value: Value) -> std::io::Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    timeout(Duration::from_secs(3), w.write_all(&bytes))
        .await
        .map_err(|_| std::io::Error::from(std::io::ErrorKind::TimedOut))?
}
async fn read_frame<R: AsyncBufReadExt + Unpin>(
    r: &mut R,
    data: &mut Vec<u8>,
) -> Result<Frame, &'static str> {
    loop {
        let bytes = r.fill_buf().await.map_err(|_| "connection_closed")?;
        if bytes.is_empty() {
            return Err("connection_closed");
        }
        let n = bytes
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(bytes.len());
        if data.len() + n > MAX_FRAME {
            return Err("frame_too_large");
        }
        let done = bytes[n - 1] == b'\n';
        data.extend_from_slice(&bytes[..n]);
        r.consume(n);
        if done {
            break;
        }
    }
    let frame = serde_json::from_slice(data).map_err(|_| "invalid_frame");
    data.clear();
    frame
}
type Sink = Arc<dyn Fn(&str, Value) + Send + Sync>;
async fn session(
    stream: TcpStream,
    token: String,
    expires: tokio::time::Instant,
    mut commands: broadcast::Receiver<Command>,
    sink: Sink,
    mut stop: watch::Receiver<bool>,
    identities: Arc<Mutex<HashSet<String>>>,
) {
    let (r, mut w) = stream.into_split();
    let mut r = BufReader::new(r);
    let mut decoder = Vec::new();
    let hello = timeout(Duration::from_secs(5), read_frame(&mut r, &mut decoder)).await;
    let (body_id, capabilities) = match hello {
        Ok(Ok(Frame::Hello {
            version: 1,
            message_id,
            body_id,
            token: provided,
            capabilities,
        })) if tokio::time::Instant::now() < expires && id(&message_id)
            && id(&body_id)
            && body_id != "desktop"
            && body_id != "virtual"
            && provided == token
            && capabilities.valid() =>
        {
            if !identities.lock().insert(body_id.clone()) {
                let _ = write_frame(
                    &mut w,
                    json!({"type":"error","version":1,"code":"body_already_connected"}),
                )
                .await;
                return;
            }
            if write_frame(&mut w,json!({"type":"welcome","version":1,"messageId":message_id,"bodyId":body_id,"capabilities":capabilities,"heartbeatSeconds":30})).await.is_err(){identities.lock().remove(&body_id);return;}
            (body_id, capabilities)
        }
        _ => {
            let _ = write_frame(
                &mut w,
                json!({"type":"error","version":1,"code":"handshake_rejected"}),
            )
            .await;
            return;
        }
    };
    sink(
        "body:connection",
        json!({"bodyId":body_id,"connected":true,"version":1,"capabilities":capabilities}),
    );
    let mut seen = VecDeque::<String>::new();
    let mut pending = HashSet::<String>::new();
    let mut last_input = tokio::time::Instant::now() - Duration::from_secs(1);
    let mut last_received = tokio::time::Instant::now();
    loop {
        tokio::select! {
        _=stop.changed()=>break,
        _=tokio::time::sleep_until(last_received+Duration::from_secs(65))=>break,
        frame=read_frame(&mut r,&mut decoder)=>{let frame=match frame{Ok(f)=>f,Err(code)=>{let _=write_frame(&mut w,json!({"type":"error","version":1,"code":code})).await;break;}};last_received=tokio::time::Instant::now();match frame{
        Frame::Input{version:1,message_id,event}if id(&message_id)&&event.body_id==body_id&&event.valid()&&capabilities.inputs.contains(&event.kind)=>{if !seen.contains(&message_id){if last_input.elapsed()<Duration::from_millis(20){let _=write_frame(&mut w,json!({"type":"error","version":1,"code":"rate_limited"})).await;continue;}last_input=tokio::time::Instant::now();if seen.len()>=128{seen.pop_front();}seen.push_back(message_id.clone());sink("body:input",serde_json::to_value(event).unwrap_or(Value::Null));}if write_frame(&mut w,json!({"type":"ack","version":1,"messageId":message_id})).await.is_err(){break;}},
        Frame::Heartbeat{version:1,message_id}if id(&message_id)=>{if write_frame(&mut w,json!({"type":"status","version":1,"messageId":message_id,"state":"connected"})).await.is_err(){break;}},Frame::Ack{version:1,message_id}if id(&message_id)=>{if !pending.remove(&message_id){let _=write_frame(&mut w,json!({"type":"error","version":1,"code":"invalid_ack"})).await;break;}},_=>{let _=write_frame(&mut w,json!({"type":"error","version":1,"code":"invalid_message"})).await;break;}}},
        command=commands.recv()=>{match command{Ok(command)if command.body_id==body_id&&capabilities.outputs.contains(&command.kind)=>{if pending.len()>=32{let _=write_frame(&mut w,json!({"type":"error","version":1,"code":"ack_backlog"})).await;break;}let mid=uuid::Uuid::new_v4().to_string();pending.insert(mid.clone());if write_frame(&mut w,json!({"type":"command","version":1,"messageId":mid,"command":command})).await.is_err(){break;}},Err(_)=>break,_=>{}}}
        }
    }
    identities.lock().remove(&body_id);
    sink(
        "body:connection",
        json!({"bodyId":body_id,"connected":false,"version":1,"capabilities":capabilities}),
    );
}
async fn start(sink: Sink) -> Result<BodyTransport, String> {
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not bind loopback body transport")?;
    let port = listener
        .local_addr()
        .map_err(|_| "Transport address unavailable")?
        .port();
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let info = TransportInfo {
        port,
        token: token.clone(),
    };
    let expires = tokio::time::Instant::now() + Duration::from_secs(600);
    let (stop, mut stopped) = watch::channel(false);
    let (commands, _) = broadcast::channel::<Command>(64);
    let sender = commands.clone();
    tokio::spawn(async move {
        let identities = Arc::new(Mutex::new(HashSet::new()));
        let active = Arc::new(tokio::sync::Semaphore::new(4));
        loop {
            tokio::select! {_=stopped.changed()=>break,accepted=listener.accept()=>{if let Ok((stream,_))=accepted{if let Ok(permit)=active.clone().try_acquire_owned(){let receiver=sender.subscribe();let token=token.clone();let sink=sink.clone();let stop=stopped.clone();let identities=identities.clone();tokio::spawn(async move{let _permit=permit;session(stream,token,expires,receiver,sink,stop,identities).await;});}}}}
        }
    });
    Ok(BodyTransport {
        info,
        stop,
        commands,
    })
}
#[tauri::command]
pub async fn start_body_transport(
    app: tauri::AppHandle,
    state: tauri::State<'_, BodyTransportState>,
) -> Result<TransportInfo, String> {
    let generation = state.1.load(std::sync::atomic::Ordering::SeqCst);
    if let Some(t) = state.0.lock().as_ref() {
        return Ok(t.info.clone());
    }
    let sink: Sink = Arc::new(move |event, value| {
        let _ = app.emit(event, value);
    });
    let transport = start(sink).await?;
    let mut guard = state.0.lock();
    if generation != state.1.load(std::sync::atomic::Ordering::SeqCst) { let _ = transport.stop.send(true); return Err("Transport start cancelled".into()); }
    if let Some(t) = guard.as_ref() {
        let _ = transport.stop.send(true);
        return Ok(t.info.clone());
    }
    let info = transport.info.clone();
    *guard = Some(transport);
    Ok(info)
}
#[tauri::command]
pub fn stop_body_transport(state: tauri::State<'_, BodyTransportState>) {
    state.1.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(t) = state.0.lock().take() {
        let _ = t.stop.send(true);
    }
}
#[tauri::command]
pub fn send_body_command(
    state: tauri::State<'_, BodyTransportState>,
    command: Command,
) -> Result<(), String> {
    if !command.valid()
        || serde_json::to_vec(&command)
            .map_err(|_| "Invalid command")?
            .len()
            > MAX_FRAME - 200
    {
        return Err("Invalid body command".into());
    }
    let guard = state.0.lock();
    let t = guard.as_ref().ok_or("Body transport disconnected")?;
    t.commands.send(command).map_err(|_| "No connected body")?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_schema() {
        let v = json!({"version":1,"type":"touch","bodyId":"esp32","timestamp":"2026-10-05T00:00:00Z","payload":{}});
        assert!(serde_json::from_value::<Input>(v.clone()).unwrap().valid());
        let mut v = v;
        v["payload"] = json!({"shell":"bad"});
        assert!(!serde_json::from_value::<Input>(v).unwrap().valid());
        assert!(!Capabilities {
            inputs: vec!["shell".into()],
            outputs: vec![]
        }
        .valid());
        let c = serde_json::from_value::<Command>(
            json!({"version":1,"type":"brightness","bodyId":"esp32","payload":{"level":2}}),
        )
        .unwrap();
        assert!(!c.valid());
    }
    #[tokio::test]
    async fn auth_ack_commands_reconnect_and_oversize() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let copy = events.clone();
        let t = start(Arc::new(move |name, value| {
            copy.lock().push((name.to_owned(), value))
        }))
        .await
        .unwrap();
        async fn client(
            port: u16,
        ) -> (
            BufReader<tokio::net::tcp::OwnedReadHalf>,
            tokio::net::tcp::OwnedWriteHalf,
        ) {
            let stream = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                .await
                .unwrap();
            let (r, w) = stream.into_split();
            (BufReader::new(r), w)
        }
        let (mut r, mut w) = client(t.info.port).await;
        let hello = |token: &str| json!({"type":"hello","version":1,"messageId":"h","bodyId":"esp32","token":token,"capabilities":{"inputs":["touch"],"outputs":["brightness"]}});
        write_frame(&mut w, hello("wrong")).await.unwrap();
        let mut line = String::new();
        r.read_line(&mut line).await.unwrap();
        assert!(line.contains("handshake_rejected"));
        for _ in 0..2 {
            let (mut r, mut w) = client(t.info.port).await;
            write_frame(&mut w, hello(&t.info.token)).await.unwrap();
            line.clear();
            r.read_line(&mut line).await.unwrap();
            assert!(line.contains("welcome"));
            let input = json!({"type":"input","version":1,"messageId":"tap1","event":{"version":1,"type":"touch","bodyId":"esp32","timestamp":"2026-10-05T00:00:00Z","payload":{}}});
            write_frame(&mut w, input.clone()).await.unwrap();
            line.clear();
            r.read_line(&mut line).await.unwrap();
            assert!(line.contains("ack"));
            let before = events
                .lock()
                .iter()
                .filter(|(n, _)| n == "body:input")
                .count();
            write_frame(&mut w, input).await.unwrap();
            line.clear();
            r.read_line(&mut line).await.unwrap();
            assert_eq!(
                before,
                events
                    .lock()
                    .iter()
                    .filter(|(n, _)| n == "body:input")
                    .count()
            );
            t.commands
                .send(Command {
                    version: 1,
                    kind: "brightness".into(),
                    body_id: "esp32".into(),
                    correlation_id: None,
                    payload: json!({"level":0.5}),
                })
                .unwrap();
            line.clear();
            timeout(Duration::from_secs(2), r.read_line(&mut line))
                .await
                .unwrap()
                .unwrap();
            assert!(line.contains("command"));
            w.write_all(&vec![b'x'; 5000]).await.unwrap();
            w.write_all(b"\n").await.unwrap();
            line.clear();
            r.read_line(&mut line).await.unwrap();
            assert!(line.contains("frame_too_large"));
        }
        let _ = t.stop.send(true);
    }
    #[tokio::test]
    async fn fragmented_decoder_survives_outgoing_command_cancellation() {
        let (mut writer, reader) = tokio::io::duplex(1024);
        let mut reader = BufReader::new(reader);
        let mut decoder = Vec::new();
        let mut bytes =
            serde_json::to_vec(&json!({"type":"heartbeat","version":1,"messageId":"fragmented"}))
                .unwrap();
        bytes.push(b'\n');
        let split = 20;
        writer.write_all(&bytes[..split]).await.unwrap();
        assert!(timeout(
            Duration::from_millis(10),
            read_frame(&mut reader, &mut decoder)
        )
        .await
        .is_err());
        assert_eq!(decoder.len(), split);
        writer.write_all(&bytes[split..]).await.unwrap();
        assert!(matches!(
            read_frame(&mut reader, &mut decoder).await.unwrap(),
            Frame::Heartbeat { version: 1, .. }
        ));
        assert!(decoder.is_empty());
    }
}

#[cfg(test)] mod fuzz_hardening_tests {
    use super::*;
    #[tokio::test] async fn deterministic_random_frames_are_bounded_and_do_not_panic() {
        let mut seed=0x12345678u32;
        for i in 0..1200 {
            let len=i%4200;let mut bytes=Vec::with_capacity(len+1);
            for _ in 0..len {seed=seed.wrapping_mul(1664525).wrapping_add(1013904223);bytes.push((seed>>24) as u8);}bytes.push(b'\n');
            let mut reader=BufReader::new(bytes.as_slice());let mut decoder=Vec::new();let _=read_frame(&mut reader,&mut decoder).await;assert!(decoder.len()<=MAX_FRAME);
        }
        for raw in [b"\n".as_slice(),b"{}\n",b"{\"type\":\"shell\"}\n",b"{\"type\":\"heartbeat\",\"version\":-1,\"messageId\":\"x\"}\n"] {
            assert!(read_frame(&mut BufReader::new(raw),&mut Vec::new()).await.is_err());
        }
    }
    #[tokio::test] async fn expired_handshake_and_identity_collision_cannot_take_over() {
        let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();assert!(addr.ip().is_loopback());
        let stream=TcpStream::connect(addr).await.unwrap();let (server,_)=listener.accept().await.unwrap();let (sender,_)=broadcast::channel(8);let (_stop,stopped)=watch::channel(false);
        let handle=tokio::spawn(session(server,"fake-token".into(),tokio::time::Instant::now()-Duration::from_secs(1),sender.subscribe(),Arc::new(|_,_|panic!("expired body must not emit")),stopped,Arc::new(Mutex::new(HashSet::new()))));
        let (r,mut w)=stream.into_split();write_frame(&mut w,json!({"type":"hello","version":1,"messageId":"h","bodyId":"esp32","token":"fake-token","capabilities":{"inputs":[],"outputs":[]}})).await.unwrap();let mut line=String::new();BufReader::new(r).read_line(&mut line).await.unwrap();assert!(line.contains("handshake_rejected"));handle.await.unwrap();
    }
    #[test] fn hostile_semantic_payload_matrix() {
        for percent in [-1.,101.,1e100] {let e:Input=serde_json::from_value(json!({"version":1,"type":"battery","bodyId":"esp32","timestamp":"2026-10-05T00:00:00Z","payload":{"percent":percent}})).unwrap();assert!(!e.valid());}
        for output in ["filesystem.read","shell.execute","ai.propose","brightness"] {let c:Command=serde_json::from_value(json!({"version":1,"type":output,"bodyId":"esp32","payload":{"level":-1}})).unwrap();assert!(!c.valid());}
        for id_value in ["", "../escape", "desktop/other"] {assert!(!id(id_value));}
    }
}

#[cfg(test)] mod reconnect_stress {
 use super::*;
 #[tokio::test] async fn duplicate_identity_is_rejected_and_50_reconnects_release_sessions() {
  let events=Arc::new(Mutex::new(Vec::new()));let copy=events.clone();let transport=start(Arc::new(move |name,value|copy.lock().push((name.to_string(),value)))).await.unwrap();
  async fn connect(port:u16,token:&str)->(BufReader<tokio::net::tcp::OwnedReadHalf>,tokio::net::tcp::OwnedWriteHalf,String) {
   let socket=TcpStream::connect((std::net::Ipv4Addr::LOCALHOST,port)).await.unwrap();let (r,mut w)=socket.into_split();write_frame(&mut w,json!({"type":"hello","version":1,"messageId":"hello","bodyId":"stress","token":token,"capabilities":{"inputs":["touch"],"outputs":["expression"]}})).await.unwrap();let mut r=BufReader::new(r);let mut line=String::new();timeout(Duration::from_secs(2),r.read_line(&mut line)).await.unwrap().unwrap();(r,w,line)
  }
  let (r,w,hello)=connect(transport.info.port,&transport.info.token).await;assert!(hello.contains("welcome"));let (_,_,collision)=connect(transport.info.port,&transport.info.token).await;assert!(collision.contains("body_already_connected"));drop(r);drop(w);
  for i in 0..50 {
   for _ in 0..100 {if events.lock().iter().filter(|(n,v)|n=="body:connection"&&v["connected"]==false).count()>i {break;}tokio::time::sleep(Duration::from_millis(1)).await;}
   let (r,w,line)=connect(transport.info.port,&transport.info.token).await;assert!(line.contains("welcome"));drop(r);drop(w);
  }
  let _=transport.stop.send(true);
 }
}
