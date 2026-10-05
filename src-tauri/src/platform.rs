pub mod desktop;
// Host-owned capability registry. Device claims never grant desktop permissions.
use crate::state::AppState;
use serde::Serialize;
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Supported,
    Unsupported,
    PermissionRequired,
    TemporarilyUnavailable,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub id: &'static str,
    pub status: CapabilityStatus,
    pub reason: &'static str,
}
pub fn registry(os: &str, calendar_connected: bool) -> Vec<Capability> {
    use CapabilityStatus::*;
    let mac = os == "macos";
    let desktop = if mac { Supported } else { Unsupported };
    let mut result = Vec::new();
    for id in [
        "system.volume.read",
        "system.volume.write",
        "system.mute",
        "app.launch",
        "web.open",
    ] {
        result.push(Capability {
            id,
            status: desktop.clone(),
            reason: if mac {
                "macOS adapter"
            } else {
                "Adapter not verified on this platform"
            },
        });
    }
    for id in ["system.media", "system.focus"] {
        result.push(Capability {
            id,
            status: Unsupported,
            reason: "No supported host adapter",
        });
    }
    for id in [
        "clipboard.read",
        "clipboard.write",
        "desktop.notifications",
        "secure.secrets",
    ] {
        result.push(Capability {
            id,
            status: PermissionRequired,
            reason: "Requires per-action approval or OS access; runtime errors report availability",
        });
    }
    result.push(Capability {
        id: "filesystem.pocket",
        status: Supported,
        reason: "Sandboxed local storage",
    });
    result.push(Capability {
        id: "calendar",
        status: if calendar_connected {
            Supported
        } else {
            TemporarilyUnavailable
        },
        reason: if calendar_connected {
            "Configured provider; credentials checked by provider"
        } else {
            "Calendar disconnected or local-only mode"
        },
    });
    result
}
#[tauri::command]
pub fn get_platform_capabilities(state: tauri::State<'_, AppState>) -> Vec<Capability> {
    let enabled = state
        .db
        .get_setting("calendar:v1")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .is_some_and(|v| v["enabled"] == true);
    let local = state
        .db
        .get_setting("settings:v1")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<crate::models::Settings>(&s).ok())
        .map_or(true, |s| s.local_only_mode);
    registry(std::env::consts::OS, enabled && !local)
}
#[tauri::command]
pub fn get_diagnostics(state: tauri::State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({"product":"NYRC","platform":std::env::consts::OS,"storagePath":state.pet_home,"database":"nyrc.db","schemaVersion":crate::db::SCHEMA_VERSION,"authority":crate::authority::diagnostics(),"capabilities":get_platform_capabilities(state)})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_platform_contracts() {
        for os in ["windows", "linux"] {
            let r = registry(os, false);
            assert_eq!(
                r.iter()
                    .find(|c| c.id == "system.volume.write")
                    .unwrap()
                    .status,
                CapabilityStatus::Unsupported
            );
            assert_eq!(
                r.iter().find(|c| c.id == "calendar").unwrap().status,
                CapabilityStatus::TemporarilyUnavailable
            );
        }
        assert_eq!(
            registry("macos", true)
                .iter()
                .find(|c| c.id == "system.volume.read")
                .unwrap()
                .status,
            CapabilityStatus::Supported
        );
    }
}
