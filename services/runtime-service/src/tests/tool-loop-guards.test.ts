import test from "node:test";
import assert from "node:assert/strict";
import type {
  AgentToolDefinition,
  CompletionRequestBody,
  CompletionResponseBody,
} from "@quickstart/contracts";
import type { ToolCallsClient } from "../clients/tool-calls.client.js";
import type { ModelGatewayClient } from "../clients/model-gateway.client.js";
import { ToolLoop } from "../services/tool-loop.js";
import type { ToolExecutor } from "../services/tool-executor.js";

const HTTP_TOOL: AgentToolDefinition = {
  id: "custom:get_posts",
  name: "get_posts",
  description: "Fetch a post by id",
  type: "http",
  method: "GET",
  base_url: "https://dummyjson.com",
  allowed_hosts: ["dummyjson.com"],
  path_template: "/posts/{post_id}",
  parameters: {
    type: "object",
    properties: { post_id: { type: "string", description: "The post id" } },
    required: ["post_id"],
  },
};

type Round = {
  finish: "tool_calls" | "stop";
  calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  content?: string;
};

function loopWith(
  rounds: Round[],
  executed: Array<{ name: string; args: Record<string, unknown> }>,
  visitorText = "check post 5 and post 6",
  tool: AgentToolDefinition = HTTP_TOOL,
) {
  const modelClient = {
    async complete(body: CompletionRequestBody): Promise<CompletionResponseBody> {
      const round = rounds.shift();
      if (!round) {
        return {
          content: "final",
          finish_reason: "stop",
          usage: { input_tokens: 1, output_tokens: 1 },
          provider: "fake",
          model: body.model.model_id,
          latency_ms: 1,
        };
      }
      return {
        content: round.content ?? "",
        finish_reason: round.finish,
        ...(round.calls ? { tool_calls: round.calls } : {}),
        usage: { input_tokens: 1, output_tokens: 1 },
        provider: "fake",
        model: body.model.model_id,
        latency_ms: 1,
      };
    },
  } as unknown as ModelGatewayClient;

  const toolCallsClient = {
    async listByTurn() {
      return [];
    },
    async upsert() {
      return { record: {}, created: true };
    },
  } as unknown as ToolCallsClient;

  const executor = {
    async execute(tool: AgentToolDefinition, args: Record<string, unknown>) {
      executed.push({ name: tool.name, args });
      return { ok: true, content: `result:${JSON.stringify(args)}`, status: "succeeded" as const };
    },
  } as unknown as ToolExecutor;

  const loop = new ToolLoop(modelClient, toolCallsClient, executor);
  return loop.run({
    workspaceId: "ws-1",
    agentId: "agent-1",
    conversationId: "conv-1",
    requestId: "req-1",
    turnIdempotencyKey: "turn-1",
    authHeaders: {},
    model: { profile: "fake", model_id: "fake:model" },
    tools: [tool],
    chatMessages: [{ role: "user", content: visitorText }],
    visitorText,
  });
}

test("tool loop refuses to execute when required arguments are missing", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await loopWith(
    [
      { finish: "tool_calls", calls: [{ id: "tc-1", name: "get_posts", arguments: {} }] },
      { finish: "stop", content: "What post id should I look up?" },
    ],
    executed,
  );
  assert.equal(executed.length, 0);
  const guard = result.chatMessages.find((m) => m.role === "tool");
  assert.ok(guard);
  assert.match(guard.content, /tool_guard/);
  assert.match(guard.content, /post_id/);
  assert.equal(result.content, "What post id should I look up?");
});

test("tool loop executes a duplicate call only once per turn", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await loopWith(
    [
      {
        finish: "tool_calls",
        calls: [
          { id: "tc-1", name: "get_posts", arguments: { post_id: "5" } },
          { id: "tc-2", name: "get_posts", arguments: { post_id: "5" } },
        ],
      },
      { finish: "stop", content: "Here are the post details." },
    ],
    executed,
  );
  assert.equal(executed.length, 1);
  assert.deepEqual(executed[0].args, { post_id: "5" });
  const toolMessages = result.chatMessages.filter((m) => m.role === "tool");
  assert.equal(toolMessages.length, 2);
  assert.match(toolMessages[1].content, /already called get_posts/);
  assert.equal(result.content, "Here are the post details.");
});

test("tool loop executes calls with different arguments", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  await loopWith(
    [
      {
        finish: "tool_calls",
        calls: [
          { id: "tc-1", name: "get_posts", arguments: { post_id: "5" } },
          { id: "tc-2", name: "get_posts", arguments: { post_id: "6" } },
        ],
      },
      { finish: "stop", content: "Done." },
    ],
    executed,
  );
  assert.equal(executed.length, 2);
  assert.deepEqual(
    executed.map((e) => e.args.post_id),
    ["5", "6"],
  );
});

test("tool policy can disable a tool before execution", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await loopWith(
    [
      { finish: "tool_calls", calls: [{ id: "tc-1", name: "get_posts", arguments: { post_id: "5" } }] },
      { finish: "stop", content: "I cannot run that action." },
    ],
    executed,
    "check post 5",
    { ...HTTP_TOOL, policy: { enabled: false } },
  );
  assert.equal(executed.length, 0);
  assert.match(result.chatMessages.find((m) => m.role === "tool")?.content ?? "", /disabled/);
});

test("tool policy enforces channel allowlists and per-turn limits", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await loopWith(
    [
      {
        finish: "tool_calls",
        calls: [
          { id: "tc-1", name: "get_posts", arguments: { post_id: "5" } },
          { id: "tc-2", name: "get_posts", arguments: { post_id: "6" } },
        ],
      },
      { finish: "stop", content: "Done." },
    ],
    executed,
    "check post 5 and post 6",
    { ...HTTP_TOOL, policy: { allowed_channels: ["voice"], max_calls_per_turn: 1 } },
  );
  assert.equal(executed.length, 0);
  assert.match(result.chatMessages.filter((m) => m.role === "tool")[0]?.content ?? "", /channel/);
});

test("tool policy caps different calls to the configured per-turn limit", async () => {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  await loopWith(
    [
      {
        finish: "tool_calls",
        calls: [
          { id: "tc-1", name: "get_posts", arguments: { post_id: "5" } },
          { id: "tc-2", name: "get_posts", arguments: { post_id: "6" } },
        ],
      },
      { finish: "stop", content: "Done." },
    ],
    executed,
    "check post 5 and post 6",
    { ...HTTP_TOOL, policy: { max_calls_per_turn: 1 } },
  );
  assert.equal(executed.length, 1);
});
