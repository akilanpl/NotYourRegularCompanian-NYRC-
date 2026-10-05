# Prompt 2 validation

NYRC package/executable, `nyrc_lib`, NYRC.app, com.nyrc.companion, nyrc/nyrc.db,
NYRC_HOME, generic renderer and companion-* assets are in place. The active
identity audit has zero matches outside the isolated migration module/tests and
THIRD_PARTY_NOTICES.md. MIT copyright/license provenance is retained.

Validation on macOS:

- Svelte check: 0 errors, 0 warnings.
- Vitest: 366 tests in 35 files passed.
- Rust library tests: 115 passed, including SQLite snapshot/persistence,
  transactional schema upgrade/rollback, idempotency, corrupt/partial/interrupted
  recovery, future versions, denied access and symlink rejection; body schemas,
  real loopback pairing/ACK/dedup/reconnect/oversize and fragmented-frame
  cancellation; platform contracts and existing provider/service regressions.
- Frontend production build and cargo build passed.
- Debug and optimized release macOS .app bundles built successfully. The release
  bundle includes LICENSE and THIRD_PARTY_NOTICES.md resources.
- git diff --check passed.

Native CUA smoke: NYRC app/menu/settings identity; time; short timer firing;
reminder scheduling/firing; Pocket migrated item visible after restart; alias
creation/execution; Work mode; Focus mode partial success; volume restored to
94 after testing; settings platform/storage/body diagnostics; virtual connect,
touch, shake, low battery, disconnect input refusal, reconnect and malformed
input refusal. The final optimized release app launched and passed time/Pocket
checks. The local fixture paired with the final debug app and received cached
neutral, touch, shake, low-battery expression/animation/sound commands, then ACKed
them. Transport stopped after the test; pairing token was not retained.

Before migration, the source had schema 0, one scheduled item, four modes and one
Pocket item. The copied destination had schema 1 and matching counts; source
retained schema 0. Subsequent smoke tests created one alias and one reminder in
the new database only. No existing source data was deleted. Migration's staged
publication deliberately leaves recovery artifacts on interruption; see
STORAGE-MIGRATION.md for recovery and the non-atomic publication limitation.

`npm run tauri:dev` started Vite and the executable, but this shell's macOS GUI
launch reported WindowServer/XPC errors. Native checks used the built .app via
CUA and are automated UI smoke tests, not human manual testing.

Cloud/Google Calendar live operations were not tested: no cloud key was stored,
calendar was disabled, and local-only mode was enabled. Mock calendar, fake local
provider success/401/429/malformed/unavailable cases and credential-free failures
remain covered. No physical ESP32/BLE/Raspberry Pi hardware was available; the
real loopback transport and virtual device are tested. Speech/microphone work is
not implemented by placeholder messages. Windows/Linux native controls are
explicitly unverified/unsupported.

Screenshots: [standalone assistant](standalone-smoke.png),
[body diagnostics and malformed-event refusal](body-smoke.png).

Prompt 3 remains the visual/frontend redesign: final character/art, visual
identity, layout and interaction polish. No visual redesign was started here.
