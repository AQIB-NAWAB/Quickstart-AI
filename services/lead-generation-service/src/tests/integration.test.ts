import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.NODE_ENV = "test";
import http from "node:http";
import { signAccessToken } from "@quickstart/auth";
import { createLogger } from "@quickstart/logging";
import { DEFAULT_POLICY, runInput, policyInput } from "../domain.js";
import { database } from "./db.js";
import type { Identity } from "../store.js";
import { Store } from "../store.js";
import {
  ResearchAgent,
  DemoProvider,
  qualify,
  locationsCompatible,
  ResearchError,
  GatewayResearchProvider,
} from "../research.js";
import { processTask } from "../worker.js";
import { createServer } from "../http.js";
import type { Config } from "../config.js";
import { publicAddress, assertPublicUrl } from "@quickstart/utilities";
import { responseText, retryAfterSeconds } from "../responses.js";

const identity = (): Identity => ({
  orgId: randomUUID(),
  workspaceId: randomUUID(),
  actorId: randomUUID(),
  requestId: randomUUID(),
});
const business = {
  name: "Appointments Inc",
  website: "https://example.com/",
  description: "Appointment software for clinics",
  offerings: ["appointment software"],
  target_categories: ["clinics"],
  locations: ["Lahore"],
};
const brief = () => runInput({ categories: ["clinics"], location: "Lahore", target_count: 10, qualification_mode: "strict" });
const logger = createLogger({ service: "lead-test" });
async function fixture() {
  const db = await database();
  const i = identity();
  await db.store.putProfile(i, business, 0);
  return { ...db, i };
}
async function drain(
  f: Awaited<ReturnType<typeof fixture>>,
  provider = new DemoProvider(),
  limit = 100,
) {
  const agent = new ResearchAgent(f.store, provider);
  for (let n = 0; n < limit; n++) {
    const task = await f.store.claim(120);
    if (!task) break;
    await processTask(f.store, agent, task, logger);
  }
  await f.store.finalizeRuns();
}

test("complete onboarding -> multi-round research -> campaign delivery; replay deduplicates", async () => {
  const f = await fixture();
  try {
    const b = { ...brief(), campaign_id: randomUUID() };
    const created = await f.store.createRun(f.i, b, "run-key");
    const replay = await f.store.createRun(f.i, b, "run-key");
    assert.equal(replay.run.id, created.run.id);
    assert.equal(replay.deduplicated, true);
    await assert.rejects(
      () => f.store.createRun(f.i, { ...b, target_count: 2 }, "run-key"),
      /different request/,
    );
    await drain(f);
    const profile = await f.store.profile(f.i);
    assert.equal(profile.research_status, "ready");
    const run = await f.store.run(f.i, created.run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.accepted, 3);
    assert.equal(run.rounds, 3);
    const results = await f.store.results(f.i, run.id, null, 100);
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.status === "accepted"));
    const delivery = await f.store.deliveries(f.i, run.id);
    assert.equal(delivery.length, 3);
    assert.ok(delivery.every((r) => r.state === "done" && r.result.simulated === true));
    assert.equal((await f.store.list(f.i, "leads", null, 100)).length, 3);
  } finally {
    await f.close();
  }
});

test("fair scheduler rotates tenants and aggregates caps across their workspaces", async () => {
  const f = await fixture();
  try {
    await drain(f);
    const second = identity();
    await f.store.putProfile(second, business, 0);
    await drain(f);
    await f.store.createRun(
      f.i,
      { ...brief(), categories: ["clinics", "salons", "restaurants"] },
      "a",
    );
    await f.store.createRun(second, brief(), "b");
    const one = await f.store.claim(120),
      two = await f.store.claim(120);
    assert.ok(one && two);
    assert.notEqual(one.org_id, two.org_id);
    const another = { ...f.i, workspaceId: randomUUID() };
    await f.store.putProfile(another, business, 0);
    for (let n = 0; n < 10; n++) await f.store.claim(120);
    const counts = (
      await f.pool.query(
        "SELECT org_id,count(*)::int AS n FROM lg_tasks WHERE state='running' GROUP BY org_id",
      )
    ).rows;
    assert.ok(counts.every((r) => r.n <= 2));
  } finally {
    await f.close();
  }
});

test("atomic run quota across simultaneous create requests and dynamic audited settings", async () => {
  const f = await fixture();
  try {
    await f.store.changeSettings(f.i, {
      scope: "tier",
      name: "limited",
      expected_version: 0,
      policy: { subscription_limits_enabled: true, daily_runs: 1 },
      reason: "Test tier",
    });
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: f.i.orgId,
      tier_name: "limited",
      expected_version: 1,
      reason: "Assign tier",
    });
    const results = await Promise.allSettled([
      f.store.createRun(f.i, brief(), "one"),
      f.store.createRun(f.i, brief(), "two"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(
      () =>
        f.store.changeSettings(f.i, {
          scope: "tenant",
          org_id: f.i.orgId,
          expected_version: 1,
          reason: "Stale edit",
        }),
      /version/,
    );
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: f.i.orgId,
      expected_version: 2,
      policy: { daily_runs: 2 },
      reason: "Increase allowance",
    });
    await f.store.createRun(f.i, brief(), "three");
    assert.equal(
      (await f.pool.query("SELECT count(*)::int AS n FROM lg_audit WHERE action LIKE 'settings.%'"))
        .rows[0].n,
      3,
    );
  } finally {
    await f.close();
  }
});

test("worker lease expiry fences old workers and recovers work", async () => {
  const f = await fixture();
  try {
    const old = await f.store.claim(120);
    assert.ok(old);
    await f.pool.query("UPDATE lg_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [
      old.id,
    ]);
    const recovered = await f.store.claim(120);
    assert.ok(recovered);
    assert.equal(recovered.id, old.id);
    assert.notEqual(recovered.lease_token, old.lease_token);
    await assert.rejects(() => f.store.finishProfile(old, { summary: "stale" }), /lease lost/);
    await f.store.finishProfile(recovered, { summary: "recovered" });
    assert.equal((await f.store.profile(f.i)).researched.summary, "recovered");
  } finally {
    await f.close();
  }
});

test("live quota reductions stop later provider actions and preserve run snapshots", async () => {
  const f = await fixture();
  try {
    const created = await f.store.createRun(f.i, brief(), "run");
    const task = await f.store.claim(120);
    assert.ok(task);
    const event = await f.store.reserve(task, "model", 10);
    await f.store.settle(event, 5);
    await f.store.settle(event, 5);
    assert.equal(
      Number(
        (await f.pool.query("SELECT tokens FROM lg_usage_daily WHERE org_id=$1", [f.i.orgId]))
          .rows[0].tokens,
      ),
      5,
    );
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: f.i.orgId,
      expected_version: 1,
      policy: { daily_units: 1 },
      reason: "Reduce safety allowance",
    });
    await assert.rejects(() => f.store.reserve(task, "web", 0), /budget reached/);
    assert.equal(
      (await f.store.run(f.i, created.run.id)).policy_snapshot.daily_units,
      DEFAULT_POLICY.daily_units,
    );
  } finally {
    await f.close();
  }
});

test("cancellation prevents stale acceptance; deadline stops scheduling", async () => {
  const f = await fixture();
  try {
    await drain(f);
    const r = await f.store.createRun(f.i, brief(), "cancel");
    const task = await f.store.claim(120);
    assert.ok(task);
    await f.store.cancel(f.i, r.run.id);
    await assert.rejects(
      () => f.store.discovered(task, [{ url: "https://example.com/", category: "clinics" }]),
      /lease lost/,
    );
    const other = await f.store.createRun(f.i, brief(), "deadline");
    await f.pool.query("UPDATE lg_runs SET deadline_at=now()-interval '1 second' WHERE id=$1", [
      other.run.id,
    ]);
    assert.equal(await f.store.claim(120), null);
    assert.equal((await f.store.run(f.i, other.run.id)).stop_reason, "deadline_reached");
  } finally {
    await f.close();
  }
});

test("campaign outage retains qualified leads and failed delivery can be replayed", async () => {
  const f = await fixture();
  try {
    const r = await f.store.createRun(f.i, { ...brief(), campaign_id: randomUUID() }, "outage");
    const provider = new DemoProvider();
    provider.deliver = async () => {
      throw new ResearchError("CAMPAIGN_UNAVAILABLE", false);
    };
    await drain(f, provider);
    const deliveries = await f.store.deliveries(f.i, r.run.id);
    assert.equal(deliveries.length, 3);
    assert.ok(deliveries.every((d) => d.state === "failed"));
    assert.equal((await f.store.list(f.i, "leads", null, 100)).length, 3);
    await f.store.retryFailed(f.i, deliveries[0].id);
    await drain(f);
    assert.equal(
      (await f.store.deliveries(f.i, r.run.id)).filter((d) => d.state === "done").length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("HTTP verifies JWT, ignores spoofed auth context, authorizes roles and scopes records", async () => {
  const f = await fixture();
  const other = identity();
  const ws = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ workspace: { id: req.url?.split("/").at(-1), orgId: f.i.orgId } }));
  });
  await new Promise<void>((resolve) => ws.listen(0, "127.0.0.1", resolve));
  const wsPort = (ws.address() as { port: number }).port;
  const secret = "test-secret-at-least-32-characters-long";
  const config = {
    jwt: secret,
    admin: "test-admin-at-least-32-characters-long",
    workspaceUrl: `http://127.0.0.1:${wsPort}`,
    live: false,
  } as Config;
  let role: "owner" | "analyst" = "owner";
  const app = createServer(config, f.store, { resolveRole: async () => role }, logger);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const token = await signAccessToken(
    { sub: f.i.actorId, org_id: f.i.orgId, sid: randomUUID() },
    { secret, ttlSeconds: 300 },
  );
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const base = `${root}/v1/workspaces/${f.i.workspaceId}/lead-generation`;
  try {
    assert.equal(
      (
        await fetch(`${base}/profile`, {
          headers: { "x-quickstart-auth-context": JSON.stringify({ actorId: f.i.actorId }) },
        })
      ).status,
      401,
    );
    assert.equal((await fetch(`${base}/profile`, { headers })).status, 200);
    role = "analyst";
    assert.equal(
      (
        await fetch(`${base}/runs`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": "api" },
          body: JSON.stringify(brief()),
        })
      ).status,
      403,
    );
    role = "owner";
    const run = await f.store.createRun(f.i, brief(), "scope");
    const csv = await fetch(`${base}/leads/export/csv?run_id=${run.run.id}`, {method: "POST", headers});
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csv.text(), /Company Name/);
    await assert.rejects(() => f.store.run(other, run.run.id), /not found/);
    const cross = await fetch(
      `${root}/v1/workspaces/${other.workspaceId}/lead-generation/runs/${run.run.id}`,
      { headers },
    );
    assert.equal(cross.status, 404);
    assert.equal(
      (await fetch(`${root}/internal/lead-generation/settings`, { headers })).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${root}/internal/lead-generation/settings`, {
          headers: { authorization: `Bearer ${config.admin}` },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(`${base}/runs`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": "api" },
          body: JSON.stringify(brief()),
        })
      ).status,
      202,
    );
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: f.i.orgId,
      expected_version: 1,
      policy: { enabled: false },
      reason: "Emergency disable",
    });
    assert.equal((await fetch(`${base}/profile`, { headers })).status, 200);
    assert.equal(
      (
        await fetch(`${base}/runs`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": "disabled" },
          body: JSON.stringify(brief()),
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/runs/${run.run.id}/cancel`, { method: "POST", headers })).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await new Promise<void>((r) => ws.close(() => r()));
    await f.close();
  }
});

test("evidence rejects hallucinated contacts and unsupported targeting", () => {
  const page = { url: "https://example.com/", text: "Example Clinic is a clinic in Lahore." };
  const raw = {
    company_name: "Example Clinic",
    category: "clinic",
    location: "Lahore",
    email: "invented@example.com",
    fit_score: 99,
    fit_reasons: ["match"],
    target_checks: { category_match: true, location_match: true },
    evidence: ["company_name", "category", "location"].map((field) => ({
      field,
      value:
        field === "company_name" ? "Example Clinic" : field === "category" ? "clinic" : "Lahore",
      source_url: page.url,
      quote: page.text,
    })),
  };
  const result = qualify(
    raw,
    [page],
    { ...brief(), required_contact: "email" },
    page.url,
    "clinics",
    70,
  );
  assert.equal(result.accepted, false);
  assert.equal(result.data.email, null);
  assert.equal(
    qualify(raw, [page], { ...brief(), company_size: "large" }, page.url, "clinics", 70).accepted,
    false,
  );
  assert.throws(() => policyInput({ max_active_tasks: 1000 }), /safety/);
});

test("a neighborhood inside the target city counts as the same location", () => {
  assert.equal(locationsCompatible("Lahore, Pakistan", "Gulberg, Lahore, Pakistan"), true);
  assert.equal(locationsCompatible("Lahore, Pakistan", "Lahore"), true);
  assert.equal(locationsCompatible("Lahore, Pakistan", "Karachi, Pakistan"), false);
  assert.equal(locationsCompatible("Lahore, Pakistan", "Lahore, India"), false);

  const page = {
    url: "https://example.com/",
    text: "Example Clinic is a clinic in Gulberg, Lahore, Pakistan.",
  };
  const raw = {
    company_name: "Example Clinic",
    category: "clinic",
    location: "Gulberg, Lahore, Pakistan",
    fit_score: 82,
    fit_reasons: ["clinic in Gulberg"],
    target_checks: { category_match: true, location_match: false },
    evidence: ["company_name", "category", "location"].map((field) => ({
      field,
      value:
        field === "company_name"
          ? "Example Clinic"
          : field === "category"
            ? "clinic"
            : "Gulberg, Lahore, Pakistan",
      source_url: page.url,
      quote: page.text,
    })),
  };
  const result = qualify(
    raw,
    [page],
    { ...brief(), location: "Lahore, Pakistan" },
    page.url,
    "clinics",
    70,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.data.location, "Gulberg, Lahore, Pakistan");

  const otherCity = qualify(
    {
      ...raw, location: "Karachi, Pakistan", target_checks: { category_match: true, location_match: true },
      evidence: raw.evidence.map((item) => ({
        ...item,
        value: item.field === "location" ? "Karachi, Pakistan" : item.value,
        quote: "Example Clinic is a clinic in Karachi, Pakistan.",
      })),
    },
    [{ url: page.url, text: "Example Clinic is a clinic in Karachi, Pakistan." }],
    { ...brief(), location: "Lahore, Pakistan" },
    page.url,
    "clinics",
    70,
  );
  assert.equal(otherCity.accepted, false);
  assert.ok(otherCity.data.reject_reasons?.includes("Location was not supported by the page"));
});

test("web guard rejects private, mapped, metadata and credential URLs", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
  for (const u of [
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://localhost/",
    "http://user:pass@example.com/",
    "file:///etc/passwd",
  ])
    await assert.rejects(() => assertPublicUrl(u));
});

test("live gateway rejects simulated search results rather than accepting fake leads", async () => {
  const f = await fixture();
  const fake = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ provider: "fake", results: [{ url: "https://example.com/" }] }));
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  try {
    const t = await f.store.claim(120);
    assert.ok(t);
    const provider = new GatewayResearchProvider(
      {
        webUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`,
        webToken: "test",
        requestTimeoutMs: 1000,
      } as Config,
      f.store,
    );
    await assert.rejects(() => provider.search(t, "clinic"), /SIMULATED_PROVIDER_REJECTED/);
  } finally {
    await new Promise<void>((r) => fake.close(() => r()));
    await f.close();
  }
});

test("live workers cannot consume demo tasks or use demo business profiles", async () => {
  const f = await fixture();
  try {
    const live = new Store(f.pool, "live");
    assert.equal(await live.claim(120), null);
    assert.equal(await live.profile(f.i), null);
    const direct = await live.createRun(f.i, brief(), "live");
    assert.equal(direct.run.profile_id, null);
    assert.equal(direct.run.profile_snapshot.supplied.name, "", "Direct live search must not inherit the demo profile");
    await live.putProfile(f.i, business, 0);
    const task = await live.claim(120);
    assert.ok(task);
    const row = (await f.pool.query("SELECT execution_mode FROM lg_tasks WHERE id=$1", [task.id]))
      .rows[0];
    assert.equal(row.execution_mode, "live");
  } finally {
    await f.close();
  }
});

test("weighted tiers share scheduling and a global cap reduction blocks new claims", async () => {
  const f = await fixture();
  try {
    await drain(f);
    const other = identity();
    await f.store.putProfile(other, business, 0);
    await drain(f);
    await f.store.changeSettings(f.i, {
      scope: "tier",
      name: "premium",
      expected_version: 0,
      policy: { scheduling_weight: 3 },
      reason: "Weighted scheduling test",
    });
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: other.orgId,
      tier_name: "premium",
      expected_version: 1,
      reason: "Premium tenant",
    });
    await f.pool.query("UPDATE lg_tenants SET virtual_finish=0");
    for (let n = 0; n < 5; n++) {
      await f.store.createRun(
        f.i,
        { ...brief(), categories: ["clinics", "salons", "shops"] },
        `a-${n}`,
      );
      await f.store.createRun(
        other,
        { ...brief(), categories: ["clinics", "salons", "shops"] },
        `b-${n}`,
      );
    }
    let basic = 0,
      premium = 0;
    for (let n = 0; n < 12; n++) {
      const t = await f.store.claim(120);
      assert.ok(t);
      if (t.org_id === f.i.orgId) basic++;
      else premium++;
      await f.store.discovered(t, []);
    }
    assert.ok(basic >= 2 && basic <= 4);
    assert.ok(premium >= 8 && premium <= 10);
    await f.store.changeSettings(f.i, {
      scope: "global",
      expected_version: 1,
      global_active_limit: 1,
      reason: "Reduce shared capacity",
    });
    assert.ok(await f.store.claim(120));
    assert.equal(await f.store.claim(120), null);
  } finally {
    await f.close();
  }
});

test("business profile updates cannot change the saved context of an existing run", async () => {
  const f = await fixture();
  try {
    const run = await f.store.createRun(f.i, brief(), "snapshot");
    await f.store.putProfile(
      f.i,
      { ...business, description: "A completely different offering" },
      1,
    );
    const saved = await f.store.run(f.i, run.run.id);
    assert.equal(saved.profile_snapshot.supplied.description, business.description);
    assert.equal(
      (await f.store.profile(f.i)).supplied.description,
      "A completely different offering",
    );
  } finally {
    await f.close();
  }
});

test("an empty early search still tries later query variants", async () => {
  const f = await fixture();
  class EmptyFirstSearch extends DemoProvider {
    calls = 0;
    override async search(t: Parameters<DemoProvider["search"]>[0], query: string) {
      return this.calls++ === 0 ? [] : super.search(t, query);
    }
  }
  try {
    const created = await f.store.createRun(f.i, brief(), "empty-first");
    const provider = new EmptyFirstSearch();
    await drain(f, provider);
    const run = await f.store.run(f.i, created.run.id);
    assert.equal(provider.calls, 6);
    assert.equal(run.rounds, 3);
    assert.equal(run.accepted, 3);
  } finally {
    await f.close();
  }
});

test("own business, its subdomains and excluded redirect destinations never become leads", async () => {
  const f = await fixture();
  class RedirectToExcludedBusiness extends DemoProvider {
    override async search() {
      return ["https://example.com/", "https://shop.example.com/", "https://alias.example/"];
    }
    override async scrape(t: Parameters<DemoProvider["scrape"]>[0], url: string) {
      return super.scrape(t, url.replace("alias.example", "excluded.example"));
    }
  }
  try {
    const created = await f.store.createRun(
      f.i,
      { ...brief(), excluded_domains: ["excluded.example"] },
      "exclude",
    );
    await drain(f, new RedirectToExcludedBusiness());
    assert.equal((await f.store.run(f.i, created.run.id)).accepted, 0);
    const results = await f.store.results(f.i, created.run.id, null, 100);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[0].assessment.website, "https://excluded.example/");
    assert.equal((await f.store.list(f.i, "leads", null, 100)).length, 0);
  } finally {
    await f.close();
  }
});

test("redirected duplicate leads cannot prematurely satisfy the target", async () => {
  const f = await fixture();
  try {
    await drain(f);
    await f.store.changeSettings(f.i, {
      scope: "tenant",
      org_id: f.i.orgId,
      expected_version: 1,
      policy: { max_rounds: 1 },
      reason: "Single search for duplicate regression",
    });
    const created = await f.store.createRun(f.i, { ...brief(), target_count: 2 }, "duplicates");
    const search = await f.store.claim(120);
    assert.ok(search);
    await f.store.discovered(
      search,
      [1, 2, 3].map((n) => ({ url: `https://alias-${n}.example/`, category: "clinics" })),
    );
    const provider = new DemoProvider();
    const page = await provider.scrape(search, "https://canonical.example/");
    const raw = await provider.json(search, "qualify", { pages: [page] });
    const data = qualify(raw, [page], brief(), page.url, "clinics", 70).data;
    const first = await f.store.claim(120);
    assert.ok(first);
    await f.store.assessed(first, data, true);
    const second = await f.store.claim(120);
    assert.ok(second);
    await f.store.assessed(second, data, true);
    const pending = await f.store.run(f.i, created.run.id);
    assert.equal(pending.accepted, 1);
    assert.equal(pending.status, "running");
    const third = await f.store.claim(120);
    assert.ok(third);
    await f.store.assessed(third, { ...data, website: "https://other.example/" }, true);
    const run = await f.store.run(f.i, created.run.id);
    assert.equal(run.accepted, 2);
    assert.equal(run.stop_reason, "target_reached");
    assert.equal(
      (await f.store.results(f.i, run.id, null, 100)).filter((r) => r.status === "duplicate")
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});

test("an expired worker cannot report failure before a replacement worker claims its task", async () => {
  const f = await fixture();
  try {
    const task = await f.store.claim(120);
    assert.ok(task);
    await f.pool.query("UPDATE lg_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [
      task.id,
    ]);
    await f.store.failed(task, "STALE_FAILURE", false);
    const row = (await f.pool.query("SELECT state,error_code FROM lg_tasks WHERE id=$1", [task.id]))
      .rows[0];
    assert.equal(row.state, "running");
    assert.equal(row.error_code, null);
    const replacement = await f.store.claim(120);
    assert.ok(replacement);
    assert.notEqual(replacement.lease_token, task.lease_token);
  } finally {
    await f.close();
  }
});

test("concurrent scheduler replicas obey global and organization caps", async () => {
  const f = await fixture();
  try {
    await f.store.changeSettings(f.i, {
      scope: "global",
      expected_version: 1,
      global_active_limit: 5,
      reason: "Concurrent scheduling regression",
    });
    await f.store.createRun(f.i, brief(), "first");
    for (let n = 0; n < 3; n++) {
      const tenant = identity();
      await f.store.putProfile(tenant, business, 0);
      await f.store.createRun(tenant, brief(), `tenant-${n}`);
    }
    const replicas = [f.store, new Store(f.pool, "demo"), new Store(f.pool, "demo")];
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, n) => replicas[n % replicas.length].claim(120)),
    );
    assert.equal(claims.filter(Boolean).length, 5);
    const counts = (
      await f.pool.query(
        "SELECT org_id,count(*)::int AS n FROM lg_tasks WHERE state='running' GROUP BY org_id",
      )
    ).rows;
    assert.ok(counts.every((r) => r.n <= 2));
  } finally {
    await f.close();
  }
});

test("provider response streams are bounded and interrupted bodies are retryable", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(101));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => responseText(new Response(stream), 100),
    (e: unknown) =>
      e instanceof ResearchError && e.code === "PROVIDER_RESPONSE_TOO_LARGE" && !e.retryable,
  );
  assert.equal(cancelled, true);
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("connection lost"));
    },
  });
  await assert.rejects(
    () => responseText(new Response(broken)),
    (e: unknown) => e instanceof ResearchError && e.retryable,
  );
  assert.equal(await responseText(new Response('{"ok":true}')), '{"ok":true}');
  assert.equal(retryAfterSeconds("120"), 120);
  assert.equal(retryAfterSeconds("9000"), 3600);
  assert.equal(retryAfterSeconds("invalid"), 0);
  assert.equal(retryAfterSeconds(new Date(Date.now() - 10_000).toUTCString()), 0);
  assert.ok(retryAfterSeconds(new Date(Date.now() + 60_000).toUTCString()) >= 59);
});

test("gateway preserves permanent scrape failures and rejects simulated live campaign receipts", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/internal/search") {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { details: { retryable: false, upstream_status: 404 } } }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = JSON.parse(body);
      res.end(
        JSON.stringify({
          workspace_id: payload.workspace_id,
          idempotency_key: payload.idempotency_key,
          campaign_lead_id: "fake-receipt",
          simulated: true,
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const provider = new GatewayResearchProvider(
    {
      webUrl: url,
      webToken: "test",
      campaignUrl: url,
      campaignToken: "test",
      requestTimeoutMs: 3000,
    } as Config,
    { reserve: async () => "event" } as unknown as Store,
  );
  const task = {
    workspace_id: randomUUID(),
    request_id: randomUUID(),
    id: randomUUID(),
    attempts: 1,
  } as Parameters<DemoProvider["search"]>[0];
  try {
    await assert.rejects(
      () => provider.search(task, "clinics"),
      (e: unknown) =>
        e instanceof ResearchError && e.code === "PROVIDER_UPSTREAM_404" && !e.retryable,
    );
    await assert.rejects(
      () =>
        provider.deliver(task, {
          workspace_id: task.workspace_id,
          idempotency_key: "one",
        } as Parameters<DemoProvider["deliver"]>[1]),
      /CAMPAIGN_INVALID_ACK/,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("daily model quota stops a run promptly instead of burning retries until its deadline", async () => {
  const f = await fixture();
  const upstream = http.createServer((_req, res) => {
    res.writeHead(429, {"content-type":"application/json"});
    res.end(JSON.stringify({error:{message:"Rate limit reached on tokens per day (TPD): Limit 200000, Used 199000"}}));
  });
  await new Promise<void>(resolve => upstream.listen(0,"127.0.0.1",resolve));
  try {
    await drain(f);
    const {run}=await f.store.createRun(f.i,brief(),"daily-quota");
    const task=(await f.store.claim(120))!;
    const provider=new GatewayResearchProvider({modelUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,modelToken:"test",requestTimeoutMs:1000,maxOutputTokens:100,modelMinIntervalSeconds:0} as Config,f.store);
    let failure: ResearchError | undefined;
    try { await provider.json(task,"Return JSON",{}); } catch(error) { if(error instanceof ResearchError) failure=error; else throw error; }
    assert.equal(failure?.code,"MODEL_QUOTA_EXHAUSTED");
    assert.equal(failure?.retryable,false);
    await f.store.failed(task,failure!.code,failure!.retryable);
    const stopped=await f.store.run(f.i,run.id);
    assert.equal(stopped.status,"completed_with_errors");
    assert.equal(stopped.stop_reason,"provider_quota_exhausted");
    assert.equal(Number((await f.pool.query("SELECT count(*) AS count FROM lg_tasks WHERE run_id=$1 AND state IN ('running','queued')",[run.id])).rows[0].count),0);
  } finally {
    await new Promise<void>(resolve=>upstream.close(()=>resolve()));
    await f.close();
  }
});

test("truncated model output is not repaired into an accepted partial qualification", async () => {
  const f=await fixture();
  const upstream=http.createServer((_req,res)=>{
    res.setHeader("content-type","application/json");
    res.end(JSON.stringify({provider:"gemini",content:'{"company_name":"Partial"}',finish_reason:"length",usage:{input_tokens:20,output_tokens:10}}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  try {
    const task=(await f.store.claim(120))!;
    const provider=new GatewayResearchProvider({modelUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,modelToken:"test",modelProfile:"gemini",modelId:"test",requestTimeoutMs:1000,maxOutputTokens:6000,modelMinIntervalSeconds:0} as Config,f.store);
    await assert.rejects(()=>provider.json(task,"Return JSON",{}),error=>error instanceof ResearchError && error.code==="MODEL_OUTPUT_TRUNCATED" && error.retryable===false);
  } finally { await new Promise<void>(resolve=>upstream.close(()=>resolve())); await f.close(); }
});

test("Gemini free-tier daily request quota is terminal rather than a minute cooldown", async () => {
  const f=await fixture();
  const upstream=http.createServer((_req,res)=>{
    res.writeHead(429,{"content-type":"application/json"});
    res.end(JSON.stringify({error:{message:'upstream 429: [{"error":{"message":"Generate content requests per day limit exceeded on Free Tier","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier","quotaValue":"20"}]}}]'}}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));
  try {
    const task=(await f.store.claim(120))!;
    const provider=new GatewayResearchProvider({modelUrl:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,modelToken:"test",modelProfile:"gemini",modelId:"test",requestTimeoutMs:1000,maxOutputTokens:6000,modelMinIntervalSeconds:0} as Config,f.store);
    await assert.rejects(()=>provider.json(task,"Return JSON",{}),error=>error instanceof ResearchError && error.code==="MODEL_QUOTA_EXHAUSTED" && error.retryable===false);
  } finally { await new Promise<void>(resolve=>upstream.close(()=>resolve())); await f.close(); }
});
