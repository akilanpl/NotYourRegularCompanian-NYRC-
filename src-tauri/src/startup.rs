use std::sync::atomic::{AtomicU8, Ordering};
/// Public phases carry no paths, migration payloads or credentials.
#[derive(Default)]
pub struct StartupState(AtomicU8);
impl StartupState {
    pub fn phase(&self) -> &'static str {
        match self.0.load(Ordering::Acquire) {
            1 => "ready",
            2 => "failed",
            _ => "preparing",
        }
    }
    pub fn finish(&self, successful: bool) {
        self.0
            .store(if successful { 1 } else { 2 }, Ordering::Release);
    }
}
#[tauri::command]
pub fn startup_phase(state: tauri::State<'_, StartupState>) -> &'static str {
    state.phase()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gates_service_mount_until_ready() {
        let state = StartupState::default();
        assert_eq!(state.phase(), "preparing");
        state.finish(true);
        assert_eq!(state.phase(), "ready");
    }
    #[test]
    fn initialization_failure_is_a_safe_phase() {
        let state = StartupState::default();
        state.finish(false);
        assert_eq!(state.phase(), "failed");
    }
}
