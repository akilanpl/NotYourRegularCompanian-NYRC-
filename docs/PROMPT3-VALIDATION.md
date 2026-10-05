# Prompt 3 — character and product experience

Original procedural SVG character: ceramic shell, dark display, two apertures and a restrained status bar. All 18 semantic expressions have display mappings and screen-reader labels. Idle blink/glance is deterministic and pauses under reduced motion, hidden or unfocused windows. Desktop roaming is opt-in in Advanced.

The compact assistant shares existing routing/executors, shows concise lifecycle labels and bounded recent context, and pauses sensitive actions for equally visible Allow once / Deny choices. Pocket uses one shared tray in assistant and settings. Calendar has day queries and create/edit/delete review cards; live Google authorization is not fabricated. Settings includes personality presets, write-only provider credentials, Calendar configuration, permissions, notifications, devices, saved aliases/modes, advanced simulator and accessible full legal notices.

Virtual-body connections remain available across Settings sections. Onboarding completion, chosen name and roaming preference use backward-compatible settings fields. Storage migration/initialization runs on a worker; the frontend waits for a safe preparing/ready/failed phase before mounting service-dependent components.

## Validation

- `npm run check`: 0 errors, 0 warnings.
- `npm test`: **426 passed**, 38 files; original 366 retained.
- `npm run build`: passed; production JS approximately 216 kB (72 kB gzip), no rendering library added.
- `cargo test --lib`: **118 passed**; original 115 retained.
- `cargo build`: passed.
- `CARGO_NET_OFFLINE=true npm run tauri:build -- --bundles app`: optimized macOS application built.
- `git diff --check`: passed.
- Donor identity audit: 14 matches, confined to migration discovery/fixtures and required legal notice. Zero active product identity matches.
- Deleted renderer/artwork reference audit: no active imports or asset paths. Negative schema tests and historical development logs are intentionally retained.
- Packaged Resources contain full LICENSE and THIRD_PARTY_NOTICES.md.

## Native visual matrix

CUA-assisted native packaged-app checks, not a human manual test. Screenshots were viewed and alignment, contrast, reachability and duplicate controls corrected. They record checks during the implementation, so early permission/general screenshots may precede final small control additions.

| Surface | Evidence |
|---|---|
| Fresh onboarding | [onboarding](visual/nyrc-onboarding.png) |
| Desktop | [desktop](visual/nyrc-desktop.png) |
| Compact assistant | [assistant](visual/nyrc-assistant-final.png) |
| Thinking | [thinking](visual/nyrc-thinking.png) |
| Permission | [permission](visual/nyrc-permission.png) |
| Success | [success](visual/nyrc-success.png) |
| Timer notification | [notification](visual/nyrc-notification.png) |
| Settings | [settings](visual/nyrc-settings.png) |
| AI local-only | [AI](visual/nyrc-ai.png) |
| Pocket | [Pocket](visual/nyrc-pocket.png) |
| Devices | [Devices](visual/nyrc-devices.png) |
| Calendar degraded | [degraded](visual/nyrc-degraded.png) |
| Provider offline | [offline](visual/nyrc-provider-offline.png) |
| Virtual simulator | [simulator](visual/nyrc-simulator.png) |

Functional checks: time; short timer and durable reminder completion; persisted alias; Focus mode partial success with unavailable Focus control and successful volume step; volume restored to its pre-test 81%; Pocket retrieval; clipboard deny and allow-once with known fixture; persisted developer failure query; AI-disabled fallback; Ollama configuration/test reporting Offline; Calendar disconnected query; virtual touch, hold, shake, pickup/drop, battery, offline, sleep/wake, reconnect and outbound brightness/haptic/text/sound/status concepts. Naming updated immediately and persisted across restart; the temporary Nova test name was restored to the original NYRC label.

`npm run tauri:dev` was launched, but its shell-started native process reported WindowServer/XPC connection errors in this environment. Actual GUI smoke used the optimized packaged application launched through CUA.

The final restart smoke of the asynchronous startup gate is **pending**: macOS locked before the new bundle could be restarted. Earlier native visual/functional checks above passed. The delivery PR remains a draft until this final check is completed.

## Limits and Prompt 4 targets

Live cloud provider success and Google Calendar OAuth/CRUD require credentials; Ollama was unavailable locally. Physical ESP32/BLE/Raspberry Pi hardware is untested. Windows/Linux controls remain explicitly unsupported/unverified.

Prompt 4 targets: real DOM keyboard/focus/permission integration tests; Calendar connected CRUD/conflicts with credentials; long-running task retention/cancellation and notification race stress; large/corrupt/interrupted migration startup/recovery stress; provider timeout/auth/rate-limit and secret-redaction adversarial checks; cross-window settings/device lifecycle tests; loopback fragmentation/backpressure/reconnect fuzzing and physical-device validation. Prompt 4 work has not started.
