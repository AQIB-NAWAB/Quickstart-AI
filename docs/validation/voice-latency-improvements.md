# Voice response latency and turn reliability

## Research and decisions

This change improves the existing streaming cascade shared by website voice and
calling sessions. It preserves the configured providers, models, tools, and agent
instructions.

- [Deepgram endpointing and interim results](https://developers.deepgram.com/docs/understand-endpointing-interim-results):
  `is_final` finalizes a transcript segment; `speech_final` signals an utterance
  endpoint. Accumulate stable segments and handle endpoint events even when they
  contain no new text. Recheck local caller silence when the commit timer fires,
  since speech can resume before the next transcript arrives.
- [LiveKit turn detection](https://docs.livekit.io/agents/logic/turns/turn-detector/):
  turn-taking balances response delay with caller interruptions. Keep the existing
  adaptive energy threshold and speech-tail guard instead of globally shortening
  all silence windows.
- [Twilio Media Streams](https://www.twilio.com/docs/voice/media-streams/websocket-messages):
  interruption clears buffered playback via `clear`. The existing Twilio bridge
  already maps the session interrupt event to that message. This change prevents
  aborted turns from emitting stale completion or delaying new synthesis.

## Changes

- Numeric caller answers (including Urdu digits) survive filler filtering, so an
  order number or other identifier reaches the runtime.
- Empty endpoint events commit preceding transcript segments without waiting for
  the later UtteranceEnd event.
- A commit rechecks caller speech before starting the response. Transcripts are
  preserved while a turn is already processing and scheduled after it finishes.
- A completed SSE reply returns at the `done` event, releasing its reader without
  waiting for HTTP EOF. CRLF, fragmented UTF-8, and multiline data are supported.
- Completed replies with no token events, including idempotent replays, are spoken.
- Interrupted turns cannot clear the next turn's timers or emit stale tokens and
  completion events. New synthesis bypasses the aborted synthesis queue.
- Session close cancels a pending speech-provider reconnect timer.

## Verification

The original voice suite passed 67 tests before edits. New tests first reproduced
four failures: numeric filtering, waiting for HTTP EOF, CRLF parsing, and failure
to cancel a reader after a provider error.

Commands:

```sh
pnpm --filter @quickstart/service-voice build
pnpm --filter @quickstart/service-voice test
pnpm --filter @quickstart/service-runtime build
pnpm --filter @quickstart/service-runtime test
```

Regression coverage includes numeric answers, empty endpoints, resumed caller
speech, replacement-turn ownership after interruption, done-only replies,
first-clause audio before model completion, and timeout fallback. Stream tests
cover a response whose HTTP body stays open after `done`, byte-by-byte Urdu UTF-8,
CRLF framing, multiline JSON, provider errors, and truncated replies.

These tests use controlled runtime/speech boundaries, not billable provider calls.
They verify streaming order and eliminate specific unnecessary waits; their
execution times are not real-world STT/model/TTS latency measurements. A production
latency claim needs a real phone-call benchmark, including endpoint-to-first-audio
p50/p95 and interruption behavior under noise and network delay.

The initial voice-wide lint command reported 15 pre-existing errors. Follow-up
work removed an unused binding in the touched Twilio media bridge, leaving 14
errors in other files. Changed TypeScript files are linted separately.

## Follow-up: reasoning, voice quality, and additional latency work

- Preserve a quick first speech phrase, then group later speech into sentences or
  longer phrases rather than making a new synthesis request every three words.
  Decimal amounts, Unicode digits, and numeric sentence endings have regression
  coverage. Larger phrases give the speech model more pronunciation/prosody context.
- Preserve streaming through the speech policy wrapper. It previously exposed only
  full-clip synthesis even when the underlying provider could stream. Retry only
  before the first non-empty audio chunk; never replay partially spoken responses
  or retry interrupted requests. Usage is emitted once at first audio.
- Use raw 24 kHz PCM for live OpenAI synthesis, avoiding MP3 codec overhead. Preserve
  16-bit sample alignment across arbitrary HTTP chunk boundaries and reject
  truncated samples. Preview downloads retain MP3. Supply a conversational delivery
  instruction for compatible models and preserve custom voices/instructions.
- Forward the selected Cartesia voice's language to streaming synthesis. Urdu no
  longer silently requests English. Support CRLF framing as well as LF.
- Use provider sample-rate metadata when converting PCM for Twilio. A 100 ms clip
  at 16, 22.05, or 24 kHz now remains 100 ms after conversion to 8 kHz mu-law,
  avoiding the duration/pitch distortion caused by assuming every source is 16 kHz.
- Start optional retrieval and memory budgets concurrently with their requests,
  including while history loads. Unavailable context no longer adds consecutive
  250 ms + 150 ms waits. These remain optional-context deadlines; the agent should
  acknowledge missing facts rather than invent them.
- Replace the implicit 160-token voice ceiling with reasoning-aware defaults:
  256 tokens without reasoning, 2,048 for minimal/low, and 4,096 for medium and
  higher. These are ceilings, not target response lengths. Explicit agent token
  limits and positive `VOICE_MAX_TOKENS` deployment caps still apply. Existing
  reasoning levels and model selections are preserved. Voice instructions keep
  audible answers short, lead with the conclusion, and ask for essential missing
  information instead of guessing. This fixes budget starvation; reasoning
  accuracy itself still needs model-backed evaluations on representative calls.

Research supporting these decisions:

- [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization)
- [OpenAI reasoning token budgets](https://developers.openai.com/api/docs/guides/reasoning)
- [OpenAI speech formats and delivery control](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Cartesia streaming request language and audio format](https://docs.cartesia.ai/api-reference/tts/sse)

Follow-up validation: **88 voice tests and 59 runtime tests pass**, including a
runtime integration test that verifies the configured reasoning level and output
budget reach the model request, and a real local WebSocket test of Twilio PCM
conversion and interruption messages. Builds succeed and all changed TypeScript
files pass ESLint. The voice-wide lint check still reports 14 existing errors in
other files. Actual provider voice quality and phone-call p50/p95 latency have not
been measured; no real-provider performance or perceptual-quality claim is made.

## Native realtime runtime bridge

Native OpenAI Realtime and Gemini Live sessions now delegate tools and scoped
knowledge to the shared runtime using a transcript-bound `consult_agent` function.
See [ADR 0030](../adr/0030-native-realtime-agent-tools.md) for architecture,
configuration, cancellation, transcript ordering, and production acceptance limits.

Final automated verification for the complete change:

- Voice service: **105 tests passed**.
- Runtime service: **64 tests passed**.
- Agent service: **36 tests passed**.
- Contracts: **5 tests passed**.
- Builds pass for all four packages; edited TypeScript files pass ESLint.
- Repository integrity and `git diff --check` pass.

Provider tests use real local WebSocket connections with controlled runtime and
speech boundaries. They include both OpenAI and Gemini function protocols,
transcription arriving after a tool request, Gemini fragment coalescing,
interruption, cancellation, duplicate calls, rejected injected arguments, native
PCM output, and confirmed and staff-authorized handoffs. Runtime tests verify
actual shared tool-loop confirmation, negated confirmations, per-channel tool
permissions, selected knowledge sources, idempotent booking, and tenant isolation.
The agent HTTP test verifies that a native S2S agent with tools and knowledge can
pass the former restriction and publish.
