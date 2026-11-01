import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "./db.js";
import { qualify, type Page } from "../research.js";
import { applyFieldMapping, connectorInput, collectionInput, runInput } from "../domain.js";
import type { Identity } from "../store.js";

const createIdentity = (): Identity => ({
  orgId: randomUUID(),
  workspaceId: randomUUID(),
  actorId: randomUUID(),
  requestId: randomUUID(),
});

test("Qualification - Strict mode rejects missing mandatory criteria while Best Match surfaces gaps honestly", () => {
  const briefStrict = runInput({
    categories: ["DTC Luxury", "Fine Jewelry"],
    location: "London, UK",
    required_contact: "email",
    target_count: 10,
    qualification_mode: "strict",
    excluded_domains: [],
  });

  const page: Page = {
    url: "https://mayfair-gems.co.uk",
    text: "Mayfair Gems is a fine jewelry artisan atelier based in London, UK. We create bespoke luxury jewelry.",
  };

  const rawCandidate = {
    company_name: "Mayfair Gems",
    category: "Fine Jewelry",
    location: "London, UK",
    evidence: [
      { field: "category", value: "Fine Jewelry", quote: "fine jewelry artisan atelier", source_url: "https://mayfair-gems.co.uk" },
      { field: "location", value: "London, UK", quote: "based in London, UK", source_url: "https://mayfair-gems.co.uk" },
    ],
    target_checks: { category_match: true },
  };

  // 1. Strict mode: missing mandatory email must fail qualification
  const strictResult = qualify(rawCandidate, [page], briefStrict, "https://mayfair-gems.co.uk", "Fine Jewelry", 70);
  assert.equal(strictResult.accepted, false, "Strict mode must reject candidate missing mandatory email");
  assert.equal(strictResult.data.qualification_mode, "strict");
  const emailEval = strictResult.data.criterion_evaluations?.find(e => e.criterion === "email");
  assert.ok(emailEval, "Criterion evaluation for email must be present");
  assert.equal(emailEval.status, "unknown");
  assert.equal(emailEval.mandatory, true);

  // 2. Best Match mode: prospect ranked with fit score, but email gap is reported honestly
  const briefBestMatch = runInput({
    ...briefStrict,
    qualification_mode: "best_match",
  });
  const bestMatchResult = qualify(rawCandidate, [page], briefBestMatch, "https://mayfair-gems.co.uk", "Fine Jewelry", 50);
  assert.equal(bestMatchResult.accepted, false, "Best match must not bypass a required contact channel");
  assert.equal(bestMatchResult.data.qualification_mode, "best_match");
  assert.ok(bestMatchResult.data.fit_score >= 50, "Fit score should reflect matched business criteria");
  assert.equal(bestMatchResult.data.dimensions?.contact_readiness.email_available, false);
  // Outreach eligibility must always be false by default
  assert.equal(bestMatchResult.data.dimensions?.outreach_eligibility.eligible, false);
  assert.equal(bestMatchResult.data.outreach_eligible, false);
});

test("Contact Requirements - 'both', 'either', and 'none' enforced correctly", () => {
  const page: Page = {
    url: "https://sapphire-atelier.com",
    text: "Sapphire Atelier Handcrafted Jewelry in New York. Email us at concierge@sapphire-atelier.com for bespoke orders.",
  };

  const rawCandidate = {
    company_name: "Sapphire Atelier",
    category: "Handcrafted Jewelry",
    location: "New York",
    fit_score: 85,
    fit_reasons: ["Handcrafted Jewelry studio in New York"],
    evidence: [
      { field: "category", value: "Handcrafted Jewelry", quote: "Handcrafted Jewelry in New York", source_url: "https://sapphire-atelier.com" },
      { field: "location", value: "New York", quote: "Handcrafted Jewelry in New York", source_url: "https://sapphire-atelier.com" },
    ],
    target_checks: { category_match: true },
  };

  // Requirement 'both': has email in text, but lacks phone -> fails strict
  const resultBoth = qualify(
    rawCandidate,
    [page],
    runInput({
      categories: ["Handcrafted Jewelry"],
      location: "New York",
      required_contact: "both",
      target_count: 5,
      qualification_mode: "strict",
      excluded_domains: [],
    }),
    "https://sapphire-atelier.com",
    "Handcrafted Jewelry",
    60
  );
  assert.equal(resultBoth.accepted, false, "'both' must reject candidate missing phone");

  // Requirement 'either': has email -> passes strict
  const resultEither = qualify(
    rawCandidate,
    [page],
    runInput({
      categories: ["Handcrafted Jewelry"],
      location: "New York",
      required_contact: "either",
      target_count: 5,
      qualification_mode: "strict",
      excluded_domains: [],
    }),
    "https://sapphire-atelier.com",
    "Handcrafted Jewelry",
    60
  );
  assert.equal(resultEither.accepted, true, "'either' must accept candidate with email");

  // Requirement 'none': candidate without any contact -> passes strict
  const pageNoContact: Page = {
    url: "https://sapphire-atelier.com",
    text: "Sapphire Atelier Handcrafted Jewelry in New York.",
  };
  const resultNone = qualify(
    rawCandidate,
    [pageNoContact],
    runInput({
      categories: ["Handcrafted Jewelry"],
      location: "New York",
      required_contact: "none",
      target_count: 5,
      qualification_mode: "strict",
      excluded_domains: [],
    }),
    "https://sapphire-atelier.com",
    "Handcrafted Jewelry",
    60
  );
  assert.equal(resultNone.accepted, true, "'none' allows prospects without direct contact details");
});

test("Field Mapping - canonical aliases and sample transformations work reliably without script execution", () => {
  const rawPayload = {
    biz_name: "Artisan Gems Studio",
    web_url: "https://artisangems.example.com",
    contact_person: "Elena Vance",
    job_title: "Head of Design",
    contact_email: "elena@artisangems.example.com",
    biz_phone: "+44 20 7946 0991",
    geo: "London, UK",
    vertical: "Jewelry Design",
  };

  const customMapping = {
    company_name: "biz_name",
    website: "web_url",
    person_name: "contact_person",
    person_role: "job_title",
    email: "contact_email",
    phone: "biz_phone",
    location: "geo",
    category: "vertical",
  };

  const mapped = applyFieldMapping(rawPayload, customMapping);
  assert.equal(mapped.company_name, "Artisan Gems Studio");
  assert.equal(mapped.website, "https://artisangems.example.com");
  assert.equal(mapped.person_name, "Elena Vance");
  assert.equal(mapped.person_role, "Head of Design");
  assert.equal(mapped.email, "elena@artisangems.example.com");
  assert.equal(mapped.phone, "+44 20 7946 0991");
  assert.equal(mapped.location, "London, UK");
  assert.equal(mapped.category, "Jewelry Design");
});

test("Inbound Connectors & Collections - Token hashing, scoped authentication, and collection overrides", async () => {
  const db = await database();
  try {
    const ident = createIdentity();

    // 1. Create a Collection with qualification overrides
    const collection = await db.store.createCollection(
      ident,
      collectionInput({
        name: "High-Priority European Retailers",
        description: "Curated inbound leads for Q4 campaign",
        qualification_overrides: {
          qualification_mode: "strict",
          required_contact: "either",
          min_fit_score: 75,
        },
      })
    );
    assert.ok(collection.id);
    assert.equal(collection.name, "High-Priority European Retailers");

    // 2. Create an Inbound Connector
    const { connector, raw_token } = await db.store.createConnector(
      ident,
      connectorInput({
        name: "External Web Scraper Hook",
        source_type: "apify",
        collection_id: collection.id,
        default_qualification_mode: "best_match",
        batch_size_limit: 50,
      })
    );

    assert.ok(connector.id);
    assert.ok(raw_token.startsWith("inb_live_"), "Secret token must use scoped inb_live_ prefix");
    assert.equal(connector.token_prefix, `inb_live_${raw_token.slice(9, 15)}...`);

    // 3. Ingest an Inbound Batch using valid connector
    const batchIdempotencyKey = `batch_test_${randomUUID()}`;
    const batchResult = await db.store.ingestInboundBatch({
      connectorId: connector.id,
      token: raw_token,
      records: [
        {
          company_name: "Diamond Atelier Zurich",
          website: "https://diamondatelier.ch",
          category: "Luxury Jewelry",
          location: "Zurich, Switzerland",
          person_name: "Marc Weber",
          person_role: "Managing Director",
          email: "marc.weber@diamondatelier.ch",
          phone: "+41 44 668 12 34",
        },
        {
          company_name: "Diamond Atelier Zurich", // Same company domain, distinct decision-maker
          website: "https://diamondatelier.ch",
          category: "Luxury Jewelry",
          location: "Zurich, Switzerland",
          person_name: "Sophie Blanc",
          person_role: "Head of Purchasing",
          email: "sophie.b@diamondatelier.ch",
          phone: "+41 44 668 12 35",
        },
      ],
      idempotencyKey: batchIdempotencyKey,
      collectionId: collection.id,
    });

    assert.equal(batchResult.status, "completed");
    assert.equal(batchResult.records_count, 2);
    assert.equal(batchResult.created_count, 2, "Both distinct decision-makers must be created as separate leads");
    assert.equal(batchResult.failed_count, 0);

    // 4. Verify Idempotency - Replay of same batch returns duplicate-safe status
    const replayResult = await db.store.ingestInboundBatch({
      connectorId: connector.id,
      token: raw_token,
      records: [
        { company_name: "Diamond Atelier Zurich", website: "https://diamondatelier.ch" }
      ],
      idempotencyKey: batchIdempotencyKey,
    });
    assert.equal(replayResult.idempotency_key, batchIdempotencyKey);
    assert.equal(replayResult.created_count, 2, "Idempotent replay returns original batch summary without inserting duplicates");

    // 5. Ingest with Invalid Token must fail authentication
    await assert.rejects(
      async () => {
        await db.store.ingestInboundBatch({
          connectorId: connector.id,
          token: "inb_live_invalid_bad_token_12345",
          records: [{ company_name: "Fake Co" }],
        });
      },
      /Invalid ingestion credential/,
      "Ingestion with bad token must be rejected"
    );

    // 6. Token Rotation
    const rotated = await db.store.rotateConnectorToken(ident, connector.id);
    assert.ok(rotated.raw_token.startsWith("inb_live_"));
    assert.notEqual(rotated.raw_token, raw_token, "New secret token must differ from old token");

    // Old token must no longer authenticate
    await assert.rejects(
      async () => {
        await db.store.ingestInboundBatch({
          connectorId: connector.id,
          token: raw_token,
          records: [{ company_name: "Test" }],
        });
      },
      /Invalid ingestion credential/
    );

    // 7. Revocation
    await db.store.revokeConnector(ident, connector.id);
    await assert.rejects(
      async () => {
        await db.store.ingestInboundBatch({
          connectorId: connector.id,
          token: rotated.raw_token,
          records: [{ company_name: "Test" }],
        });
      },
      /Inbound connector is revoked/
    );
  } finally {
    await db.close();
  }
});

test("Shortfall Calculation - Computes shortfall explanation and expansion options when target is not met", async () => {
  const db = await database();
  try {
    const ident = createIdentity();
    await db.store.putProfile(
      ident,
      {
        name: "Luxury Gems Corp",
        website: "https://luxurygems.example.com",
        description: "Fine jewelry artisan studio",
        offerings: ["gemstones"],
        target_categories: ["retailers"],
        locations: ["Monaco"],
      },
      0
    );

    // Create a run with target_count = 25 and strict mode
    const created = await db.store.createRun(
      ident,
      runInput({
        categories: ["Rare Gemstones"],
        location: "Monaco",
        target_count: 25,
        required_contact: "both",
        qualification_mode: "strict",
        excluded_domains: [],
      }),
      "shortfall-run-key"
    );

    // Compute shortfall on the run
    const explanation = await db.store.computeShortfallExplanation(created.run.id);
    assert.ok(explanation, "Shortfall explanation must be generated for run short of target");
    assert.equal(explanation.target, 25);
    assert.equal(explanation.found, 0);
    assert.equal(explanation.shortfall, 25);
    assert.ok(explanation.summary.includes("25"), "Summary must reflect count");
    assert.ok(explanation.expansion_options.length > 0, "Must provide actionable expansion suggestions");

    // Must suggest relaxing contact from 'both' to 'either'
    const contactOption = explanation.expansion_options.find((o: any) => o.type === "relax_contact");
    assert.ok(contactOption, "Must offer relax_contact option when required_contact is both");

    // Must suggest switching to Best Match
    const modeOption = explanation.expansion_options.find((o: any) => o.type === "switch_mode");
    assert.ok(modeOption, "Must offer switch_mode when run was strict");
  } finally {
    await db.close();
  }
});
