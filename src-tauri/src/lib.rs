pub mod commands;
pub mod db;
pub mod error;
pub mod llm;
pub mod models;
pub mod sandbox;
pub mod state;
pub mod watcher;
pub mod secrets;
pub mod developer;
pub mod personality;

use std::path::PathBuf;
use std::sync::Arc;

use crate::db::Db;
use crate::models::Settings;
use crate::sandbox::{default_pet_home, ensure_pet_home};
use crate::state::AppState;
use tauri::Manager;

const SETTINGS_KEY: &str = "settings:v1";
const DB_FILE: &str = "mochi.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let pet_home = resolve_pet_home();
            ensure_pet_home(&pet_home).expect("could not create pet_home");
            let db_path = pet_home.join(DB_FILE);
            let db = Arc::new(Db::open(&db_path).expect("could not open mochi.db"));

            let app_state = AppState::new(db.clone(), pet_home.clone());

            let settings = db
                .get_setting(SETTINGS_KEY)
                .ok()
                .flatten()
                .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
                .unwrap_or_default();

            if let Ok(provider) = commands::configure_provider(&settings) { app_state.set_llm(provider); }

            let app_handle = app.handle().clone();
            match crate::watcher::spawn_inbox_watcher(app_handle, pet_home) {
                Ok(handle) => app_state.set_watcher(handle),
                Err(e) => log::warn!("could not spawn inbox watcher: {e}"),
            }
            app.manage(app_state);
            Ok(())
        })
        // REQ-115 — the settings window is created hidden and re-shown by the
        // open_settings command; closing it hides instead of destroying so it
        // can always be reopened from the pet's context menu.
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_pet_state,
            commands::save_pet_state,
            commands::quit_app,
            commands::open_settings,
            commands::get_settings,
            commands::test_provider,
            commands::calendar::get_calendar_config,
            commands::calendar::save_calendar_config,
            commands::calendar::disconnect_calendar,
            commands::save_settings,
            commands::set_cloud_api_key,
            commands::list_memories,
            commands::create_memory,
            commands::delete_memory,
            commands::search_memories,
            commands::export_memories,
            commands::send_message,
            commands::assistant_interpret,
            commands::assistant_service,
            commands::set_pocket_limit,
            commands::autonomous_speak,
            commands::list_inbox_files,
            commands::approve_file,
            commands::run_daily_reflection,
            commands::get_last_reflection,
            commands::run_status_report,
            commands::list_status_reports,
            commands::choose_choreography,
            commands::generate_interaction_report,
            commands::get_event_log,
            commands::log_event,
            commands::list_skills,
            commands::create_scheduled_item,
            commands::get_scheduled_item,
            commands::list_scheduled_items,
            commands::update_scheduled_item,
            commands::cancel_scheduled_item,
            commands::dismiss_scheduled_item,
            commands::claim_due_scheduled_items,
            commands::create_alias,
            commands::list_aliases,
            commands::update_alias,
            commands::delete_alias,
            commands::create_mode,
            commands::list_modes,
            commands::update_mode,
            commands::delete_mode,
            commands::open_website,
            commands::open_application,
            commands::get_system_volume,
            commands::set_system_volume,
            commands::set_system_mute,
            commands::unsupported_desktop_capability,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_pet_home() -> PathBuf {
    if let Ok(env_path) = std::env::var("MOCHI_HOME") {
        return PathBuf::from(env_path);
    }
    default_pet_home().unwrap_or_else(|_| PathBuf::from("./pet_home"))
}
