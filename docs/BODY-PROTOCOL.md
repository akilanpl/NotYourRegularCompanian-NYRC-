# NYRC Body protocol v1

The host owns memory, intelligence, tasks, permissions, integrations, scheduling,
personality and user-state estimates. An ESP32 is a thin body: draw a face from
an animation ID, read buttons/touch/IMU, and optionally drive LEDs, haptics,
microphone/speaker. Voice events and speech requests are placeholders; they do
not imply voice recognition or speech synthesis. A Raspberry Pi can implement
the same adapter contract. Domain code imports BodyAdapter, never firmware.

`BodyInputEvent`: `{version:1,type,bodyId,timestamp,payload}`.
`BodyCommand`: `{version:1,type,bodyId,correlationId?,payload}`.
IDs are 1–64 ASCII letters/digits/underscore/hyphen. Timestamps are RFC3339.
Unknown fields/types/versions are rejected. JSON frames are at most 4096 UTF-8
bytes, text at most 512 characters; physical commands reserve envelope space.
Capabilities enumerate inputs/outputs only, and never grant host permissions.

## Local development transport

Settings → Developer → Platform & body diagnostics → Start loopback body
transport. TCP binds **127.0.0.1 on an ephemeral port**, disabled until explicitly
started. Pair with the 256-bit session token displayed in that panel. It is
never persisted, included in diagnostic JSON, or logged. There is no LAN bind
option. Future network/BLE adapters must require explicit pairing and protected
transport; a token alone over unencrypted LAN is insufficient.

One JSON object per newline. Examples (TOKEN is the session token):

```json
{"type":"hello","version":1,"messageId":"hello-1","bodyId":"esp32-1","token":"TOKEN","capabilities":{"inputs":["touch","shake","battery"],"outputs":["expression","animation","brightness"]}}
{"type":"welcome","version":1,"messageId":"hello-1","bodyId":"esp32-1","capabilities":{"inputs":["touch","shake","battery"],"outputs":["expression","animation","brightness"]},"heartbeatSeconds":30}
{"type":"input","version":1,"messageId":"touch-1","event":{"version":1,"type":"touch","bodyId":"esp32-1","timestamp":"2026-10-05T09:00:00Z","payload":{}}}
{"type":"input","version":1,"messageId":"shake-1","event":{"version":1,"type":"shake","bodyId":"esp32-1","timestamp":"2026-10-05T09:00:01Z","payload":{}}}
{"type":"input","version":1,"messageId":"battery-1","event":{"version":1,"type":"battery","bodyId":"esp32-1","timestamp":"2026-10-05T09:00:02Z","payload":{"percent":12,"charging":false}}}
{"type":"ack","version":1,"messageId":"touch-1"}
{"type":"command","version":1,"messageId":"output-1","command":{"version":1,"type":"expression","bodyId":"esp32-1","payload":{"id":"pleased","intensity":0.35,"durationMs":750}}}
{"type":"command","version":1,"messageId":"output-2","command":{"version":1,"type":"animation","bodyId":"esp32-1","payload":{"id":"acknowledge"}}}
{"type":"ack","version":1,"messageId":"output-1"}
{"type":"heartbeat","version":1,"messageId":"heartbeat-1"}
{"type":"status","version":1,"messageId":"heartbeat-1","state":"connected"}
{"type":"error","version":1,"code":"invalid_message"}
```

The welcome echoes the validated device capabilities; the host filters all
outputs against them. Invalid or reserved body IDs, duplicate connected IDs,
unknown capabilities and incompatible versions fail pairing. Input message IDs
are deduplicated in a bounded 128-entry session cache and still ACKed. Command
ACK backlog is capped at 32. Maximum four sockets, 5-second handshake,
65-second inactivity timeout, 3-second writes, 50 accepted input events/second;
invalid/oversized frames close only that client. Errors contain codes, no token.

## Events and outputs

Empty payload: touch, hold, double_tap, shake, pickup, put_down, ready, sleep,
wake. Button uses `{button:"primary"}`; connection `{online:false}`; battery
`{percent:0..100,charging?:boolean}`; status `{message:"..."}`; voice_event
`{state:"started"|"stopped"}`. These are interaction hints, never medical facts.

Outputs: expression `{id,intensity:0..1,durationMs:1..60000}`, animation
`{id}` (acknowledge/attend/tilt/settle/stumble/celebrate), text and speech_request
`{text}`, sound `{id}` (acknowledge/confirm/attention), haptic
`{intensity:0..1,durationMs:1..1000}`, brightness `{level:0..1}`, status_indicator
`{state}` (idle/connected/offline/error/low_battery), sleep/wake `{}`.
Expressions use the closed companion-expression vocabulary in `body/protocol.ts`.

Updates are event-driven. Identical expression/brightness/status commands are
suppressed; no face-frame streaming or AI calls on heartbeat. The body applies
animation IDs locally and may dim/sleep its display. On disconnect the host
brain and desktop stay alive. Device firmware should fall back to its local
idle face. Reconnect with a fresh hello, same stable bodyId, exponential backoff
1/2/4/8/16/30 seconds, then restore the host's cached expression/text. Transient
haptics/sounds are not replayed. Sleeping bodies should wake to send status,
then return to low-power operation; MCU power policy belongs to firmware.

## Fixture and acceptance

Run `node tools/body-client.mjs <port>` and enter the session token on stdin.
The tiny Node client represents a device: hello, ready/touch/shake/low-battery,
output ACKs, heartbeat and bounded reconnect. Stop with Ctrl-C. No hardware or
firmware toolchain is needed. Physical firmware/BLE/Raspberry Pi drivers remain
future adapters; only the loopback transport and virtual/desktop bodies are
implemented today.

Automated Rust tests use real loopback sockets for pairing failure, handshake,
input dedup/ACK, output, reconnect and oversized frames. TypeScript tests cover
closed schemas, capability negotiation, virtual/desktop sharing, disconnected
input rejection, state sync and duplicate-expression suppression.
