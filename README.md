# NYRC — Not Your Regular Companion

A local-first desktop companion that stays expressive and useful with AI off. **1.0.0-rc.1 is a release candidate**, not a trusted signed stable release.

The unified assistant handles timers, durable reminders, Pocket notes and links, aliases, modes, clipboard and developer events. Optional Ollama, OpenAI-compatible and Gemini providers propose actions through a closed schema. Google Calendar is optional. Sensitive actions require approval; model output cannot authorize itself. The original SVG character responds to mood, gestures and semantic events.

## Install and run

Download a package for your actual architecture from the release/CI artifacts. Verify its SHA-256 against the accompanying SHA256SUMS file. macOS: unzip and copy NYRC.app to Applications. Windows: run the NSIS installer. Debian/Ubuntu: install the .deb with your package manager. Unsigned candidates may trigger OS publisher warnings; macOS builds are not notarized unless the release evidence explicitly says so. See [platform status](docs/PLATFORMS.md) before relying on platform-specific features.

On first launch, name your companion and choose local-only mode or an optional provider. Timers, reminders and Pocket need no API key. Open Settings to configure AI or Calendar; Advanced contains diagnostics and Devices contains the virtual Body simulator and opt-in authenticated loopback transport.

## Build from source

Use Node >=22.12 and Rust >=1.89 with the platform [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run tauri:dev
# Packaged release build:
npm run tauri:build -- --ci -- --locked
```

[Contributing](CONTRIBUTING.md) contains checks, fixtures and platform prerequisites. CI installs from committed npm/Cargo lockfiles and builds macOS ARM64/Intel, Windows x64 and Linux x64 packages.

## Your data

SQLite, memories, reminders, Pocket and settings live in your platform local-data directory under `nyrc`. Secrets use the OS credential store. `NYRC_HOME` selects an isolated absolute directory for testing. Ordinary reinstall/uninstall does not intentionally erase your personal data. Quit before backup. See [storage, backup and reset](docs/STORAGE-MIGRATION.md), [privacy](PRIVACY.md) and [security](SECURITY.md).

## Documentation

- [Release procedure and signing](docs/RELEASE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Assistant and provider setup](docs/V1-ASSISTANT.md)
- [Body protocol](docs/BODY-PROTOCOL.md)
- [Dependency security review](docs/DEPENDENCY-SECURITY.md)
- [Changelog](CHANGELOG.md)
- [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md)

Live cloud/Google acceptance requires real credentials. Physical ESP32 acceptance requires hardware. CI compilation does not establish Windows/Linux desktop UX acceptance. Screenshots and the final release scorecard are recorded in the release validation report.
