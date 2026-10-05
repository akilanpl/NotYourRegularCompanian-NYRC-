//! Local aliases, assistant modes, and allowlisted desktop operations.

use crate::error::AppResult;
use crate::models::{AssistantMode, NewAssistantMode, NewUserAlias, UserAlias};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopActionError {
    pub code: String,
    pub message: String,
}

impl DesktopActionError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AliasInput {
    phrase: String,
    target_type: String,
    target: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeInput {
    name: String,
    actions: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn create_alias(state: State<'_, AppState>, alias: AliasInput) -> AppResult<UserAlias> {
    state.db.create_user_alias(validate_alias(alias)?)
}

#[tauri::command]
pub fn list_aliases(state: State<'_, AppState>) -> AppResult<Vec<UserAlias>> {
    state.db.list_user_aliases()
}

#[tauri::command]
pub fn update_alias(
    state: State<'_, AppState>,
    id: String,
    alias: AliasInput,
) -> AppResult<UserAlias> {
    state.db.update_user_alias(&id, validate_alias(alias)?)
}

#[tauri::command]
pub fn delete_alias(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_user_alias(&id)
}

#[tauri::command]
pub fn create_mode(state: State<'_, AppState>, mode: ModeInput) -> AppResult<AssistantMode> {
    state.db.create_assistant_mode(validate_mode(mode)?)
}

#[tauri::command]
pub fn list_modes(state: State<'_, AppState>) -> AppResult<Vec<AssistantMode>> {
    state.db.list_assistant_modes()
}

#[tauri::command]
pub fn update_mode(
    state: State<'_, AppState>,
    id: String,
    mode: ModeInput,
) -> AppResult<AssistantMode> {
    state.db.update_assistant_mode(&id, validate_mode(mode)?)
}

#[tauri::command]
pub fn delete_mode(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_assistant_mode(&id)
}

#[tauri::command]
pub fn open_website(url: String) -> Result<(), DesktopActionError> {
    validate_web_url(&url)?;
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let result = match std::env::var_os("WINDIR") {
        Some(windows_dir) => Command::new(
            std::path::PathBuf::from(windows_dir)
                .join("System32")
                .join("rundll32.exe"),
        )
        .args(["url.dll,FileProtocolHandler", &url])
        .status(),
        None => Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Windows directory is unavailable",
        )),
    };
    #[cfg(target_os = "linux")]
    let result = Command::new("/usr/bin/xdg-open").arg(&url).status();
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err(DesktopActionError::new(
            "open_failed",
            "Could not open website",
        )),
        Err(error) => Err(DesktopActionError::new("open_failed", error.to_string())),
    }
}

#[tauri::command]
pub fn open_application(application: String) -> Result<(), DesktopActionError> {
    let app = validate_application(&application)?;
    #[cfg(target_os = "macos")]
    let result = Command::new("/usr/bin/open").args(["-a", app]).status();
    #[cfg(not(target_os = "macos"))]
    let result: std::io::Result<std::process::ExitStatus> = Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Application aliases are supported on macOS only",
    ));
    match result {
        Ok(status) if status.success() => Ok(()),
        Ok(_) => Err(DesktopActionError::new(
            "application_unavailable",
            "Configured application is unavailable",
        )),
        Err(error) => Err(DesktopActionError::new(
            "application_unavailable",
            error.to_string(),
        )),
    }
}

#[tauri::command]
pub fn get_system_volume() -> Result<u8, DesktopActionError> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/osascript")
            .args(["-e", "output volume of (get volume settings)"])
            .output()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if !output.status.success() {
            return Err(DesktopActionError::new(
                "volume_unavailable",
                "Could not read system volume",
            ));
        }
        let value = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u8>()
            .map_err(|_| {
                DesktopActionError::new("volume_unavailable", "System returned an invalid volume")
            })?;
        return Ok(value.min(100));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "System volume control is supported on macOS only",
    ))
}

#[tauri::command]
pub fn set_system_volume(volume: i32) -> Result<u8, DesktopActionError> {
    let volume = clamp_system_volume(volume);
    #[cfg(target_os = "macos")]
    {
        let script = format!("set volume output volume {volume}");
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", &script])
            .status()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if status.success() {
            return Ok(volume);
        }

        return Err(DesktopActionError::new(
            "volume_unavailable",
            "Could not set system volume",
        ));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "System volume control is supported on macOS only",
    ))
}

fn clamp_system_volume(volume: i32) -> u8 {
    volume.clamp(0, 100) as u8
}

#[tauri::command]
pub fn set_system_mute(muted: bool) -> Result<bool, DesktopActionError> {
    #[cfg(target_os = "macos")]
    {
        let script = if muted {
            "set volume with output muted"
        } else {
            "set volume without output muted"
        };
        let status = Command::new("/usr/bin/osascript")
            .args(["-e", script])
            .status()
            .map_err(|error| DesktopActionError::new("volume_unavailable", error.to_string()))?;
        if status.success() {
            return Ok(muted);
        }
        return Err(DesktopActionError::new(
            "volume_unavailable",
            "Could not change mute state",
        ));
    }
    #[cfg(not(target_os = "macos"))]
    Err(DesktopActionError::new(
        "unsupported_on_current_platform",
        "Mute control is supported on macOS only",
    ))
}

#[tauri::command]
pub fn unsupported_desktop_capability(capability: String) -> Result<(), DesktopActionError> {
    match capability.as_str() {
        "media.play_pause" | "media.next" | "media.previous" => Err(DesktopActionError::new(
            "unsupported_capability",
            "Media controls are not available reliably on this platform",
        )),
        "system.focus.enable" | "system.dnd.enable" => Err(DesktopActionError::new(
            "unsupported_on_current_platform",
            "System Focus/DND control is not supported",
        )),
        _ => Err(DesktopActionError::new(
            "unsupported_action",
            "Unknown desktop capability",
        )),
    }
}

fn validate_alias(alias: AliasInput) -> AppResult<NewUserAlias> {
    let phrase = alias.phrase.trim();
    let normalized = normalize_phrase(phrase);
    if normalized.is_empty() || normalized.chars().count() > 80 {
        return Err(crate::error::AppError::InvalidInput(
            "Alias phrase must contain 1 to 80 characters".into(),
        ));
    }
    if !matches!(
        alias.target_type.as_str(),
        "website" | "application" | "mode"
    ) {
        return Err(crate::error::AppError::InvalidInput(
            "Unsupported alias target type".into(),
        ));
    }
    if alias.target.trim().is_empty() || alias.target.len() > 500 {
        return Err(crate::error::AppError::InvalidInput(
            "Alias target must contain 1 to 500 characters".into(),
        ));
    }
    if alias.target_type == "website" {
        validate_web_url(&alias.target)
            .map_err(|error| crate::error::AppError::InvalidInput(error.message))?;
    } else if alias.target_type == "application" {
        validate_application(&alias.target)
            .map_err(|error| crate::error::AppError::InvalidInput(error.message))?;
    }
    Ok(NewUserAlias {
        phrase: phrase.to_string(),
        target_type: alias.target_type,
        target: alias.target.trim().to_string(),
    })
}

fn validate_mode(mode: ModeInput) -> AppResult<NewAssistantMode> {
    let name = mode.name.trim();
    if name.is_empty() || name.chars().count() > 60 || mode.actions.len() > 20 {
        return Err(crate::error::AppError::InvalidInput(
            "Mode requires a name and at most 20 actions".into(),
        ));
    }
    Ok(NewAssistantMode {
        name: name.to_string(),
        actions: mode.actions,
    })
}

fn normalize_phrase(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn validate_web_url(value: &str) -> Result<(), DesktopActionError> {
    let value = value.trim();
    let scheme = value
        .split_once(':')
        .map(|(scheme, _)| scheme.to_ascii_lowercase());
    if !matches!(scheme.as_deref(), Some("https" | "http"))
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        || value.len() > 2_048
        || value.contains('\\')
    {
        return Err(DesktopActionError::new(
            "invalid_url",
            "Only valid HTTP or HTTPS URLs can be opened",
        ));
    }
    let authority = value
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""));
    let Some(authority) =
        authority.filter(|authority| !authority.is_empty() && !authority.contains('@'))
    else {
        return Err(DesktopActionError::new(
            "invalid_url",
            "URL must include a host",
        ));
    };
    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        let Some((host, rest)) = bracketed.split_once(']') else {
            return Err(DesktopActionError::new(
                "invalid_url",
                "URL host is invalid",
            ));
        };
        if !rest.is_empty() && !valid_port(rest.strip_prefix(':').unwrap_or("")) {
            return Err(DesktopActionError::new(
                "invalid_url",
                "URL port is invalid",
            ));
        }
        host
    } else {
        match authority.rsplit_once(':') {
            Some((host, port)) => {
                if authority.matches(':').count() != 1 || !valid_port(port) {
                    return Err(DesktopActionError::new(
                        "invalid_url",
                        "URL port is invalid",
                    ));
                }
                host
            }
            None => authority,
        }
    };
    let valid_ip = host.parse::<std::net::IpAddr>().is_ok();
    let valid_domain = !host.is_empty()
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
                && !label.starts_with('-')
                && !label.ends_with('-')
        });
    if !valid_ip && !valid_domain {
        return Err(DesktopActionError::new(
            "invalid_url",
            "URL host is invalid",
        ));
    }
    Ok(())
}

fn valid_port(value: &str) -> bool {
    value.parse::<u16>().map(|port| port > 0).unwrap_or(false)
}

fn validate_application(value: &str) -> Result<&'static str, DesktopActionError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "visual studio code" | "vscode" | "code" => Ok("Visual Studio Code"),
        "antigravity" => Ok("Antigravity"),
        "safari" => Ok("Safari"),
        "terminal" => Ok("Terminal"),
        _ => Err(DesktopActionError::new(
            "invalid_application",
            "Application is not in the configured allowlist",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_safe_urls_and_rejects_dangerous_or_malformed_inputs() {
        assert!(validate_web_url("https://example.com/path?q=1").is_ok());
        assert!(validate_web_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_web_url("http://[::1]:8080").is_ok());
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "shell:open",
            "https://user@host.com",
            "https://",
            "https://-bad.example",
            "https://bad host.example",
            "https://example.com:invalid",
        ] {
            assert_eq!(validate_web_url(url).unwrap_err().code, "invalid_url");
        }
    }

    #[test]
    fn only_allowlisted_application_names_are_accepted() {
        assert_eq!(validate_application("code").unwrap(), "Visual Studio Code");
        assert_eq!(validate_application("Antigravity").unwrap(), "Antigravity");
        assert_eq!(validate_application("Terminal").unwrap(), "Terminal");
        assert_eq!(
            validate_application("open -a Terminal").unwrap_err().code,
            "invalid_application"
        );
        assert_eq!(
            validate_application("/Applications/unsafe.app")
                .unwrap_err()
                .code,
            "invalid_application"
        );
    }

    #[test]
    fn alias_phrases_are_normalized_and_targets_are_validated() {
        let input = AliasInput {
            phrase: "  Back   To Studies ".to_string(),
            target_type: "website".to_string(),
            target: "https://chatgpt.com".to_string(),
        };
        let alias = validate_alias(input).unwrap();
        assert_eq!(alias.phrase, "Back   To Studies");
        assert_eq!(normalize_phrase(&alias.phrase), "back to studies");
        assert!(validate_alias(AliasInput {
            phrase: "bad".to_string(),
            target_type: "website".to_string(),
            target: "javascript:alert(1)".to_string(),
        })
        .is_err());
    }

    #[test]
    fn clamps_volume_and_reports_unsupported_capabilities_explicitly() {
        assert_eq!(clamp_system_volume(-20), 0);
        assert_eq!(clamp_system_volume(45), 45);
        assert_eq!(clamp_system_volume(120), 100);
        assert_eq!(
            unsupported_desktop_capability("media.next".to_string())
                .unwrap_err()
                .code,
            "unsupported_capability"
        );
        assert_eq!(
            unsupported_desktop_capability("system.dnd.enable".to_string())
                .unwrap_err()
                .code,
            "unsupported_on_current_platform"
        );
    }
}
