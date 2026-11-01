import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "@quickstart/logging";
import { WidgetVoiceLiveSession, type VoiceLiveEvent } from "../widget-voice/live-session.js";

// Exercise turn orchestration with controlled STT/runtime/TTS boundaries, no paid calls.
type Harness = {
  utteranceParts: string[];
  lastVoiceAt: number;
  turnAbort: AbortController | null;
  turnDeadlineTimer: ReturnType<typeof setTimeout> | null;
  turnStartedAt: number;
  processingTurn: boolean;
  commitUtterance(): Promise<void>;
  bargeIn(level: number): void;
  handleTranscript(message: {
    is_final?: boolean;
    speech_final?: boolean;
    channel?: { alternatives: { transcript: string }[] };
  }): void;
};
function fixture(timeout = 1000) {
  const spoken: string[] = [];
  const events: VoiceLiveEvent[] = [];
  const session = new WidgetVoiceLiveSession({
    workspaceId: "workspace",
    conversationId: "conversation",
    actorId: "caller",
    deepgramApiKey: "test",
    deepgramModel: "nova-3",
    runtimeUrl: "http://runtime.test",
    internalToken: "test",
    ttsVoiceId: Promise.resolve("test"),
    replyLanguage: Promise.resolve("en"),
    turnTimeoutMs: timeout,
    speechTailMs: 20,
    tts: {
      id: "test",
      async synthesize(text) {
        spoken.push(text);
        return {
          audio: { bytes: Buffer.from(text), encoding: "fake", sampleRateHz: 16000 },
          latencyMs: 0,
          provider: "test",
        };
      },
    },
    logger: createLogger({ service: "live-session-test" }),
  });
  session.subscribe((event) => events.push(event));
  return { session, state: session as unknown as Harness, spoken, events };
}
function response(text: string) {
  return new Response(
    `event: done\ndata: ${JSON.stringify({
      turn: {
        deduplicated: true,
        conversation_id: "conversation",
        agent_id: "agent",
        agent_version_id: "version",
        assistant_message: { id: "message", text, seq: 2 },
      },
    })}\n\n`,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("a done-only runtime reply is spoken exactly once", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response("Your booking is confirmed."));
  const { session, state, spoken, events } = fixture();
  t.after(() => session.close());
  state.utteranceParts = ["Check my booking."];
  await state.commitUtterance();
  assert.deepEqual(spoken, ["Your booking is confirmed."]);
  assert.equal(events.filter((event) => event.type === "turn_done").length, 1);
});

test("interrupted turn cannot clear its replacement deadline or emit stale completion", async (t) => {
  const oldReply = deferred<Response>();
  const newReply = deferred<Response>();
  let requests = 0;
  t.mock.method(globalThis, "fetch", () =>
    ++requests === 1 ? oldReply.promise : newReply.promise,
  );
  const { session, state, events, spoken } = fixture();
  t.after(() => session.close());
  state.utteranceParts = ["First request."];
  const first = state.commitUtterance();
  state.bargeIn(0.5);
  state.utteranceParts = ["Actually, second request."];
  const second = state.commitUtterance();
  const replacementTimer = state.turnDeadlineTimer;
  const replacementStart = state.turnStartedAt;
  oldReply.resolve(response("Stale answer."));
  await first;
  assert.equal(state.turnDeadlineTimer, replacementTimer);
  assert.equal(state.turnStartedAt, replacementStart);
  assert.equal(state.processingTurn, true);
  assert.equal(
    events.some((event) => event.type === "assistant_done"),
    false,
  );
  newReply.resolve(response("Current answer."));
  await second;
  assert.deepEqual(spoken, ["Current answer."]);
  assert.equal(events.filter((event) => event.type === "turn_done").length, 1);
});

test("empty endpoint commits preceding final segments without waiting for UtteranceEnd", async (t) => {
  const called = deferred<void>();
  t.mock.method(globalThis, "fetch", async () => {
    called.resolve();
    return response("Found it.");
  });
  const { session, state } = fixture();
  t.after(() => session.close());
  state.handleTranscript({
    is_final: true,
    channel: { alternatives: [{ transcript: "Check order 42." }] },
  });
  state.handleTranscript({
    speech_final: true,
    is_final: true,
    channel: { alternatives: [{ transcript: "" }] },
  });
  await Promise.race([
    called.promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("endpoint did not commit")), 500),
    ),
  ]);
});

test("resumed caller speech postpones an already scheduled commit", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return response("Okay.");
  });
  const { session, state } = fixture();
  t.after(() => session.close());
  state.utteranceParts = ["I need help with"];
  state.lastVoiceAt = Date.now();
  await state.commitUtterance();
  assert.equal(requests, 0);
  assert.deepEqual(state.utteranceParts, ["I need help with"]);
});

test("numeric caller answer reaches the runtime", async (t) => {
  let message = "";
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init: RequestInit) => {
    message = (JSON.parse(String(init.body)) as { message: string }).message;
    return response("Checking order 42.");
  });
  const { session, state } = fixture();
  t.after(() => session.close());
  state.utteranceParts = ["42"];
  await state.commitUtterance();
  assert.equal(message, "42");
});

test("first clause audio is emitted while the rest of the model response is still pending", async (t) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
        }),
      ),
  );
  const { session, state, events, spoken } = fixture();
  t.after(() => session.close());
  const firstAudio = deferred<void>();
  session.subscribe((event) => {
    if (event.type === "audio") firstAudio.resolve();
  });
  state.utteranceParts = ["Can you help me?"];
  const pending = state.commitUtterance();
  controller.enqueue(new TextEncoder().encode('event: token\ndata: {"delta":"Sure, "}\n\n'));
  await firstAudio.promise;
  assert.deepEqual(spoken, ["Sure,"]);
  assert.equal(
    events.some((event) => event.type === "assistant_done"),
    false,
  );
  controller.enqueue(new TextEncoder().encode('event: token\ndata: {"delta":"I can help."}\n\n'));
  const done = await response("Sure, I can help.").text();
  controller.enqueue(new TextEncoder().encode(done));
  await pending;
  assert.deepEqual(spoken, ["Sure,", "I can help."]);
});

test("runtime timeout speaks a fallback and releases the turn", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    (_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const { session, state, spoken } = fixture(30);
  t.after(() => session.close());
  state.utteranceParts = ["Check availability."];
  await state.commitUtterance();
  assert.equal(spoken.length, 1);
  assert.match(spoken[0]!, /having trouble/);
  assert.equal(state.processingTurn, false);
  assert.equal(state.turnDeadlineTimer, null);
});
