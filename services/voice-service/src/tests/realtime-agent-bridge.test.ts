import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "@quickstart/logging";
import { RealtimeAgentBridge } from "../widget-voice/realtime-agent-bridge.js";

function fixture(options: { transcriptWaitMs?: number; turnTimeoutMs?: number } = {}) {
  return new RealtimeAgentBridge({
    workspaceId: "workspace A",
    conversationId: "conversation B",
    actorId: "caller",
    runtimeUrl: "http://runtime.test",
    conversationUrl: "http://conversations.test",
    internalToken: "internal-secret",
    logger: createLogger({ service: "realtime-bridge-test" }),
    ...options,
  });
}
function runtimeReply(
  answer = "The verified appointment is available.",
  handoff = false,
): Response {
  return new Response(
    `${handoff ? 'event: transfer\ndata: {"status":"waiting"}\n\n' : ""}event: done\ndata: ${JSON.stringify({ turn: { deduplicated: false, conversation_id: "conversation", agent_id: "agent", agent_version_id: "version", assistant_message: { id: "reply", text: answer, seq: 2 } } })}\n\n`,
  );
}

test("realtime bridge waits for caller transcript, binds tenant scope, and coalesces duplicate calls", async (t) => {
  const bridge = fixture();
  t.after(() => bridge.close());
  const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
    return url.includes("runtime.test") ? runtimeReply() : new Response("{}");
  });
  const id = bridge.beginTurn("provider-item");
  const first = bridge.consult(id);
  const duplicate = bridge.consult(id);
  assert.equal(first, duplicate);
  assert.equal(requests.length, 0);
  bridge.transcript(id, "Check availability for Thursday.");
  const result = await first;
  assert.equal(result.status, "ok");
  assert.equal(requests.length, 2);
  const runtime = requests[1]!;
  assert.match(
    runtime.url,
    /workspaces\/workspace%20A\/widget\/conversations\/conversation%20B\/turns$/,
  );
  assert.equal(runtime.body.message, "Check availability for Thursday.");
  assert.equal(runtime.body.modality, "voice");
  assert.equal(runtime.headers.get("authorization"), "Bearer internal-secret");
  assert.equal(runtime.headers.get("idempotency-key"), requests[0]!.body.idempotency_key);
  await bridge.complete(id, "The appointment is available.", "spoken-reply");
  assert.equal(
    requests.length,
    2,
    "canonical runtime assistant answer is not persisted a second time",
  );
});

test("missing transcription cannot execute a model-invented request", async (t) => {
  const bridge = fixture({ transcriptWaitMs: 5 });
  t.after(() => bridge.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return runtimeReply();
  });
  assert.equal((await bridge.consult(bridge.beginTurn())).status, "unavailable");
  assert.equal(calls, 0);
});

test("interruption aborts runtime and an old item cannot replace the active caller turn", async (t) => {
  const bridge = fixture();
  t.after(() => bridge.close());
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (!url.includes("runtime.test")) return new Response("{}");
    started();
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new DOMException("Interrupted", "AbortError"));
        },
        { once: true },
      ),
    );
  });
  const old = bridge.beginTurn("old");
  bridge.transcript(old, "Check my booking.");
  const result = bridge.consult(old);
  await running;
  const current = bridge.beginTurn("new");
  bridge.transcript(current, "Never mind.");
  bridge.beginTurn("old");
  assert.equal(bridge.turnId, "new");
  assert.equal((await result).status, "unavailable");
  assert.equal(aborted, true);
  assert.equal(bridge.isCurrent(old), false);
  assert.equal(bridge.isCurrent(current), true);
});

test("runtime failure is cached without retrying an action; transfer is driven by runtime event", async (t) => {
  const bridge = fixture();
  t.after(() => bridge.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (!url.includes("runtime.test")) return new Response("{}");
    calls++;
    if (calls === 1) return new Response("offline", { status: 503 });
    return runtimeReply("I'm switching you to a teammate now.", true);
  });
  const first = bridge.beginTurn();
  bridge.transcript(first, "Book it.");
  assert.equal((await bridge.consult(first)).status, "unavailable");
  assert.equal((await bridge.consult(first)).status, "unavailable");
  assert.equal(calls, 1);
  const second = bridge.beginTurn();
  bridge.transcript(second, "Yes, connect me to a teammate.");
  assert.equal((await bridge.consult(second)).handoff, true);
  assert.equal(calls, 2);
});

test("ordinary native conversation persists user before assistant with stable message keys", async (t) => {
  const bridge = fixture();
  t.after(() => bridge.close());
  const writes: { sender_type: string; idempotency_key: string }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    writes.push(JSON.parse(String(init.body)));
    return new Response("{}");
  });
  const id = bridge.beginTurn();
  bridge.transcript(id, "Hello.");
  await bridge.complete(id, "Hello, how can I help?", "response");
  assert.deepEqual(
    writes.map((write) => write.sender_type),
    ["user", "assistant"],
  );
  assert.match(writes[1]!.idempotency_key, new RegExp(`^${writes[0]!.idempotency_key}:spoken:`));
});

test("runtime deadline returns an unavailable result without retrying or deactivating provider response delivery", async (t) => {
  const bridge = fixture({ turnTimeoutMs: 15 });
  t.after(() => bridge.close());
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (!url.includes("runtime.test")) return new Response("{}");
    calls++;
    return new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Timeout", "AbortError")),
        { once: true },
      ),
    );
  });
  const id = bridge.beginTurn();
  bridge.transcript(id, "Check my booking.");
  assert.equal((await bridge.consult(id)).status, "unavailable");
  assert.equal(bridge.isCurrent(id), true, "timeout result must still reach the voice model");
  assert.equal((await bridge.consult(id)).status, "unavailable");
  assert.equal(calls, 1);
});
