import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "./db.js";
import { escapeCsvField, runInput } from "../domain.js";
import type { Task } from "../store.js";

test("Phase 2 - CSV Export Formula Injection Defense", () => {
  // Test malicious spreadsheet payloads
  const maliciousFormulae = [
    "=cmd|'/C calc'!A0",
    "+SUM(1,2)",
    "-2+3*4",
    "@SUM(1,1)",
    "\tmalicious_tab",
    "\rmalicious_return",
  ];

  for (const formula of maliciousFormulae) {
    const escaped = escapeCsvField(formula);
    const unquoted = escaped.startsWith('"') ? escaped.slice(1, -1) : escaped;
    assert.ok(unquoted.startsWith("'"), `Dangerous formula "${formula}" MUST be prefixed with single-quote; got: "${escaped}"`);
  }

  // Safe strings should not be prefixed
  assert.equal(escapeCsvField("Acme Corp"), "Acme Corp");
  assert.equal(escapeCsvField("hello, world"), '"hello, world"');
  assert.equal(escapeCsvField(null), "");
  assert.equal(escapeCsvField(undefined), "");
});

test("Phase 2 - Entity Types, Refresh History, and Multi-Person Domain Separation", async () => {
  const { store, pool, close } = await database();
  const orgId = randomUUID();
  const workspaceId = randomUUID();
  const actorId = randomUUID();
  const identity = { orgId, workspaceId, actorId, requestId: randomUUID() };

  try {
    // 1. Create a business profile
    const profile = await store.putProfile(
      identity,
      {
        name: "Test B2B & B2C Search Corp",
        website: "https://testsearchcorp.com",
        description: "General purpose multi-entity search agency",
        offerings: ["Lead generation"],
        target_categories: ["Consumer", "SaaS"],
        locations: ["California, US"],
        target_audience: "SMB and direct consumers",
        value_proposition: "Verified lead pipelines",
      },
      0,
    );
    assert.ok(profile);
    assert.equal(profile.name, "Test B2B & B2C Search Corp");

    // 2. Create Run for multi-entity
    const runBrief = runInput({
      entity_type: "consumer",
      categories: ["Consumer"],
      required_contact: "email",
      target_count: 10,
      qualification_mode: "strict",
      excluded_domains: [],
    });

    const runRes = await store.createRun(identity, runBrief, `run-idemp-${randomUUID()}`);
    const run = runRes.run;
    assert.ok(run);

    async function createRunningTask(candidateId: string, category: string): Promise<Task> {
      await pool.query(
        "INSERT INTO lg_candidates(id, run_id, workspace_id, category, status) VALUES($1,$2,$3,$4,$5)",
        [candidateId, run.id, workspaceId, category, "pending"],
      );
      const taskId = randomUUID();
      const leaseToken = randomUUID();
      await pool.query(
        `INSERT INTO lg_tasks(id, org_id, workspace_id, run_id, kind, payload, lease_token, attempts, request_id, state, lease_until, execution_mode, dedup_key)
         VALUES($1,$2,$3,$4,'candidate',$5,$6,0,$7,'running', now() + interval '1 hour', 'demo', $8)`,
        [taskId, orgId, workspaceId, run.id, { candidate_id: candidateId }, leaseToken, randomUUID(), `candidate:${candidateId}`],
      );
      return {
        id: taskId,
        org_id: orgId,
        workspace_id: workspaceId,
        run_id: run.id,
        kind: "candidate",
        payload: { candidate_id: candidateId },
        lease_token: leaseToken,
        attempts: 0,
        request_id: randomUUID(),
      };
    }

    // 3. Test Consumer Lead without website/domain
    const candidateId1 = randomUUID();
    const taskConsumer = await createRunningTask(candidateId1, "Consumer");

    const consumerLeadData = {
      entity_type: "consumer" as const,
      category: "Consumer",
      person_name: "John Consumer",
      email: "john.consumer@gmail.com",
      phone: "+13105550199",
      location: "Los Angeles, CA",
      fit_score: 88,
      summary: "Individual home buyer",
      evidence: [
        { field: "person_name", value: "John Consumer", quote: "John Consumer quote", source_url: "https://consumer-forum.example/thread/1" },
      ],
    };

    const res1 = await store.assessed(taskConsumer, consumerLeadData as any, true);
    assert.ok(res1.leadId, "Consumer lead without website should be successfully inserted");

    // Retrieve consumer lead with details
    const fetchedConsumer = await store.getLeadWithDetails(identity, res1.leadId!);
    assert.equal(fetchedConsumer.entity_type, "consumer");
    assert.equal(fetchedConsumer.domain, null);
    assert.equal(fetchedConsumer.contact_email, "john.consumer@gmail.com");
    assert.equal(fetchedConsumer.observations.length, 1);
    assert.equal(fetchedConsumer.observations[0].quote, "John Consumer quote");

    // 4. Test Two People at Same Domain Stay Separate
    const candidateIdAlice = randomUUID();
    const candidateIdBob = randomUUID();

    const taskAlice = await createRunningTask(candidateIdAlice, "SaaS");
    const taskBob = await createRunningTask(candidateIdBob, "SaaS");

    const aliceData = {
      entity_type: "professional" as const,
      category: "SaaS",
      company_name: "Acme Tech",
      website: "https://acme-tech.example",
      person_name: "Alice Founder",
      person_role: "Chief Executive Officer",
      email: "alice@acme-tech.example",
      fit_score: 92,
      summary: "CEO at Acme Tech",
    };

    const bobData = {
      entity_type: "professional" as const,
      category: "SaaS",
      company_name: "Acme Tech",
      website: "https://acme-tech.example",
      person_name: "Bob Engineer",
      person_role: "VP Engineering",
      email: "bob@acme-tech.example",
      fit_score: 85,
      summary: "VP Eng at Acme Tech",
    };

    const aliceRes = await store.assessed(taskAlice, aliceData as any, true);
    const bobRes = await store.assessed(taskBob, bobData as any, true);

    assert.ok(aliceRes.leadId);
    assert.ok(bobRes.leadId);
    assert.notEqual(aliceRes.leadId, bobRes.leadId, "Alice and Bob at the same domain MUST remain separate leads");

    // 5. Test Sales Status Update, User Edits, and Activity History
    const updatedLead = await store.updateLeadSalesStatus(
      identity,
      aliceRes.leadId!,
      "meeting",
      "Meeting scheduled for Tuesday with Alice",
      { custom_title: "Key Decision Maker", person_role: "User-authored role" },
    );
    assert.equal(updatedLead.sales_status, "meeting");
    assert.equal(updatedLead.notes, "Meeting scheduled for Tuesday with Alice");
    assert.equal(updatedLead.user_edits.custom_title, "Key Decision Maker");
    assert.equal(updatedLead.activity_history.length, 1);
    assert.equal(updatedLead.activity_history[0].details.new_status, "meeting");

    const notesOnly = await store.updateLeadSalesStatus(identity, aliceRes.leadId!, undefined,
      "Meeting scheduled for Tuesday with Alice");
    assert.equal(notesOnly.sales_status, "meeting", "Notes-only edits must not clear sales status");

    // 6. Test Lead Rediscovery & Refresh: user edits and sales status must be preserved!
    const candidateIdAliceRefresh = randomUUID();
    const taskAliceRefresh = await createRunningTask(candidateIdAliceRefresh, "SaaS");

    const refreshedScrapedData = {
      entity_type: "professional" as const,
      category: "SaaS",
      company_name: "Acme Tech Inc New Legal Name",
      website: "https://acme-tech.example",
      person_name: "Alice Founder",
      person_role: "CEO & Chairwoman",
      email: "alice@acme-tech.example",
      fit_score: 95,
      summary: "Updated refreshed summary from website",
    };

    await store.assessed(taskAliceRefresh, refreshedScrapedData as any, true);

    const recheckedAlice = await store.getLeadWithDetails(identity, aliceRes.leadId!);
    // Sales status and user notes must not be clobbered
    assert.equal(recheckedAlice.sales_status, "meeting", "Sales status MUST NOT be reset to new on refresh");
    assert.equal(recheckedAlice.notes, "Meeting scheduled for Tuesday with Alice", "User notes MUST NOT be wiped on refresh");
    assert.equal(recheckedAlice.user_edits.custom_title, "Key Decision Maker", "User edited fields MUST be preserved");
    assert.equal(recheckedAlice.data.person_role, "User-authored role");
    assert.equal(recheckedAlice.person_role, "User-authored role", "Canonical columns must preserve edits too");
    // Refresh history must contain recorded diff
    assert.ok(Array.isArray(recheckedAlice.refresh_history));
    assert.equal(recheckedAlice.refresh_history.length, 1);
    assert.equal(recheckedAlice.refresh_history[0].fit_score, 95);

    // 7. Test Schedules
    const schedule = await store.createSchedule(identity, {
      name: "Weekly California Consumer Search",
      brief: runBrief,
      timezone: "America/Los_Angeles",
      cron_expression: "0 9 * * 1",
      next_run_at: new Date(Date.now() - 1000).toISOString(), // due in past
      enabled: true,
      overlap_policy: "skip",
      last_occurrence_key: null,
      last_run_id: null,
    });
    assert.ok(schedule.id);
    assert.equal(schedule.name, "Weekly California Consumer Search");

    const dueList = await store.claimDueSchedules(5);
    assert.ok(dueList.length >= 1, "Due schedule should be claimed");
    assert.equal(dueList[0].id, schedule.id);

    // 8. Test CSV Export with Injection Safety
    const csvContent = await store.exportLeadsToCsv(identity);
    assert.ok(csvContent.includes("Alice Founder"));
    assert.ok(csvContent.includes("John Consumer"));
    assert.ok(csvContent.includes("john.consumer@gmail.com"));
    assert.ok(csvContent.includes("meeting"));
  } finally {
    await close();
  }
});
