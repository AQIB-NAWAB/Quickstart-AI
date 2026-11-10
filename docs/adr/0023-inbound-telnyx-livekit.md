# ADR 0023: Inbound calling — Telnyx numbers + LiveKit SIP + our agent runtime

- **Status:** Accepted
- **Date:** 2026-10-24
- **Amended by:** [ADR 0031](0031-byo-sip-and-self-hosted-sip.md) (adds BYO SIP trunks and self-hosted LiveKit SIP)
- **Supersedes (inbound path):** ADR 0022's Twilio-media-stream-only inbound slice
- **Feature:** 21C extension — number inventory and production inbound

## Context

ADR 0022 shipped a provider adapter and an inbound webhook that either ran a fixture turn (Twilio form post) or handed media to a Twilio Media Streams WebSocket. Two things were still missing for a real inbound product:

1. **Numbers were not a product object.** There was no way for a workspace to browse Telnyx inventory, buy a number on the platform account, assign it to an agent, or release it.
2. **Inbound media had no production path.** Twilio Media Streams is a CPaaS-specific websocket. Telnyx needs SIP ingress and a media server that can also carry the agent audio with low latency, echo cancellation, jitter buffering and scaling.

## Decision

### Carrier: Telnyx SIP, platform-owned account

- One platform Telnyx account (`TELNYX_API_KEY`). Customers rent numbers from the platform; they do not bring their own Telnyx credentials in this slice.
- Number search uses `GET /v2/available_phone_numbers`; purchases use `POST /v2/number_orders` with the platform FQDN connection id.
- The platform creates/reuses one **FQDN SIP connection** (`POST /v2/fqdn_connections`) pointing at the LiveKit SIP endpoint (`POST /v2/fqdns`, port 5060, TCP).
- Numbers are assigned to that connection (`PATCH /v2/phone_numbers/:id`).
- Telnyx webhooks are Ed25519-signed. We verify `telnyx-signature-ed25519` over `${telnyx-timestamp}|${rawBody}` with the account public key and reject timestamps outside a configurable replay window.

### Media: LiveKit Cloud SIP + our existing voice pipeline

```
Telnyx number → Telnyx FQDN connection → LiveKit Cloud SIP
              → inbound trunk (per number) → dispatch rule (per number)
              → LiveKit room qs-call-<numberId>-<random>
              → voice-service LiveKit webhook
              → InboundMediaBridge (@livekit/rtc-node)
              → WidgetVoiceLiveSessionManager (Deepgram STT → runtime-service → catalog TTS)
```

- **LiveKit Cloud only.** No self-hosted `livekit-server`/`livekit-sip` in this slice.
- **One inbound trunk and one dispatch rule per number.** Long-lived configuration objects reused across calls. The dispatch rule uses an individual rule with `roomPrefix = qs-call-<numberId>-`; the room name carries the number id (not the E.164) so LiveKit logs do not leak caller PII.
- **No LiveKit agent dispatch.** We do not use `room_config.agents`; the bridge joins from the LiveKit webhook and uses our own agent runtime. This keeps tools, knowledge, transcripts, recordings and usage on one code path with the widget.
- **The bridge is the only new media component.** It joins the room with a server-minted token, resamples caller audio 48 kHz → 16 kHz into the existing session manager, and publishes agent audio 16 kHz/22.05 kHz/44.1 kHz → 48 kHz. MP3 TTS chunks are decoded with `mpg123-decoder`; PCM chunks are resampled directly.

### Call lifecycle

| Event | Action |
| --- | --- |
| Telnyx `number_order.*` | Reconcile provisioning rows (fallback for orders pending past the synchronous poll window) |
| LiveKit `room_started` | Resolve number id from room name, enforce inbound call caps, create `voice_calls` row |
| LiveKit `participant_joined` (SIP) | Record caller/SIP ids, create a conversation, start the bridge |
| LiveKit `participant_left` / `room_finished` | Stop the bridge, release the cap lease, complete the call, emit usage minutes |
| Duplicate webhook | Idempotency claims keyed by room + event/participant sid |

If a number has no assigned agent, or the workspace inbound cap is exhausted, the call is recorded as `failed` and the SIP participant is removed instead of leaving a silent room.

### API surface

```
GET    /v1/workspaces/:id/voice/numbers            list workspace numbers + platform pool
GET    /v1/workspaces/:id/voice/numbers/available  Telnyx inventory search
POST   /v1/workspaces/:id/voice/numbers            purchase/claim + LiveKit provisioning
PATCH  /v1/workspaces/:id/voice/numbers/:numberId  assign agent / rename
DELETE /v1/workspaces/:id/voice/numbers/:numberId  ?mode=pool|provider
POST   /voice/telephony/telnyx/webhook             Ed25519-verified public webhook
POST   /voice/telephony/livekit/webhook            LiveKit-signed public webhook
```

RBAC adds `workspace.voice.numbers.read` and `workspace.voice.numbers.manage`.

### Data model

`workspace_phone_numbers` becomes the platform inventory:

- `workspace_id` nullable: null = platform pool, otherwise rented to a workspace.
- `status` / `inbound_status`: `pending | available | provisioning | active | releasing | released | error`.
- `provider_number_id`, `provider_connection_id`, `livekit_trunk_id`, `livekit_dispatch_rule_id`, cost/location metadata, `provisioning_error`.
- Global unique index on `phone_number` (one platform account).

`voice_calls` gains `livekit_room_name`, `livekit_participant_sid`, `phone_number_id`, `sip_call_id`.
Long-lived provisioning state (the Telnyx FQDN connection id) lives in `voice_platform_config`.

## Failure policy

| Condition | Behavior |
| --- | --- |
| Telnyx order `pending` beyond poll window | Row stays `provisioning`; webhook/reconciliation completes it |
| Telnyx order `failure`/`cancelled` | `503` with Telnyx detail; no row is activated |
| LiveKit provisioning fails after purchase | Row `error` + `provisioning_error`; operator can release/retry |
| Number assigned to another workspace | `409 CONFLICT` |
| No agent assigned | Call recorded failed, SIP participant removed |
| Inbound cap exhausted | Call recorded failed, SIP participant removed |
| Duplicate webhook | Idempotent 200 no-op |
| Bridge start fails | Call marked failed, participant removed, operator can inspect |

## Consequences

- Inbound calls use the same STT/runtime/TTS, tool calls, knowledge, transcripts and usage ledger as widget voice.
- One new native dependency (`@livekit/rtc-node`); deployment images must support its N-API binary.
- LiveKit webhooks require a public HTTPS URL; local development needs a tunnel.
- Outbound PSTN dialing is unchanged and returns a typed error for Telnyx in this slice.
- Recording remains the session manager's concern; inbound recording is not enabled until object storage/consent handling is finalized.

## Setup checklist

1. Telnyx Mission Control: create an API v2 key and copy the account public key.
2. LiveKit Cloud project: copy `LIVEKIT_URL`, API key/secret, and the SIP endpoint (`<project>.sip.livekit.cloud`).
3. Set the env vars from `.env.example`.
4. Point the Telnyx webhook at `https://<voice-host>/voice/telephony/telnyx/webhook`.
5. Point the LiveKit webhook at `https://<voice-host>/voice/telephony/livekit/webhook`.
6. Run `TELEPHONY_PROFILE=telnyx TELEPHONY_REQUIRE_REAL=1 pnpm --filter @quickstart/service-voice start`.
7. In Voice → Numbers, search inventory, purchase a number, assign an agent, and call it.
