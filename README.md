# NYRC — Not Your Regular Companion

A local-first intelligent personal companion for the desktop. It stays alive
with AI disabled and provides one input for local utilities, reminders, aliases,
modes, Pocket, clipboard, calendar and developer status. Optional Ollama,
OpenAI-compatible or Gemini adapters interpret requests through a closed action
schema; model output cannot choose permissions or execute arbitrary code.

```sh
npm install
npm run tauri:dev
```

macOS desktop controls are implemented. Windows/Linux report unverified controls
as unsupported. Settings → Developer contains platform/storage diagnostics, a
virtual-body simulator and an opt-in authenticated loopback transport for testing
a thin physical body without hardware. The virtual body displays expression,
gesture, text, sound, brightness and haptic commands.

Data lives in the platform local-data directory under `nyrc/nyrc.db`; override
with `NYRC_HOME`. Existing local data is copied safely on first default launch,
with the source retained. API/OAuth secrets use the OS credential store.

- [Assistant setup and acceptance](docs/V1-ASSISTANT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Storage migration and recovery](docs/STORAGE-MIGRATION.md)
- [Body protocol and tiny local client](docs/BODY-PROTOCOL.md)
- [Third-party attribution](THIRD_PARTY_NOTICES.md)

```sh
npm run check
npm test
npm run build
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

Cloud/calendar validation requires configured credentials. Disconnected behavior,
mock calendar and fake local provider transports are covered without credentials.
Temporary art preserves current desktop functionality; a separate visual redesign
is still planned. Derived code/assets retain their MIT provenance in LICENSE and
THIRD_PARTY_NOTICES.md.
