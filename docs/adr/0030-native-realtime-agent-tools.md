# ADR 0030: Native realtime speech with shared agent tools and knowledge

- **Status:** Accepted
- **Date:** 2026-10-30
- **Scope:** OpenAI Realtime and Gemini Live sessions used by website voice and the live calling bridges.
- **Supersedes:** The no-tools/no-RAG restriction in ADRs 0021 and 0029 for these native sessions only.

## Decision

The realtime provider handles audio input and output. A single native function,
`consult_agent`, delegates substantive questions and actions to the existing
runtime widget voice endpoint. The runtime owns the published agent version,
knowledge source selection, memory, graph execution, tool selection, credentials,
confirmation policies, tool audit ledger, and idempotency. We do not expose raw
HTTP/MCP tools or their credentials to a second execution engine.

The function accepts an empty object. Tenant, conversation, actor, request text,
and idempotency keys come from server-owned session state. Caller text comes from
the provider's input transcription, never model-generated function arguments.
Unknown functions or non-empty/malformed arguments return an unavailable result
without executing a runtime request.

OpenAI declares the function in `session.update.tools`, executes completed
function items from `response.done`, posts `function_call_output` items with the
matching `call_id`, and resumes audio with `response.create`. The result response
disables additional function calls for that response so the model voices the
answer instead of repeatedly consulting. Gemini declares a function in setup and
replies with `toolResponse.functionResponses` using matching function IDs.

## Ordering, latency, and transcripts

- Provider tool events can arrive before transcription. The bridge waits up to
  two seconds for input text; missing text cannot authorize a guessed request.
- Gemini input transcription is a separate fragment stream. A 100 ms quiet window
  coalesces late fragments before runtime execution. This is a transport heuristic,
  not a guarantee of perfect speech recognition or a semantic endpoint detector.
- Native greetings can be spoken directly. Instructions require consultation for
  business facts, actions, confirmations, and transfers. Tool choice remains a
  model decision; the server enforces what functions can actually execute.
- One consultation promise and one stable runtime idempotency key are retained
  per caller turn. Duplicate provider function IDs or repeated function events
  cannot start another action for that turn. Session history is bounded.
- User transcript persistence and runtime execution share the user-message key.
  The runtime stores the canonical assistant answer; the speech model's paraphrase
  and tool acknowledgement are not persisted as duplicate assistant messages.
  Non-delegated native exchanges persist user and assistant in order.
- The old broad startup knowledge query is disabled for managed live sessions.
  Knowledge is fetched for the actual question using the published source policy.
- OpenAI readiness waits for session configuration acknowledgement. Short input
  audio is buffered until ready. Node `ws` supplies server-side authentication
  headers; the browser-style WebSocket constructor did not support these headers.

## Permissions, interruption, and handoff

Widget voice turns now carry `channel: voice` through the shared tool loop, so
voice-only tools work and chat-only tools remain unavailable. Confirmation still
runs in the shared runtime. Negated confirmations such as “yes, but do not book
anything yet” are explicitly rejected rather than matching an isolated “yes”.

Interruption, provider tool cancellation, session hold, and close abort the active
runtime request. Stale tool results and OpenAI audio from cancelled responses are
suppressed. A 20-second default consultation deadline bounds runtime waits. Failed
or unknown actions are not retried automatically.

An external action that has already begun may complete despite interruption;
abort is not rollback. The existing runtime tool ledger and business-provider
idempotency remain responsible for reconciliation. The voice result must not
invent success after a failed or unknown request.

Human handoff is driven by the runtime transfer event, after its confirmation
flow, and activates the session manager after the final spoken response. Matching
words such as “switching you” in generated text no longer trigger a transfer.
Staff-requested transfer announcements can still be spoken while the model is held.

## Publishing and compatibility

Agent readiness and publish validation allow S2S agents to include tools and
knowledge when using the native runtime bridge. The shared `s2sProfileAllowed`
validator requires an explicit bridge capability; the legacy batch/fake S2S
pipeline retains its no-tools/no-RAG restriction because it has no function bridge.
Cascade selection and existing model/voice configuration remain available.

The ElevenLabs compatibility adapter shares the OpenAI protocol client, but its
vendor-specific function/event compatibility has not been validated against a
live account. OpenAI and Gemini protocol behavior is covered by local WebSocket
integration tests; production provider acceptance remains a separate live check.

## Verification

Tests cover actual local WebSocket exchanges for both native protocols, delayed
transcripts, fragment coalescing, streamed PCM, duplicate calls, injected function
arguments, runtime errors and deadlines, cancellation, stale responses, handoff,
and transcript deduplication. Shared-runtime integration tests exercise the real
tool loop for confirmation, a booking executed once, voice-channel policies,
knowledge source selection, and workspace isolation. Agent HTTP tests verify
readiness and publication of an S2S agent with tools and selected knowledge.

No billable provider sessions or real phone calls were placed. Test timings do
not establish caller-experienced production latency or voice quality.

## References

- [OpenAI realtime function calls](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Gemini Live function calls](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Gemini WebSocket ordering and cancellation](https://ai.google.dev/api/live)
