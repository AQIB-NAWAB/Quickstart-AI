import assert from "node:assert/strict";
import test from "node:test";
import { optionalVoiceContext, voiceOutputBudget } from "../services/voice-response-policy.js";

test("voice reserves space for reasoning while preserving explicit token limits", () => {
  assert.equal(voiceOutputBudget({ reasoningEffort: "low" }), 2048);
  assert.equal(voiceOutputBudget({ reasoningEffort: "medium" }), 4096);
  assert.equal(voiceOutputBudget({ reasoningEffort: "none" }), 256);
  assert.equal(voiceOutputBudget({ reasoningEffort: "high", configuredMax: 5000 }), 5000);
  assert.equal(voiceOutputBudget({ reasoningEffort: "low", configuredMax: 100 }), 100);
  assert.equal(voiceOutputBudget({ reasoningEffort: "low", environmentMax: "1000" }), 1000);
  for (const invalid of ["0", "-10", "NaN", "Infinity"]) {
    assert.equal(voiceOutputBudget({ reasoningEffort: "low", environmentMax: invalid }), 2048);
  }
});

test("optional context budgets run concurrently and expire before a later await", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let retrievalCancelled = false;
  const never = new Promise<string[]>(() => {});
  const retrieval = optionalVoiceContext(never, 250, [], () => {
    retrievalCancelled = true;
  });
  const memory = optionalVoiceContext(never, 150, []);
  // Simulate another upstream operation occupying the full context window.
  t.mock.timers.tick(250);
  assert.equal(retrievalCancelled, true);
  assert.deepEqual(await retrieval, []);
  assert.deepEqual(await memory, []);
});

test("optional context keeps real facts and cancels unused timeout work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  const facts = await optionalVoiceContext(Promise.resolve(["verified fact"]), 250, [], () => {
    cancelled = true;
  });
  t.mock.timers.tick(300);
  assert.deepEqual(facts, ["verified fact"]);
  assert.equal(cancelled, false);
  assert.deepEqual(await optionalVoiceContext(Promise.reject(new Error("offline")), 100, []), []);
});

test("live voice request keeps configured reasoning and sends a useful answer budget to the model", async () => {
  const { TurnsService } = await import("../services/turns.service.js");
  const { MockAgentClient, MockConversationClient, MockModelGatewayClient } =
    await import("../helpers/test-app.js");
  const agents = new MockAgentClient();
  agents.agents.set("workspace:agent", {
    id: "agent",
    workspace_id: "workspace",
    name: "Support",
    production_version_id: "version",
    instructions: "Use verified facts.",
  });
  agents.versions.set("workspace:agent:version", {
    id: "version",
    workspace_id: "workspace",
    agent_id: "agent",
    release_number: 1,
    snapshot: {
      name: "Support",
      instructions: "Use verified facts.",
      model_settings: { profile: "openai", model_id: "gpt-6-luna", reasoning_effort: "medium" },
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
  let lastRequest: import("@quickstart/contracts").CompletionRequestBody | undefined;
  const originalComplete = models.complete.bind(models);
  models.complete = async (body) => {
    lastRequest = body;
    return originalComplete(body);
  };
  const agentClient = {
    getAgentWidget: agents.getAgent.bind(agents),
    getVersionWidget: agents.getVersion.bind(agents),
  };
  const conversationClient = {
    getConversationWidget: conversations.getConversation.bind(conversations),
    appendMessageWidget: conversations.appendMessage.bind(conversations),
    listMessagesWidget: conversations.listMessages.bind(conversations),
  };
  const service = new TurnsService(
    agentClient as unknown as import("../clients/agent.client.js").AgentClient,
    conversationClient as unknown as import("../clients/conversation.client.js").ConversationClient,
    models as unknown as import("../clients/model-gateway.client.js").ModelGatewayClient,
  );
  const result = await service.executeWidgetTurn({
    workspaceId: "workspace",
    conversationId: "conversation",
    actorId: "caller",
    requestId: "request",
    idempotencyKey: "turn",
    text: "Explain the tradeoffs for my requirements.",
    modality: "voice",
    onToken: () => {},
  });
  assert.ok(result.assistant_message.text);
  assert.equal(lastRequest?.reasoning_effort, "medium");
  assert.equal(lastRequest?.max_tokens, 4096);
  assert.match(lastRequest?.messages[0]?.content ?? "", /essential detail is ambiguous/);
});
