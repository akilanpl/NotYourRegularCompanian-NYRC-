//! Lifetime-held advisory lock: no second storage initializer/scheduler can run.
use fs2::FileExt;
use std::{
    fs::{File, OpenOptions},
    path::Path,
};
pub struct InstanceGuard(File);
impl InstanceGuard {
    pub fn acquire(home: &Path) -> crate::error::AppResult<Self> {
        let path = home.join("instance.lock");
        crate::sandbox::validate_storage_path(&path)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path)?;
        file.try_lock_exclusive().map_err(|_| {
            crate::error::AppError::Permission(
                "NYRC is already running for this storage directory".into(),
            )
        })?;
        Ok(Self(file))
    }
}
impl Drop for InstanceGuard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.0);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifetime_lock_blocks_second_and_releases() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        let first = InstanceGuard::acquire(&root).unwrap();
        assert!(InstanceGuard::acquire(&root).is_err());
        drop(first);
        assert!(InstanceGuard::acquire(&root).is_ok());
    }
}
