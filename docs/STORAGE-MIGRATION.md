# NYRC storage and recovery

The current directory is `<platform local-data>/nyrc/`, database `nyrc.db`.
`NYRC_HOME` selects an explicit absolute directory and skips automatic legacy
migration. Use a separate directory when testing. Runtime writes use only this
new home; secret-service identity is `com.nyrc.companion`, unchanged from the
assistant release. Keys remain in the OS credential store; unavailable keyring
access is a service error, with no plaintext fallback.

On the first default-home launch, the isolated compatibility module discovers
the old default directory or old environment override. It validates paths and
all source entries, opens SQLite read-only, checks integrity and recognized
schema, and uses SQLite backup to include committed WAL state. A sibling
`.nyrc-migration-pending` directory holds the snapshot and copied sandbox files.
Schema upgrades occur in a transaction. Default character naming is normalized;
custom names, memories, schedules, aliases, modes, Pocket and compatible settings
are retained. Provider references are copied without exposing credentials.

Publishing reserves the destination exclusively and moves staged entries into
it. This is safe against overwrites but is not a single atomic directory rename:
a crash during publication leaves a partial destination and/or staging directory.
Such states deliberately require recovery. The source is never deleted or
modified. Destination databases always take priority and are never overwritten.
A successful copy records `storage:migration:v1`; repeat launches are no-ops.

Failures return a structured code, message and recoveryPath at startup. Source
missing means a clean install. Missing/corrupt/unrecognized source database,
future schema, symlinks/special files, access denial, staging collision, and
partial destination halt migration without deleting any data. Close both builds,
back up the source, destination and staging directories, inspect them, then move
an incomplete destination/staging aside before retrying. Do not delete recovery
data unless you have verified the new database. `NYRC_HOME` can select an intact
NYRC backup. Diagnostics shows the active path and schema version without keys.

SQLite `PRAGMA user_version=1` identifies the current schema. Version 0 upgrades
in deterministic order: create baseline tables/indexes/triggers, add missing
`last_report_at`, set version, commit. Reopening version 1 does no schema work.
Future versions are refused. Failed upgrades roll back instead of marking a
partially upgraded schema as current.

## Locations, backup, reinstall and reset

- macOS: `~/Library/Application Support/nyrc`
- Windows: `%LOCALAPPDATA%\nyrc`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/nyrc`
- An explicit absolute `NYRC_HOME` replaces the default; diagnostics is the authority for the active location.

`nyrc.db` contains memories/interactions, settings, aliases/modes, schedules and Pocket text/link metadata. Pocket files and exports live alongside it in the sandbox. A manual backup must copy the **whole home after quitting NYRC**, including any SQLite WAL/SHM files. Copying only a live database can miss writes. Restore with NYRC closed, preserve a backup of the current home, restore the complete folder at its original location, then launch and check diagnostics/integrity. Do not restore a future-schema database to an older binary.

Replacing/reinstalling the app does not reset storage or rerun completed migration. Removing the macOS .app, Windows installer-managed binaries or Linux package does not intentionally remove the separate local-data home or OS credential entries. A full manual reset is deliberate: remove provider keys in Settings → AI; disconnect Calendar; quit all NYRC instances; back up the home; move the exact home folder aside. Launch to verify fresh onboarding. Moving it aside is reversible; delete the backup only after deciding it is no longer needed. Do not delete a symlink target or a guessed parent directory.

For a complete credential cleanup when the UI cannot start, inspect your OS credential manager for NYRC-owned service `com.nyrc.companion` entries: `cloud_api_key:openai`, `cloud_api_key:gemini`, `calendar:client_secret`, `calendar:refresh_token`. Remove only those entries. Exported copies outside NYRC's home must be removed separately. Memory export is available in Settings → Advanced → Export memories as JSON; Pocket entries and scheduled items have individual deletion controls.
