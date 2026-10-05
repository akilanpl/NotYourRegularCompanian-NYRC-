//! Native credential store; no plaintext fallback.
use crate::error::{AppError, AppResult};
fn entry(name: &str) -> AppResult<keyring::Entry> {
    keyring::Entry::new("com.nyrc.companion", name)
        .map_err(|_| AppError::Internal("secure credential store unavailable".into()))
}
pub fn get(name: &str) -> AppResult<Option<String>> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(AppError::Internal(
            "secure credential store unavailable".into(),
        )),
    }
}
pub fn set(name: &str, value: Option<&str>) -> AppResult<bool> {
    let e = entry(name)?;
    match value.filter(|s| !s.is_empty()) {
        Some(v) => {
            if v.len() > 4096 {
                return Err(AppError::InvalidInput("credential too long".into()));
            }
            e.set_password(v)
                .map_err(|_| AppError::Internal("could not save credential securely".into()))?;
            Ok(true)
        }
        None => {
            match e.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(_) => return Err(AppError::Internal("could not remove credential".into())),
            };
            Ok(false)
        }
    }
}
