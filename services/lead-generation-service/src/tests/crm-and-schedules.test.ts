import test from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { HubSpotAdapter } from "../crm/hubspot.adapter.js";
import { SalesforceAdapter } from "../crm/salesforce.adapter.js";
import { CustomWebhookAdapter } from "../crm/custom-webhook.adapter.js";
import { computeNextRunAt, runDueSchedules } from "../scheduler.js";
import { database } from "./db.js";

test("Phase 5 - HubSpot Adapter: Deduplication and Conflict Preservation", async (t) => {
  const adapter = new HubSpotAdapter();

  // Mock global fetch for HubSpot API
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let patchCalled = false;
  let patchBody: any = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();

    // 1. Search endpoint: find existing contact with remote rep edits
    if (urlStr.includes("/crm/v3/objects/contacts/search")) {
      return new Response(
        JSON.stringify({
          total: 1,
          results: [
            {
              id: "hubspot-contact-123",
              properties: {
                email: "founder@acme.org",
                firstname: "Alice (Rep Customized)",
                company: "Acme Holdings LLC",
                hs_lead_status: "IN_PROGRESS",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Patch endpoint: update contact
    if (urlStr.includes("/crm/v3/objects/contacts/hubspot-contact-123") && init?.method === "PATCH") {
      patchCalled = true;
      patchBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          id: "hubspot-contact-123",
          properties: patchBody.properties,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ id: "hubspot-contact-999" }), { status: 200 });
  }) as any;

  const lead = {
    id: "lead-abc",
    person_name: "Alice Founder",
    contact_email: "founder@acme.org",
    data: {
      company_name: "Acme Inc",
      email: "founder@acme.org",
      phone: "+1-555-0199",
      website: "acme.org",
    },
  };

  const result = await adapter.pushLead(
    lead,
    { accessToken: "pat-na1-valid-hubspot-token-test-12345" },
    null,
    { preserveConflicts: true },
  );

  assert.equal(result.operation, "updated");
  assert.equal(result.remote_record_id, "hubspot-contact-123");
  assert.equal(result.conflict_detected, true);
  // Remote edits on firstname and company should have been preserved
  assert.ok(result.preserved_fields?.includes("firstname"));
  assert.ok(result.preserved_fields?.includes("company"));
  assert.equal(patchCalled, true);
  // Only non-conflicting properties (phone, website) should be in the patch payload
  assert.equal(patchBody.properties.firstname, undefined, "Conflicting firstname should not be overwritten");
  assert.equal(patchBody.properties.phone, "+1-555-0199", "New phone should be updated");
});

test("Phase 5 - Salesforce Adapter: Conflict Preservation and Deduplication", async (t) => {
  const adapter = new SalesforceAdapter();
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let patchCalled = false;
  let patchBody: any = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();

    // Query endpoint
    if (urlStr.includes("/services/data/v58.0/query")) {
      return new Response(
        JSON.stringify({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: "00Q5g00000abc123",
              FirstName: "Robert",
              LastName: "Executive",
              Company: "Global Tech Inc (Enterprise Account)",
              Status: "Working - Contacted",
              Email: "robert@globaltech.com",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Patch endpoint
    if (urlStr.includes("/services/data/v58.0/sobjects/Lead/00Q5g00000abc123") && init?.method === "PATCH") {
      patchCalled = true;
      patchBody = JSON.parse(init.body as string);
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify({ id: "00Q5g00000def456", success: true }), { status: 201 });
  }) as any;

  const lead = {
    id: "lead-sf-1",
    person_name: "Robert Executive",
    contact_email: "robert@globaltech.com",
    data: {
      company_name: "Global Tech",
      email: "robert@globaltech.com",
      phone: "+1-415-555-0122",
      website: "globaltech.com",
    },
  };

  const result = await adapter.pushLead(
    lead,
    { instanceUrl: "https://mycorp.my.salesforce.com", accessToken: "valid-salesforce-bearer-token" },
    null,
    { preserveConflicts: true },
  );

  assert.equal(result.operation, "updated");
  assert.equal(result.remote_record_id, "00Q5g00000abc123");
  assert.equal(result.conflict_detected, true);
  assert.ok(result.preserved_fields?.includes("Company"));
  assert.equal(patchCalled, true);
  assert.equal(patchBody.Company, undefined, "Remote Company name edit must be preserved");
  assert.equal(patchBody.Phone, "+1-415-555-0122");
});

test("Phase 5 - Custom Webhook Adapter: HMAC-SHA256 Signature Verification", async (t) => {
  const adapter = new CustomWebhookAdapter((url, init) => fetch(url, init));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const secret = "whsec_super_secret_signing_key_456";
  let capturedHeaders: any = undefined;
  let capturedBody = "";

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = init?.headers;
    capturedBody = init?.body as string;
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }) as any;

  const lead = {
    id: "lead-webhook-99",
    entity_type: "professional",
    sales_status: "new",
    person_name: "Diana Prince",
    contact_email: "diana@themyscira.gov",
    domain: "themyscira.gov",
    data: {
      company_name: "Justice Foundation",
      fit_score: 92,
      summary: "Qualified director lead",
    },
  };

  const result = await adapter.pushLead(lead, {
    url: "https://hooks.clientcrm.com/inbound-leads",
    secret,
  });

  assert.equal(result.operation, "created");
  assert.equal(result.remote_record_id, "webhook:lead-webhook-99");

  const headers = capturedHeaders as Record<string, string>;
  const sigHeader = headers["X-Quickstart-Signature"];
  assert.ok(sigHeader, "X-Quickstart-Signature header must be present");
  assert.ok(sigHeader.startsWith("sha256="));

  const receivedSig = sigHeader.replace("sha256=", "");
  const expectedSig = crypto.createHmac("sha256", secret).update(capturedBody).digest("hex");
  assert.equal(receivedSig, expectedSig, "HMAC-SHA256 signature must match the payload and secret");

  const parsed = JSON.parse(capturedBody);
  assert.equal(parsed.event, "lead.qualified");
  assert.equal(parsed.lead.person_name, "Diana Prince");
  assert.equal(parsed.lead.fit_score, 92);
});

test("Phase 5 - Scheduler Engine: Next Run Calculation & Occurrence Idempotency", async () => {
  const baseTime = new Date("2026-10-25T10:00:00.000Z");

  // Hourly
  const hourlyNext = computeNextRunAt("@hourly", baseTime);
  assert.equal(hourlyNext.getUTCHours(), 11);
  assert.equal(hourlyNext.getUTCMinutes(), 0);

  // Daily
  const dailyNext = computeNextRunAt("@daily", baseTime);
  assert.equal(dailyNext.getUTCDate(), 26);
  assert.equal(dailyNext.getUTCHours(), 9);

  // 5-part cron: 0 14 * * * (daily at 14:00 UTC)
  const cron14Next = computeNextRunAt("0 14 * * *", baseTime);
  assert.equal(cron14Next.getUTCHours(), 14);
  assert.equal(cron14Next.getUTCMinutes(), 0);
});

test("Phase 5 - Database-Coordinated Schedule Execution", async (t) => {
  const { store, pool, close } = await database();
  t.after(async () => {
    await close();
  });

  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const identity = { orgId, workspaceId, actorId, requestId: crypto.randomUUID() };

  await pool.query("INSERT INTO lg_tenants(org_id) VALUES($1) ON CONFLICT DO NOTHING", [orgId]);

  // Create a business profile for this workspace so runs can be scheduled
  await store.putProfile(
    identity,
    {
      name: "Tech Leads Targeter",
      website: "https://techleads.example.com",
      description: "Automated search agent for tech leads",
      offerings: ["B2B prospecting"],
      target_categories: ["Software"],
      locations: ["United States"],
      target_audience: "B2B SaaS companies",
      value_proposition: "Enterprise outbound pipeline automation",
    },
    0,
  );

  // Insert a due schedule with next_run_at in the past
  const scheduleId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO lg_schedules(
      id, org_id, workspace_id, name, brief, cron_expression, next_run_at, enabled, execution_mode
    ) VALUES($1,$2,$3,$4,$5,$6,now() - interval '5 minutes',true,'demo')`,
    [
      scheduleId,
      orgId,
      workspaceId,
      "Daily Tech Leads",
      JSON.stringify({
        categories: ["Software"],
        target_count: 5,
        required_contact: "email",
        excluded_domains: [],
      }),
      "0 9 * * *",
    ],
  );

  // First run: claims and dispatches
  const report1 = await runDueSchedules(store, "test-scheduler");
  assert.ok(report1.claimed >= 1, "Should have claimed the due schedule");
  assert.ok(report1.dispatched >= 1, `Should have dispatched a new run, errors: ${JSON.stringify(report1.errors)}`);

  // Verify schedule's next_run_at has been advanced into the future
  const updatedSchedule = (
    await pool.query("SELECT * FROM lg_schedules WHERE id=$1", [scheduleId])
  ).rows[0];
  assert.ok(new Date(updatedSchedule.next_run_at).getTime() > Date.now(), "next_run_at must advance into the future");
  assert.ok(updatedSchedule.last_occurrence_key, "last_occurrence_key must be recorded");

  // Second run immediately afterwards: should claim 0 due schedules (atomic & idempotent)
  const report2 = await runDueSchedules(store, "test-scheduler");
  assert.equal(report2.claimed, 0, "No schedules should be due after advancement");
});
