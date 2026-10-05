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
    let r = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", c.client_id.as_str()),
            ("client_secret", secret.as_str()),
            ("refresh_token", refresh.as_str()),
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
    let method = match action {
        "calendar.list" | "calendar.get" => reqwest::Method::GET,
        "calendar.create" => reqwest::Method::POST,
        "calendar.update" => reqwest::Method::PATCH,
        "calendar.delete" => reqwest::Method::DELETE,
        _ => return Err(AppError::InvalidInput("unknown calendar action".into())),
    };
    let mut url = reqwest::Url::parse("https://www.googleapis.com/calendar/v3/calendars/").unwrap();
    {
        let mut path = url.path_segments_mut().unwrap();
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
    let client = client()?;
    let t = token(&c, &client).await?;
    let mut request = client.request(method, url).bearer_auth(t);
    if let Some(b) = body {
        request = request.json(&b);
    }
    let r = request
        .send()
        .await
        .map_err(|_| AppError::LlmUnavailable("calendar network failure or timeout".into()))?;
    if !r.status().is_success() {
        return Err(crate::llm::cloud::status_error(r.status()));
    }
    if action == "calendar.delete" {
        return Ok(json!({"deleted":true}));
    }
    let v: Value = crate::llm::cloud::bounded_json(r).await?;
    if action == "calendar.list" {
        let items = v["items"]
            .as_array()
            .ok_or_else(|| AppError::InvalidInput("malformed calendar list".into()))?;
        Ok(Value::Array(
            items
                .iter()
                .filter(|e| e["status"] != "cancelled")
                .map(normalize_event)
                .collect::<AppResult<Vec<_>>>()?,
        ))
    } else {
        normalize_event(&v)
    }
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
