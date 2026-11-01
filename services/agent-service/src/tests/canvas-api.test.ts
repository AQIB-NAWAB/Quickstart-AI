import assert from "node:assert/strict";
import test from "node:test";
import { withAgentServer } from "../helpers/test-app.js";
const workspace = "00000000-0000-4000-8000-0000000000a1";
const graph = {
  schema_version: 1,
  entry_node_id: "entry",
  nodes: [
    {
      id: "entry",
      type: "entrypoint",
      name: "Start",
      position: { x: 0, y: 0 },
      config: { allowed_channels: ["chat"] },
    },
    { id: "end", type: "end_conversation", name: "End", position: { x: 300, y: 0 }, config: {} },
  ],
  edges: [
    {
      id: "edge",
      source_node_id: "entry",
      source_port_id: "out",
      target_node_id: "end",
      target_port_id: "in",
    },
  ],
};
test("canvas HTTP save, reload, stale revision, validation, publish and snapshot", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const token = await createToken("00000000-0000-4000-8000-000000000001");
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const base = `http://127.0.0.1:${port}/v1/workspaces/${workspace}/agents`;
    const created = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Canvas regression" }),
    });
    assert.equal(created.status, 201);
    const { agent } = (await created.json()) as { agent: { id: string; version: number } };
    const url = `${base}/${agent.id}`;
    const saved = await fetch(`${url}/graph`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        graph,
        expected_revision: agent.version,
        settings: { instructions: "Be helpful", channels: { chat: true, voice: false } },
      }),
    });
    assert.equal(saved.status, 200);
    const draft = (await saved.json()) as { draft_revision: number };
    assert.equal(draft.draft_revision, agent.version + 1);
    const reloaded = await fetch(`${url}/graph`, { headers });
    const loaded = (await reloaded.json()) as {
      draft_revision: number;
      builder_mode: string;
      graph: { edges: { source: string; source_port: string }[] };
    };
    assert.equal(loaded.draft_revision, draft.draft_revision);
    assert.equal(loaded.builder_mode, "canvas");
    assert.equal(loaded.graph.edges[0].source_port, "interaction_received");
    const stale = await fetch(`${url}/graph`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ graph, expected_revision: agent.version }),
    });
    assert.equal(stale.status, 409);
    const validated = await fetch(`${url}/validate-graph`, {
      method: "POST",
      headers,
      body: JSON.stringify({ graph }),
    });
    assert.equal(((await validated.json()) as { valid: boolean }).valid, true);
    const published = await fetch(`${url}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expected_revision: draft.draft_revision,
        release_notes: "Graph release",
      }),
    });
    assert.equal(published.status, 201);
    const release = (await published.json()) as {
      release_number: number;
      version: { created_by: string; snapshot: { graph: unknown } };
    };
    assert.equal(release.release_number, 1);
    assert.ok(release.version.snapshot.graph);
    assert.equal(release.version.created_by, "00000000-0000-4000-8000-000000000001");
  });
});
test("canvas write requires authentication", async () => {
  await withAgentServer(async ({ port }) => {
    const res = await fetch(
      `http://127.0.0.1:${port}/v1/workspaces/${workspace}/agents/no-agent/graph`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph, expected_revision: 1 }),
      },
    );
    assert.equal(res.status, 401);
  });
});

test("AI editor returns a validated draft proposal", async () => {
  await withAgentServer(
    async ({ port, createToken }) => {
      const token = await createToken("00000000-0000-0000-0000-000000000001");
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };
      const base = `http://127.0.0.1:${port}/v1/workspaces/${workspace}/agents`;
      const created = await fetch(base, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "AI editor regression", model_settings: { model: "fake" } }),
      });
      assert.equal(created.status, 201);
      const { agent } = (await created.json()) as { agent: { id: string } };

      const response = await fetch(`${base}/${agent.id}/ai-edit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "Make the greeting concise." }),
      });
      assert.equal(response.status, 200);
      const proposal = (await response.json()) as {
        summary: string;
        changes: string[];
        validation: { valid: boolean };
      };
      assert.equal(proposal.validation.valid, true);
      assert.equal(proposal.summary, "Concise greeting");
      assert.deepEqual(proposal.changes, ["Updated the greeting"]);
    },
    {
      modelGateway: {
        async complete() {
          return {
            content: JSON.stringify({
              summary: "Concise greeting",
              changes: ["Updated the greeting"],
              settings: { instructions: "Be concise." },
              graph,
            }),
            finish_reason: "stop",
            usage: { input_tokens: 1, output_tokens: 1 },
            provider: "fake",
            model: "fake",
            latency_ms: 1,
          };
        },
      },
    },
  );
});

test("unsigned gateway context cannot authorize canvas writes", async () => {
  await withAgentServer(async ({ port }) => {
    const context = Buffer.from(
      JSON.stringify({ tenant_id: "org", actor_id: "victim", roles: [], request_id: "test" }),
    ).toString("base64url");
    const res = await fetch(
      `http://127.0.0.1:${port}/v1/workspaces/${workspace}/agents/no-agent/graph`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", "x-quickstart-auth-context": context },
        body: JSON.stringify({ graph, expected_revision: 1 }),
      },
    );
    assert.equal(res.status, 401);
  });
});
