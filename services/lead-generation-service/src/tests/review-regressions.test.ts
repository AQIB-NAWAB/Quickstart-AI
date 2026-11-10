import test from "node:test";
import assert from "node:assert/strict";
import { validateEmail, validatePhone } from "../contact-validation.js";
import { qualify } from "../research.js";
import { runInput } from "../domain.js";
import { HubSpotAdapter } from "../crm/hubspot.adapter.js";
import { SalesforceAdapter } from "../crm/salesforce.adapter.js";
import { deliverLeadToCrm } from "../crm/index.js";
import type { Store } from "../store.js";
import { computeNextRunAt } from "../scheduler.js";
import { database } from "./db.js";
import { randomUUID } from "node:crypto";
import { requestPublicWebhook } from "../crm/public-request.js";
import { Store as LeadStore } from "../store.js";

const noData = () => Promise.reject(Object.assign(new Error("no data"), { code: "ENODATA" }));

test("mail routing supports IPv6 fallback and preserves transient failures as unknown", async () => {
  const ipv6 = await validateEmail("Mixed.Case@example.com", {
    resolveMx: noData,
    resolve4: noData,
    resolve6: async () => ["2001:4860:4860::8888"],
  });
  assert.equal(ipv6.status, "domain_routable");
  assert.equal(ipv6.normalized, "Mixed.Case@example.com");
  const transient = await validateEmail("person@example.com", {
    resolveMx: noData,
    resolve4: noData,
    resolve6: async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
    },
  });
  assert.equal(transient.status, "domain_unknown");
  const nullMx = await validateEmail("person@example.com", {
    resolveMx: async () => [{ exchange: ".", priority: 0 }],
    resolve4: async () => {
      throw new Error("must not query fallback");
    },
    resolve6: async () => {
      throw new Error("must not query fallback");
    },
  });
  assert.equal(nullMx.mailRoutingStatus, "null_mx_rejected");
  assert.equal((await validateEmail("a..b@example.com")).formatValid, false);
});

test("phone heuristics cannot claim numbering-plan validation", () => {
  assert.equal(validatePhone("+999123456789").status, "numbering_plan_possible");
  assert.equal(validatePhone("+01234567890").formatValid, false);
  assert.equal(validatePhone("abc1234567890").formatValid, false);
});

test("custom webhooks reject private destinations before sending payloads", async () => {
  await assert.rejects(
    () =>
      requestPublicWebhook("https://127.0.0.1/private", { method: "POST", body: "customer data" }),
    /UNSAFE_URL/,
  );
  await assert.rejects(
    () => requestPublicWebhook("https://169.254.169.254/metadata", { method: "POST" }),
    /UNSAFE_URL/,
  );
});

test("schedule time honors timezone and rejects invalid cron instead of running daily", () => {
  const next = computeNextRunAt("0 9 * * *", new Date("2026-10-25T10:00:00Z"), "Asia/Karachi");
  assert.equal(next.toISOString(), "2026-10-26T04:00:00.000Z");
  const spring = computeNextRunAt(
    "0 9 * * *",
    new Date("2026-03-07T15:00:00Z"),
    "America/New_York",
  );
  assert.equal(spring.toISOString(), "2026-03-08T13:00:00.000Z");
  assert.throws(() => computeNextRunAt("60 25 * * *"), /outside range/);
  assert.throws(() => computeNextRunAt("not cron"), /five cron fields/);
  assert.throws(() => computeNextRunAt("@daily", new Date(), "not-a-timezone"));
});

test("schedule claim persists beyond transaction and stale dispatch cannot finalize a recovered lease", async () => {
  const db = await database();
  try {
    const identity = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    await db.pool.query("INSERT INTO lg_tenants(org_id) VALUES($1)", [identity.orgId]);
    const schedule = await db.store.createSchedule(identity, {
      name: "test",
      brief: runInput({ categories: ["Bakery"], target_count: 5 }),
      timezone: "UTC",
      cron_expression: "@daily",
      next_run_at: new Date(Date.now() - 60000).toISOString(),
      enabled: true,
      overlap_policy: "skip",
    });
    const [first, second] = await Promise.all([
      db.store.claimDueSchedules(),
      db.store.claimDueSchedules(),
    ]);
    assert.equal(first.length + second.length, 1);
    const claimed = [...first, ...second][0];
    await db.pool.query(
      "UPDATE lg_schedules SET dispatch_lease_until=now()-interval '1 second' WHERE id=$1",
      [schedule.id],
    );
    const recovered = (await db.store.claimDueSchedules())[0];
    assert.notEqual(claimed.dispatch_lease_token, recovered.dispatch_lease_token);
    assert.equal(
      new Date(claimed.next_run_at).toISOString(),
      new Date(recovered.next_run_at).toISOString(),
    );
    assert.equal(
      await db.store.recordScheduleOccurrence(
        schedule.id,
        "old",
        new Date(),
        null,
        claimed.dispatch_lease_token,
      ),
      undefined,
    );
    assert.ok(
      await db.store.recordScheduleOccurrence(
        schedule.id,
        "current",
        new Date(Date.now() + 60000),
        null,
        recovered.dispatch_lease_token,
      ),
    );
  } finally {
    await db.close();
  }
});

test("unsupported live source policies fail before creating company-web research jobs", async () => {
  const db = await database();
  try {
    const identity = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    const live = new LeadStore(db.pool, "live");
    await assert.rejects(
      () =>
        live.createRun(
          identity,
          runInput({
            categories: ["Creators"],
            entity_type: "consumer",
            target_count: 5,
          }),
          "consumer-run",
        ),
      /SOURCE_CAPABILITY_UNAVAILABLE/,
    );
    await assert.rejects(
      () =>
        live.createRun(
          identity,
          runInput({
            categories: ["Agency"],
            source_policy: { preferred_sources: ["instagram"], allow_fallback: false },
            target_count: 5,
          }),
          "instagram-run",
        ),
      /SOURCE_CAPABILITY_UNAVAILABLE/,
    );
    assert.equal(Number((await db.pool.query("SELECT count(*) AS n FROM lg_tasks")).rows[0].n), 0);
  } finally {
    await db.close();
  }
});

test("direct search can run without a fabricated business profile", async () => {
  const db = await database();
  try {
    const identity = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    const { run } = await db.store.createRun(
      identity,
      runInput({ categories: ["Bakery"], target_count: 5 }),
      "direct-search",
    );
    assert.equal(run.profile_id, null);
    assert.equal(run.profile_snapshot.supplied.name, "");
    assert.equal(run.profile_snapshot.supplied.website, undefined);
    assert.equal((await db.store.claim(120))?.kind, "search");
    assert.equal(
      Number((await db.pool.query("SELECT count(*) AS n FROM lg_profiles")).rows[0].n),
      0,
    );
  } finally {
    await db.close();
  }
});

const page = {
  url: "https://bakery.example/",
  text: "Acme Bakery in Austin. Email Owner@bakery.example. Employees: 12.",
};
const candidate = {
  company_name: "Acme Bakery",
  category: "Bakery",
  location: "Austin",
  fit_score: 90,
  fit_reasons: ["Bakery in Austin"],
  target_checks: { category_match: true, location_match: true },
  evidence: [
    { field: "company_name", value: "Acme Bakery", quote: "Acme Bakery", source_url: page.url },
    { field: "category", value: "Bakery", quote: "Bakery", source_url: page.url },
    { field: "employees", value: "12", quote: "Employees: 12.", source_url: page.url },
  ],
};

test("best match enforces contact and custom mandatory conditions with truthful verification flags", () => {
  const brief = runInput({
    categories: ["Bakery"],
    required_contact: "both",
    qualification_mode: "best_match",
    target_count: 5,
  });
  const missingPhone = qualify(candidate, [page], brief, page.url, "Bakery", 70);
  assert.equal(missingPhone.accepted, false);
  assert.equal(missingPhone.data.dimensions?.contact_readiness.email_verified, false);
  assert.equal(missingPhone.data.dimensions?.contact_readiness.status, "unverified");
  const custom = {
    ...brief,
    required_contact: "email" as const,
    criteria: [
      {
        id: "staff",
        field: "employees",
        operator: "greater_than" as const,
        value: "20",
        mandatory: true,
      },
    ],
  };
  const mismatch = qualify(candidate, [page], custom, page.url, "Bakery", 70);
  assert.equal(mismatch.accepted, false);
  assert.equal(
    mismatch.data.criterion_evaluations?.find((c) => c.criterion === "staff")?.status,
    "unmet",
  );
  const unsupported = qualify(
    candidate,
    [page],
    {
      ...custom,
      criteria: [{ ...custom.criteria[0], field: "buying_intent" }],
    },
    page.url,
    "Bakery",
    70,
  );
  assert.equal(unsupported.accepted, false);
  assert.equal(
    unsupported.data.criterion_evaluations?.find((c) => c.criterion === "staff")?.status,
    "unknown",
  );
  const supported = qualify(
    candidate,
    [page],
    {
      ...custom,
      criteria: [{ ...custom.criteria[0], value: "10" }],
    },
    page.url,
    "Bakery",
    70,
  );
  assert.equal(supported.accepted, true);
});

test("CRM read/search failures do not fall through to destructive writes or duplicate creates", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const requests: string[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init?.method ?? "GET");
    return new Response("unavailable", { status: 503 });
  };
  const hubspot = new HubSpotAdapter();
  await assert.rejects(
    () => hubspot.pushLead({ email: "a@example.com" }, { token: "test-token-long-enough" }),
    /search failed/,
  );
  assert.equal(requests.length, 1);
  const salesforce = new SalesforceAdapter();
  await assert.rejects(
    () =>
      salesforce.pushLead(
        {
          email: "a@example.com",
          person_name: "Person Example",
          data: { company_name: "Example" },
        },
        {
          instanceUrl: "https://tenant.my.salesforce.com",
          token: "test-token-long-enough",
        },
      ),
    /search failed/,
  );
  assert.equal(requests.length, 2);
  await assert.rejects(
    () =>
      salesforce.pushLead(
        {},
        {
          instanceUrl: "http://127.0.0.1",
          token: "test-token-long-enough",
        },
      ),
    /HTTPS Salesforce instance/,
  );
  assert.equal(requests.length, 2);
});

test("CRM mapping lookup uses lead id before provider", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  const existingId = "remote-contact";
  globalThis.fetch = async () => new Response(JSON.stringify({ properties: {} }), { status: 200 });
  const store = {
    async getCrmMapping(_identity: unknown, leadId: string, provider: string) {
      assert.equal(leadId, "lead-123");
      assert.equal(provider, "hubspot");
      return { external_object_id: existingId };
    },
    async recordCrmMapping() {},
  } as unknown as Store;
  const result = await deliverLeadToCrm(
    store,
    {
      orgId: "org",
      workspaceId: "workspace",
      actorId: "actor",
      requestId: "request",
    },
    { id: "lead-123", email: "a@example.com" },
    "hubspot",
    { token: "test-token-long-enough" },
  );
  assert.equal(result.remote_record_id, existingId);
  assert.equal(result.operation, "updated");
});

test("CRM refresh updates previously synced fields while preserving later user edits", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let written: Record<string, string> = {};
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "PATCH") {
      written = JSON.parse(String(init.body)).properties;
      return new Response(JSON.stringify({ id: "remote" }));
    }
    return new Response(
      JSON.stringify({ properties: { phone: "old-phone", firstname: "Rep edit" } }),
    );
  };
  const adapter = new HubSpotAdapter();
  await adapter.pushLead(
    { person_name: "Alice Person", phone: "new-phone" },
    { token: "test-token-long-enough" },
    {
      id: "mapping",
      workspace_id: "workspace",
      provider: "hubspot",
      lead_id: "lead",
      external_object_id: "remote",
      external_object_type: "Contact",
      last_synced_at: new Date().toISOString(),
      status: "synced",
      last_synced_payload: { fields: { phone: "old-phone", firstname: "Alice" } },
    },
  );
  assert.equal(written.phone, "new-phone");
  assert.equal(written.firstname, undefined);
});
