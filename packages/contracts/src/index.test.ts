import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACTS_VERSION,
  DEFAULT_VOICE_MODE,
  createDefaultAgentGraph,
  s2sProfileAllowed,
  validateAgentGraph,
} from "./index.js";

test("contracts exports a version string", () => {
  assert.equal(CONTRACTS_VERSION, "0.0.0");
});

test("default voice mode is cascade", () => {
  assert.equal(DEFAULT_VOICE_MODE, "cascade");
});

test("s2s rejects tools and RAG", () => {
  assert.equal(
    s2sProfileAllowed({ voice_mode: "s2s", toolsCount: 1, knowledgeEnabled: false }).ok,
    false,
  );
  assert.equal(
    s2sProfileAllowed({ voice_mode: "s2s", toolsCount: 0, knowledgeEnabled: true }).ok,
    false,
  );
  assert.equal(
    s2sProfileAllowed({ voice_mode: "s2s", toolsCount: 0, knowledgeEnabled: false }).ok,
    true,
  );
  assert.equal(
    s2sProfileAllowed({ voice_mode: "cascade", toolsCount: 3, knowledgeEnabled: true }).ok,
    true,
  );
});

test("default manual-agent graph is valid and inherits shared instructions", () => {
  const graph = createDefaultAgentGraph({
    channels: { chat: true, voice: true },
    knowledge: { enabled: true },
  });
  const validation = validateAgentGraph(graph);

  assert.equal(validation.valid, true);
  assert.deepEqual(graph.nodes.find((node) => node.type === "ai_prompt")?.config, {
    system_prompt: "",
    inherit_agent_instructions: true,
    context_variables: ["search_context", "visitor.message"],
    temperature: 0.3,
    output_variable: "ai_output",
  });
  assert.deepEqual(graph.nodes.find((node) => node.type === "entrypoint")?.config, {
    allowed_channels: ["chat", "voice"],
    visitor_metadata_fields: [],
  });
  assert.equal(
    (
      graph.nodes.find((node) => node.type === "knowledge_search")?.config as {
        use_all_sources?: boolean;
      }
    ).use_all_sources,
    true,
  );

  const withoutKnowledge = createDefaultAgentGraph({
    channels: { chat: true, voice: false },
    knowledge: { enabled: false },
  });
  assert.equal(
    withoutKnowledge.nodes.some((node) => node.type === "knowledge_search"),
    false,
  );
  assert.equal(validateAgentGraph(withoutKnowledge).valid, true);

  const noChannelGraph = createDefaultAgentGraph({
    channels: { chat: false, voice: false },
  });
  assert.equal(validateAgentGraph(noChannelGraph).valid, true);
});

test("native realtime runtime bridge permits tools and scoped knowledge", () => {
  assert.equal(
    s2sProfileAllowed({
      voice_mode: "s2s",
      toolsCount: 3,
      knowledgeEnabled: true,
      runtimeBridge: true,
    }).ok,
    true,
  );
  assert.equal(
    s2sProfileAllowed({
      voice_mode: "s2s",
      toolsCount: 3,
      knowledgeEnabled: true,
      runtimeBridge: false,
    }).ok,
    false,
  );
});
