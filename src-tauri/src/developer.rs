use crate::{
    error::{AppError, AppResult},
    state::AppState,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeveloperEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
pub fn validate(raw: &str) -> AppResult<DeveloperEvent> {
    if raw.len() > 4096 {
        return Err(AppError::InvalidInput("event too large".into()));
    }
    let e: DeveloperEvent = serde_json::from_str(raw)
        .map_err(|_| AppError::InvalidInput("invalid developer event JSON".into()))?;
    let types = [
        "developer.task.started",
        "developer.task.completed",
        "developer.tests.passed",
        "developer.tests.failed",
        "developer.build.success",
        "developer.build.failed",
        "developer.agent.waiting",
        "developer.permission.required",
        "developer.agent.message",
    ];
    if !types.contains(&e.kind.as_str())
        || e.id.is_empty()
        || e.id.len() > 80
        || !e
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
        || chrono::DateTime::parse_from_rfc3339(&e.timestamp).is_err()
        || e.message
            .as_ref()
            .is_some_and(|s| s.len() > 2000 || s.chars().any(|c| c.is_control() && c != '\n'))
    {
        return Err(AppError::InvalidInput(
            "invalid developer event fields".into(),
        ));
    }
    Ok(e)
}
pub fn ingest(app: &tauri::AppHandle, name: &str) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let enabled = state
        .db
        .get_setting("settings:v1")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<crate::models::Settings>(&s).ok())
        .is_some_and(|s| s.developer_event_log);
    if !enabled {
        return;
    }
    let result = (|| -> AppResult<()> {
        let raw = crate::sandbox::read_developer_event(&state.pet_home, name)?;
        let event = validate(&raw)?;
        if !state.db.claim_developer_event(&event.id)? {
            return Ok(());
        }
        state.db.put_setting("developer:last", &raw)?;
        if event.kind.ends_with("failed") {
            state.db.put_setting("developer:last_failure", &raw)?;
        }
        if !state.cooldown.try_acquire("developer:presentation", std::time::Duration::from_millis(250)) { return Ok(()); }
        app.emit("developer:event", &event)
            .map_err(|_| AppError::Internal("event delivery failed".into()))?;
        Ok(())
    })();
    if result.is_err() {
        log::warn!("developer event rejected");
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn events() {
        assert!(validate(
            r#"{"id":"a","type":"developer.tests.passed","timestamp":"2026-10-05T10:00:00Z"}"#
        )
        .is_ok());
        for raw in [
            r#"{"id":"a","type":"shell.execute","timestamp":"2026-10-05T10:00:00Z"}"#,
            r#"{"id":"a","type":"developer.tests.passed","timestamp":"bad"}"#,
        ] {
            assert!(validate(raw).is_err());
        }
    }
}
