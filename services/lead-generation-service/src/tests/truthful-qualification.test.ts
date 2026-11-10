import test from "node:test";
import assert from "node:assert/strict";
import { qualify, adaptiveMinScore, validatedEvidence, type Page } from "../research.js";
import { locationsHierarchicallyCompatible, parseLocation } from "../geography.js";
import { validateEmail, validatePhone } from "../contact-validation.js";
import { runInput } from "../domain.js";

test("Phase 1 - Truthful Qualification: Mandatory missing contact never qualifies", () => {
  const page: Page = {
    url: "https://artisan-bakery.com",
    text: "Artisan Bakery & Cafe located in Austin, Texas. Fresh sourdough and pastries daily.",
  };

  const rawCandidate = {
    company_name: "Artisan Bakery",
    category: "Bakery",
    location: "Austin, Texas",
    fit_score: 95,
    fit_reasons: ["Specializes in artisan sourdough and pastries"],
    evidence: [
      { field: "company_name", value: "Artisan Bakery", quote: "Artisan Bakery & Cafe", source_url: page.url },
      { field: "category", value: "Bakery", quote: "Fresh sourdough and pastries daily", source_url: page.url },
      { field: "location", value: "Austin, Texas", quote: "located in Austin, Texas", source_url: page.url },
    ],
    target_checks: { category_match: true, location_match: true },
  };

  // Mandatory email required
  const briefMandatoryEmail = runInput({
    categories: ["Bakery"],
    location: "Austin, Texas",
    required_contact: "email",
    target_count: 5,
    qualification_mode: "strict",
    excluded_domains: [],
  });

  const result = qualify(rawCandidate, [page], briefMandatoryEmail, page.url, "Bakery", 70);
  assert.equal(result.accepted, false, "Candidate missing mandatory email MUST NOT qualify");
  assert.ok(result.data.reject_reasons?.some((r) => r.includes("email was required")), "Reject reasons must cite missing email");

  const emailEval = result.data.criterion_evaluations?.find((c) => c.criterion === "email");
  assert.ok(emailEval);
  assert.equal(emailEval.status, "unknown");
  assert.equal(emailEval.mandatory, true);
  assert.ok(result.data.dimensions?.evidence_completeness.unknown_criteria.includes("email"));
  assert.equal(result.data.dimensions?.contact_readiness.email_available, false);
});

test("Phase 1 - Truthful Qualification: No arbitrary fallback score of 75", () => {
  const page: Page = {
    url: "https://small-niche.example",
    text: "Niche Consultancy services. Phone: 555-0199",
  };

  const rawCandidateNoScore = {
    company_name: "Niche Consultancy",
    category: "Consulting",
    fit_score: 0, // Model returned 0
    target_checks: { category_match: true, location_match: false },
    evidence: [
      { field: "company_name", value: "Niche Consultancy", quote: "Niche Consultancy", source_url: page.url },
      { field: "category", value: "Consulting", quote: "Consultancy services", source_url: page.url },
    ],
  };

  const brief = runInput({
    categories: ["Consulting"],
    location: "Chicago, IL",
    required_contact: "none",
    target_count: 5,
    qualification_mode: "strict",
    excluded_domains: [],
  });

  // Target min score is 70. Category matches (50%), but location is missing -> score should be 50, NOT inflated to 75!
  const result = qualify(rawCandidateNoScore, [page], brief, page.url, "Consulting", 70);
  assert.equal(result.accepted, false, "Score must not be arbitrarily inflated to 75 to pass a 70 bar");
  assert.equal(result.data.fit_score, 50, "Calculated score should reflect only verified criteria (category = 50%)");
});

test("Phase 1 - Truthful Qualification: adaptiveMinScore never silently relaxes bar", () => {
  const base = 70;
  // Previously: accepted=0, evaluated=5 would lower base by 15 (to 55)
  const score1 = adaptiveMinScore(base, 0, 5);
  assert.equal(score1, 70, "adaptiveMinScore must not lower the score threshold after 0 accepted and 5 evaluated");

  const score2 = adaptiveMinScore(base, 0, 20);
  assert.equal(score2, 70, "adaptiveMinScore must remain stable even after high evaluated count");
});

test("Phase 1 - Evidence Enforcement: Unsupported quotes rejected, never falling back to page 0", () => {
  const page: Page = {
    url: "https://real-site.com",
    text: "Real company text that exists on the page.",
  };

  const hallucinatedEvidence = [
    {
      field: "revenue",
      value: "$10M",
      quote: "Our annual revenue exceeded 10 million dollars this fiscal year.", // NOT in page text!
    },
    {
      field: "company_name",
      value: "Real Company",
      quote: "Real company text", // IS in page text
    },
  ];

  const filtered = validatedEvidence(hallucinatedEvidence, [page]);
  assert.equal(filtered.length, 1, "Only the quote physically present on the page should be accepted");
  assert.equal(filtered[0].field, "company_name");
  assert.equal(filtered[0].quote, "Real company text");
});

test("Phase 1 - Geography: California vs Canada and multi-country disambiguation", () => {
  // California vs Canada: Must NEVER conflate
  assert.equal(locationsHierarchicallyCompatible("California, US", "Los Angeles, CA"), true);
  assert.equal(locationsHierarchicallyCompatible("California, US", "San Francisco, California"), true);
  assert.equal(locationsHierarchicallyCompatible("California, US", "Toronto, ON, Canada"), false);
  assert.equal(locationsHierarchicallyCompatible("Canada", "Los Angeles, CA, USA"), false);
  assert.equal(locationsHierarchicallyCompatible("Canada", "Vancouver, BC, Canada"), true);

  // Same city name in different countries
  assert.equal(locationsHierarchicallyCompatible("London, UK", "London, Ontario, Canada"), false);
  assert.equal(locationsHierarchicallyCompatible("London, UK", "Mayfair, London, UK"), true);
  assert.equal(locationsHierarchicallyCompatible("Paris, France", "Paris, TX, USA"), false);
  assert.equal(locationsHierarchicallyCompatible("Lahore, Pakistan", "Lahore, India"), false);

  // Standalone ambiguous "CA" triggers explicit ambiguity
  const parsedCa = parseLocation("CA");
  assert.equal(parsedCa.isAmbiguous, true);
  assert.ok(parsedCa.ambiguityReason?.includes("California"));
});

test("Phase 1 - Contact Validation: Truthful email syntax, role account detection, and phone formatting", async () => {
  // 1. Valid syntax & role account detection
  const emailRole = await validateEmail("support@example.com");
  assert.equal(emailRole.formatValid, true);
  assert.equal(emailRole.isRoleAccount, true, "support@ should be classified as a role account");
  assert.equal(emailRole.localPart, "support");
  assert.equal(emailRole.domain, "example.com");

  // Local part casing preservation
  const emailCasing = await validateEmail("John.Doe+Tag@EXAMPLE.COM");
  assert.equal(emailCasing.normalized, "John.Doe+Tag@example.com", "Local part casing should be preserved while domain is lowercased");

  // Invalid email syntax
  const invalidEmail = await validateEmail("not-an-email");
  assert.equal(invalidEmail.formatValid, false);
  assert.equal(invalidEmail.status, "format_invalid");

  // 2. Phone validation
  const usPhone = validatePhone("+1 (415) 555-2671", "US");
  assert.equal(usPhone.formatValid, true);
  assert.equal(usPhone.digitsOnly, "14155552671");
  assert.equal(usPhone.status, "numbering_plan_possible");
  assert.ok(usPhone.explanation.includes("unverified"), "Must never claim active verification without provider");

  const invalidPhone = validatePhone("123", "US");
  assert.equal(invalidPhone.formatValid, false);
  assert.equal(invalidPhone.status, "format_invalid");
});

test("category_match evidence alias retains a verbatim business category without accepting invented quotes", () => {
  const page = {url:"https://retailer.example/", text:'{"categoryName":"Watch store"}'};
  const evidence = validatedEvidence([
    {field:"category_match",value:"Watch store",quote:'"categoryName":"Watch store"'},
    {field:"category_match",value:"Independent retailer",quote:"Independently owned"},
  ], [page]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].field, "category");
  assert.equal(evidence[0].value, "Watch store");
});
