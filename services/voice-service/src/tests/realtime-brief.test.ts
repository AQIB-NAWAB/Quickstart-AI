import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createLogger } from "@quickstart/logging";
import { loadWidgetVoiceBrief } from "../widget-voice/agent-brief.js";

test("native realtime startup leaves knowledge retrieval to the source-scoped runtime", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    if (url.includes("conversations"))
      return Response.json({ conversation: { agent_id: "agent" } });
    if (url.includes("versions"))
      return Response.json({
        version: {
          snapshot: { instructions: "Published instructions", voice: { language: "ur" } },
        },
      });
    return Response.json({
      agent: {
        name: "Published Agent",
        production_version_id: "version",
        instructions: "Draft instructions",
      },
    });
  });
  const pack = await loadWidgetVoiceBrief({
    workspaceId: randomUUID(),
    conversationId: "conversation",
    conversationUrl: "http://conversations.test",
    agentUrl: "http://agents.test",
    knowledgeUrl: "http://knowledge.test",
    internalToken: "test",
    runtimeKnowledge: true,
    logger: createLogger({ service: "brief-test" }),
  });
  assert.equal(pack.language, "ur");
  assert.match(pack.brief, /Published instructions/);
  assert.doesNotMatch(pack.brief, /Draft instructions/);
  assert.equal(
    urls.some((url) => url.includes("knowledge.test")),
    false,
  );
});
