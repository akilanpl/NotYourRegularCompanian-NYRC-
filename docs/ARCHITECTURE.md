# NYRC architecture

NYRC is a standalone Tauri desktop product with a local SQLite brain. The pure
simulation continues without AI. The unified assistant routes deterministic
commands first; optional model proposals pass a closed schema and permission
checks through TaskManager. Local timers, persistent scheduling, aliases/modes,
Pocket, clipboard, Google Calendar and developer events share semantic reactions.
Provider secrets live in the OS credential store.

`platform/capabilities.ts` maps actions to the host-owned capability registry.
The backend reports supported, unsupported, permission_required or
temporarily_unavailable. A capability claim from a body cannot enable a host
operation. The macOS desktop adapter wraps fixed, validated OS operations;
Windows/Linux contracts explicitly mark unverified desktop actions unsupported.
Cross-platform Pocket/SQLite and credential/notification/clipboard contracts
retain their existing permission and runtime error boundaries. Modes check each
step and report partial success. Calendar availability follows configuration
and local-only mode, with credential failures reported by the provider.

`body/protocol.ts` defines bounded versioned events/commands. `BodyCore` receives
interaction hints, selects semantic reactions and sends capability-filtered
commands through BodyAdapter. DesktopBodyAdapter feeds CharacterRenderer and
the generic SpriteRenderer. VirtualBodyAdapter exposes a compact simulator in
Devices settings. LocalTransportBodyAdapter bridges the authenticated Rust
loopback transport. Multiple body IDs share the host brain; they do not hold
separate memories or grant permissions. Expression/text cache allows reconnect
sync without invoking a model; transient sounds/haptics are not replayed.

Settings diagnostics reports platform support, storage path/schema and body
connection/capability/event/error state. Protocol tokens appear only in the
explicit pairing panel, never diagnostic JSON. See BODY-PROTOCOL.md and
STORAGE-MIGRATION.md for operational details. Original SVG expressions now replace temporary raster artwork; the semantic renderer remains
the Body API boundary. The product UI uses shared action cards, a local-first onboarding flow, and sectioned settings.

Startup storage initialization is asynchronous. A credential-free startup phase
(preparing/ready/failed) gates mounting service-dependent views. The ready phase
is published only after AppState is managed and migration has completed.

The assistant router prioritizes deterministic local requests before provider proposals. TaskManager owns immutable action snapshots, permission expiry, cancellation and bounded history. Provider configuration generations invalidate old responses; the personality/reaction layer maps semantic outcomes to expressions without granting authority. Memory is SQLite-backed and extracted through the active provider configuration. Scheduler claims due rows transactionally and recovers triggered entries after restart; this gives durable application state, not guaranteed exactly-once OS notification delivery. Pocket stores text/link metadata in SQLite and files in the path jail. Calendar is a configured optional service outside local-only mode. User state, aliases, modes and onboarding persist independently of AI. Native instance locking prevents a second scheduler for the same home.

Release CI validates lockfiles, tests and native packages on four targets. About/diagnostics report the canonical package version and RC channel. Signing is reported as unverified by runtime rather than guessed; verified distribution state belongs to release evidence.
