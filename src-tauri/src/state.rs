use crate::db::Db;
use crate::llm::{CooldownManager, LlmProvider};
use crate::watcher::WatcherHandle;
use parking_lot::{Mutex, RwLock};
use std::path::PathBuf;
use std::sync::Arc;

/// Shared application state held by tauri's `manage`. Dropping `AppState`
/// (which happens at app shutdown) will release the watcher handle, signaling
/// the inbox watcher thread to exit cleanly.
pub struct AppState {
    pub db: Arc<Db>,
    pub pet_home: PathBuf,
    pub llm: Arc<RwLock<Option<Arc<dyn LlmProvider>>>>,
    pub cooldown: Arc<CooldownManager>,
    pub provider_generation: std::sync::atomic::AtomicU64,
    pub service_requests: Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
    pub watcher: Mutex<Option<WatcherHandle>>,
}

impl AppState {
    pub fn new(db: Arc<Db>, pet_home: PathBuf) -> Self {
        Self {
            db,
            pet_home,
            llm: Arc::new(RwLock::new(None)),
            cooldown: Arc::new(CooldownManager::new()),
            provider_generation: std::sync::atomic::AtomicU64::new(0),
            service_requests: Mutex::new(std::collections::HashMap::new()),
            watcher: Mutex::new(None),
        }
    }

    pub fn set_llm(&self, provider: Option<Arc<dyn LlmProvider>>) {
        let mut slot = self.llm.write();
        *slot = provider;
        self.provider_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn set_watcher(&self, handle: WatcherHandle) {
        *self.watcher.lock() = Some(handle);
    }
}
