# Security

Only the latest release candidate and current main branch receive fixes during v1 stabilization. No long-term maintenance promise is made for older pre-v1 builds. Report a suspected vulnerability privately through GitHub's Security → Report a vulnerability on this repository when available. If private reporting is unavailable, open an issue requesting a private contact without including exploit details, tokens or personal data.

NYRC has no arbitrary-shell assistant action, remote skill installation or browser automation. Deterministic commands and provider proposals pass a closed action schema. TaskManager approval is bound to an immutable action snapshot and expires. Native backend approval independently guards sensitive clipboard, file/export/delete, provider and Calendar mutations; Enter denies and Escape cancels. A connected Body cannot grant desktop permissions.

Files stay within the NYRC home path jail. Symlinks, traversal and unsafe destinations are rejected. SQLite migrations are transactional; migration source data is retained. Secrets use the OS credential store without a plaintext fallback. Provider replies and protocol frames are bounded; stale provider generations and late canceled results are rejected.

Optional Ollama contacts the configured local model endpoint. The opt-in Body service binds loopback, requires an expiring pairing token, caps clients/frames, and validates protocol versions and capabilities. Do not forward its port to a network. Physical devices are untrusted sensors/displays; the desktop remains the authority.

Local-first does not protect a device already compromised by another local program with access to your account. Cloud providers and Google receive explicitly enabled requests. Release signing/notarization is a separate publisher-authenticity layer; unsigned RCs make no trusted-publisher claim. See [dependency policy](docs/DEPENDENCY-SECURITY.md) for the explicitly reviewed Linux glib warning and current maintenance notices.
