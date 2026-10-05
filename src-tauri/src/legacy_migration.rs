//! Isolated, read-only compatibility identifiers. Never write to the legacy home.
use crate::{db::Db, sandbox};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationError {
    pub code: &'static str,
    pub message: String,
    pub recovery_path: PathBuf,
}
fn failure(code: &'static str, path: &Path, e: impl std::fmt::Display) -> MigrationError {
    MigrationError {
        code,
        message: format!("{e}. Source retained; inspect the recovery path before retrying."),
        recovery_path: path.into(),
    }
}
pub fn legacy_home() -> Option<PathBuf> {
    std::env::var_os("MOCHI_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            dirs::data_local_dir()
                .or_else(dirs::data_dir)
                .map(|p| p.join("pet-mochi"))
        })
}
pub fn migrate(source: &Path, destination: &Path) -> Result<bool, MigrationError> {
    if destination.exists() {
        sandbox::validate_storage_tree(destination)
            .map_err(|e| failure("unsafe_destination", destination, e))?;
        if !destination.join("nyrc.db").is_file() {
            return Err(failure(
                "partial_destination",
                destination,
                "Destination exists without its database; it was not overwritten",
            ));
        }
        Db::open(&destination.join("nyrc.db"))
            .map_err(|e| failure("destination_invalid", destination, e))?;
        return Ok(false);
    }
    if !source.exists() {
        return Ok(false);
    }
    sandbox::validate_storage_tree(source).map_err(|e| failure("unsafe_source", source, e))?;
    let old = source.join("mochi.db");
    if !old.is_file() {
        return Err(failure(
            "missing_database",
            source,
            "Legacy database missing",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| failure("invalid_destination", destination, "Missing parent"))?;
    sandbox::validate_storage_path(parent).map_err(|e| failure("unsafe_parent", parent, e))?;
    std::fs::create_dir_all(parent).map_err(|e| failure("permission_denied", parent, e))?;
    // A deterministic staging directory lets interrupted attempts be recovered without deleting data.
    let stage = parent.join(".nyrc-migration-pending");
    std::fs::create_dir(&stage).map_err(|e| failure("migration_pending", &stage, e))?;
    sandbox::secure_storage_directory(&stage)
        .map_err(|e| failure("permission_denied", &stage, e))?;
    let result = (|| -> crate::error::AppResult<()> {
        let src = Connection::open_with_flags(
            &old,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
        )?;
        let integrity: String = src.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if integrity != "ok" {
            return Err(crate::error::AppError::InvalidInput(
                "Source database is corrupt".into(),
            ));
        }
        let known:i64=src.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('pet_state','memories')",[],|r|r.get(0))?;
        if known != 2 {
            return Err(crate::error::AppError::InvalidInput(
                "Unrecognized source database schema".into(),
            ));
        }
        let mut dst = Connection::open(stage.join("nyrc.db"))?;
        rusqlite::backup::Backup::new(&src, &mut dst)?.run_to_completion(
            128,
            std::time::Duration::from_millis(5),
            None,
        )?;
        drop(dst);
        drop(src);
        let db = Db::open(&stage.join("nyrc.db"))?;
        // Rename only the old default character name, preserving user-defined names.
        if let Some(mut state) = db.load_pet_state("default")? {
            if state.name == "Mochi" {
                state.name = "NYRC".into();
                db.save_pet_state(&state)?;
            }
        }
        if let Some(raw) = db.get_setting("settings:v1")? {
            if let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&raw) {
                if settings["petName"] == "Mochi" {
                    settings["petName"] = "NYRC".into();
                }
                settings["petHomePath"] = serde_json::Value::Null;
                db.put_setting("settings:v1", &serde_json::to_string(&settings)?)?;
            }
        }
        db.put_setting("storage:migration:v1", "copied; source retained")?;
        drop(db);
        sandbox::copy_storage_contents(
            source,
            &stage,
            &["mochi.db", "mochi.db-wal", "mochi.db-shm"],
        )?;
        sandbox::publish_storage(&stage, destination)?;
        Ok(())
    })();
    result.map_err(|e| failure("migration_failed", &stage, e))?;
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_preserves_data_and_reopens_without_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let t = temp.path().canonicalize().unwrap();
        let old = t.as_path().join("pet-mochi");
        let new = t.as_path().join("nyrc");
        std::fs::create_dir(&old).unwrap();
        let db = Db::open(&old.join("mochi.db")).unwrap();
        db.save_pet_state(&crate::models::PetState::new("Mochi"))
            .unwrap();
        db.put_setting("test", "retained").unwrap();
        let memory = db
            .create_memory(crate::models::NewMemory {
                r#type: "note".into(),
                content: "migration memory".into(),
                importance: None,
                confidence: None,
                source_interaction_id: None,
            })
            .unwrap();
        let pocket = crate::commands::save_pocket(
            &db,
            "text",
            "migration Pocket",
            "retained content".into(),
            1024,
        )
        .unwrap();
        let alias = db
            .create_user_alias(crate::models::NewUserAlias {
                phrase: "open test".into(),
                target_type: "website".into(),
                target: "https://example.com".into(),
            })
            .unwrap();
        let mode = db
            .create_assistant_mode(crate::models::NewAssistantMode {
                name: "test".into(),
                actions: vec![
                    serde_json::json!({"id":"system.volume.get","payload":{},"permission":"none"}),
                ],
            })
            .unwrap();
        let schedule = db
            .create_scheduled_item(crate::models::NewScheduledItem {
                kind: crate::models::ScheduledItemKind::Reminder,
                title: "migration reminder".into(),
                message: None,
                scheduled_at: "2027-01-01T00:00:00Z".into(),
                timezone: None,
                recurrence: None,
                metadata: None,
            })
            .unwrap();
        sandbox::ensure_pet_home(&old).unwrap();
        std::fs::write(old.join("notes/retained.txt"), "retained file").unwrap();
        assert!(migrate(&old, &new).unwrap());
        assert!(old.join("mochi.db").exists());
        let migrated = Db::open(&new.join("nyrc.db")).unwrap();
        assert_eq!(
            migrated.get_setting("test").unwrap().as_deref(),
            Some("retained")
        );
        assert_eq!(
            migrated.load_pet_state("default").unwrap().unwrap().name,
            "NYRC"
        );
        assert_eq!(migrated.list_memories(10).unwrap()[0].id, memory.id);
        assert_eq!(
            migrated.get_pocket_item(&pocket.id).unwrap().content,
            "retained content"
        );
        assert_eq!(migrated.list_user_aliases().unwrap()[0].id, alias.id);
        assert_eq!(migrated.list_assistant_modes().unwrap()[0].id, mode.id);
        assert_eq!(
            migrated
                .get_scheduled_item(&schedule.id)
                .unwrap()
                .unwrap()
                .title,
            "migration reminder"
        );
        assert_eq!(
            std::fs::read_to_string(new.join("notes/retained.txt")).unwrap(),
            "retained file"
        );
        migrated.put_setting("test", "newer").unwrap();
        assert!(!migrate(&old, &new).unwrap());
        assert_eq!(
            migrated.get_setting("test").unwrap().as_deref(),
            Some("newer")
        );
    }
    #[test]
    fn missing_corrupt_interrupted_partial_and_future_are_retained() {
        let temp = tempfile::tempdir().unwrap();
        let t = temp.path().canonicalize().unwrap();
        let old = t.as_path().join("old");
        let new = t.as_path().join("nyrc");
        assert!(!migrate(&old, &new).unwrap());
        std::fs::create_dir(&old).unwrap();
        assert_eq!(migrate(&old, &new).unwrap_err().code, "missing_database");
        std::fs::write(old.join("mochi.db"), "corrupt").unwrap();
        assert_eq!(migrate(&old, &new).unwrap_err().code, "migration_failed");
        assert!(!new.exists());
        assert_eq!(migrate(&old, &new).unwrap_err().code, "migration_pending");
        std::fs::create_dir(&new).unwrap();
        assert_eq!(migrate(&old, &new).unwrap_err().code, "partial_destination");
        let future = t.as_path().join("future.db");
        let c = Connection::open(&future).unwrap();
        c.pragma_update(None, "user_version", 99).unwrap();
        assert!(Db::open(&future).is_err());
        assert_eq!(
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            99
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlink_source_refused() {
        let temp = tempfile::tempdir().unwrap();
        let t = temp.path().canonicalize().unwrap();
        let old = t.as_path().join("old");
        std::os::unix::fs::symlink(t.as_path(), &old).unwrap();
        assert_eq!(
            migrate(&old, &t.as_path().join("nyrc")).unwrap_err().code,
            "unsafe_source"
        );
    }
    #[cfg(unix)]
    #[test]
    fn permission_denial_retains_source_and_does_not_publish() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let source = root.join("source");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("mochi.db"), "retained").unwrap();
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o000)).unwrap();
        let result = migrate(&source, &root.join("nyrc"));
        std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert!(!root.join("nyrc").exists());
        assert_eq!(
            std::fs::read_to_string(source.join("mochi.db")).unwrap(),
            "retained"
        );
    }
}

#[cfg(test)] mod torture_tests {
    use super::*;
    #[test] fn reasonable_large_snapshot_and_existing_destination_are_never_overwritten() {
        let d=tempfile::tempdir().unwrap();let root=d.path().canonicalize().unwrap();let old=root.join("source");let new=root.join("destination");sandbox::ensure_pet_home(&old).unwrap();
        let db=Db::open(&old.join("mochi.db")).unwrap();
        for i in 0..300 {db.put_setting(&format!("fixture:{i}"),&"x".repeat(4096)).unwrap();}
        for i in 0..30 {std::fs::write(old.join(format!("notes/{i}.txt")),vec![b'x';65536]).unwrap();}
        drop(db);assert!(migrate(&old,&new).unwrap());assert_eq!(std::fs::read(new.join("notes/29.txt")).unwrap().len(),65536);
        Db::open(&new.join("nyrc.db")).unwrap().put_setting("fixture:0","new state").unwrap();assert!(!migrate(&old,&new).unwrap());assert_eq!(Db::open(&old.join("mochi.db")).unwrap().get_setting("fixture:0").unwrap().unwrap().len(),4096);
    }
    #[cfg(unix)] #[test] fn symlink_inside_source_and_destination_collision_preserve_source() {
        let d=tempfile::tempdir().unwrap();let root=d.path().canonicalize().unwrap();let old=root.join("source");sandbox::ensure_pet_home(&old).unwrap();drop(Db::open(&old.join("mochi.db")).unwrap());
        std::os::unix::fs::symlink(root.join("outside"),old.join("notes/link")).unwrap();assert_eq!(migrate(&old,&root.join("new")).unwrap_err().code,"unsafe_source");assert!(old.join("mochi.db").is_file());
        std::fs::write(root.join("collision"),"retained").unwrap();assert!(migrate(&old,&root.join("collision")).is_err());assert_eq!(std::fs::read_to_string(root.join("collision")).unwrap(),"retained");
    }
}
