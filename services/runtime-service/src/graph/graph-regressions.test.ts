import test from "node:test";
import assert from "node:assert/strict";
import type { AgentGraph, AgentGraphNode } from "@quickstart/contracts";
import {
  DEFAULT_AGENT_CONFIGURATION,
  normalizeAgentGraph,
  validateAgentGraph,
} from "@quickstart/contracts";
import { GraphEngine } from "./engine.js";
import { GraphNodeRegistry } from "./registry.js";
import { GraphSessionStore } from "./session-store.js";
import { setVariablePath, resolveVariablePath } from "./eval-utils.js";
import type { KnowledgeClient } from "../clients/knowledge.client.js";
import type { ModelGatewayClient } from "../clients/model-gateway.client.js";
import type { AgentClient } from "../clients/agent.client.js";

const node = (
  id: string,
  type: AgentGraphNode["type"],
  config: Record<string, unknown> = {},
): AgentGraphNode => ({
  id,
  type,
  name: id,
  position: { x: 0, y: 0 },
  config: config as AgentGraphNode["config"],
});
const graph = (nodes: AgentGraphNode[], connections: [string, string, string][]): AgentGraph => ({
  schema_version: 1,
  entry_node_id: nodes[0].id,
  nodes,
  edges: connections.map(([source, source_port, target], i) => ({
    id: `e${i}`,
    source,
    source_port,
    target,
    target_port: "in",
  })),
});
const fixture = () => {
  const store = new GraphSessionStore();
  return { store, engine: new GraphEngine(new GraphNodeRegistry(), store) };
};
const run = (engine: GraphEngine, g: AgentGraph, message?: string, workspace = "a") =>
  engine.executeTurn({
    workspaceId: workspace,
    agentId: "agent",
    conversationId: "conversation",
    sessionId: "session",
    graph: g,
    releaseId: null,
    channel: "chat",
    isPreview: true,
    requestId: crypto.randomUUID(),
    visitorMessage: message,
  });

test("legacy editor edges normalize into executable ports", () => {
  const g = graph(
    [node("entry", "entrypoint", { allowed_channels: ["chat"] }), node("end", "end_conversation")],
    [],
  );
  g.edges = [
    {
      id: "edge",
      source_node_id: "entry",
      source_port_id: "out",
      target_node_id: "end",
      target_port_id: "in",
    },
  ];
  assert.deepEqual(normalizeAgentGraph(g).edges[0], {
    id: "edge",
    source: "entry",
    source_port: "interaction_received",
    target: "end",
    target_port: "in",
  });
  assert.equal(validateAgentGraph(g).valid, true);
});
test("invalid port and duplicate target branch are rejected", () => {
  const g = graph(
    [node("entry", "entrypoint"), node("end", "end_conversation")],
    [
      ["entry", "bad", "end"],
      ["entry", "bad", "end"],
    ],
  );
  const issues = validateAgentGraph(g).issues.map((i) => i.code);
  assert.ok(issues.includes("PORT_INVALID"));
  assert.ok(issues.includes("PORT_MULTIPLE_TARGETS"));
});
test("malformed graphs return validation errors instead of throwing", () => {
  assert.equal(
    validateAgentGraph({ nodes: [null], edges: [] } as unknown as AgentGraph).valid,
    false,
  );
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("capture", "conversation", { captured_fields: [{ variable: 42 }] }),
    ],
    [],
  );
  assert.equal(validateAgentGraph(g).valid, false);
});
test("edited aliases override previously normalized settings", () => {
  const g = graph(
    [node("welcome", "welcome", { fixed_text: "First", transition: "continue" })],
    [],
  );
  const saved = normalizeAgentGraph(g);
  saved.nodes[0].config = {
    ...saved.nodes[0].config,
    fixed_text: "Edited",
    transition: "wait_for_input",
  };
  const edited = normalizeAgentGraph(saved).nodes[0].config as Record<string, unknown>;
  assert.equal(edited.message, "Edited");
  assert.equal(edited.after_mode, "wait");
});
test("capture stays on its node until all fields arrive and does not invent a name", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("capture", "conversation", {
        instructions: "Ask for details",
        capture_fields: [
          { field_name: "name", type: "text", required: true },
          { field_name: "date", type: "date", required: true },
        ],
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "capture"],
      ["capture", "details_complete", "end"],
    ],
  );
  const a = await run(engine, g, "tomorrow");
  assert.equal(a.currentNodeId, "capture");
  assert.equal(resolveVariablePath("name", a.sessionState.variables), undefined);
  assert.equal(a.status, "waiting_for_input");
  const b = await run(engine, g, "Jane Smith");
  assert.equal(b.status, "completed");
  assert.equal(resolveVariablePath("name", b.sessionState.variables), "Jane Smith");
});
test("welcome waits once, then consumes next visitor turn in the next node", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("welcome", "welcome", { fixed_text: "Hello", transition: "wait_for_input" }),
      node("reply", "response", {
        content_type: "variable_reference",
        variable_name: "visitor.message",
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "welcome"],
      ["welcome", "message_sent", "reply"],
      ["reply", "message_sent", "end"],
    ],
  );
  const a = await run(engine, g);
  assert.deepEqual(a.messages, ["Hello"]);
  assert.equal(a.currentNodeId, "reply");
  const b = await run(engine, g, "My question");
  assert.deepEqual(b.messages, ["My question"]);
  await assert.rejects(run(engine, g, "retry"), /ended/);
});
test("session graph remains frozen when draft is edited", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("welcome", "welcome", { fixed_text: "Hello", transition: "wait_for_input" }),
      node("end", "end_conversation", { closing_message: "Original" }),
    ],
    [
      ["entry", "interaction_received", "welcome"],
      ["welcome", "message_sent", "end"],
    ],
  );
  await run(engine, g);
  const edited = structuredClone(g);
  edited.nodes[2].config = { closing_message: "Changed" };
  const b = await run(engine, edited, "Goodbye");
  assert.deepEqual(b.messages, ["Original"]);
});
test("session and traces cannot cross workspace boundaries", async () => {
  const { engine, store } = fixture();
  const g = graph(
    [node("entry", "entrypoint"), node("end", "end_conversation")],
    [["entry", "interaction_received", "end"]],
  );
  const a = await run(engine, g);
  assert.equal(await store.getSession("b", "session"), null);
  assert.equal(await store.getTrace("b", a.runId), null);
  assert.deepEqual(await store.listTraces("b", "session"), []);
  assert.equal((await store.listAgentTraces("a", "agent")).length, 1);
  assert.deepEqual(await store.listAgentTraces("b", "agent"), []);
});
test("trace listeners are workspace scoped", async () => {
  const { store } = fixture();
  let called = false;
  store.subscribeTrace("b", "session", () => {
    called = true;
  });
  const event = { event_id: "e" } as never;
  await store.appendTraceEvent("a", "session", event);
  assert.equal(called, false);
});
test("agent trace index caps high-volume histories and honors retention", async () => {
  const store = new GraphSessionStore();
  const base = {
    session_id: "session",
    agent_id: "agent",
    status: "succeeded" as const,
    total_duration_ms: 1,
    steps: [],
    started_at: new Date().toISOString(),
  };
  for (let i = 0; i < 120; i += 1) {
    await store.saveTrace(
      { ...base, run_id: `run-${i}`, completed_at: new Date().toISOString() },
      "a",
      60,
    );
  }
  assert.equal((await store.listAgentTraces("a", "agent", 200)).length, 100);
  await store.saveTrace(
    { ...base, run_id: "expired", completed_at: new Date().toISOString() },
    "a",
    0,
  );
  assert.ok(await store.getTrace("a", "expired"));
});
test("agent trace settings redact PII and can disable input/output capture", async () => {
  const { engine } = fixture();
  const g = graph(
    [node("entry", "entrypoint"), node("end", "end_conversation")],
    [["entry", "interaction_received", "end"]],
  );
  const redacted = await engine.executeTurn({
    workspaceId: "a",
    agentId: "agent",
    conversationId: "trace-redaction",
    sessionId: "trace-redaction",
    graph: g,
    releaseId: "release",
    channel: "chat",
    isPreview: false,
    requestId: crypto.randomUUID(),
    visitorMessage: "Email me at person@example.com",
    agentConfiguration: DEFAULT_AGENT_CONFIGURATION,
  });
  const serialized = JSON.stringify(redacted.trace);
  assert.match(serialized, /REDACTED_EMAIL/);
  assert.doesNotMatch(serialized, /person@example\.com/);

  const result = await engine.executeTurn({
    workspaceId: "a",
    agentId: "agent",
    conversationId: "trace-settings",
    sessionId: "trace-settings",
    graph: g,
    releaseId: "release",
    channel: "chat",
    isPreview: false,
    requestId: crypto.randomUUID(),
    visitorMessage: "Email me at person@example.com",
    agentConfiguration: {
      ...DEFAULT_AGENT_CONFIGURATION,
      observability: { trace_retention_days: 1, capture_inputs: false, capture_outputs: false },
    },
  });
  assert.equal(result.trace.steps[0]?.inputs, undefined);
  assert.equal(result.trace.steps[0]?.outputs, undefined);
});
test("runtime executes 100 independent turns without cross-session trace leakage", async () => {
  const { engine, store } = fixture();
  const g = graph(
    [node("entry", "entrypoint"), node("end", "end_conversation")],
    [["entry", "interaction_received", "end"]],
  );
  for (let i = 0; i < 100; i += 1) {
    const id = `load-${i}`;
    const result = await engine.executeTurn({
      workspaceId: "a",
      agentId: "agent",
      conversationId: id,
      sessionId: id,
      graph: g,
      releaseId: "release",
      channel: "chat",
      isPreview: false,
      requestId: crypto.randomUUID(),
      visitorMessage: `hello-${i}`,
    });
    assert.equal(result.status, "completed");
  }
  assert.equal((await store.listAgentTraces("a", "agent", 100)).length, 100);
  assert.deepEqual(await store.listAgentTraces("b", "agent"), []);
});
test("concurrent turns use exclusive session lock", async () => {
  const { store } = fixture();
  let release!: () => void;
  const waiting = new Promise<void>((r) => {
    release = r;
  });
  const first = store.withSessionLock("a", "session", () => waiting);
  await assert.rejects(
    store.withSessionLock("a", "session", async () => {}),
    /already processing/,
  );
  release();
  await first;
});
test("internal channel model calls inherit frozen agent settings without browser credentials", async () => {
  let called = false;
  const modelGateway = {
    async complete(body: { model: { model_id: string }; temperature: number }) {
      called = true;
      assert.equal(body.model.model_id, "configured-model");
      assert.equal(body.temperature, 0.7);
      return { content: "Verified answer" };
    },
  } as unknown as ModelGatewayClient;
  const engine = new GraphEngine(new GraphNodeRegistry({ modelGateway }), new GraphSessionStore());
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("ai", "ai_prompt", { instructions: "Answer", output_variable: "answer.text" }),
      node("response", "response", {
        content_type: "variable_reference",
        variable_name: "answer.text",
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "ai"],
      ["ai", "success", "response"],
      ["response", "message_sent", "end"],
    ],
  );
  const result = await engine.executeTurn({
    workspaceId: "a",
    agentId: "agent",
    conversationId: "c",
    graph: g,
    releaseId: "r",
    channel: "voice",
    isPreview: false,
    requestId: "request",
    visitorMessage: "Question",
    agentDefaults: {
      instructions: "Persona",
      model_settings: { model_id: "configured-model", temperature: 0.7 },
      tools: [],
    },
  });
  assert.equal(called, true);
  assert.deepEqual(result.messages, ["Verified answer"]);
  assert.equal(result.status, "completed");
});
test("AI prompt can delegate to a different published specialist agent", async () => {
  let requestAgentId = "";
  let systemPrompt = "";
  const modelGateway = {
    async complete(body: { agent_id?: string; messages: Array<{ role: string; content: string }> }) {
      requestAgentId = body.agent_id ?? "";
      systemPrompt = body.messages.find((message) => message.role === "system")?.content ?? "";
      return { content: "Specialist answer" };
    },
  } as unknown as ModelGatewayClient;
  const agentClient = {
    async getAgentWidget() {
      return { production_version_id: "specialist-release" };
    },
    async getVersionWidget() {
      return {
        id: "specialist-release",
        agent_id: "specialist",
        snapshot: {
          name: "Specialist",
          instructions: "You are the billing specialist.",
          model_settings: { profile: "openai", model_id: "specialist-model" },
        },
      };
    },
  } as unknown as AgentClient;
  const engine = new GraphEngine(
    new GraphNodeRegistry({ modelGateway, agentClient }),
    new GraphSessionStore(),
  );
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("ai", "ai_prompt", {
        delegate_agent_id: "specialist",
        output_variable: "answer.text",
      }),
      node("response", "response", {
        content_type: "variable_reference",
        variable_name: "answer.text",
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "ai"],
      ["ai", "success", "response"],
      ["response", "message_sent", "end"],
    ],
  );
  const result = await engine.executeTurn({
    workspaceId: "a",
    agentId: "parent",
    conversationId: "c-delegate",
    graph: g,
    releaseId: "parent-release",
    channel: "chat",
    isPreview: false,
    requestId: "request-delegate",
    visitorMessage: "Why was I charged?",
  });
  assert.equal(requestAgentId, "specialist");
  assert.match(systemPrompt, /billing specialist/);
  assert.deepEqual(result.messages, ["Specialist answer"]);
});
test("internal channel knowledge retrieval uses service credentials and selected sources", async () => {
  let requestedWorkspace = "";
  const knowledgeClient = {
    async retrieve(workspaceId: string) {
      requestedWorkspace = workspaceId;
      return [
        { chunk_id: "one", source_id: "selected", text: "Clinic hours", score: 1 },
        { chunk_id: "two", source_id: "other", text: "Other", score: 1 },
      ];
    },
  } as unknown as KnowledgeClient;
  const store = new GraphSessionStore();
  const engine = new GraphEngine(new GraphNodeRegistry({ knowledgeClient }), store);
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("knowledge", "knowledge_search", {
        source_ids: ["selected"],
        output_variable: "knowledge.results",
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "knowledge"],
      ["knowledge", "results_found", "end"],
    ],
  );
  const result = await run(engine, g, "Hours?");
  assert.equal(requestedWorkspace, "a");
  assert.equal(result.status, "completed");
  assert.deepEqual(resolveVariablePath("knowledge.results", result.sessionState.variables), [
    { chunk_id: "one", source_id: "selected", text: "Clinic hours", score: 1 },
  ]);
});
test("missing HTTP integration never fabricates appointment success", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("http", "http_request", { url: "https://clinic.example/slots" }),
      node("error", "response", { fixed_text: "Unavailable" }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "http"],
      ["http", "failure", "error"],
      ["error", "message_sent", "end"],
    ],
  );
  const a = await run(engine, g);
  assert.deepEqual(a.messages, ["Unavailable"]);
  assert.ok(a.trace.steps.some((s) => s.node_id === "http" && s.status === "failed"));
});
test("missing knowledge and model dependencies fail honestly", async () => {
  for (const type of ["knowledge_search", "ai_prompt"] as const) {
    const { engine } = fixture();
    const g = graph(
      [
        node("entry", "entrypoint"),
        node("service", type, { instructions: "Answer", query_variable: "visitor.message" }),
      ],
      [["entry", "interaction_received", "service"]],
    );
    const r = await run(engine, g, "What are your hours?");
    assert.equal(r.status, "failed");
    assert.deepEqual(r.messages, []);
  }
});
test("immediate cycles fail at step budget rather than succeeding", async () => {
  const { engine } = fixture();
  const g = graph(
    [node("entry", "entrypoint"), node("loop", "condition", { rules: [] })],
    [
      ["entry", "interaction_received", "loop"],
      ["loop", "otherwise", "loop"],
    ],
  );
  assert.equal((await run(engine, g)).status, "failed");
});
test("variable paths reject prototype pollution", () => {
  assert.throws(() => setVariablePath("__proto__.polluted", true, {}), /Invalid/);
  assert.equal(resolveVariablePath("constructor.name", {}), undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("duplicate graph turn replays without emitting another message", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("reply", "response", { fixed_text: "Hello" }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "reply"],
      ["reply", "message_sent", "end"],
    ],
  );
  let emitted = 0;
  const request = {
    workspaceId: "a",
    agentId: "agent",
    conversationId: "c",
    sessionId: "s",
    graph: g,
    releaseId: null,
    channel: "chat" as const,
    isPreview: true,
    requestId: "request",
    idempotencyKey: "same-turn",
    visitorMessage: "Hi",
    onAssistantMessage: async () => {
      emitted++;
    },
  };
  const first = await engine.executeTurn(request),
    second = await engine.executeTurn(request);
  assert.equal(emitted, 1);
  assert.equal(first.runId, second.runId);
  await assert.rejects(
    engine.executeTurn({ ...request, visitorMessage: "Changed" }),
    /different message/,
  );
});

test("ai prompt nodes emit generated text to the caller", async () => {
  const store = new GraphSessionStore();
  const model = {
    complete: async () => ({
      content: "The specialist found the answer.",
      finish_reason: "stop",
      usage: { input_tokens: 1, output_tokens: 1 },
      provider: "fake",
      model: "fake",
      latency_ms: 1,
    }),
  } as unknown as ModelGatewayClient;
  const engine = new GraphEngine(new GraphNodeRegistry({ modelGateway: model }), store);
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("prompt", "ai_prompt", { instructions: "Answer the visitor.", output_variable: "answer" }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "prompt"],
      ["prompt", "success", "end"],
    ],
  );
  const emitted: string[] = [];
  const result = await engine.executeTurn({
    workspaceId: "a",
    agentId: "agent",
    conversationId: "conversation",
    sessionId: "prompt-session",
    graph: g,
    releaseId: null,
    channel: "chat",
    isPreview: true,
    requestId: crypto.randomUUID(),
    visitorMessage: "What is the answer?",
    agentDefaults: { instructions: "", model_settings: { model: "fake" }, tools: [] },
    onAssistantMessage: async (text) => {
      emitted.push(text);
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(emitted, ["The specialist found the answer."]);
  assert.deepEqual(result.messages, emitted);
});

test("mutating tools stay suspended until exact confirmation and cannot bypass it", async () => {
  const store = new GraphSessionStore();
  let calls = 0;
  const executor = {
    execute: async () => {
      calls++;
      return { ok: true, status: "succeeded", content: '{"status":"confirmed"}' };
    },
  } as unknown as import("../services/tool-executor.js").ToolExecutor;
  const engine = new GraphEngine(new GraphNodeRegistry({ toolExecutor: executor }), store);
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("book", "http_request", {
        tool_id: "tool",
        require_confirmation: false,
        parameter_mappings: { slot: "visitor.slot" },
        output_variable: "booking",
      }),
      node("end", "end_conversation"),
    ],
    [
      ["entry", "interaction_received", "book"],
      ["book", "success", "end"],
    ],
  );
  const session = {
    session_id: "session",
    workspace_id: "a",
    agent_id: "agent",
    release_id: null,
    is_preview: true,
    channel: "chat" as const,
    status: "active" as const,
    current_node_id: "entry",
    variables: { visitor: { slot: "09:00" } },
    agent_defaults: {
      instructions: "",
      model_settings: {},
      tools: [
        {
          id: "tool",
          type: "http" as const,
          name: "book",
          description: "Book an appointment",
          base_url: "https://clinic.example",
          method: "POST" as const,
          allowed_hosts: ["clinic.example"],
          parameters: {
            type: "object" as const,
            properties: { slot: { type: "string" } },
            required: ["slot"],
          },
        },
      ],
    },
    turn_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await store.saveSession(session);
  const first = await run(engine, g, "book an appointment");
  assert.equal(first.status, "waiting_for_input");
  assert.equal(first.currentNodeId, "book");
  assert.equal(calls, 0);
  const declined = await run(engine, g, "not yes, do not book");
  assert.equal(declined.status, "waiting_for_input");
  assert.equal(calls, 0);
  const confirmed = await run(engine, g, "yes");
  assert.equal(confirmed.status, "completed");
  assert.equal(calls, 1);
});
test("handoff waits for explicit authoritative release before resuming", async () => {
  const { engine } = fixture();
  const g = graph(
    [
      node("entry", "entrypoint"),
      node("handoff", "human_handoff", { handoff_message: "Connecting", resume_node_id: "end" }),
      node("end", "end_conversation", { closing_message: "Resumed" }),
    ],
    [
      ["entry", "interaction_received", "handoff"],
      ["handoff", "resumed", "end"],
    ],
  );
  const first = await run(engine, g);
  assert.equal(first.status, "handed_off");
  await assert.rejects(run(engine, g, "Hello"), /human operator/);
  const released = await engine.executeTurn({
    workspaceId: "a",
    agentId: "agent",
    conversationId: "conversation",
    sessionId: "session",
    graph: g,
    releaseId: null,
    channel: "chat",
    isPreview: true,
    requestId: "release",
    humanReleased: true,
    visitorMessage: "Hello",
  });
  assert.equal(released.status, "completed");
});
