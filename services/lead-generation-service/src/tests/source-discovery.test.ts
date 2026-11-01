import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BusinessDiscovery } from "../business-discovery.js";
import { ApifyActorOrchestrator } from "../apify-orchestrator.js";
import { database } from "./db.js";
import { runInput } from "../domain.js";
import { ResearchAgent, DemoProvider, ResearchError, type Page, type ResearchProvider } from "../research.js";
import type { Store, Run, Task } from "../store.js";

test("a disallowed web fallback is never used when the customer Maps connection is missing", async () => {
  class MissingConnection extends ApifyActorOrchestrator {
    override async resolveCustomerToken(): Promise<never> {
      throw new Error("missing");
    }
  }
  const run = {
    brief: runInput({ categories: ["Retailers"], source_policy: { disallowed_sources: ["web"] } }),
  } as Run;
  const task: Task = {
    id: "task", org_id: "org", workspace_id: "workspace", run_id: "run",
    kind: "search", payload: { round: 0 }, lease_token: "lease", attempts: 1, request_id: "request"
  };
  await assert.rejects(
    () => new BusinessDiscovery({} as Store, new MissingConnection()).discover(task, run),
    /APIFY_CONNECTION_REQUIRED/,
  );
});

test("Maps discovery resumes the stored actor instead of launching again after a worker retry", async () => {
  const db = await database();
  try {
    const i = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    const created = await db.store.createRun(
      i,
      runInput({ categories: ["Retailers"], location: "London, UK", target_count: 5 }),
      "maps-test",
    );
    let starts = 0;
    class Client extends ApifyActorOrchestrator {
      override async resolveCustomerToken(workspace: string) {
        assert.equal(workspace, i.workspaceId);
        return "customer";
      }
      override async startActorRun(_token: string, actor: string, input: Record<string, unknown>) {
        starts++;
        assert.equal(actor, "compass~crawler-google-places");
        assert.equal(input.locationQuery, "London, UK");
        assert.equal(input.maxCrawledPlacesPerSearch, 25);
        return { runId: "external-run", datasetId: "external-dataset", status: "READY" };
      }
      override async getActorRun(_token: string, id: string) {
        assert.equal(id, "external-run");
        return { status: "SUCCEEDED" };
      }
      override async fetchDatasetItemsPaged() {
        return {
          items: [
            {
              title: "Actual Retailer",
              website: "https://retailer.example/",
              url: "https://www.google.com/maps/place/example",
              address: "London, UK",
              phone: "+442079460000",
            },
          ],
          offset: 0,
          total: 1,
        };
      }
    }
    const first = (await db.store.claim(120))!;
    await assert.rejects(
      () => new BusinessDiscovery(db.store, new Client()).discover(first, created.run),
      (e) => e instanceof ResearchError && e.code === "SOURCE_PENDING",
    );
    await db.store.failed(first, "SOURCE_PENDING", true, 1);
    await db.pool.query("UPDATE lg_tasks SET available_at=now() WHERE id=$1", [first.id]);
    const retry = (await db.store.claim(120))!;
    assert.equal(retry.attempts, 1, "Polling must not burn provider retry allowance");
    const businesses = await new BusinessDiscovery(db.store, new Client()).discover(
      retry,
      created.run,
    );
    assert.equal(starts, 1);
    assert.equal(businesses?.[0].url, "https://retailer.example/");
    assert.ok(businesses?.[0].source_page?.text.includes("Actual Retailer"));
    await db.store.discovered(retry, businesses!);
    const source = (await db.store.run(i, created.run.id)) as typeof created.run & {
      source_runs: Array<{ actor_id: string; status: string }>;
    };
    assert.equal(source.source_runs[0].status, "succeeded");
    const payload = (
      await db.pool.query("SELECT payload FROM lg_tasks WHERE run_id=$1 AND kind='candidate'", [
        created.run.id,
      ])
    ).rows[0].payload;
    assert.ok(
      payload.source_page,
      "Normalized dataset evidence must be carried into the candidate task",
    );
  } finally {
    await db.close();
  }
});

test("uncertain actor creation is not replayed on recovery", async () => {
  const db = await database();
  try {
    const i = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    const created = await db.store.createRun(
      i,
      runInput({ categories: ["Retailers"], target_count: 5 }),
      "uncertain-test",
    );
    const task = (await db.store.claim(120))!;
    await db.store.beginSourceRun(task, "compass~crawler-google-places");
    let starts = 0;
    class Client extends ApifyActorOrchestrator {
      override async resolveCustomerToken() {
        return "customer";
      }
      override async startActorRun(): Promise<never> {
        starts++;
        throw new Error("must not launch");
      }
    }
    await assert.rejects(
      () => new BusinessDiscovery(db.store, new Client()).discover(task, created.run),
      /APIFY_START_UNCERTAIN/,
    );
    assert.equal(starts, 0);
  } finally {
    await db.close();
  }
});

test("optional failed contact pages do not turn a successfully scraped business into a research failure", async () => {
  const db = await database();
  try {
    const i = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      actorId: randomUUID(),
      requestId: randomUUID(),
    };
    const { run } = await db.store.createRun(
      i,
      runInput({ categories: ["clinics"], required_contact: "email", target_count: 5 }),
      "contact-error",
    );
    const search = (await db.store.claim(120))!;
    await db.store.discovered(search, [{ url: "https://clinic.example/", category: "clinics" }]);
    const candidate = (await db.store.claim(120))!;
    let contactAttempts = 0;
    class Provider extends DemoProvider {
      override async scrape(_t: typeof candidate, url: string): Promise<Page> {
        contactAttempts++;
        if (new URL(url).pathname !== "/") throw new ResearchError("PROVIDER_UPSTREAM_503", true);
        return {
          url,
          text: "Example Clinic provides clinic services in Lahore. Software. [Contact](/contact)",
        };
      }
    }
    await new ResearchAgent(db.store, new Provider()).execute(candidate);
    assert.ok(contactAttempts <= 5, "Failed optional pages must count against the scrape attempt limit");
    const results = await db.store.results(i, run.id, null, 50);
    const result = results.find((item) => item.id === candidate.payload.candidate_id);
    assert.equal(
      result?.status,
      "rejected",
      "Missing email rejects qualification but is not a failed research task",
    );
  } finally {
    await db.close();
  }
});

test("model cooldown preserves scraped pages and delays queued research before retry", async () => {
  const db = await database();
  try {
    const i = { orgId: randomUUID(), workspaceId: randomUUID(), actorId: randomUUID(), requestId: randomUUID() };
    const { run } = await db.store.createRun(i, runInput({ categories: ["clinics"], required_contact: "email", target_count: 5 }), "cooldown");
    const search = (await db.store.claim(120))!;
    await db.store.discovered(search, [{url:"https://clinic.example/", category:"clinics"}]);
    const candidate = (await db.store.claim(120))!;
    let scrapes = 0;
    let completions = 0;
    class Provider extends DemoProvider {
      override async scrape(_t: Task, url: string): Promise<Page> {
        scrapes++;
        return {url, text:"Example Clinic clinics contact: info@clinic.example +442079460000"};
      }
      override async json(t: Task, instruction: string, data: unknown) {
        if (++completions === 1) throw new ResearchError("MODEL_RATE_LIMITED", true);
        return super.json(t, instruction, data);
      }
    }
    const agent = new ResearchAgent(db.store, new Provider());
    await assert.rejects(() => agent.execute(candidate), /MODEL_RATE_LIMITED/);
    await db.store.failed(candidate, "MODEL_RATE_LIMITED", true);
    const saved = (await db.pool.query("SELECT payload,available_at FROM lg_tasks WHERE id=$1", [candidate.id])).rows[0];
    assert.ok(saved.payload.research_pages.length > 0);
    assert.ok(new Date(saved.available_at).getTime() > Date.now() + 50000);
    assert.equal(await db.store.claim(120), null, "queued research must honor cooldown");
    await db.pool.query("UPDATE lg_tasks SET available_at=now() WHERE id=$1", [candidate.id]);
    const retry = (await db.store.claim(120))!;
    await agent.execute(retry);
    assert.equal(scrapes, 1, "model retries must reuse acquired source pages");
    assert.equal((await db.store.results(i, run.id, null, 50))[0].status, "accepted");
  } finally { await db.close(); }
});

test("long-page qualification retains footer address and contact evidence in model input", async () => {
  const db = await database();
  try {
    const i = {orgId:randomUUID(), workspaceId:randomUUID(), actorId:randomUUID(), requestId:randomUUID()};
    const {run} = await db.store.createRun(i, runInput({categories:["clinics"], location:"London, UK", required_contact:"email", target_count:5}), "footer");
    const search = (await db.store.claim(120))!;
    await db.store.discovered(search, [{url:"https://clinic.example/", category:"clinics"}]);
    const candidate = (await db.store.claim(120))!;
    class Provider implements ResearchProvider {
      async search() { return []; }
      async deliver() { return {}; }
      async scrape(_t: Task, url: string) {
        return {url, text:"Example Clinic clinic services. " + "Long catalog content. ".repeat(400) + " Address: London, UK. Email: info@example.com"};
      }
      async json(_t: Task, _instruction: string, data: unknown) {
        const {pages} = data as {pages:Page[]};
        assert.ok(pages[0].text.includes("London, UK"));
        assert.ok(pages[0].text.includes("info@example.com"));
        return {company_name:"Example Clinic", category:"clinic", location:"London, UK", email:"info@example.com", phone:null, summary:"Clinic", target_checks:{category_match:true,location_match:true}, evidence:[
          {field:"company_name",value:"Example Clinic",quote:"Example Clinic clinic services."},
          {field:"category",value:"clinic",quote:"Example Clinic clinic services."},
          {field:"location",value:"London, UK",quote:"Address: London, UK."},
          {field:"email",value:"info@example.com",quote:"Email: info@example.com"}
        ]};
      }
    }
    await new ResearchAgent(db.store, new Provider()).execute(candidate);
    assert.equal((await db.store.results(i, run.id, null, 50))[0].status,"accepted");
  } finally { await db.close(); }
});

test("shared model admission defers without charging usage or burning task attempts", async () => {
  const db = await database();
  try {
    const i = {orgId:randomUUID(),workspaceId:randomUUID(),actorId:randomUUID(),requestId:randomUUID()};
    await db.store.createRun(i, runInput({categories:["clinics"],target_count:5}), "pacing");
    const task = (await db.store.claim(120))!;
    await db.store.reserve(task,"model.complete",100,45);
    await assert.rejects(() => db.store.reserve(task,"model.complete",100,45), e => e instanceof ResearchError && e.code === "MODEL_PACING_WAIT" && e.retryAfter >= 40);
    assert.equal(Number((await db.pool.query("SELECT count(*) AS count FROM lg_usage_events WHERE action='model.complete'")).rows[0].count),1);
    await db.store.failed(task,"MODEL_PACING_WAIT",true,45);
    const saved=(await db.pool.query("SELECT state,attempts FROM lg_tasks WHERE id=$1",[task.id])).rows[0];
    assert.equal(saved.state,"queued");
    assert.equal(saved.attempts,0);
  } finally { await db.close(); }
});

test("cancel removes queued model waits immediately and fences an already running candidate", async () => {
  const db=await database();
  try {
    const i={orgId:randomUUID(),workspaceId:randomUUID(),actorId:randomUUID(),requestId:randomUUID()};
    const {run}=await db.store.createRun(i,runInput({categories:["clinics"],target_count:3}),"cancel-model-wait");
    const search=(await db.store.claim(120))!;
    await db.store.discovered(search,[{url:"https://one.example/",category:"clinics"},{url:"https://two.example/",category:"clinics"}]);
    const waiting=(await db.store.claim(120))!;
    const running=(await db.store.claim(120))!;
    await db.store.failed(waiting,"MODEL_PACING_WAIT",true,45);
    const cancelled=await db.store.cancel(i,run.id);
    assert.equal(cancelled.status,"cancelled");
    assert.equal((await db.store.cancel(i,run.id)).status,"cancelled");
    assert.equal(Number((await db.pool.query("SELECT count(*) AS count FROM lg_tasks WHERE run_id=$1 AND state IN ('queued','running')",[run.id])).rows[0].count),0);
    await assert.rejects(()=>db.store.saveResearchPages(running,[{url:"https://two.example/",text:"late"}]),/lease lost/);
    assert.equal(await db.store.claim(120),null);
  } finally { await db.close(); }
});

test("discovery waits for candidates in model cooldown before buying another search round", async () => {
  const db=await database();
  try {
    const i={orgId:randomUUID(),workspaceId:randomUUID(),actorId:randomUUID(),requestId:randomUUID()};
    const {run}=await db.store.createRun(i,runInput({categories:["clinics"],target_count:3}),"wait-before-search");
    const search=(await db.store.claim(120))!;
    await db.store.discovered(search,[{url:"https://clinic.example/",category:"clinics"}]);
    const candidate=(await db.store.claim(120))!;
    await db.store.failed(candidate,"MODEL_PACING_WAIT",true,45);
    assert.equal(await db.store.claim(120),null,"pending candidate research must finish before expanding discovery");
    assert.equal((await db.store.run(i,run.id)).status,"running");
  } finally { await db.close(); }
});
