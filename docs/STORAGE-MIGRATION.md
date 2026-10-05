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
