# Voice Service (`@quickstart/service-voice`)

Feature **21–22 / 21B / 21C** — realtime voice edge on port **3008**.

Cascade (default): audio → STT → runtime turn → TTS. Native realtime S2S supports tools and knowledge through the shared agent runtime. Legacy batch S2S remains tool-free. Multi-provider telephony (Twilio, Telnyx, SIP/BYOC via SBC bridge).

## Run

```bash
export JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
export VOICE_INTERNAL_TOKEN="$(openssl rand -hex 32)"
pnpm --filter @quickstart/service-voice build
pnpm --filter @quickstart/service-voice migrate
pnpm --filter @quickstart/service-voice start
```

## Voice models (current defaults)

| Layer | Default                                                   | Other supported choices                                                                                                     |
| ----- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| STT   | Deepgram **Nova-3** (`DEEPGRAM_MODEL=nova-3`)             | OpenAI `gpt-4o-transcribe`; ElevenLabs Scribe v2 Realtime / AssemblyAI are not wired yet                                    |
| TTS   | Cartesia **Sonic 3.6** (`CARTESIA_MODEL=sonic-3.6`)       | ElevenLabs `eleven_flash_v2_5` (low latency) or `eleven_v4` (quality), Fish Audio S2, OpenAI `gpt-4o-mini-tts`, Uplift Urdu |
| S2S   | Gemini **3.8 Live** (`GEMINI_LIVE_MODEL=gemini-3.8-live`) | OpenAI `gpt-realtime-2.1` or `gpt-live-1`, ElevenLabs `eleven_realtime_v1_mini` / `eleven_realtime_v1_max`                  |

`VOICE_S2S_PROVIDER` controls the live voice path:

- `auto` (default): use cascade when Deepgram + a TTS provider are configured; otherwise Gemini → OpenAI → ElevenLabs.
- `gemini`, `openai`, `elevenlabs`: force that speech-to-speech model (its key is required).
- `none`: force cascade.

Notes:

- `gpt-live-1` is OpenAI's premier full-duplex model ($0.05/min). Set `OPENAI_REALTIME_MODEL=gpt-live-1` to use it; `gpt-realtime-2.1` remains the default Realtime path.
- ElevenLabs Realtime is OpenAI-compatible and requires `ELEVENLABS_API_KEY` plus `ELEVENLABS_VOICE_ID`.
- OpenAI Realtime and Gemini Live expose `consult_agent`, delegating tools, knowledge, and confirmations to the shared runtime. See [ADR 0030](../../docs/adr/0030-native-realtime-agent-tools.md).
- The agent's published `voice.tts_voice_id` selects a catalog voice, so one workspace can mix Urdu Uplift, English Cartesia, Fish, and ElevenLabs voices.

## Native realtime tools and knowledge

Set `VOICE_S2S_PROVIDER=openai` or `VOICE_S2S_PROVIDER=gemini` with the matching
provider key, then publish the agent with its existing tools and selected knowledge
sources. The native session uses the same `RUNTIME_URL`, internal service token,
and agent configuration as cascade. No new public tool execution endpoint or
client-side credential is needed. `auto` continues to prefer a configured cascade.

For example, a caller asking to check an appointment triggers `consult_agent`.
The runtime retrieves the relevant information or executes a permitted tool. If
confirmation or a required field is missing, the realtime model speaks the
runtime's question and waits for the caller. A later confirmation starts a new
runtime turn; a duplicated provider event does not repeat the action.

Caller transcription must be available. Runtime failure returns an unavailable
result; actions are never automatically retried after an unknown outcome. See
[the implementation and validation notes](../../docs/adr/0030-native-realtime-agent-tools.md)
for ordering, interruption, transcript, and compatibility limits.

## Fake-media simulation

```http
POST /internal/v1/workspaces/:workspaceId/voice/simulate
Authorization: Bearer <VOICE_INTERNAL_TOKEN>
Content-Type: application/json

{
  "agent_id": "<uuid>",
  "conversation_id": "<uuid>",
  "utterance_audio_b64": "ZmFrZQ==",
  "direction": "inbound",
  "caller": "+15551212"
}
```

## Inbound calling (Telnyx numbers → LiveKit SIP)

Inbound calls do **not** use Twilio Media Streams. The production path is:

```
Telnyx number → Telnyx FQDN connection → LiveKit Cloud SIP
              → per-number inbound trunk + dispatch rule
              → room qs-call-<numberId>-<random>
              → LiveKit webhook → InboundMediaBridge
              → existing WidgetVoiceLiveSessionManager (STT → runtime → TTS)
```

Number inventory and purchase live on the workspace routes:

```
GET    /v1/workspaces/:id/voice/numbers
GET    /v1/workspaces/:id/voice/numbers/available
POST   /v1/workspaces/:id/voice/numbers
PATCH  /v1/workspaces/:id/voice/numbers/:numberId
DELETE /v1/workspaces/:id/voice/numbers/:numberId?mode=pool|provider
```

Public webhooks (no staff auth):

- `POST /voice/telephony/telnyx/webhook` — Ed25519 (`telnyx-signature-ed25519` + `telnyx-timestamp`).
- `POST /voice/telephony/livekit/webhook` — LiveKit-signed room lifecycle events.

### Environment

```bash
TELEPHONY_PROFILE=telnyx
TELEPHONY_REQUIRE_REAL=1

TELNYX_API_KEY=...
TELNYX_PUBLIC_KEY=...            # PEM or base64 Ed25519 account key
# TELNYX_SIP_CONNECTION_ID=...   # optional; created automatically when empty
TELNYX_SIP_CONNECTION_NAME="QuickStart Inbound"

LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_SIP_ENDPOINT=<project>.sip.livekit.cloud
LIVEKIT_BRIDGE_ENABLED=1
```

With no Telnyx/LiveKit credentials the service runs `TELEPHONY_PROFILE=fake`: number search,
purchase and routing transitions are simulated so the UI and tests work locally.

### External setup

1. Telnyx: API v2 key + account public key. Use a paid account (LiveKit SIP requires it).
2. LiveKit Cloud: project URL, API key/secret, and SIP endpoint.
3. Telnyx webhook → `https://<voice-host>/voice/telephony/telnyx/webhook`.
4. LiveKit webhook → `https://<voice-host>/voice/telephony/livekit/webhook`.
5. Purchase a number in Voice → Numbers. The service creates the Telnyx FQDN connection,
   assigns the number, creates the LiveKit inbound trunk + dispatch rule, and returns `active`.

Full decision record: [docs/adr/0023-inbound-telnyx-livekit.md](../../docs/adr/0023-inbound-telnyx-livekit.md).

## Live turn-taking, interruptions, and tool calls

The inbound bridge uses the same `WidgetVoiceLiveSession` as widget voice. The live path is tuned as follows:

- **STT is opened immediately** when the session starts; the agent brief (conversation → agent → published version → knowledge) is fetched in parallel and cached (agent/voice for 60 s, knowledge slice for 30 s). Caller frames received before Deepgram is ready are buffered (up to 500 ms) and flushed on connect. The LiveKit bridge also creates the voice session in parallel with the room connect/publish, and requests a native 16 kHz stream so there is no extra 48→16 resample.
- **Eager commit is guarded.** Deepgram endpointing defaults to **100 ms** (`DEEPGRAM_ENDPOINTING_MS`), but `speech_final` waits for the longer of the phrase-shape delay (open endings like “and/so/because” wait ~350 ms) and an **180 ms speech-tail** (`VOICE_SPEECH_TAIL_MS`) since the last caller voice frame. Filler-only finals (“um”, “uh huh”, “you know”) are ignored.
- **TTS starts at the first natural clause.** A comma/colon after two characters or a three-word clause is spoken immediately, overlapping the rest of the model reply.
- **Voice RAG is time-boxed.** Retrieval gets **250 ms** (`VOICE_RETRIEVAL_TIMEOUT_MS`) before the model starts without it; the request is aborted when the deadline wins.
- **Voice turns can use a faster model.** Set `VOICE_MODEL_ID` (and optionally `VOICE_MODEL_PROFILE`) to override the agent's chat model for voice only.
- **Every TTS provider streams.** Cartesia, ElevenLabs, Fish, Uplift, and OpenAI emit audio chunks as they arrive; Fish/OpenAI now read the response body incrementally instead of waiting for a full clip.
- **Barge-in is adaptive.** Three consecutive frames above `max(0.22, noise floor × 3)` interrupt the turn, abort the runtime stream, clear pending TTS, and reset the duplicate-transcript guard. The LiveKit bridge increments an audio generation so frames queued before the interrupt are never played.
- **Tool acknowledgements are delayed by 250 ms** and cancelled if the model’s first token arrives sooner, so fast tools do not add a spoken “let me check that”.
- **Every turn is bounded** by `VOICE_DEADLINE_MS` (default 15 s). A hung tool loop, model, or stream aborts and speaks the configured fallback instead of leaving the caller in silence.
- **The agent’s configured voice and language** are used when present (falling back to the catalog demo voice only for `default`).
- **Inbound prewarm:** on `room_started` the service creates the conversation and joins the bridge, opening Deepgram and loading the brief before the SIP caller connects.

Useful log events during a call: `widget.voice.turn_complete` (first token / first audio / total ms),
`widget.voice.barge_in`, `widget.voice.turn_timeout`, `widget.voice.tool_nudge_played`, and
`widget.voice.stt_prebuffer_flushed`.

## Load / drain smoke

```bash
pnpm --filter @quickstart/service-voice voice-load-smoke
```

Inbound number proof:

```bash
pnpm --filter @quickstart/service-voice build
node scripts/check-voice-inbound-numbers-proof.mjs
```

## Still unsafe at scale

In-memory session maps die on restart until Redis session TTL is complete; the inbound bridge must be verified against the deployed N-API binaries; outbound PSTN dialing through Telnyx/LiveKit is not enabled yet; object-storage recordings are local stub until cloud credentials exist.
