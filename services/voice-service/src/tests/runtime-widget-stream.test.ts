import assert from "node:assert/strict";
import test from "node:test";
import { streamWidgetTurn } from "../clients/runtime-widget-stream.js";

const input = {
  runtimeUrl: "http://runtime.test",
  internalToken: "test",
  workspaceId: "workspace",
  conversationId: "conversation",
  actorId: "caller",
  text: "Hello",
  idempotencyKey: "turn",
  requestId: "request",
};
const turn = {
  deduplicated: false,
  conversation_id: "conversation",
  agent_id: "agent",
  agent_version_id: "version",
  assistant_message: { id: "message", text: "Hello there.", seq: 2 },
};

test("voice stream returns on done without waiting for HTTP close and cancels its reader", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`event: done\ndata: ${JSON.stringify({ turn })}\n\n`),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream));
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 200);
  try {
    const result = await Promise.race([
      streamWidgetTurn({ ...input, signal: abort.signal }, () => {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("waited for HTTP close")), 300),
      ),
    ]);
    assert.equal(result.assistant_text, "Hello there.");
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(timeout);
  }
});

test("voice stream handles CRLF, fragmented UTF-8 and multiline data", async (t) => {
  const wire = `: heartbeat\r\n\r\nevent: token\r\ndata: {"delta":"جی"}\r\n\r\nevent: done\r\ndata: {"turn":\r\ndata: ${JSON.stringify(turn)}}\r\n\r\n`;
  const bytes = new TextEncoder().encode(wire);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
      ),
  );
  const tokens: string[] = [];
  const result = await streamWidgetTurn(input, (delta) => tokens.push(delta));
  assert.deepEqual(tokens, ["جی"]);
  assert.equal(result.assistant_text, "Hello there.");
});

test("voice stream releases the reader on provider error and rejects truncated replies", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('event: error\ndata: {"message":"unavailable"}\n\n'),
            );
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  await assert.rejects(
    streamWidgetTurn(input, () => {}),
    /unavailable/,
  );
  assert.equal(cancelled, true);
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response('event: token\ndata: {"delta":"partial"}\n\n'),
  );
  await assert.rejects(
    streamWidgetTurn(input, () => {}),
    /before completion/,
  );
});
