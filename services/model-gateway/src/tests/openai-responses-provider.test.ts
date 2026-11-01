import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleProvider } from "../providers/openai-compatible.provider.js";

test("GPT-6 models use Responses with provider items preserved for tool loops", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input, init) => {
    assert.match(String(input), /\/responses$/);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output: [
          { type: "reasoning", id: "rs_1" },
          {
            type: "function_call",
            call_id: "call_1",
            name: "lookup_order",
            arguments: '{"order_id":"A-1"}',
          },
        ],
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const provider = new OpenAiCompatibleProvider({
      id: "openai",
      driver: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
    });
    const result = await provider.complete({
      modelId: "gpt-6-astra",
      messages: [{ role: "user", content: "Find order A-1" }],
      tools: [{ name: "lookup_order", description: "Look up an order" }],
      reasoningEffort: "medium",
      context: { workspaceId: "ws", requestId: "req", attempt: 1 },
    });
    assert.equal(result.finishReason, "tool_calls");
    assert.equal(result.toolCalls?.[0]?.name, "lookup_order");
    assert.equal(result.providerItems?.[0] && (result.providerItems[0] as { type: string }).type, "reasoning");
    assert.deepEqual((requestBody?.reasoning as { effort: string }).effort, "medium");
    assert.equal(Array.isArray(requestBody?.input), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
