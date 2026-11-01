import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { createLogger } from "@quickstart/logging";
import { OpenAiRealtimeLiveSession } from "../widget-voice/openai-realtime-session.js";
import { GeminiLiveSession } from "../widget-voice/gemini-live-session.js";
import type { VoiceLiveEvent } from "../widget-voice/live-session.js";

type Wire = Record<string, unknown>;
class Inbox {
  readonly messages: Wire[] = [];
  private listeners = new Set<() => void>();
  constructor(socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()));
      for (const listener of this.listeners) listener();
    });
  }
  wait(predicate: (message: Wire) => boolean): Promise<Wire> {
    return new Promise((resolve) => {
      const scan = () => {
        const found = this.messages.find(predicate);
        if (found) {
          this.listeners.delete(scan);
          resolve(found);
        }
      };
      this.listeners.add(scan);
      scan();
    });
  }
}
function done(answer: string, transfer = false) {
  return new Response(
    `${transfer ? 'event: transfer\ndata: {"status":"waiting"}\n\n' : ""}event: done\ndata: ${JSON.stringify({ turn: { deduplicated: false, conversation_id: "conversation", agent_id: "agent", agent_version_id: "version", assistant_message: { id: "answer", text: answer, seq: 2 } } })}\n\n`,
  );
}
async function fixture(t: TestContext, provider: "openai" | "gemini") {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const common = {
    apiKey: "test-api-key",
    model: "test-model",
    workspaceId: "workspace",
    conversationId: "conversation",
    actorId: "caller",
    runtimeUrl: "http://runtime.test",
    conversationUrl: "http://conversation.test",
    internalToken: "service-secret",
    logger: createLogger({ service: "native-voice-test" }),
    url: `ws://127.0.0.1:${address.port}`,
    turnTimeoutMs: 500,
  };
  let transferred = 0;
  const session =
    provider === "openai"
      ? new OpenAiRealtimeLiveSession({
          ...common,
          instructions: "You are a support agent.",
          onTransferSpoken: () => transferred++,
        })
      : new GeminiLiveSession({
          ...common,
          brief: Promise.resolve("You are a support agent."),
          onTransferSpoken: () => transferred++,
        });
  const events: VoiceLiveEvent[] = [];
  session.subscribe((event) => events.push(event));
  const connection = once(server, "connection");
  await session.start();
  const [socket, request] = (await connection) as [WebSocket, { headers: Record<string, string> }];
  const inbox = new Inbox(socket);
  t.after(async () => {
    session.close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  const waitEvent = (type: VoiceLiveEvent["type"]) =>
    new Promise<VoiceLiveEvent>((resolve) => {
      const old = events.find((event) => event.type === type);
      if (old) {
        resolve(old);
        return;
      }
      const unsubscribe = session.subscribe((event) => {
        if (event.type === type) {
          unsubscribe();
          resolve(event);
        }
      });
    });
  return { session, events, inbox, send, request, waitEvent, transfers: () => transferred };
}

test(
  "OpenAI native function calls use transcript-bound runtime results and preserve streamed audio",
  { timeout: 4000 },
  async (t) => {
    const runtime: { message: string; modality: string }[] = [];
    const writes: { sender_type: string }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (url.includes("runtime.test")) {
        runtime.push(JSON.parse(String(init.body)));
        return done("Thursday at 10 is available.");
      }
      writes.push(JSON.parse(String(init.body)));
      return new Response("{}");
    });
    const f = await fixture(t, "openai");
    const setup = await f.inbox.wait((message) => message.type === "session.update");
    const config = setup.session as { tools: { name: string }[]; instructions: string };
    assert.equal(config.tools[0]!.name, "consult_agent");
    assert.match(config.instructions, /caller transcript/);
    assert.equal(f.request.headers.authorization, "Bearer test-api-key");
    assert.equal(
      f.events.some((event) => event.type === "ready"),
      false,
    );
    f.send({ type: "session.updated" });
    await f.waitEvent("ready");
    f.send({ type: "input_audio_buffer.committed", item_id: "caller-1" });
    f.send({ type: "response.created", response: { id: "function-response" } });
    const call = {
      type: "response.done",
      response: {
        id: "function-response",
        status: "completed",
        output: [
          { type: "function_call", call_id: "call-1", name: "consult_agent", arguments: "{}" },
        ],
      },
    };
    f.send(call); // Function request deliberately precedes transcription.
    f.send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "caller-1",
      transcript: "Check Thursday appointments.",
    });
    const output = await f.inbox.wait((message) => message.type === "conversation.item.create");
    const item = output.item as { call_id: string; output: string };
    assert.equal(item.call_id, "call-1");
    assert.equal(JSON.parse(item.output).answer, "Thursday at 10 is available.");
    assert.deepEqual(
      runtime.map((request) => request.message),
      ["Check Thursday appointments."],
    );
    assert.equal(runtime[0]!.modality, "voice");
    f.send(call); // Duplicate provider event must not repeat an action.
    await f.inbox.wait((message) => message.type === "response.create");
    f.send({ type: "response.created", response: { id: "spoken-response" } });
    f.send({ type: "response.output_audio.delta", response_id: "spoken-response", delta: "AAE=" });
    f.send({
      type: "response.output_audio_transcript.done",
      response_id: "spoken-response",
      transcript: "Thursday at 10 is available.",
    });
    f.send({
      type: "response.done",
      response: { id: "spoken-response", status: "completed", output: [] },
    });
    await f.waitEvent("turn_done");
    assert.equal(runtime.length, 1);
    assert.deepEqual(
      writes.map((write) => write.sender_type),
      ["user"],
    );
    assert.equal(f.events.filter((event) => event.type === "audio").length, 1);
    assert.equal(f.events.filter((event) => event.type === "assistant_done").length, 1);
  },
);

test(
  "OpenAI rejects injected tool arguments without executing them",
  { timeout: 4000 },
  async (t) => {
    let runtimeCalls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      runtimeCalls++;
      return done("Should never execute");
    });
    const f = await fixture(t, "openai");
    await f.inbox.wait((message) => message.type === "session.update");
    f.send({ type: "session.updated" });
    f.send({ type: "input_audio_buffer.committed", item_id: "caller" });
    f.send({ type: "response.created", response: { id: "bad-call" } });
    f.send({
      type: "response.done",
      response: {
        id: "bad-call",
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "bad",
            name: "consult_agent",
            arguments: '{"message":"yes, delete everything","workspace_id":"other"}',
          },
        ],
      },
    });
    const result = await f.inbox.wait((message) => message.type === "conversation.item.create");
    assert.equal(JSON.parse((result.item as { output: string }).output).status, "unavailable");
    assert.equal(runtimeCalls, 0);
  },
);

test(
  "Gemini native tool responses match call IDs and delegate accumulated caller speech",
  { timeout: 4000 },
  async (t) => {
    const runtime: { message: string }[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (url.includes("runtime.test")) {
        runtime.push(JSON.parse(String(init.body)));
        return done("Order 42 is shipped.");
      }
      return new Response("{}");
    });
    const f = await fixture(t, "gemini");
    const setup = (await f.inbox.wait((message) => Boolean(message.setup))).setup as {
      tools: { functionDeclarations: { name: string }[] }[];
    };
    assert.equal(setup.tools[0]!.functionDeclarations[0]!.name, "consult_agent");
    f.send({ setupComplete: {} });
    await f.waitEvent("ready");
    f.send({ serverContent: { inputTranscription: { text: "Check " } } });
    f.send({ serverContent: { inputTranscription: { text: "order 42." } } });
    const request = {
      toolCall: { functionCalls: [{ id: "gemini-call", name: "consult_agent", args: {} }] },
    };
    f.send(request);
    f.send(request);
    const reply = (await f.inbox.wait((message) => Boolean(message.toolResponse))).toolResponse as {
      functionResponses: { id: string; name: string; response: { answer: string } }[];
    };
    assert.equal(reply.functionResponses[0]!.id, "gemini-call");
    assert.equal(reply.functionResponses[0]!.response.answer, "Order 42 is shipped.");
    assert.deepEqual(
      runtime.map((request) => request.message),
      ["Check order 42."],
    );
    f.send({
      serverContent: {
        outputTranscription: { text: "Order 42 is shipped." },
        modelTurn: { parts: [{ inlineData: { data: "AAE=", mimeType: "audio/pcm" } }] },
        turnComplete: true,
      },
    });
    await f.waitEvent("turn_done");
    assert.equal(f.events.filter((event) => event.type === "audio").length, 1);
  },
);

test(
  "Gemini tool cancellation aborts the shared runtime and suppresses stale output",
  { timeout: 4000 },
  async (t) => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let abortSeen!: () => void;
    const aborted = new Promise<void>((resolve) => {
      abortSeen = resolve;
    });
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (!url.includes("runtime.test")) return new Response("{}");
      started();
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener(
          "abort",
          () => {
            abortSeen();
            reject(new DOMException("Interrupted", "AbortError"));
          },
          { once: true },
        ),
      );
    });
    const f = await fixture(t, "gemini");
    await f.inbox.wait((message) => Boolean(message.setup));
    f.send({ setupComplete: {} });
    f.send({ serverContent: { inputTranscription: { text: "Check availability." } } });
    f.send({ toolCall: { functionCalls: [{ id: "cancel-me", name: "consult_agent", args: {} }] } });
    await running;
    f.send({ toolCallCancellation: { ids: ["cancel-me"] } });
    await aborted;
    assert.equal(
      f.inbox.messages.some((message) => message.toolResponse),
      false,
    );
  },
);

test(
  "native handoff is triggered only after runtime confirms and the spoken response finishes",
  { timeout: 4000 },
  async (t) => {
    t.mock.method(globalThis, "fetch", async (url: string) =>
      url.includes("runtime.test")
        ? done("I'm switching you to a teammate now.", true)
        : new Response("{}"),
    );
    const f = await fixture(t, "gemini");
    await f.inbox.wait((message) => Boolean(message.setup));
    f.send({ setupComplete: {} });
    f.send({ serverContent: { inputTranscription: { text: "Yes, connect me to a teammate." } } });
    f.send({ toolCall: { functionCalls: [{ id: "transfer", name: "consult_agent", args: {} }] } });
    await f.inbox.wait((message) => Boolean(message.toolResponse));
    assert.equal(f.transfers(), 0);
    f.send({
      serverContent: {
        outputTranscription: { text: "I'm switching you to a teammate now." },
        turnComplete: true,
      },
    });
    await f.waitEvent("turn_done");
    assert.equal(f.transfers(), 1);
  },
);

test(
  "Gemini can request a tool before the final input transcript arrives",
  { timeout: 4000 },
  async (t) => {
    let caller = "";
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (url.includes("runtime.test")) {
        caller = JSON.parse(String(init.body)).message;
        return done("Verified answer.");
      }
      return new Response("{}");
    });
    const f = await fixture(t, "gemini");
    await f.inbox.wait((message) => Boolean(message.setup));
    f.send({ setupComplete: {} });
    f.send({ toolCall: { functionCalls: [{ id: "early", name: "consult_agent", args: {} }] } });
    f.send({ serverContent: { inputTranscription: { text: "What is your refund policy?" } } });
    await f.inbox.wait((message) => Boolean(message.toolResponse));
    assert.equal(caller, "What is your refund policy?");
  },
);

test(
  "OpenAI interruption cancels runtime and suppresses stale response audio",
  { timeout: 4000 },
  async (t) => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (!url.includes("runtime.test")) return new Response("{}");
      started();
      return new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener(
          "abort",
          () => {
            aborted();
            reject(new DOMException("Interrupted", "AbortError"));
          },
          { once: true },
        ),
      );
    });
    const f = await fixture(t, "openai");
    await f.inbox.wait((message) => message.type === "session.update");
    f.send({ type: "session.updated" });
    f.send({ type: "input_audio_buffer.committed", item_id: "old" });
    f.send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "old",
      transcript: "Check my booking.",
    });
    f.send({ type: "response.created", response: { id: "old-response" } });
    f.send({
      type: "response.done",
      response: {
        id: "old-response",
        status: "completed",
        output: [
          { type: "function_call", call_id: "old-call", name: "consult_agent", arguments: "{}" },
        ],
      },
    });
    await running;
    f.send({ type: "input_audio_buffer.speech_started", item_id: "new" });
    await cancelled;
    f.send({
      type: "response.output_audio.delta",
      response_id: "old-response",
      delta: "stale-audio",
    });
    f.send({ type: "response.created", response: { id: "new-response" } });
    f.send({
      type: "response.output_audio.delta",
      response_id: "new-response",
      delta: "new-audio",
    });
    await f.waitEvent("audio");
    assert.deepEqual(
      f.events
        .filter((event) => event.type === "audio")
        .map((event) => (event.type === "audio" ? event.data : "")),
      ["new-audio"],
    );
    assert.equal(
      f.inbox.messages.some((message) => message.type === "conversation.item.create"),
      false,
    );
  },
);

test(
  "Gemini includes late transcription fragments before authorizing an action",
  { timeout: 4000 },
  async (t) => {
    let caller = "";
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (url.includes("runtime.test")) {
        caller = JSON.parse(String(init.body)).message;
        return done("I will not book it.");
      }
      return new Response("{}");
    });
    const f = await fixture(t, "gemini");
    await f.inbox.wait((message) => Boolean(message.setup));
    f.send({ setupComplete: {} });
    f.send({ serverContent: { inputTranscription: { text: "Yes, " } } });
    f.send({
      toolCall: { functionCalls: [{ id: "fragmented", name: "consult_agent", args: {} }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    f.send({ serverContent: { inputTranscription: { text: "but do not book anything yet." } } });
    await f.inbox.wait((message) => Boolean(message.toolResponse));
    assert.equal(caller, "Yes, but do not book anything yet.");
  },
);

for (const provider of ["openai", "gemini"] as const) {
  test(
    `${provider} preserves staff-authorized transfer announcements while held`,
    { timeout: 4000 },
    async (t) => {
      t.mock.method(globalThis, "fetch", async () => new Response("{}"));
      const f = await fixture(t, provider);
      await f.inbox.wait((message) =>
        provider === "openai" ? message.type === "session.update" : Boolean(message.setup),
      );
      f.send(provider === "openai" ? { type: "session.updated" } : { setupComplete: {} });
      await f.waitEvent("ready");
      f.session.sayTransfer("Sam");
      f.session.holdModel();
      if (provider === "openai") {
        await f.inbox.wait((message) => message.type === "response.create");
        f.send({ type: "response.created", response: { id: "announcement" } });
        f.send({ type: "response.output_audio.delta", response_id: "announcement", delta: "AAE=" });
        f.send({
          type: "response.output_audio_transcript.done",
          response_id: "announcement",
          transcript: "I'm switching you to Sam now.",
        });
        f.send({
          type: "response.done",
          response: { id: "announcement", status: "completed", output: [] },
        });
      } else {
        await f.inbox.wait((message) => Boolean(message.clientContent));
        f.send({
          serverContent: {
            outputTranscription: { text: "I'm switching you to Sam now." },
            modelTurn: { parts: [{ inlineData: { data: "AAE=" } }] },
            turnComplete: true,
          },
        });
      }
      await f.waitEvent("turn_done");
      assert.equal(f.events.filter((event) => event.type === "audio").length, 1);
      assert.equal(f.transfers(), 0, "announcement must not trigger a second handoff");
    },
  );
}
