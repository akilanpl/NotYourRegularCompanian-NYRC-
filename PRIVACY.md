# NYRC privacy

Core simulation, local commands, settings, memories, interactions, schedules and Pocket stay in your local NYRC home. There is no NYRC analytics, advertising telemetry, account sync or automatic crash-upload service. Diagnostic JSON reports configuration/capability/storage status, not secret values; review it before sharing.

Local-only mode disables cloud AI and Calendar requests. Ollama uses the configured model endpoint; a remote endpoint sends data to that host. When cloud AI is enabled, your requests and the context assembled for that operation are sent to the chosen OpenAI-compatible or Gemini service. That service's own policies apply. NYRC stores its API keys in the OS credential store, not SQLite or diagnostic exports.

Google Calendar is contacted only after configured/enabled use and outside local-only mode. Event queries return Calendar data; create/update/delete actions require approval. OAuth client secrets and refresh tokens use the OS credential store. Disconnect Calendar to remove its credentials.

Clipboard is not continuously monitored. Reads ask for per-action approval; saving clipboard content to Pocket creates a local copy. Copy/write actions also require approval. Pocket text/link metadata resides in SQLite and sandbox files live under the local home. Delete individual entries through Pocket; exported copies you create elsewhere remain your responsibility.

The developer bridge is opt-in and reads bounded event files from NYRC's inbox. The Body bridge is opt-in, authenticated and loopback-only; pairing tokens are shown only in the pairing panel. Connected bodies may receive companion expressions/text and submit validated sensor hints. They cannot choose permissions or read the host database.

Remove provider keys in Settings → AI and disconnect Calendar before a full reset. Quit NYRC before moving/removing its local home. [Backup and reset instructions](docs/STORAGE-MIGRATION.md) explain exact locations and what uninstall retains. There is no cloud account to delete.
