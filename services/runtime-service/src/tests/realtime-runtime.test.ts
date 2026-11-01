import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAgentConfiguration,
  type AgentToolDefinition,
  type CompletionRequestBody,
} from "@quickstart/contracts";
import {
  MockAgentClient,
  MockConversationClient,
  MockModelGatewayClient,
  MockToolCallsClient,
} from "../helpers/test-app.js";
import type { AgentClient } from "../clients/agent.client.js";
import type { ConversationClient } from "../clients/conversation.client.js";
import type { ModelGatewayClient } from "../clients/model-gateway.client.js";
import type { KnowledgeClient } from "../clients/knowledge.client.js";
import type { ToolCallsClient } from "../clients/tool-calls.client.js";
import { TurnsService } from "../services/turns.service.js";
import { ToolExecutor } from "../services/tool-executor.js";
import { ToolLoop } from "../services/tool-loop.js";

const booking: AgentToolDefinition = {
  id: "booking",
  name: "confirm_booking",
  description: "Confirm the appointment the caller requested",
  type: "http",
  method: "POST",
  base_url: "https://booking.test/confirm",
  allowed_hosts: ["booking.test"],
  parameters: { type: "object", properties: {} },
  policy: { enabled: true, risk: "write", confirmation: "user", allowed_channels: ["voice"] },
};
function fixture(tools: AgentToolDefinition[] = [], knowledge?: KnowledgeClient) {
  const agents = new MockAgentClient();
  agents.agents.set("workspace:agent", {
    id: "agent",
    workspace_id: "workspace",
    name: "Appointments",
    production_version_id: "version",
    instructions: "Use confirmed facts and tools.",
  });
  agents.versions.set("workspace:agent:version", {
    id: "version",
    workspace_id: "workspace",
    agent_id: "agent",
    release_number: 1,
    snapshot: {
      name: "Appointments",
      instructions: "Use confirmed facts and tools.",
      model_settings: { profile: "fake", model_id: "fake" },
      tools,
      configuration: normalizeAgentConfiguration({
        knowledge: {
          enabled: Boolean(knowledge),
          source_ids: ["selected-source"],
          search_method: "hybrid",
        },
      }),
    },
  });
  const conversations = new MockConversationClient();
  conversations.conversations.set("workspace:conversation", {
    id: "conversation",
    workspace_id: "workspace",
    agent_id: "agent",
    last_seq: 0,
  });
  const models = new MockModelGatewayClient();
  const ledger = new MockToolCallsClient();
  const executor = new ToolExecutor();
  let executed = 0;
  executor.execute = async () => {
    executed++;
    return { ok: true, content: '{"status":"confirmed"}', status: "succeeded" };
  };
  const service = new TurnsService(
    {
      getAgentWidget: agents.getAgent.bind(agents),
      getVersionWidget: agents.getVersion.bind(agents),
    } as unknown as AgentClient,
    {
      getConversationWidget: conversations.getConversation.bind(conversations),
      appendMessageWidget: conversations.appendMessage.bind(conversations),
      listMessagesWidget: conversations.listMessages.bind(conversations),
    } as unknown as ConversationClient,
    models as unknown as ModelGatewayClient,
    knowledge,
    undefined,
    new ToolLoop(
      models as unknown as ModelGatewayClient,
      ledger as unknown as ToolCallsClient,
      executor,
    ),
  );
  const request = (text: string, key: string, workspaceId = "workspace") =>
    service.executeWidgetTurn({
      workspaceId,
      conversationId: "conversation",
      actorId: "caller",
      requestId: key,
      idempotencyKey: key,
      text,
      modality: "voice",
      onToken: () => {},
    });
  return { models, conversations, ledger, request, executions: () => executed };
}

test("realtime delegation uses voice permissions, asks for confirmation, and executes a booking once", async () => {
  const f = fixture([booking]);
  const seen: CompletionRequestBody[] = [];
  f.models.complete = async (body) => {
    seen.push(body);
    const result = [...body.messages].reverse().find((message) => message.role === "tool");
    return {
      content: result
        ? /changes data/.test(result.content)
          ? "Should I book this appointment?"
          : "Your appointment is confirmed."
        : "",
      finish_reason: result ? "stop" : "tool_calls",
      ...(!result
        ? { tool_calls: [{ id: "book-call", name: "confirm_booking", arguments: {} }] }
        : {}),
      usage: { input_tokens: 1, output_tokens: 1 },
      provider: "fake",
      model: "fake",
      latency_ms: 1,
    };
  };
  const question = await f.request("Book the appointment.", "turn-1");
  assert.match(question.assistant_message.text, /Should I book/);
  assert.equal(f.executions(), 0);
  await f.request("Yes, but do not book anything yet.", "turn-hold");
  assert.equal(f.executions(), 0, "a corrected or negated yes must not authorize a write");
  const confirmed = await f.request("Yes, go ahead.", "turn-2");
  assert.match(confirmed.assistant_message.text, /confirmed/);
  assert.equal(f.executions(), 1);
  assert.ok(seen.every((request) => request.channel === "voice"));
  const replay = await f.request("Yes, go ahead.", "turn-2");
  assert.equal(replay.deduplicated, true);
  assert.equal(f.executions(), 1);
});

test("realtime delegation cannot execute a tool restricted to chat", async () => {
  const f = fixture([
    {
      ...booking,
      policy: {
        ...booking.policy,
        allowed_channels: ["chat"],
        confirmation: "never",
        risk: "read",
      },
    },
  ]);
  f.models.complete = async (body) => {
    const guarded = body.messages.some((message) => message.role === "tool");
    return {
      content: guarded ? "That action is unavailable on this call." : "",
      finish_reason: guarded ? "stop" : "tool_calls",
      ...(!guarded ? { tool_calls: [{ id: "call", name: "confirm_booking", arguments: {} }] } : {}),
      usage: { input_tokens: 1, output_tokens: 1 },
      provider: "fake",
      model: "fake",
      latency_ms: 1,
    };
  };
  await f.request("Yes, book it.", "restricted");
  assert.equal(f.executions(), 0);
});

test("realtime knowledge retrieval uses caller query and published source selection", async () => {
  let scope: unknown[] = [];
  const knowledge = {
    async retrieve(...args: unknown[]) {
      scope = args;
      return [
        {
          chunk_id: "chunk",
          source_id: "selected-source",
          text: "Verified policy: refunds take five business days.",
          score: 1,
        },
      ];
    },
  } as unknown as KnowledgeClient;
  const f = fixture([], knowledge);
  await f.request("How long do refunds take?", "knowledge");
  assert.equal(scope[0], "workspace");
  assert.equal(scope[1], "How long do refunds take?");
  assert.deepEqual(scope[5], { sourceIds: ["selected-source"], searchMethod: "hybrid" });
  assert.match(
    f.models.lastMessages[0]!.content,
    /Verified policy: refunds take five business days/,
  );
});

test("realtime runtime cannot cross conversation workspace boundaries", async () => {
  const f = fixture([booking]);
  await assert.rejects(f.request("Yes, book it.", "cross-tenant", "other-workspace"), /not found/i);
  assert.equal(f.models.callCount, 0);
  assert.equal(f.executions(), 0);
});
