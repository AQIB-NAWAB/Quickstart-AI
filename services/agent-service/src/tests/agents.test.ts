import assert from "node:assert/strict";
import test from "node:test";
import { withAgentServer } from "../helpers/test-app.js";

const WS_A = "00000000-0000-4000-8000-0000000000a1";
const WS_B = "00000000-0000-4000-8000-0000000000b2";
const USER = "00000000-0000-0000-0000-00000000000a";

test("create and list agents in workspace", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);

    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Support Bot",
        instructions: "Be helpful",
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      agent: { id: string; version: number; name: string };
    };
    assert.equal(created.agent.name, "Support Bot");
    assert.equal(created.agent.version, 1);

    const listRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as { agents: { id: string }[] };
    assert.equal(list.agents.length, 1);
    assert.equal(list.agents[0].id, created.agent.id);
  });
});

test("cursor pagination stays bounded for high-volume agent lists", async () => {
  await withAgentServer(async ({ port, createToken, store }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const tenant = { workspaceId: WS_A, actorId: USER };
    await Promise.all(
      Array.from({ length: 105 }, (_, index) =>
        store.createAgent(tenant, { name: `Bulk agent ${String(index).padStart(3, "0")}` }),
      ),
    );
    const firstRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents?limit=100`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(firstRes.status, 200);
    const first = (await firstRes.json()) as { agents: unknown[]; next_cursor: string | null };
    assert.equal(first.agents.length, 100);
    assert.ok(first.next_cursor);
    const secondRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents?limit=100&cursor=${encodeURIComponent(first.next_cursor!)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    assert.equal(secondRes.status, 200);
    const second = (await secondRes.json()) as { agents: unknown[]; next_cursor: string | null };
    assert.equal(second.agents.length, 5);
    assert.equal(second.next_cursor, null);
  });
});

test("persists agent policies and supports archive lifecycle", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Policy Bot",
        configuration: {
          knowledge: { enabled: true, source_ids: ["source-1"] },
          memory: { enabled: true, subject_key_template: "customer:{customer_id}" },
          guardrails: { block_prompt_injection: true, violation_action: "handoff" },
        },
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as {
      agent: {
        id: string;
        configuration: { knowledge: { source_ids: string[] }; memory: { enabled: boolean } };
      };
    };
    assert.deepEqual(created.agent.configuration.knowledge.source_ids, ["source-1"]);
    assert.equal(created.agent.configuration.memory.enabled, true);

    const archiveRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/archive`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ archived: true }),
      },
    );
    assert.equal(archiveRes.status, 200);
    const active = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(((await active.json()) as { agents: unknown[] }).agents.length, 0);
    const archived = await fetch(`${base}/v1/workspaces/${WS_A}/agents?include_archived=true`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(((await archived.json()) as { agents: unknown[] }).agents.length, 1);
  });
});

test("release policy requires checklist completion and explicit approval", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Governed Release Bot",
        configuration: {
          release: {
            require_approval: true,
            required_checklist: ["Regression suite passed", "Security review completed"],
          },
        },
      }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { agent: { id: string; version: number } };

    const blockedRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ base_version: created.agent.version }),
      },
    );
    assert.equal(blockedRes.status, 400);
    const blockedBody = (await blockedRes.json()) as { error: { message: string } };
    assert.match(blockedBody.error.message, /checklist|approval/i);

    const publishRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          base_version: created.agent.version,
          approval: { approved: true, note: "Reviewed by release owner" },
          completed_checklist: ["Regression suite passed", "Security review completed"],
        }),
      },
    );
    assert.equal(publishRes.status, 201);
  });
});

test("canary traffic pins an immutable release and can be disabled", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Canary Bot" }),
    });
    const created = (await createRes.json()) as { agent: { id: string; version: number } };
    const firstPublish = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      { method: "POST", headers, body: JSON.stringify({ base_version: created.agent.version }) },
    );
    const first = (await firstPublish.json()) as { version: { id: string } };

    const updateRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expected_version: 1, instructions: "Version two" }),
    });
    const updated = (await updateRes.json()) as { agent: { version: number } };
    const secondPublish = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      { method: "POST", headers, body: JSON.stringify({ base_version: updated.agent.version }) },
    );
    const second = (await secondPublish.json()) as { version: { id: string } };

    const canaryRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/canary`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ version_id: first.version.id, canary_percentage: 25 }),
      },
    );
    assert.equal(canaryRes.status, 200);
    const canary = (await canaryRes.json()) as {
      agent: { canary_version_id: string; canary_percentage: number };
    };
    assert.equal(canary.agent.canary_version_id, first.version.id);
    assert.equal(canary.agent.canary_percentage, 25);

    const clearRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/canary`,
      { method: "POST", headers, body: JSON.stringify({ canary_percentage: 0 }) },
    );
    assert.equal(clearRes.status, 200);
    const cleared = (await clearRes.json()) as {
      agent: { canary_version_id: string | null; canary_percentage: number };
    };
    assert.equal(cleared.agent.canary_version_id, null);
    assert.equal(cleared.agent.canary_percentage, 0);
    assert.notEqual(first.version.id, second.version.id);
  });
});

test("scheduled releases expose staging and promote at the requested time", async () => {
  await withAgentServer(async ({ port, createToken, store }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Scheduled Bot" }),
    });
    const created = (await createRes.json()) as { agent: { id: string; version: number } };
    const publishRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      { method: "POST", headers, body: JSON.stringify({ base_version: created.agent.version }) },
    );
    const published = (await publishRes.json()) as { version: { id: string } };
    const updateRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ expected_version: 1, instructions: "Scheduled revision" }),
    });
    const updated = (await updateRes.json()) as { agent: { version: number } };
    const secondPublishRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/publish`,
      { method: "POST", headers, body: JSON.stringify({ base_version: updated.agent.version }) },
    );
    const secondPublished = (await secondPublishRes.json()) as { version: { id: string } };
    const rollbackRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/rollback`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ version_id: published.version.id }),
      },
    );
    assert.equal(rollbackRes.status, 200);
    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const scheduleRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/schedule-release`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ version_id: secondPublished.version.id, publish_at: scheduledAt }),
      },
    );
    assert.equal(scheduleRes.status, 200);
    const scheduled = (await scheduleRes.json()) as {
      agent: {
        scheduled_version_id: string;
        scheduled_publish_at: string;
        production_version_id: string | null;
      };
    };
    assert.equal(scheduled.agent.scheduled_version_id, secondPublished.version.id);
    assert.equal(scheduled.agent.production_version_id, published.version.id);

    const comparisonRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/environments`,
      { headers },
    );
    assert.equal(comparisonRes.status, 200);
    const comparison = (await comparisonRes.json()) as {
      environments: { staging: { id: string } | null; production: { id: string } | null };
    };
    assert.equal(comparison.environments.staging?.id, secondPublished.version.id);
    assert.equal(comparison.environments.production?.id, published.version.id);

    assert.equal(await store.applyDueSchedules(new Date(scheduled.agent.scheduled_publish_at)), 1);
    const promoted = await store.getAgent({ workspaceId: WS_A, actorId: USER }, created.agent.id);
    assert.equal(promoted?.productionVersionId, secondPublished.version.id);
    assert.equal(promoted?.scheduledVersionId, null);
  });
});

test("release readiness reports blockers and archived agents can be deleted safely", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Readiness Bot" }),
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { agent: { id: string } };

    const readyRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/release-readiness`,
      {
        headers,
      },
    );
    assert.equal(readyRes.status, 200);
    const ready = (await readyRes.json()) as { ready: boolean; blockers: unknown[] };
    assert.equal(ready.ready, true);
    assert.deepEqual(ready.blockers, []);

    const archiveRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/archive`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ archived: true }),
      },
    );
    assert.equal(archiveRes.status, 200);

    const archivedReadyRes = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/release-readiness`,
      {
        headers,
      },
    );
    const archivedReady = (await archivedReadyRes.json()) as {
      ready: boolean;
      blockers: Array<{ code: string }>;
    };
    assert.equal(archivedReady.ready, false);
    assert.equal(archivedReady.blockers[0]?.code, "ARCHIVED");

    const deleteRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(deleteRes.status, 200);
  });
});

test("publish readiness blocks missing workspace secrets", async () => {
  await withAgentServer(
    async ({ port, createToken }) => {
      const base = `http://127.0.0.1:${port}`;
      const token = await createToken(USER);
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Secret Bot",
          tools: [
            {
              id: "order-lookup",
              name: "order_lookup",
              description: "Look up an order",
              type: "http",
              method: "GET",
              base_url: "https://api.example.com",
              allowed_hosts: ["api.example.com"],
              auth: { type: "bearer_secret", secret_name: "ORDER_TOKEN" },
            },
          ],
        }),
      });
      assert.equal(createRes.status, 201);
      const created = (await createRes.json()) as { agent: { id: string } };
      const readinessRes = await fetch(
        `${base}/v1/workspaces/${WS_A}/agents/${created.agent.id}/release-readiness`,
        { headers },
      );
      const readiness = (await readinessRes.json()) as {
        ready: boolean;
        blockers: Array<{ code: string }>;
      };
      assert.equal(readiness.ready, false);
      assert.equal(readiness.blockers[0]?.code, "MISSING_SECRET");
    },
    { secrets: { listNames: async () => new Set<string>() } },
  );
});

test("bulk archive preflights live releases and archives a batch", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const ids: string[] = [];
    for (const name of ["Batch One", "Batch Two"]) {
      const response = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name }),
      });
      const body = (await response.json()) as { agent: { id: string } };
      ids.push(body.agent.id);
    }
    const archiveRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents/archive-batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agent_ids: ids, archived: true }),
    });
    assert.equal(archiveRes.status, 200);
    const archived = (await archiveRes.json()) as { agents: Array<{ archived_at: string | null }> };
    assert.equal(archived.agents.length, 2);
    assert.ok(archived.agents.every((agent) => agent.archived_at));
  });
});

test("duplicate agent name returns 409", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);
    const body = JSON.stringify({ name: "Dup", instructions: "x" });

    const first = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    assert.equal(first.status, 201);

    const second = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    assert.equal(second.status, 409);
  });
});

test("stale expected_version returns 409 on update", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);

    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "V", instructions: "a" }),
    });
    const { agent } = (await createRes.json()) as { agent: { id: string; version: number } };

    const ok = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${agent.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expected_version: 1, instructions: "b" }),
    });
    assert.equal(ok.status, 200);

    const stale = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${agent.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ expected_version: 1, instructions: "c" }),
    });
    assert.equal(stale.status, 409);
  });
});

test("cross-workspace agent read returns 404", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const token = await createToken(USER);

    const createRes = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Secret", instructions: "x" }),
    });
    const { agent } = (await createRes.json()) as { agent: { id: string } };

    const cross = await fetch(`${base}/v1/workspaces/${WS_B}/agents/${agent.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(cross.status, 404);
  });
});

test("analyst cannot create agent (403)", async () => {
  await withAgentServer(
    async ({ port, createToken }) => {
      const base = `http://127.0.0.1:${port}`;
      const token = await createToken(USER);

      const res = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "Nope", instructions: "x" }),
      });
      assert.equal(res.status, 403);
    },
    { role: "analyst" },
  );
});

test("native realtime agents can publish configured tools and selected knowledge", async () => {
  await withAgentServer(async ({ port, createToken }) => {
    const base = `http://127.0.0.1:${port}`;
    const headers = {
      authorization: `Bearer ${await createToken(USER)}`,
      "content-type": "application/json",
    };
    const created = await fetch(`${base}/v1/workspaces/${WS_A}/agents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Realtime Tool Agent",
        instructions: "Use the knowledge base and configured tools.",
        voice: { voice_mode: "s2s" },
        tools: [
          {
            id: "lookup",
            name: "lookup_order",
            description: "Look up an order",
            type: "http",
            method: "GET",
            base_url: "https://orders.example.com",
            allowed_hosts: ["orders.example.com"],
            policy: { enabled: true, allowed_channels: ["voice"] },
          },
        ],
        configuration: { knowledge: { enabled: true, source_ids: ["selected-source"] } },
      }),
    });
    assert.equal(created.status, 201);
    const body = (await created.json()) as { agent: { id: string; version: number } };
    const readiness = await fetch(
      `${base}/v1/workspaces/${WS_A}/agents/${body.agent.id}/release-readiness`,
      { headers },
    );
    const checks = (await readiness.json()) as { blockers: { code: string; message: string }[] };
    assert.equal(
      checks.blockers.some((blocker) => /s2s.*(?:tools|RAG)/i.test(blocker.message)),
      false,
    );
    const published = await fetch(`${base}/v1/workspaces/${WS_A}/agents/${body.agent.id}/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({ base_version: body.agent.version }),
    });
    assert.equal(published.status, 201, JSON.stringify(await published.json()));
  });
});
