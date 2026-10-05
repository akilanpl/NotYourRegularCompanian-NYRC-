use crate::{
    error::{AppError, AppResult},
    models::now_rfc3339,
    state::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PocketItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub size: usize,
    pub metadata: Value,
    pub storage_reference: String,
    pub content: String,
}
fn text<'a>(p: &'a Value, k: &str, max: usize) -> AppResult<&'a str> {
    p.get(k)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && s.len() <= max)
        .ok_or_else(|| AppError::InvalidInput(format!("invalid {k}")))
}
fn uuid(p: &Value) -> AppResult<&str> {
    let id = text(p, "id", 36)?;
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidInput("invalid ID".into()))?;
    Ok(id)
}
pub fn save_pocket(
    db: &crate::db::Db,
    kind: &str,
    title: &str,
    content: String,
    limit: usize,
) -> AppResult<PocketItem> {
    if content.len() > limit || title.is_empty() || title.len() > 200 {
        return Err(AppError::InvalidInput(
            "Pocket size or title limit exceeded".into(),
        ));
    }
    if kind == "url" {
        let u = reqwest::Url::parse(&content)
            .map_err(|_| AppError::InvalidInput("invalid URL".into()))?;
        if !matches!(u.scheme(), "http" | "https")
            || !u.username().is_empty()
            || u.password().is_some()
        {
            return Err(AppError::InvalidInput("unsafe URL".into()));
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let at = now_rfc3339();
    let item = PocketItem {
        id: id.clone(),
        item_type: kind.into(),
        title: title.into(),
        created_at: at.clone(),
        updated_at: at,
        size: content.len(),
        metadata: json!({}),
        storage_reference: format!("sqlite:pocket/{id}"),
        content,
    };
    db.save_pocket_item(&item)?;
    Ok(item)
}
#[tauri::command]
pub async fn assistant_service(
    state: State<'_, AppState>,
    action: String,
    payload: Value,
) -> AppResult<Value> {
    if serde_json::to_vec(&payload)?.len() > 1_048_576 {
        return Err(AppError::InvalidInput("payload too large".into()));
    }
    if action.starts_with("calendar.") {
        return super::calendar::calendar_action(&state, &action, &payload).await;
    }
    match action.as_str() {
        "pocket.save_text" | "pocket.save_url" => {
            let limit = pocket_limit(&state.db);
            let content = text(&payload, "content", limit)?.to_string();
            let title = text(&payload, "title", 200)?;
            Ok(serde_json::to_value(save_pocket(
                &state.db,
                if action.ends_with("url") {
                    "url"
                } else {
                    "text"
                },
                title,
                content,
                limit,
            )?)?)
        }
        "pocket.save_file" => {
            use base64::Engine;
            let name = text(&payload, "name", 200)?;
            let limit = pocket_limit(&state.db);
            let bytes = crate::sandbox::read_pocket_file(&state.pet_home, name, limit)?;
            let (content, encoding) = match String::from_utf8(bytes.clone()) {
                Ok(text) => (text, "utf8"),
                Err(_) => (
                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                    "base64",
                ),
            };
            let id = uuid::Uuid::new_v4().to_string();
            let at = now_rfc3339();
            let item = PocketItem {
                id: id.clone(),
                item_type: "file".into(),
                title: crate::sandbox::safe_pocket_name(name),
                created_at: at.clone(),
                updated_at: at,
                size: bytes.len(),
                metadata: json!({"encoding":encoding}),
                storage_reference: format!("sqlite:pocket/{id}"),
                content,
            };
            state.db.save_pocket_item(&item)?;
            Ok(serde_json::to_value(item)?)
        }
        "pocket.export_file" => {
            use base64::Engine;
            let item = state.db.get_pocket_item(uuid(&payload)?)?;
            if item.item_type != "file" {
                return Err(AppError::InvalidInput(
                    "Only Pocket files can be exported".into(),
                ));
            }
            let bytes = if item.metadata["encoding"] == "base64" {
                base64::engine::general_purpose::STANDARD
                    .decode(&item.content)
                    .map_err(|_| AppError::InvalidInput("invalid file encoding".into()))?
            } else {
                item.content.into_bytes()
            };
            let name = crate::sandbox::safe_pocket_name(&format!(
                "{}-{}",
                item.id,
                crate::sandbox::safe_pocket_name(&item.title)
            ));
            crate::sandbox::export_pocket_file(&state.pet_home, &name, &bytes)?;
            Ok(json!({"exported":true,"name":name}))
        }
        "pocket.list" => Ok(serde_json::to_value(state.db.list_pocket_items()?)?),
        "pocket.get" => Ok(serde_json::to_value(
            state.db.get_pocket_item(uuid(&payload)?)?,
        )?),
        "pocket.delete" => {
            state.db.delete_pocket_item(uuid(&payload)?)?;
            Ok(json!({"deleted":true}))
        }
        "clipboard.read" | "clipboard.to_pocket" | "clipboard.write" => {
            let limit = pocket_limit(&state.db);
            let mut cb = arboard::Clipboard::new()
                .map_err(|_| AppError::Permission("clipboard unavailable".into()))?;
            if action == "clipboard.write" {
                cb.set_text(text(&payload, "content", limit)?.to_owned())
                    .map_err(|_| AppError::Internal("clipboard write failed".into()))?;
                return Ok(json!({"written":true}));
            }
            let content = cb
                .get_text()
                .map_err(|_| AppError::Permission("clipboard has no readable text".into()))?;
            if content.len() > limit {
                return Err(AppError::InvalidInput("clipboard text too large".into()));
            }
            if action == "clipboard.to_pocket" {
                Ok(serde_json::to_value(save_pocket(
                    &state.db,
                    "text",
                    "Clipboard",
                    content,
                    limit,
                )?)?)
            } else {
                Ok(json!({"content":content}))
            }
        }
        "developer.task.status" => Ok(state
            .db
            .get_setting("developer:last_failure")?
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .unwrap_or(json!({"content":"No developer events received yet."}))),
        _ => Err(AppError::InvalidInput("unknown service action".into())),
    }
}
fn pocket_limit(db: &crate::db::Db) -> usize {
    db.get_setting("pocket:limit")
        .ok()
        .flatten()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(262144)
        .clamp(1024, 1048576)
}
#[tauri::command]
pub fn set_pocket_limit(state: State<'_, AppState>, bytes: usize) -> AppResult<()> {
    if !(1024..=1048576).contains(&bytes) {
        return Err(AppError::InvalidInput(
            "Pocket limit must be 1 KiB–1 MiB".into(),
        ));
    }
    state.db.put_setting("pocket:limit", &bytes.to_string())
}
#[tauri::command]
pub async fn assistant_interpret(state: State<'_, AppState>, input: String) -> AppResult<Value> {
    if input.trim().is_empty() || input.chars().count() > 2000 {
        return Err(AppError::InvalidInput("invalid input length".into()));
    }
    if !state
        .cooldown
        .try_acquire("assistant", std::time::Duration::from_secs(2))
    {
        return Err(AppError::LlmUnavailable(
            "wait a moment before trying again".into(),
        ));
    }
    let provider = state
        .llm
        .read()
        .clone()
        .ok_or_else(|| AppError::LlmUnavailable("AI disabled".into()))?;
    let schemas = include_str!("../../../src/lib/assistant/proposals.ts")
        .split("} as const;")
        .next()
        .unwrap_or("");
    let personality="Do not claim an action has run. Only return JSON: {\"kind\":\"reply\",\"message\":\"...\"} or {\"kind\":\"action\",\"action\":\"id\",\"payload\":{...}}. Ask clarification for missing fields. Never produce shell commands. Action payload schema:";
    let r = provider
        .complete(crate::llm::provider::LlmRequest {
            system: Some(format!(
                "{}\nPersonality dimensions (0–1): {}\n{personality}\n{schemas}",
                crate::personality::IDENTITY,
                serde_json::to_string(&super::state::load_settings_raw(&state.db)?.personality)?
            )),
            prompt: format!(
                "Current timestamp: {}. User request: {}",
                now_rfc3339(),
                input
            ),
            model: None,
            temperature: Some(0.3),
            max_tokens: Some(800),
        })
        .await?;
    serde_json::from_str(&r.text)
        .map_err(|_| AppError::InvalidInput("malformed AI proposal".into()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pocket_restart_and_limits() {
        let dir = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        let path = dir.path().join("test.db");
        let db = crate::db::Db::open(&path).unwrap();
        let i = save_pocket(&db, "text", "Note", "hello".into(), 1024).unwrap();
        drop(db);
        let db = crate::db::Db::open(&path).unwrap();
        assert_eq!(db.get_pocket_item(&i.id).unwrap().content, "hello");
        assert!(save_pocket(&db, "text", "Note", "x".repeat(1025), 1024).is_err());
        assert!(save_pocket(&db, "url", "Bad", "javascript:alert(1)".into(), 1024).is_err());
        db.delete_pocket_item(&i.id).unwrap();
        assert!(db.get_pocket_item(&i.id).is_err());
    }
    #[test]
    fn pocket_file_traversal() {
        let d = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        crate::sandbox::ensure_pet_home(d.path()).unwrap();
        for n in ["../secret", "/etc/passwd", "..\\secret"] {
            assert!(crate::sandbox::read_inbox_by_name(d.path(), n).is_err());
        }
    }
}
