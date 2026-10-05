# Prompt 4 — release hardening evidence

Scope: `v1-completion`, continuing draft PR #2 from `fb0d4d8`. No new product surface or character redesign. Assisted with OpenAI Codex / codex-cli 0.160.0 (GPT-6). These are automated and CUA-assisted checks, not a human manual acceptance test.

## Trust boundaries and exposed command audit

Every `generate_handler!` entry in `src-tauri/src/lib.rs` was reviewed by domain. The renderer is a potentially compromised input source; hiding controls or a TaskManager boolean is not backend authority.

| Boundary / command group | Validation and authority | Effects and failure behavior |
|---|---|---|
| AI interpretation, chat, autonomous speech | Closed structured-action schema, bounded inputs/output, untrusted content delimiters; interpreter only proposes; TaskManager snapshots and permission state machine | No model text executes host commands; stale provider responses rejected; static redacted failure messages |
| `assistant_service`, inbox approval, clipboard, Calendar mutations, Pocket file/delete/export | Backend payload bounds/jail plus OS-owned confirmation tied to the owned operation; no reusable frontend grant; max 16 active cancellable service calls | Denial/cancellation prevents the pending effect; completed irreversible effects are not rolled back by later cancellation |
| Settings/provider/keyring/Calendar configuration | Closed provider kind, endpoint/model validation, local-only loopback policy; provider endpoint/network changes require native confirmation; secrets never returned | OS credential store only; no plaintext fallback; local settings remain readable if keyring is unavailable |
| Pocket, inbox, exports, migration | Canonical jail, symlink rejection, filename/size bounds, no-follow file open, create-new exports, owner-only files | No arbitrary filesystem browsing; existing files/source retained on failure |
| Reminders/alarms, aliases/modes, memories, event/report/state commands | Validated enums, dates, text limits, finite numeric normalization, mode steps limited to fixed action subset | Transactional SQLite mutations; busy timeout; malformed records fail safely; one process owns a storage directory |
| Web/application/volume/platform commands | Only HTTP(S), no credentials; exact application allowlist and argument arrays, finite bounded volume; explicit unsupported capabilities | No shell-string interpolation; errors remain typed |
| Body start/stop/send and developer ingestion | Loopback, scoped presentation/input protocol, pairing token, frame/schema/session/ACK validation; bounded local event queue and deduplication | Device cannot invoke tools, filesystem, shell or permissions; malformed peer closes safely |
| Notifications and renderer events | Bounded priority queue, identity deduplication, OS rate limit; safe Svelte text rendering, restrictive CSP | Every due item remains queryable in durable state even if OS notification delivery is unavailable |

Exactly-once means **durable transactional claim**, not guaranteed exactly-once OS display. A crash after claim and before presentation leaves a triggered item in the reminder list. Timers are session-only; scheduled reminders/alarms are durable.

## Defects repaired and regression evidence

- A sandbox writer followed attacker-controlled symlinks. No-follow opens and path validation now preserve an outside sentinel; exports cannot overwrite existing files.
- Sensitive service calls could bypass frontend confirmation. Backend native authority now binds approval to the invocation. AI cannot acquire a reusable grant. Provider retargeting cannot silently reuse a saved key for a new endpoint.
- Mutable task inputs/snapshots could change an approved operation. Deep immutable snapshots, stale/wrong/double/denied/cancelled approval checks, mandatory minimum permissions and AbortController propagation cover this.
- Lifecycle races allowed delayed animation/reconnect callbacks to revive stale state. Generation checks and disposal cancel stale sequences, subscriptions and scheduler refreshes.
- Duplicate Settings diagnostics mounts and duplicate embedded Pocket permission controls were reproduced natively and removed. Closing the assistant now updates the parent task status after cancellation instead of retaining “Permission needed”. Input focus restoration now waits for Svelte to re-enable the field; it does not steal focus from a pending permission heading. The suggested bare “25 minute timer” phrase now routes locally without intercepting labeled cancellation. WebKit service request IDs now use secure `getRandomValues` instead of assuming `randomUUID` exists.
- Unbounded task/timer/notification/developer histories and HTTP bodies are bounded. Invalid persisted stats and non-finite estimates cannot overflow runtime arithmetic.
- Old provider responses/background memory writes are rejected after configuration changes; secret-bearing HTTP errors and full/partial fake keys are redacted.

## Stress, failure and integration checks

- Four independent SQLite connections race over 500 overdue items: each ID claimed once, including reopen. Mixed 400 Pocket + 400 memory/settings writes, busy-lock recovery, interrupted rollback, read-only DB and malformed JSON tests pass.
- Migration tests retain sources through corrupt/future/partial/pending/read-only/collision cases, repeated invocation, escaping symlinks and a larger snapshot (300 settings plus 30 files). Pocket covers empty/exact/over-limit content, Unicode, traversal and symlink escape, safe export collision.
- Real local HTTP fixtures exercise OpenAI-compatible/Gemini/Ollama status, refused connection, timeout/slow body, malformed/truncated/missing/empty/stream-like/oversized responses. Fake recognizable full/partial secrets never appear in adapter errors/output. Calendar HTTP CRUD, pagination, duplicate IDs, invalid dates and authorization failure are tested; OAuth refresh success, expired grant, rate limiting, malformed/empty/oversized tokens fail safely.
- Body framing runs 1,200 deterministic hostile/random frames; 50 TCP reconnects plus identity collision; 200 virtual lifecycle cycles. Existing authenticated handshake, fragmentation, duplicate input, ACK, capability and loopback assertions remain. New handshakes expire after ten minutes; active sessions retain their intended lifetime.
- Three accelerated days (86,400 ticks), 3,000 task transitions, stale timer callbacks, 100 simultaneous notifications, priority overflow and stale scheduler refresh/disposal are bounded.
- E2E integrations cover fake AI proposal → permission once → executor/result and malicious rejection; Calendar CRUD/conflicts; aliases/modes with unsupported capabilities; virtual events/reconnect/state sync; authenticated loopback fixture and malformed peer survival; developer failure/success semantic reactions. These are automated service/runtime integrations, not claims of complete native credentialed flows A–I.

## Performance and privacy

Measured test workloads above complete without unbounded retained histories. Optimized frontend JS is about 225 kB (75 kB gzip). Scheduler sleeps until due, capped at 60 seconds only when future durable items exist; no scheduled items means no scheduler wake. OS notifications cap at three per ten seconds. Cursor hit testing permits one in-flight request; unchanged coordinates do not publish state. Hidden/unfocused/reduced-motion rendering suppresses blink work. Body is event driven, developer events coalesce, and no idle AI polling was introduced.

Activity Monitor snapshots with the companion unfocused showed native CPU 0.1–0.7%, WebKit 0.4–1.0%, graphics 0.5–0.8%; these are short samples, not an endurance average. Native process wakeups were 11–17 in those samples. Memory values were all zero bytes and therefore unusable. CPU evidence is `outputs/nyrc-p4-cpu.png` in the delivery workspace. RSS/energy and sleep/wake endurance remain unverified. Shell process inspection is sandbox denied; macOS automation intermittently took several minutes.

## Validation and acceptance status

Final command results and native findings are recorded below before delivery. Remaining live cloud, Google OAuth/account behavior and physical ESP32 electrical/display/sensor acceptance require external credentials/hardware. No credentials were printed or committed. Active donor identity is zero outside isolated migration compatibility and legal attribution.


### Final command evidence

- `npm run check`: **0 errors, 0 warnings**.
- `npm test`: **448 passed, 41 files** (baseline 426).
- `npm run build`: passed; optimized JS 224.71 kB / 74.68 kB gzip.
- `cargo test --lib`: **142 passed** (baseline 118).
- `cargo build`: passed; `npm run tauri:build -- --bundles app`: passed, optimized macOS application.
- `git diff --check`: passed. Safe rendering audit found no `@html`, `innerHTML`, or `eval` in active source. Active donor strings occur only in isolated migration compatibility; legal attribution retained.
- `npm audit`: **0 vulnerabilities** after targeted toolchain updates. `cargo audit` 0.22.2: **0 vulnerabilities** after rustls/quinn-proto/quick-xml/anyhow updates. Remaining informational warnings: unmaintained proc-macro-error and unic crates; unsound glib 0.18.5 is a Linux GUI transitive dependency, absent from the compiled macOS target. Linux release requires a documented resolution/exception. Node minimum is now 22.12; npm/Rust Tauri versions remain matched.

### Native acceptance evidence

CUA-assisted optimized app launches restored onboarding-complete state, companion name, local settings and saved Pocket content without a stale startup screen. Final executable/frontend were also tested using an ad-hoc-signed copy with a unique **OS bundle identifier/name**, to distinguish multiple LaunchServices registrations. Bundle metadata and the ad-hoc code signature differ; all **29 Mach-O payload sections** match the production executable, including its embedded frontend/runtime identifier. At least two quit/relaunch cycles of the exact final executable/frontend passed.

- Keyboard command submission, local “25 minute timer”, timer running at quit, subsequent keyboard command without clicking, permission heading Enter doing nothing, native sheet Enter choosing Deny, native Escape cancel, explicit native Allow once, and input focus after native denial passed.
- Closing the assistant cancels its pending request; reopening shows **Cancelled** with no stale permission dialog.
- Known non-sensitive clipboard fixture saved to Pocket, persisted/retrieved after relaunch, and was deleted through frontend + native confirmation. All temporary Clipboard items were cleaned up; pre-existing Pocket item retained.
- A reminder scheduled for 30 seconds, quit before due, and relaunched overdue produced the in-app alert and durable triggered list entry. It was dismissed; later relaunch did not replay the alert.
- Virtual body connect → shake/touch → Settings/Devices navigation → disconnect → reconnect passed. Restart displayed desktop only, without a stale virtual connection, and reconnect worked. A single persistent diagnostics component now owns the simulator.
- Provider change save displayed a native sheet; default Enter denied it. Relaunch retained **Local only**.
- `npm run tauri:dev` was attempted; the shell-started native process reported WindowServer/XPC errors. Packaged UI checks above used CUA, not that dev process.
- Screenshots in delivery outputs: `nyrc-p4-native-permission.png`, `nyrc-p4-overdue-restart.png`, `nyrc-p4-cpu.png`.

### Prompt 5 acceptance gaps (no known introduced failing tests)

Native fresh-install/onboarding → durable reminder scenario A was not repeated end-to-end in an isolated clean profile in this prompt; existing-profile restart and overdue reminder passed. Automated onboarding/migration and earlier Prompt 3 onboarding evidence remain. Full native scenarios B/D/F/I are service/runtime-tested rather than complete UI automation. Extended RSS/energy/sleep-wake profiling remains open (short CPU samples only). Signed/notarized distribution and platform-specific Windows/Linux acceptance are not established by an ad-hoc macOS build; Linux glib warning needs resolution or an explicit support decision. Live BYO cloud, Google OAuth/account CRUD and physical ESP32 acceptance remain conditional external checks, not claimed as passed. No credential or hardware was supplied; none blocked local hardening. PR #2 stays draft for Prompt 5.
