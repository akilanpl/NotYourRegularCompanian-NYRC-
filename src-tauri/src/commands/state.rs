//! Pet state, settings, secrets, and the app/window commands.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::ollama::OllamaProvider;
use crate::llm::provider::LlmProvider;
use crate::models::{
    endpoint_is_loopback, normalize_stage_background, now_rfc3339, PetState, Settings,
};
use crate::sandbox::{builtin_skills, SkillManifest};
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

const SETTINGS_KEY: &str = "settings:v1";
const CLOUD_API_KEY_SECRET: &str = "cloud_api_key";
const PET_STATE_ID: &str = "default";

// ============== Pet state ==============

#[tauri::command]
pub fn get_pet_state(state: State<'_, AppState>) -> AppResult<PetState> {
    load_or_init_pet_state(&state.db)
}

pub(crate) fn load_or_init_pet_state(db: &Db) -> AppResult<PetState> {
    if let Some(s) = db.load_pet_state(PET_STATE_ID)? {
        return Ok(s);
    }
    let settings = load_settings_raw(db)?;
    let mut s = PetState::new(settings.pet_name);
    s.id = PET_STATE_ID.to_string();
    db.save_pet_state(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn save_pet_state(state: State<'_, AppState>, mut pet: PetState) -> AppResult<PetState> {
    pet.id = PET_STATE_ID.to_string();
    pet.updated_at = now_rfc3339();
    state.db.save_pet_state(&pet)?;
    Ok(pet)
}

/// Cleanly terminate the entire app process. Invoked from the pet's right-click
/// menu — the main window is frameless, so users have no native close button.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// REQ-115 — show the settings window. It is declared `visible: false` in
/// tauri.conf.json and hidden-on-close (see lib.rs), so the pet's context
/// menu is the one and only way users reach Settings.
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> AppResult<()> {
    use tauri::Manager;
    let window = app
        .get_webview_window("settings")
        .ok_or_else(|| AppError::NotFound("settings window".to_string()))?;
    window
        .show()
        .map_err(|e| AppError::Internal(format!("show settings window: {e}")))?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

// ============== Settings (secrets handled separately) ==============

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    let mut s = load_settings_raw(&state.db)?;
    s.cloud_api_key_set = key_present(&state.db)?;
    Ok(s)
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    if settings.local_only_mode
        && settings.llm_provider == "ollama"
        && !endpoint_is_loopback(&settings.ollama_endpoint)
    {
        return Err(AppError::InvalidInput(
            "local-only mode requires a loopback Ollama endpoint (localhost / 127.0.0.1 / ::1)"
                .into(),
        ));
    }

    settings.personality.validate()?;
    let provider = configure_provider(&settings)?;
    let mut to_persist = settings.clone();
    to_persist.cloud_api_key_set = false; // never persist this flag
                                          // REQ-114 — clamp to the closed background list so an arbitrary string
                                          // can never reach the frontend's data attribute.
    to_persist.stage_background =
        normalize_stage_background(&to_persist.stage_background).to_string();
    let json = serde_json::to_string(&to_persist)?;
    state.db.put_setting(SETTINGS_KEY, &json)?;

    state.set_llm(provider);

    let mut echoed = to_persist;
    echoed.cloud_api_key_set = key_present(&state.db)?;
    Ok(echoed)
}

/// True if a non-empty cloud API key is currently stored.
fn key_present(db: &Db) -> AppResult<bool> {
    // One-way upgrade of the legacy SQLite setting; only delete after secure save.
    if let Some(old) = db.get_setting(CLOUD_API_KEY_SECRET)? {
        if !old.is_empty() {
            crate::secrets::set("cloud_api_key:openai", Some(&old))?;
        }
        db.delete_setting(CLOUD_API_KEY_SECRET)?;
    }
    let settings = load_settings_raw(db)?;
    Ok(crate::secrets::get(cloud_key_name(&settings))?.is_some())
}
#[tauri::command]
pub fn set_cloud_api_key(state: State<'_, AppState>, key: Option<String>) -> AppResult<bool> {
    let settings = load_settings_raw(&state.db)?;
    if matches!(settings.llm_provider.as_str(), "openai" | "gemini")
        && key.as_ref().is_some_and(|k| !k.is_empty())
    {
        // Validate before storing: a failed configuration must not leave a saved key behind.
        crate::llm::cloud::CloudProvider::new(
            settings.llm_provider.clone(),
            settings.cloud_endpoint.clone(),
            settings.cloud_model.clone(),
            String::new(),
            settings.provider_timeout,
        )?;
    }
    let present = crate::secrets::set(cloud_key_name(&settings), key.as_deref())?;
    state.db.delete_setting(CLOUD_API_KEY_SECRET)?;
    state.set_llm(configure_provider(&settings)?);
    Ok(present)
}
fn cloud_key_name(settings: &Settings) -> &'static str {
    if settings.llm_provider == "gemini" {
        "cloud_api_key:gemini"
    } else {
        "cloud_api_key:openai"
    }
}
pub(crate) fn configure_provider(settings: &Settings) -> AppResult<Option<Arc<dyn LlmProvider>>> {
    match settings.llm_provider.as_str() {
        "none" => Ok(None),
        "ollama" => {
            crate::llm::cloud::validate_endpoint(
                &settings.ollama_endpoint,
                settings.local_only_mode,
            )?;
            Ok(Some(Arc::new(OllamaProvider::new(
                settings.ollama_endpoint.clone(),
                settings.ollama_model.clone(),
            ))))
        }
        "openai" | "gemini" => {
            crate::llm::cloud::validate_endpoint(&settings.cloud_endpoint, false)?;
            if settings.llm_provider == "gemini"
                && settings.cloud_endpoint != "https://generativelanguage.googleapis.com/v1beta"
            {
                return Err(AppError::InvalidInput(
                    "use the official Gemini endpoint".into(),
                ));
            }
            if settings.local_only_mode {
                return Ok(None);
            }
            let key = match crate::secrets::get(cloud_key_name(settings))? {
                Some(k) => k,
                None => return Ok(None),
            };
            Ok(Some(Arc::new(crate::llm::cloud::CloudProvider::new(
                settings.llm_provider.clone(),
                settings.cloud_endpoint.clone(),
                settings.cloud_model.clone(),
                key,
                settings.provider_timeout,
            )?)))
        }
        _ => Err(AppError::InvalidInput("unknown provider".into())),
    }
}
#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>) -> AppResult<String> {
    let p = state.llm.read().clone().ok_or_else(|| {
        AppError::LlmUnavailable("configure a provider and credential first".into())
    })?;
    p.complete(crate::llm::provider::LlmRequest {
        system: Some("Reply with OK".into()),
        prompt: "Connection test".into(),
        max_tokens: Some(20),
        temperature: Some(0.0),
        model: None,
    })
    .await?;
    Ok("Connected".into())
}

pub(crate) fn load_settings_raw(db: &Db) -> AppResult<Settings> {
    if let Some(raw) = db.get_setting(SETTINGS_KEY)? {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return Ok(s);
        }
    }
    Ok(Settings::default())
}

// ============== Skills ==============

#[tauri::command]
pub fn list_skills(_state: State<'_, AppState>) -> AppResult<Vec<SkillManifest>> {
    Ok(builtin_skills())
}

#[tauri::command]
pub fn get_product_notices() -> serde_json::Value {
    serde_json::json!({"license":include_str!("../../../LICENSE"),"notices":include_str!("../../../THIRD_PARTY_NOTICES.md")})
}
