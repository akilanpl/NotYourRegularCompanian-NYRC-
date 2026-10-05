//! BYO providers. Credentials stay in Rust; errors never include response bodies or URLs.
use super::provider::{LlmProvider, LlmRequest, LlmResponse};
use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::{future::Future, pin::Pin, time::Duration};
pub struct CloudProvider {
    kind: String,
    endpoint: String,
    model: String,
    key: String,
    client: reqwest::Client,
}
pub fn validate_endpoint(endpoint: &str, local: bool) -> AppResult<()> {
    let u = reqwest::Url::parse(endpoint)
        .map_err(|_| AppError::InvalidInput("invalid provider endpoint".into()))?;
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err(AppError::InvalidInput(
            "endpoint must not contain credentials, query or fragment".into(),
        ));
    }
    let loopback = matches!(
        u.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if (local && !loopback) || !(u.scheme() == "https" || u.scheme() == "http" && loopback) {
        return Err(AppError::InvalidInput(
            "use HTTPS, or HTTP on loopback only".into(),
        ));
    }
    Ok(())
}
impl CloudProvider {
    pub fn new(
        kind: String,
        endpoint: String,
        model: String,
        key: String,
        timeout: u64,
    ) -> AppResult<Self> {
        validate_endpoint(&endpoint, false)?;
        if !matches!(kind.as_str(), "openai" | "gemini")
            || model.is_empty()
            || model.len() > 150
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
        {
            return Err(AppError::InvalidInput("invalid provider or model".into()));
        }
        if kind == "gemini" && (model.contains("/") || model.contains(":") || model == "." || model == "..") { return Err(AppError::InvalidInput("invalid Gemini model".into())); }
        if kind == "gemini" && endpoint != "https://generativelanguage.googleapis.com/v1beta" {
            return Err(AppError::InvalidInput(
                "Gemini uses its official endpoint".into(),
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(timeout.clamp(2, 120)))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AppError::LlmUnavailable("client unavailable".into()))?;
        Ok(Self {
            kind,
            endpoint,
            model,
            key,
            client,
        })
    }
}
pub fn response_text(kind: &str, v: &Value) -> AppResult<String> {
    let t = if kind == "gemini" {
        v.pointer("/candidates/0/content/parts/0/text")
    } else {
        v.pointer("/choices/0/message/content")
    };
    t.and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= 65536)
        .map(str::to_owned)
        .ok_or_else(|| AppError::LlmUnavailable("malformed provider response".into()))
}
pub fn status_error(status: reqwest::StatusCode) -> AppError {
    AppError::LlmUnavailable(
        match status.as_u16() {
            401 | 403 => "invalid authentication",
            429 => "rate limited",
            _ => "provider request failed",
        }
        .into(),
    )
}
impl LlmProvider for CloudProvider {
    fn name(&self) -> &'static str {
        if self.kind == "gemini" {
            "gemini"
        } else {
            "openai"
        }
    }
    fn complete<'a>(
        &'a self,
        req: LlmRequest,
    ) -> Pin<Box<dyn Future<Output = AppResult<LlmResponse>> + Send + 'a>> {
        Box::pin(async move {
            let builder = if self.kind == "gemini" {
                self.client.post(format!("{}/models/{}:generateContent",self.endpoint,self.model)).header("x-goog-api-key",&self.key).json(&json!({"systemInstruction":{"parts":[{"text":req.system.unwrap_or_default()}]},"contents":[{"parts":[{"text":req.prompt}]}],"generationConfig":{"maxOutputTokens":req.max_tokens.unwrap_or(800),"temperature":req.temperature.unwrap_or(0.3)}}))
            } else {
                self.client.post(format!("{}/chat/completions",self.endpoint.trim_end_matches('/'))).bearer_auth(&self.key).json(&json!({"model":self.model,"messages":[{"role":"system","content":req.system.unwrap_or_default()},{"role":"user","content":req.prompt}],"max_tokens":req.max_tokens.unwrap_or(800),"temperature":req.temperature.unwrap_or(0.3)}))
            };
            let r = builder.send().await.map_err(|e| {
                AppError::LlmUnavailable(
                    if e.is_timeout() {
                        "timeout"
                    } else {
                        "network failure"
                    }
                    .into(),
                )
            })?;
            if !r.status().is_success() {
                return Err(status_error(r.status()));
            }
            let v = bounded_json(r).await?;
            Ok(LlmResponse {
                text: redact_secret(&response_text(&self.kind, &v)?, &self.key),
                model: self.model.clone(),
            })
        })
    }
}
fn redact_secret(text: &str, secret: &str) -> String {
    if secret.len() < 8 { return text.to_owned(); }
    let mut text = text.replace(secret, "[redacted]");
    let prefix: String = secret.chars().take(12).collect();
    let suffix: String = secret.chars().rev().take(12).collect::<String>().chars().rev().collect();
    for part in [prefix, suffix] { if part.len() >= 8 {text = text.replace(&part, "[redacted]");} }
    text
}
/// Bound streamed response bytes even if the server omits Content-Length.
pub async fn bounded_json(mut r: reqwest::Response) -> AppResult<Value> {
    let mut bytes = Vec::new();
    while let Some(chunk) = r
        .chunk()
        .await
        .map_err(|_| AppError::LlmUnavailable("response network failure".into()))?
    {
        if bytes.len() + chunk.len() > 262144 {
            return Err(AppError::LlmUnavailable("response too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::LlmUnavailable("malformed provider response".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints() {
        for s in [
            "file:///tmp/key",
            "http://example.com",
            "https://x.com/?key=a",
            "https://user:pass@x.com",
        ] {
            assert!(validate_endpoint(s, false).is_err());
        }
        assert!(validate_endpoint("http://127.0.0.1:11434", true).is_ok());
        assert!(validate_endpoint("https://example.com", true).is_err());
    }
    #[test]
    fn malformed() {
        assert!(response_text("openai", &json!({})).is_err());
        assert_eq!(
            response_text(
                "gemini",
                &json!({"candidates":[{"content":{"parts":[{"text":"hello"}]}}]})
            )
            .unwrap(),
            "hello"
        );
        assert!(!status_error(reqwest::StatusCode::UNAUTHORIZED)
            .to_string()
            .contains("key"));
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    fn fake_server(status: u16, body: &str) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = body.to_owned();
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut input = [0u8; 8192];
            let n = socket.read(&mut input).unwrap();
            let request = String::from_utf8_lossy(&input[..n]);
            assert!(request.contains("POST /v1/chat/completions"));
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer test-only-key"));
            write!(socket,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        });
        (format!("http://{addr}/v1"), handle)
    }
    #[tokio::test]
    async fn production_adapter_fake_transport() {
        for (status, body, expected) in [
            (
                200,
                r#"{"choices":[{"message":{"content":"safe response"}}]}"#,
                "safe response",
            ),
            (
                401,
                r#"{"secret":"must-not-leak"}"#,
                "invalid authentication",
            ),
            (429, "private body", "rate limited"),
            (200, "not JSON", "malformed provider response"),
        ] {
            let (url, handle) = fake_server(status, body);
            let p = CloudProvider::new(
                "openai".into(),
                url,
                "test-model".into(),
                "test-only-key".into(),
                3,
            )
            .unwrap();
            let result = p
                .complete(LlmRequest {
                    system: None,
                    prompt: "test".into(),
                    model: None,
                    max_tokens: Some(10),
                    temperature: None,
                })
                .await;
            let text = match result {
                Ok(r) => r.text,
                Err(e) => e.to_string(),
            };
            assert!(text.contains(expected));
            assert!(!text.contains("must-not-leak"));
            handle.join().unwrap();
        }
    }
    #[tokio::test]
    async fn unavailable_connection_is_redacted() {
        let p = CloudProvider::new(
            "openai".into(),
            "http://127.0.0.1:1/v1".into(),
            "test".into(),
            "test-only-key".into(),
            2,
        )
        .unwrap();
        let e = p
            .complete(LlmRequest {
                system: None,
                prompt: "test".into(),
                model: None,
                max_tokens: None,
                temperature: None,
            })
            .await
            .unwrap_err()
            .to_string();
        // Windows can time out a refused loopback connection before reporting refusal.
        assert!(e.contains("network failure") || e.contains("timeout"));
        assert!(!e.contains("127.0.0.1"));
        assert!(!e.contains("test-only-key"));
    }
}

#[cfg(test)] mod hardening_matrix {
    use super::*;
    use std::io::{Read,Write};
    const SECRET:&str="NYRC_TEST_SECRET_DO_NOT_LEAK_123";
    fn serve(status:u16,body:String,delay:u64)->(String,std::thread::JoinHandle<()>) {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let url=format!("http://{}/v1",listener.local_addr().unwrap());
        let handle=std::thread::spawn(move||{let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();let mut request=[0;8192];let _=stream.read(&mut request);std::thread::sleep(Duration::from_millis(delay));let _=write!(stream,"HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());});(url,handle)
    }
    fn request()->LlmRequest{LlmRequest{system:None,prompt:"non-sensitive test".into(),model:None,max_tokens:None,temperature:None}}
    #[tokio::test] async fn cloud_status_and_body_matrix_never_exposes_credentials() {
        for (status,body) in [(403,SECRET.into()),(404,SECRET.into()),(429,SECRET.into()),(500,SECRET.into()),(502,SECRET.into()),(503,SECRET.into()),(200,"{".into()),(200,"{}".into()),(200,String::new()),(200,"data: {stream}".into()),(200,"x".repeat(262145))] {
            let (url,h)=serve(status,body,0);let p=CloudProvider::new("openai".into(),url,"test".into(),SECRET.into(),2).unwrap();let error=p.complete(request()).await.unwrap_err().to_string();assert!(error.len()<150);assert!(!error.contains(SECRET));assert!(!error.contains("NYRC_TEST"));h.join().unwrap();
        }
        assert!(!redact_secret(&format!("echo {SECRET}; NYRC_TEST_SE"),SECRET).contains(SECRET));
    }
    #[tokio::test] async fn slow_body_times_out_and_gemini_parser_uses_bounded_transport() {
        let (url,h)=serve(200,"{}".into(),2100);let p=CloudProvider::new("openai".into(),url,"test".into(),SECRET.into(),2).unwrap();assert!(p.complete(request()).await.is_err());h.join().unwrap();
        let (url,h)=serve(200,json!({"candidates":[{"content":{"parts":[{"text":"safe Gemini fixture"}]}}]}).to_string(),0);
        let mut p=CloudProvider::new("openai".into(),url,"test".into(),SECRET.into(),2).unwrap();p.kind="gemini".into();assert_eq!(p.complete(request()).await.unwrap().text,"safe Gemini fixture");h.join().unwrap();
    }
    #[tokio::test] async fn ollama_rejects_oversized_empty_malformed_and_http_failure() {
        for (status,body) in [(200,"x".repeat(262145)),(200,"not json".into()),(200,json!({"response":""}).to_string()),(500,SECRET.into()),(200,json!({"response":"x".repeat(65537)}).to_string())] {
            let (url,h)=serve(status,body,0);let p=crate::llm::ollama::OllamaProvider::new(url,"test");let error=p.complete(request()).await.unwrap_err().to_string();assert!(!error.contains(SECRET));h.join().unwrap();
        }
    }
}
