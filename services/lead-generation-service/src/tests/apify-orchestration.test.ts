import test from "node:test";
import assert from "node:assert/strict";
import { ApifyActorOrchestrator } from "../apify-orchestrator.js";
import { AppError } from "@quickstart/errors";

test("Phase 3 - Apify Orchestration: Missing Customer Token Strictly Throws APIFY_CONNECTION_REQUIRED", async () => {
  const orchestrator = new ApifyActorOrchestrator({
    secretsUrl: "http://127.0.0.1:9999", // non-existent/unconnected
    mockDriver: false,
  });

  await assert.rejects(
    async () => {
      await orchestrator.resolveCustomerToken("ws-no-apify-connected");
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        err.message.includes("APIFY_CONNECTION_REQUIRED"),
        `Error must cite APIFY_CONNECTION_REQUIRED, got: ${err.message}`,
      );
      return true;
    },
  );
});

test("Phase 3 - Apify Orchestration: Recipe Parameter Builders", () => {
  const orchestrator = new ApifyActorOrchestrator({ mockDriver: true });

  // 1. Google Places
  const places = orchestrator.buildActorInput("google_places", {
    query: "Plumbers",
    location: "Chicago, IL",
    limit: 15,
  });
  assert.equal(places.actorId, "compass~crawler-google-places");
  assert.deepEqual((places.input as any).searchStringsArray, ["Plumbers in Chicago, IL"]);
  assert.equal((places.input as any).maxCrawledPlacesPerSearch, 15);

  // 2. Instagram
  const ig = orchestrator.buildActorInput("instagram", {
    query: "fitnesscoach",
    limit: 10,
  });
  assert.equal(ig.actorId, "apify~instagram-scraper");
  assert.equal((ig.input as any).search, "fitnesscoach");
  assert.equal((ig.input as any).resultsLimit, 10);

  // 3. YouTube
  const yt = orchestrator.buildActorInput("youtube", {
    query: "Tech Reviews",
    limit: 20,
  });
  assert.equal(yt.actorId, "streamers~youtube-scraper");
  assert.equal((yt.input as any).searchKeywords, "Tech Reviews");

  // 4. LinkedIn
  const li = orchestrator.buildActorInput("linkedin", {
    query: "Chief Technology Officer",
    location: "Austin, Texas",
    limit: 30,
  });
  assert.equal(li.actorId, "dev_fusion~linkedin-profile-scraper");
  assert.deepEqual((li.input as any).searchQueries, ["Chief Technology Officer"]);

  // 5. Custom Actor
  const custom = orchestrator.buildActorInput("custom", {
    query: "custom query",
    actorId: "my-org~custom-actor",
    customInput: { customParam: 123 },
  });
  assert.equal(custom.actorId, "my-org~custom-actor");
  assert.equal((custom.input as any).customParam, 123);
});

test("Phase 3 - Apify Orchestration: Checkpoint Dataset Pagination and Abort Lifecycle", async () => {
  const orchestrator = new ApifyActorOrchestrator({ mockDriver: true });

  const token = await orchestrator.resolveCustomerToken("test-ws");
  assert.ok(token);

  // Start run
  const { runId, datasetId } = await orchestrator.startActorRun(token, "test-actor", { q: "test" });
  assert.ok(runId);
  assert.ok(datasetId);

  // Poll run
  const pollRes = await orchestrator.pollActorRun(token, runId);
  assert.equal(pollRes.status, "SUCCEEDED");

  // Fetch items with offset checkpointing
  const page1 = await orchestrator.fetchDatasetItemsPaged(token, datasetId, 0, 1);
  assert.equal(page1.offset, 0);
  assert.equal(page1.items.length, 1);

  // Abort run
  const aborted = await orchestrator.abortActorRun(token, runId);
  assert.equal(aborted, true);
});

test("Phase 3 - Apify Orchestration: Canonical Candidate Normalization", async () => {
  const orchestrator = new ApifyActorOrchestrator({ mockDriver: true });

  // 1. Google Places normalization
  const rawPlace = {
    title: "Apex Plumbing Solutions",
    website: "https://apexplumbing.example",
    phone: "+13125550144",
    address: "Chicago, IL, USA",
    categoryName: "Plumbing Service",
    url: "https://maps.google.com/?cid=12345",
    placeId: "place_abc123",
  };

  const normPlace = await orchestrator.normalizeCandidate(rawPlace, "google_places", "Plumber");
  assert.equal(normPlace.company_name, "Apex Plumbing Solutions");
  assert.equal(normPlace.website, "https://apexplumbing.example/");
  assert.equal(normPlace.phone, "+13125550144");
  assert.equal(normPlace.location, "Chicago, IL, USA");
  assert.equal(normPlace.category, "Plumbing Service");
  assert.equal(normPlace.entity_type, "business");
  assert.equal(normPlace.external_record_id, "place_abc123");
  assert.ok(normPlace.contact_points.some((c) => c.type === "phone" && c.status === "format_valid"));

  // 2. Instagram profile normalization
  const rawIg = {
    username: "healthcoaching",
    fullName: "Sarah Fitness Coach",
    externalUrl: "https://sarahfit.example",
    businessEmail: "sarah@sarahfit.example",
    businessPhoneNumber: "+12125550199",
    isBusinessAccount: true,
  };

  const normIg = await orchestrator.normalizeCandidate(rawIg, "instagram", "Fitness");
  assert.equal(normIg.person_name, "Sarah Fitness Coach");
  assert.equal(normIg.email, "sarah@sarahfit.example");
  assert.equal(normIg.website, "https://sarahfit.example/");
  assert.ok(normIg.contact_points.some((c) => c.type === "email" && c.status === "format_valid"));
  assert.ok(normIg.contact_points.some((c) => c.type === "phone" && c.status === "format_valid"));

  // 3. Custom actor with field mapping
  const rawCustom = {
    org_name: "Fintech Growth Partners",
    contact_email: "invest@fintechgrowth.example",
    contact_person: "David Miller",
    job_role: "Managing Director",
  };

  const normCustom = await orchestrator.normalizeCandidate(rawCustom, "custom", "Venture Capital", {
    company_name: "org_name",
    email: "contact_email",
    person_name: "contact_person",
    person_role: "job_role",
  });

  assert.equal(normCustom.company_name, "Fintech Growth Partners");
  assert.equal(normCustom.email, "invest@fintechgrowth.example");
  assert.equal(normCustom.person_name, "David Miller");
  assert.equal(normCustom.person_role, "Managing Director");
});
