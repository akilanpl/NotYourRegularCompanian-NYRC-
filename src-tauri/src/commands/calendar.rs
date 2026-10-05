//! Google Calendar adapter. Refresh credentials remain in the OS credential store.
use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarConfig {
    pub calendar_id: String,
    pub client_id: String,
    pub enabled: bool,
}
impl Default for CalendarConfig {
    fn default() -> Self {
        Self {
            calendar_id: "primary".into(),
            client_id: String::new(),
            enabled: false,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarCreateInput {
    pub title: String,
    pub start: String,
    pub end: String,
    pub timezone: String,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
}
impl CalendarCreateInput {
    pub fn validate(&self) -> AppResult<()> {
        let timezone = self
            .timezone
            .parse::<chrono_tz::Tz>()
            .map_err(|_| AppError::InvalidInput("invalid calendar timezone".into()))?;
        let _ = timezone;
        if self.title.trim().is_empty()
            || self.title.len() > 200
            || self.description.as_ref().is_some_and(|s| s.len() > 2000)
            || self.location.as_ref().is_some_and(|s| s.len() > 500)
        {
            return Err(AppError::InvalidInput("invalid calendar text".into()));
        }
        let valid = if self.all_day {
            match (
                chrono::NaiveDate::parse_from_str(&self.start, "%Y-%m-%d"),
                chrono::NaiveDate::parse_from_str(&self.end, "%Y-%m-%d"),
            ) {
                (Ok(a), Ok(b)) => b > a,
                _ => false,
            }
        } else {
            match (
                chrono::DateTime::parse_from_rfc3339(&self.start),
                chrono::DateTime::parse_from_rfc3339(&self.end),
            ) {
                (Ok(a), Ok(b)) => b > a,
                _ => false,
            }
        };
        if !valid {
            return Err(AppError::InvalidInput(
                "calendar end must follow start; use ISO dates or timestamps".into(),
            ));
        }
        Ok(())
    }
    fn body(&self) -> Value {
        let date = if self.all_day { "date" } else { "dateTime" };
        json!({"summary":self.title,"description":self.description,"location":self.location,"start":{date:&self.start,"timeZone":self.timezone},"end":{date:&self.end,"timeZone":self.timezone}})
    }
}
#[tauri::command]
pub fn get_calendar_config(state: State<'_, AppState>) -> AppResult<CalendarConfig> {
    config(&state)
}
fn config(state: &AppState) -> AppResult<CalendarConfig> {
    Ok(state
        .db
        .get_setting("calendar:v1")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}
#[tauri::command]
pub fn save_calendar_config(
    state: State<'_, AppState>,
    config: CalendarConfig,
    client_secret: Option<String>,
    refresh_token: Option<String>,
) -> AppResult<()> {
    if config.calendar_id.is_empty()
        || config.calendar_id.len() > 250
        || config.client_id.len() > 300
    {
        return Err(AppError::InvalidInput(
            "invalid calendar configuration".into(),
        ));
    }
    if let Some(s) = client_secret {
        crate::secrets::set("calendar:client_secret", Some(&s))?;
    }
    if let Some(s) = refresh_token {
        crate::secrets::set("calendar:refresh_token", Some(&s))?;
    }
    state
        .db
        .put_setting("calendar:v1", &serde_json::to_string(&config)?)
}
#[tauri::command]
pub fn disconnect_calendar(state: State<'_, AppState>) -> AppResult<()> {
    crate::secrets::set("calendar:client_secret", None)?;
    crate::secrets::set("calendar:refresh_token", None)?;
    state.db.delete_setting("calendar:v1")
}
fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Internal("calendar client unavailable".into()))
}
async fn token(c: &CalendarConfig, client: &reqwest::Client) -> AppResult<String> {
    let refresh = crate::secrets::get("calendar:refresh_token")?.ok_or_else(|| {
        AppError::Permission("Calendar disconnected: configure Google OAuth credentials".into())
    })?;
    let secret = crate::secrets::get("calendar:client_secret")?.unwrap_or_default();
    refresh_access_token(c, client, &refresh, &secret, "https://oauth2.googleapis.com/token").await
}
async fn refresh_access_token(c: &CalendarConfig, client: &reqwest::Client, refresh: &str, secret: &str, url: &str) -> AppResult<String> {
    let r = client
        .post(url)
        .form(&[
            ("client_id", c.client_id.as_str()),
            ("client_secret", secret),
            ("refresh_token", refresh),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| AppError::LlmUnavailable("calendar network failure or timeout".into()))?;
    if !r.status().is_success() {
        return Err(AppError::Permission(
            "Calendar authorization expired or invalid; reconnect".into(),
        ));
    }
    let v: Value = crate::llm::cloud::bounded_json(r).await?;
    v["access_token"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 8192 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(|| AppError::Permission("OAuth returned no access token".into()))
}
pub async fn calendar_action(state: &AppState, action: &str, p: &Value) -> AppResult<Value> {
    let c = config(state)?;
    if !c.enabled {
        return Err(AppError::Permission(
            "Calendar disconnected; enable it in Settings".into(),
        ));
    }
    if super::state::load_settings_raw(&state.db)?.local_only_mode {
        return Err(AppError::Permission(
            "Calendar cloud access blocked by local-only mode".into(),
        ));
    }
    let client = client()?;
    let t = token(&c, &client).await?;
    request_calendar(&client, &c, &t, action, p, "https://www.googleapis.com/calendar/v3/calendars/").await
}
async fn request_calendar(client: &reqwest::Client, c: &CalendarConfig, token: &str, action: &str, p: &Value, base: &str) -> AppResult<Value> {
    let method = match action {
        "calendar.list" | "calendar.get" => reqwest::Method::GET,
        "calendar.create" => reqwest::Method::POST,
        "calendar.update" => reqwest::Method::PATCH,
        "calendar.delete" => reqwest::Method::DELETE,
        _ => return Err(AppError::InvalidInput("unknown calendar action".into())),
    };
    let mut url = reqwest::Url::parse(base).map_err(|_| AppError::Internal("Calendar endpoint unavailable".into()))?;
    {
        let mut path = url.path_segments_mut().map_err(|_| AppError::Internal("Calendar endpoint unavailable".into()))?;
        path.pop_if_empty().push(&c.calendar_id).push("events");
        if matches!(
            action,
            "calendar.get" | "calendar.update" | "calendar.delete"
        ) {
            let id = p["id"]
                .as_str()
                .filter(|s| {
                    !s.is_empty()
                        && s.len() <= 1024
                        && s.chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
                })
                .ok_or_else(|| AppError::InvalidInput("invalid calendar event ID".into()))?;
            path.push(id);
        }
    }
    let mut body = None;
    if matches!(action, "calendar.create" | "calendar.update") {
        let mut input = p.clone();
        if let Some(o) = input.as_object_mut() {
            o.remove("id");
        }
        let i: CalendarCreateInput = serde_json::from_value(input)
            .map_err(|_| AppError::InvalidInput("invalid calendar payload".into()))?;
        i.validate()?;
        body = Some(i.body());
    }
    if action == "calendar.list" {
        let a = p["start"]
            .as_str()
            .ok_or_else(|| AppError::InvalidInput("query start required".into()))?;
        let b = p["end"]
            .as_str()
            .ok_or_else(|| AppError::InvalidInput("query end required".into()))?;
        let start = chrono::DateTime::parse_from_rfc3339(a)
            .map_err(|_| AppError::InvalidInput("invalid query start".into()))?;
        let end = chrono::DateTime::parse_from_rfc3339(b)
            .map_err(|_| AppError::InvalidInput("invalid query end".into()))?;
        if end <= start {
            return Err(AppError::InvalidInput("query end must follow start".into()));
        }
        url.query_pairs_mut()
            .append_pair("timeMin", a)
            .append_pair("timeMax", b)
            .append_pair("singleEvents", "true")
            .append_pair("orderBy", "startTime")
            .append_pair("maxResults", "100");
    }
    let mut events = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for page in 0..20 {
        let mut request = client.request(method.clone(), url.clone()).bearer_auth(token);
        if let Some(b) = &body { request = request.json(b); }
        let r = request.send().await.map_err(|_| AppError::LlmUnavailable("calendar network failure or timeout".into()))?;
        if !r.status().is_success() { return Err(crate::llm::cloud::status_error(r.status())); }
        if action == "calendar.delete" { return Ok(json!({"deleted":true})); }
        let v = crate::llm::cloud::bounded_json(r).await?;
        if action != "calendar.list" { return normalize_event(&v); }
        let items = v["items"].as_array().ok_or_else(|| AppError::InvalidInput("malformed calendar list".into()))?;
        if items.len() > 100 || events.len() + items.len() > 2000 { return Err(AppError::InvalidInput("Calendar result limit exceeded".into())); }
        for item in items.iter().filter(|e| e["status"] != "cancelled") {
            let event = normalize_event(item)?;
            if !ids.insert(event["id"].as_str().unwrap_or("").to_owned()) { return Err(AppError::InvalidInput("Duplicate Calendar event ID".into())); }
            events.push(event);
        }
        let Some(next) = v.get("nextPageToken") else { return Ok(Value::Array(events)); };
        let next = next.as_str().filter(|s| !s.is_empty() && s.len() <= 1024).ok_or_else(|| AppError::InvalidInput("Invalid Calendar pagination".into()))?;
        if page == 19 { break; }
        let pairs: Vec<(String,String)> = url.query_pairs().filter(|(k,_)| k != "pageToken").map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
        url.set_query(None); url.query_pairs_mut().extend_pairs(pairs).append_pair("pageToken", next);
    }
    Err(AppError::InvalidInput("Calendar pagination limit exceeded".into()))
}

fn normalize_event(v: &Value) -> AppResult<Value> {
    let id = v["id"]
        .as_str()
        .ok_or_else(|| AppError::InvalidInput("calendar event has no ID".into()))?;
    let all_day = v["start"]["date"].is_string();
    let field = if all_day { "date" } else { "dateTime" };
    let start = v["start"][field]
        .as_str()
        .ok_or_else(|| AppError::InvalidInput("calendar event has no start".into()))?;
    let end = v["end"][field]
        .as_str()
        .ok_or_else(|| AppError::InvalidInput("calendar event has no end".into()))?;
    let input = CalendarCreateInput {title:v["summary"].as_str().unwrap_or("Untitled event").into(), start:start.into(), end:end.into(), timezone:v["start"]["timeZone"].as_str().unwrap_or("UTC").into(), all_day, description:v["description"].as_str().map(str::to_owned), location:v["location"].as_str().map(str::to_owned)};
    input.validate()?;
    if id.is_empty() || id.len() > 1024 { return Err(AppError::InvalidInput("invalid Calendar event ID".into())); }
    Ok(
        json!({"id":id,"title":v["summary"].as_str().unwrap_or("Untitled event"),"start":start,"end":end,"timezone":v["start"]["timeZone"].as_str().unwrap_or("UTC"),"allDay":all_day,"description":v["description"],"location":v["location"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn models() {
        let mut i = CalendarCreateInput {
            title: "Meeting".into(),
            start: "2026-10-05T10:00:00Z".into(),
            end: "2026-10-05T11:00:00Z".into(),
            timezone: "Asia/Kolkata".into(),
            all_day: false,
            description: None,
            location: None,
        };
        assert!(i.validate().is_ok());
        assert_eq!(i.body()["start"]["dateTime"], i.start);
        i.end = i.start.clone();
        assert!(i.validate().is_err());
        i.all_day = true;
        i.start = "2026-10-05".into();
        i.end = "2026-10-06".into();
        assert!(i.validate().is_ok());
    }
}

#[cfg(test)] mod hardening_http_tests {
    use super::*;
    use std::io::{Read, Write};
    fn fake(responses: Vec<(u16, String)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base=format!("http://{}/calendars/", listener.local_addr().unwrap());
        let handle=std::thread::spawn(move || {
            let mut requests=Vec::new();
            for (status, body) in responses {
                let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(std::time::Duration::from_secs(3))).unwrap();
                let mut bytes=vec![0;8192];let n=stream.read(&mut bytes).unwrap();requests.push(String::from_utf8_lossy(&bytes[..n]).to_string());
                write!(stream,"HTTP/1.1 {status} OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            } requests
        });(base,handle)
    }
    #[tokio::test]
    async fn oauth_refresh_success_expiry_rate_limit_and_malformed_fail_closed() {
        let fake_secret="NYRC_TEST_SECRET_DO_NOT_LEAK_123";
        for (status, body, success) in [
            (200, json!({"access_token":"test-access-token","expires_in":3600}).to_string(), true),
            (400, json!({"error":"invalid_grant","description":fake_secret}).to_string(), false),
            (401, fake_secret.into(), false),
            (429, fake_secret.into(), false),
            (503, fake_secret.into(), false),
            (200, "{".into(), false),
            (200, json!({"access_token":""}).to_string(), false),
            (200, json!({"access_token":"x".repeat(8193)}).to_string(), false),
        ] {
            let (url, handle)=fake(vec![(status,body)]);
            let result=refresh_access_token(&CalendarConfig::default(),&client().unwrap(),fake_secret,fake_secret,&url).await;
            assert_eq!(result.is_ok(),success);
            if let Err(error)=result { assert!(!error.to_string().contains(fake_secret)); }
            let requests=handle.join().unwrap(); assert!(requests[0].starts_with("POST "));
            assert!(requests[0].contains("grant_type=refresh_token"));
        }
    }
    fn event(id:&str)->Value {json!({"id":id,"summary":"<script>untrusted title</script>","start":{"dateTime":"2026-10-05T10:00:00Z"},"end":{"dateTime":"2026-10-05T11:00:00Z"}})}
    #[tokio::test] async fn real_http_crud_pagination_and_redacted_failure() {
        let responses=vec![(200,json!({"items":[event("one")],"nextPageToken":"page-two"}).to_string()),(200,json!({"items":[event("two")]}).to_string()),(200,event("one").to_string()),(200,event("one").to_string()),(200,event("one").to_string()),(204,String::new()),(401,"NYRC_TEST_SECRET_DO_NOT_LEAK_123".into())];
        let (base,handle)=fake(responses);let c=CalendarConfig{enabled:true,..Default::default()};let client=client().unwrap();
        let list=request_calendar(&client,&c,"fake-secret","calendar.list",&json!({"start":"2026-10-05T00:00:00Z","end":"2026-10-06T00:00:00Z"}),&base).await.unwrap();assert_eq!(list.as_array().unwrap().len(),2);
        let payload=json!({"id":"one","title":"Temporary test","start":"2026-10-05T10:00:00Z","end":"2026-10-05T11:00:00Z","timezone":"UTC"});
        request_calendar(&client,&c,"fake-secret","calendar.get",&json!({"id":"one"}),&base).await.unwrap();
        let mut create=payload.clone();create.as_object_mut().unwrap().remove("id");
        request_calendar(&client,&c,"fake-secret","calendar.create",&create,&base).await.unwrap();
        request_calendar(&client,&c,"fake-secret","calendar.update",&payload,&base).await.unwrap();
        assert_eq!(request_calendar(&client,&c,"fake-secret","calendar.delete",&json!({"id":"one"}),&base).await.unwrap()["deleted"],true);
        let error=request_calendar(&client,&c,"fake-secret","calendar.get",&json!({"id":"one"}),&base).await.unwrap_err().to_string();assert!(!error.contains("NYRC_TEST_SECRET"));
        let requests=handle.join().unwrap();assert!(requests[1].contains("pageToken=page-two"));assert!(requests[3].starts_with("POST "));assert!(requests[4].starts_with("PATCH "));assert!(requests[5].starts_with("DELETE "));
    }
    #[tokio::test] async fn duplicate_ids_and_malformed_provider_dates_are_rejected() {
        let (base,handle)=fake(vec![(200,json!({"items":[event("one"),event("one")]}).to_string())]);
        let result=request_calendar(&client().unwrap(),&CalendarConfig::default(),"fake","calendar.list",&json!({"start":"2026-10-05T00:00:00Z","end":"2026-10-06T00:00:00Z"}),&base).await;assert!(result.is_err());handle.join().unwrap();
        let mut e=event("a");e["end"]["dateTime"]=json!("invalid");assert!(normalize_event(&e).is_err());
        e=event("a");e["summary"]=json!("x".repeat(201));assert!(normalize_event(&e).is_err());
    }
}
