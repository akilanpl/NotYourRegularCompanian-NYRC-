//! Sensitive commands require OS-owned confirmation; a forged frontend permission flag has no authority.
use crate::error::{AppError, AppResult};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

pub fn sensitive(action: &str) -> bool {
    matches!(
        action,
        "clipboard.read"
            | "clipboard.to_pocket"
            | "clipboard.write"
            | "calendar.create"
            | "calendar.update"
            | "calendar.delete"
            | "pocket.delete"
            | "pocket.save_file"
            | "pocket.export_file"
            | "inbox.approve" | "provider.configure"
    )
}

static REQUESTED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static APPROVED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub fn diagnostics() -> serde_json::Value {
    use std::sync::atomic::Ordering::Relaxed;
    serde_json::json!({"policy":"native-once-v1", "requested":REQUESTED.load(Relaxed),"approved":APPROVED.load(Relaxed)})
}
static CONFIRMING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct ConfirmationGuard;
impl Drop for ConfirmationGuard {
    fn drop(&mut self) {
        CONFIRMING.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}
pub async fn confirm(
    app: tauri::AppHandle,
    action: &str,
    payload: &serde_json::Value,
) -> AppResult<()> {
    if !sensitive(action) {
        return Ok(());
    }
    if CONFIRMING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
        )
        .is_err()
    {
        return Err(AppError::Permission("Another confirmation is open".into()));
    }
    REQUESTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let guard = ConfirmationGuard;
    // The exact operation is owned by this invocation, not a reusable token or mutable frontend task.
    let detail = match action {
        "provider.configure" => format!("Change AI/network configuration\nProvider: {}\nEndpoint: {}\nSaved credentials may be sent to this endpoint.",payload["provider"].as_str().unwrap_or("none"),payload["endpoint"].as_str().unwrap_or("local")),
        "clipboard.read" | "clipboard.to_pocket" => "Read clipboard text once".to_string(),
        "clipboard.write" => "Replace clipboard text once".to_string(),
        "calendar.create" | "calendar.update" => format!(
            "{}: {}\n{} → {}",
            action,
            payload["title"].as_str().unwrap_or("event"),
            payload["start"].as_str().unwrap_or(""),
            payload["end"].as_str().unwrap_or("")
        ),
        _ => format!(
            "{}\nItem: {}",
            action,
            payload["id"]
                .as_str()
                .or(payload["name"].as_str())
                .unwrap_or("selected item")
        ),
    };
    let approved = tokio::task::spawn_blocking(move || {
        let _guard = guard;
        let dialog = app.dialog()
            .message(detail.chars().take(600).collect::<String>())
            .title("NYRC — confirm this operation")
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                "Deny".into(),
                "Allow once".into(),
                "Cancel".into(),
            ));
        let dialog = if let Some(window) = app.get_webview_window("settings").filter(|w| w.is_visible().unwrap_or(false))
            .or_else(|| app.get_webview_window("main")) {
            dialog.parent(&window)
        } else { dialog };
        dialog.blocking_show_with_result()
    })
    .await
    .map_err(|_| AppError::Permission("Confirmation unavailable".into()))?;
    if matches!(approved, MessageDialogResult::Custom(ref button) if button == "Allow once") {
        APPROVED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err(AppError::Permission("Action denied".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sensitive_commands_cannot_opt_out() {
        for action in [
            "clipboard.read",
            "clipboard.write",
            "clipboard.to_pocket",
            "calendar.create",
            "calendar.update",
            "calendar.delete",
            "pocket.delete",
            "inbox.approve",
        ] {
            assert!(sensitive(action));
        }
        for action in [
            "calendar.list",
            "calendar.get",
            "pocket.list",
            "developer.task.status",
        ] {
            assert!(!sensitive(action));
        }
    }
}
