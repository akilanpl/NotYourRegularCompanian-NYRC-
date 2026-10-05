<div align="center">

<img src="public/nyrc.svg" alt="NYRC companion" width="120" />

# NYRC

### Not Your Regular Companion

**A little presence. A useful assistant. Your desktop, more personal.**

An expressive desktop companion with timers, reminders and a place for the things you want to keep. Built to feel alive and stay useful with AI off.

**Local first · Optional AI · Native desktop · Open source**

[Get started](#get-started) · [See what it can do](#small-presence-real-utility) · [Privacy](PRIVACY.md) · [Release evidence](docs/PROMPT5-RELEASE.md)

</div>

<p align="center">
  <img src="docs/visual/nyrc-desktop.png" alt="NYRC's original character on the desktop, named Nova in this example" width="44%" />
  <img src="docs/visual/nyrc-assistant-final.png" alt="The unified assistant with Pocket, timers, reminders and modes" width="44%" />
</p>

<p align="center"><em>Meet your companion. Ask for what you need. Get back to your day.</em></p>

## Small presence. Real utility.

NYRC lives alongside your work. Its original character responds to gestures, mood and activity, while a single assistant brings everyday tools within reach. Give it a name, choose its personality and make it part of your routine.

| When you want to… | NYRC helps you… |
|---|---|
| Make space for focus | Start a timer with “timer 25 minutes.” |
| Remember what comes next | Create a durable reminder with “remind me in 20 minutes to submit assignment.” |
| Keep something for later | Save and retrieve notes, links and supported files in Pocket. |
| Make familiar actions quicker | Use saved aliases and modes through the same assistant. |
| Add conversation | Connect local Ollama or an optional OpenAI-compatible or Gemini provider. |
| Bring your schedule closer | Configure optional Google Calendar access and review proposed changes. |
| Explore a physical companion | Use the virtual Body simulator and authenticated loopback protocol for an ESP32 integration. |

Timers are session-only. Reminders, Pocket and settings persist across restarts. System actions depend on your platform; see the [capability matrix](docs/PLATFORMS.md).

## Useful without an API key

The character's behavior, local commands, timers, reminders and Pocket work independently of an LLM. Simple commands resolve locally before any AI request. You can start in local-only mode and add a provider when you want one.

AI replies can propose supported actions. They cannot grant themselves permission. Sensitive operations pass through native confirmation, and denied or canceled requests stay denied or canceled.

## Your companion. Your control.

- **Local storage.** Companion state, reminders, memories, Pocket and settings live in a local SQLite database.
- **Optional connections.** Cloud AI and Google Calendar require your configuration; local-only mode blocks cloud access.
- **Protected credentials.** Provider keys and Calendar secrets use the operating system's credential store, with no plaintext fallback.
- **Visible data controls.** Export memories, remove provider keys, disconnect Calendar, and back up or reset local storage.
- **Bounded access.** File operations use a restricted home directory; AI actions use validated, allowlisted payloads.

Read the [privacy policy](PRIVACY.md), [security policy](SECURITY.md) and [backup/reset guide](docs/STORAGE-MIGRATION.md) for the details and limits.

## Get started

**Current candidate: `1.0.0-rc.1`.** This is an unsigned release candidate. Trusted publisher signing and macOS notarization are not yet validated.

Download the package matching your operating system and architecture from the [successful CI run](https://github.com/akilanpl/NotYourRegularCompanian-NYRC-/actions/runs/37330186142). GitHub may require sign-in to download artifacts. Verify the package against its accompanying SHA-256 manifest before installing.

| Platform | Package | Acceptance |
|---|---|---|
| macOS Apple silicon | ARM64 App ZIP | Native installation and core restart flows tested |
| macOS Intel | x64 App ZIP | CI build and tests passed; desktop validation required |
| Windows | x64 NSIS installer | CI build and tests passed; desktop validation required |
| Debian / Ubuntu | x64 DEB | CI build and tests passed; desktop validation required |

On macOS, unzip and copy `NYRC.app` to Applications. On Windows, run the installer. On Debian/Ubuntu, install the DEB with your package manager. Unsigned packages may show operating-system publisher warnings. Check [platform requirements](docs/PLATFORMS.md) and [release instructions](docs/RELEASE.md) before installation.

On first launch:

1. Name your companion and choose local-only mode to start without credentials.
2. Open **Ask NYRC** and try `timer 25 minutes` or `list reminders`.
3. Open **Pocket** to save something you want to find again.
4. Visit **Settings** when you want to configure personality, AI, Calendar or Devices.

Live cloud/Google acceptance still needs real credentials and account consent. Physical ESP32 acceptance needs hardware. Actual OS sleep/wake and mixed-DPI desktop acceptance need the relevant native environments. The [release scorecard](docs/PROMPT5-RELEASE.md) separates tested behavior from build-only and external validation.

## Built with care

NYRC combines a Svelte 5 / TypeScript interface, a Rust / Tauri 2 native backend and SQLite persistence. A pure simulation engine drives the character; a shared semantic Body layer keeps behavior independent of its renderer.

The RC passed **452 frontend tests**, **five release-tooling tests**, and **143 Rust tests on macOS/Linux or 136 on Windows**. CI builds all four native targets and checks versions, executable architecture, package contents and checksums. Dependency audits reported zero vulnerabilities; a narrowly reviewed Linux glib soundness advisory and maintenance notices remain visible in the [dependency review](docs/DEPENDENCY-SECURITY.md).

### Run from source

Use Node **22.12+**, Rust **1.89+**, and your platform's [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/akilanpl/NotYourRegularCompanian-NYRC-.git
cd NotYourRegularCompanian-NYRC-
git checkout v1-completion
npm ci
npm run tauri:dev
```

Build a packaged candidate:

```sh
npm run tauri:build -- --ci -- --locked
```

The RC currently lives on `v1-completion`; use the published release ref when one is available. For development checks, test fixtures and contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Explore further

| Guide | What you'll find |
|---|---|
| [Assistant & integrations](docs/V1-ASSISTANT.md) | Commands, provider configuration and Calendar setup |
| [Architecture](docs/ARCHITECTURE.md) | Simulation, native services and data flow |
| [Body protocol](docs/BODY-PROTOCOL.md) | Virtual-device and hardware integration |
| [Storage & migration](docs/STORAGE-MIGRATION.md) | Data locations, backup, upgrade and reset |
| [Release engineering](docs/RELEASE.md) | Packages, checksums, signing and controlled publication |
| [Changelog](CHANGELOG.md) | What's changed in the release candidate |

NYRC is available under the [MIT license](LICENSE). Dependency attribution is recorded in [third-party notices](THIRD_PARTY_NOTICES.md).
