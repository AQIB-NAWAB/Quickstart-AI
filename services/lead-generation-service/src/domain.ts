import { computeNextRunAt } from "./schedule-time.js";
import { createHash } from "node:crypto";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  BusinessInput,
  LeadRunInput,
  LeadPolicy,
  LeadEntityType,
  SalesStatus,
  SearchCriterion,
  CriterionOperator,
  LeadSchedule,
} from "@quickstart/contracts";

export const DEFAULT_POLICY: LeadPolicy = {
  enabled: true,
  subscription_limits_enabled: false,
  max_categories: 5,
  max_queued_runs: 10,
  max_active_tasks: 2,
  daily_runs: 50,
  daily_units: 2000,
  daily_tokens: 3_000_000,
  scheduling_weight: 1,
  max_rounds: 3,
  max_candidates: 100,
  max_target_count: 100,
  run_deadline_seconds: 1800,
  request_rate_per_minute: 600,
  min_fit_score: 70,
};
export function fail(message: string, code: ErrorCode = ErrorCode.VALIDATION_FAILED): never {
  throw new AppError({ code, message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("JSON object required");
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 2000, optional = false): string {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${name}: non-empty string, maximum ${max} characters`);
  return value.trim();
}
export function strings(value: unknown, name: string, max = 20): string[] {
  if (!Array.isArray(value) || value.length > max) fail(`${name}: array, maximum ${max} items`);
  return [...new Set(value.map((v) => text(v, name, 200)))];
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    fail(`${name}: integer between ${min} and ${max}`);
  return value;
}
export function uuid(value: unknown): string {
  const v = text(value, "id", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))
    fail("Valid UUID required");
  return v;
}
export function normalizeWebsite(value: unknown): string {
  const raw = text(value, "website", 2048);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail("Valid website URL required");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    !u.hostname ||
    (u.port && !["80", "443"].includes(u.port))
  )
    fail("Only public HTTP(S) websites on standard ports are supported");
  u.hash = "";
  return u.href;
}
export function domain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}
export function businessInput(value: unknown): BusinessInput {
  const b = object(value);
  const website = b.website ? normalizeWebsite(b.website) : undefined;
  return {
    name: text(b.name, "name", 200),
    ...(website ? { website } : {}),
    description: text(b.description, "description", 5000),
    offerings: strings(b.offerings, "offerings"),
    target_categories: strings(b.target_categories ?? [], "target_categories"),
    locations: strings(b.locations ?? [], "locations"),
    ...(b.target_audience ? { target_audience: text(b.target_audience, "target_audience", 1000, true) } : {}),
    ...(b.value_proposition ? { value_proposition: text(b.value_proposition, "value_proposition", 1000, true) } : {}),
    ...(b.products_and_services ? { products_and_services: strings(b.products_and_services, "products_and_services", 50) } : {}),
    ...(b.selling_points ? { selling_points: strings(b.selling_points, "selling_points", 50) } : {}),
    ...(b.target_countries ? { target_countries: strings(b.target_countries, "target_countries", 50) } : {}),
    ...(b.target_industries ? { target_industries: strings(b.target_industries, "target_industries", 50) } : {}),
    ...(b.preferred_roles ? { preferred_roles: strings(b.preferred_roles, "preferred_roles", 50) } : {}),
    ...(b.exclusions ? { exclusions: strings(b.exclusions, "exclusions", 100) } : {}),
    ...(b.ideal_customer_profile && typeof b.ideal_customer_profile === "object"
      ? { ideal_customer_profile: b.ideal_customer_profile as BusinessInput["ideal_customer_profile"] }
      : {}),
  };
}

export function runInput(value: unknown): LeadRunInput {
  const b = object(value);
  const categories = strings(b.categories, "categories", 20);
  if (!categories.length) fail("Select at least one category");
  const contact = b.required_contact ?? "none";
  if (!["none", "email", "phone", "either", "both"].includes(String(contact))) fail("Invalid required_contact");
  const mode = b.qualification_mode ?? "best_match";
  if (!["strict", "best_match"].includes(String(mode))) fail("Invalid qualification_mode");
  const rawEntityType = b.entity_type;
  if (rawEntityType !== undefined && !["business", "professional", "consumer"].includes(String(rawEntityType))) fail("Invalid entity_type");
  if (b.criteria !== undefined && (!Array.isArray(b.criteria) || b.criteria.length > 50)) fail("criteria must contain at most 50 rules");
  if (Array.isArray(b.criteria)) {
    const ids = new Set<string>();
    for (const raw of b.criteria) {
      const criterion = object(raw);
      if (!["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "semantic_match"].includes(String(criterion.operator))) fail("Invalid criterion operator");
      if (typeof criterion.mandatory !== "boolean") fail("Criterion mandatory must be boolean");
      if (criterion.weight !== undefined) integer(criterion.weight, "criterion.weight", 1, 100);
      if (criterion.id !== undefined) {
        const id = text(criterion.id, "criterion.id", 64);
        if (ids.has(id)) fail("Duplicate criterion id");
        ids.add(id);
      }
    }
  }
  if (b.budget_limits !== undefined) {
    const budget = object(b.budget_limits);
    if (budget.max_candidates !== undefined) integer(budget.max_candidates, "max_candidates", 1, 1000);
    if (budget.max_runtime_seconds !== undefined) integer(budget.max_runtime_seconds, "max_runtime_seconds", 1, 86400);
    if (budget.max_cost_usd !== undefined && (typeof budget.max_cost_usd !== "number" || !Number.isFinite(budget.max_cost_usd) || budget.max_cost_usd <= 0)) fail("max_cost_usd must be a positive finite number");
  }
  const entity_type: LeadEntityType =
    rawEntityType === "professional" || rawEntityType === "consumer" ? rawEntityType : "business";
  const exclusions = strings(b.excluded_domains ?? [], "excluded_domains", 100).map((x) =>
    domain(normalizeWebsite(x.includes("://") ? x : `https://${x}`)),
  );
  const priorities: LeadRunInput["priorities"] = Array.isArray(b.priorities)
    ? (b.priorities as unknown[])
        .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
        .map((p) => ({
          field: text(p.field, "priority.field", 100),
          priority: integer(Number(p.priority ?? 1), "priority.priority", 1, 100),
          mandatory: Boolean(p.mandatory),
        }))
    : undefined;

  const criteria: SearchCriterion[] | undefined = Array.isArray(b.criteria)
    ? (b.criteria as unknown[])
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
        .map((c, idx) => ({
          id: typeof c.id === "string" && c.id.trim() ? c.id.trim().slice(0, 64) : `crit_${idx + 1}`,
          field: text(c.field, `criteria[${idx}].field`, 100),
          operator: (["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "semantic_match"].includes(String(c.operator))
            ? c.operator
            : "contains") as CriterionOperator,
          value: typeof c.value === "string" ? c.value.slice(0, 500) : undefined,
          mandatory: Boolean(c.mandatory),
          weight: typeof c.weight === "number" ? Math.max(1, Math.min(100, Math.floor(c.weight))) : undefined,
          semantic_description: typeof c.semantic_description === "string" ? c.semantic_description.slice(0, 1000) : undefined,
          evidence_required: Boolean(c.evidence_required),
        }))
    : undefined;

  const confirmed_assumptions = Array.isArray(b.confirmed_assumptions)
    ? strings(b.confirmed_assumptions, "confirmed_assumptions", 50)
    : undefined;

  const budget_limits = b.budget_limits && typeof b.budget_limits === "object"
    ? {
        ...(typeof (b.budget_limits as any).max_cost_usd === "number" ? { max_cost_usd: (b.budget_limits as any).max_cost_usd } : {}),
        ...(typeof (b.budget_limits as any).max_candidates === "number" ? { max_candidates: (b.budget_limits as any).max_candidates } : {}),
        ...(typeof (b.budget_limits as any).max_runtime_seconds === "number" ? { max_runtime_seconds: (b.budget_limits as any).max_runtime_seconds } : {}),
      }
    : undefined;

  const source_policy = b.source_policy && typeof b.source_policy === "object"
    ? {
        ...(Array.isArray((b.source_policy as any).preferred_sources) ? { preferred_sources: strings((b.source_policy as any).preferred_sources, "preferred_sources", 20) } : {}),
        ...(typeof (b.source_policy as any).allow_fallback === "boolean" ? { allow_fallback: (b.source_policy as any).allow_fallback } : {}),
        ...(Array.isArray((b.source_policy as any).disallowed_sources) ? { disallowed_sources: strings((b.source_policy as any).disallowed_sources, "disallowed_sources", 20) } : {}),
      }
    : undefined;

  return {
    entity_type,
    categories,
    location: text(b.location, "location", 200, true),
    company_size: text(b.company_size, "company_size", 100, true),
    contact_role: text(b.contact_role, "contact_role", 100, true),
    instructions: text(b.instructions, "instructions", 2000, true),
    excluded_domains: exclusions,
    required_contact: contact as LeadRunInput["required_contact"],
    qualification_mode: mode as LeadRunInput["qualification_mode"],
    target_count: integer(b.target_count ?? 25, "target_count", 1, 1000),
    ...(b.campaign_id ? { campaign_id: uuid(b.campaign_id) } : {}),
    ...(b.collection_id ? { collection_id: uuid(b.collection_id) } : {}),
    ...(b.countries ? { countries: strings(b.countries, "countries", 50) } : {}),
    ...(b.industries ? { industries: strings(b.industries, "industries", 50) } : {}),
    ...(b.target_roles ? { target_roles: strings(b.target_roles, "target_roles", 50) } : {}),
    ...(b.buying_signals ? { buying_signals: strings(b.buying_signals, "buying_signals", 50) } : {}),
    ...(priorities ? { priorities } : {}),
    ...(criteria ? { criteria } : {}),
    ...(confirmed_assumptions ? { confirmed_assumptions } : {}),
    ...(budget_limits ? { budget_limits } : {}),
    ...(source_policy ? { source_policy } : {}),
  };
}

export function salesStatusInput(value: unknown): SalesStatus {
  const s = String(value).toLowerCase().trim();
  if (!["new", "contacted", "replied", "meeting", "won", "lost"].includes(s)) {
    fail("Invalid sales_status. Supported: new, contacted, replied, meeting, won, lost");
  }
  return s as SalesStatus;
}

export function leadSalesUpdateInput(value: unknown): {
  status?: SalesStatus;
  notes?: string;
  user_edited_fields?: Record<string, unknown>;
} {
  const b = object(value);
  const rawStatus = b.status ?? b.sales_status;
  const status = rawStatus ? salesStatusInput(rawStatus) : undefined;
  const notes = typeof b.notes === "string" ? b.notes.slice(0, 10000) : undefined;
  const user_edited_fields =
    b.user_edited_fields && typeof b.user_edited_fields === "object" && !Array.isArray(b.user_edited_fields)
      ? (b.user_edited_fields as Record<string, unknown>)
      : undefined;
  return { status, notes, user_edited_fields };
}

export function scheduleInput(
  value: unknown,
): Omit<LeadSchedule, "id" | "workspace_id" | "created_at" | "updated_at"> {
  const b = object(value);
  const name = text(b.name, "name", 200);
  const brief = runInput(b.brief);
  const timezone = text(b.timezone ?? "UTC", "timezone", 100);
  const cron_expression = text(b.cron_expression, "cron_expression", 100);
  try { computeNextRunAt(cron_expression, new Date(), timezone); }
  catch { fail("Invalid or unsupported schedule expression/timezone"); }
  if (b.next_run_at !== undefined && (typeof b.next_run_at !== "string" || !Number.isFinite(Date.parse(b.next_run_at)))) {
    fail("Invalid next_run_at timestamp");
  }
  const overlap_policy = (["skip", "allow", "queue"].includes(String(b.overlap_policy))
    ? b.overlap_policy
    : "skip") as "skip" | "allow" | "queue";
  return {
    name,
    brief,
    timezone,
    cron_expression,
    next_run_at: typeof b.next_run_at === "string" ? b.next_run_at : new Date().toISOString(),
    enabled: b.enabled !== false,
    overlap_policy,
    budget_limits:
      b.budget_limits && typeof b.budget_limits === "object"
        ? (b.budget_limits as Record<string, unknown>)
        : undefined,
    destination_config:
      b.destination_config && typeof b.destination_config === "object"
        ? (b.destination_config as Record<string, unknown>)
        : undefined,
    last_occurrence_key: null,
    last_run_id: null,
  };
}

export function escapeCsvField(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  // Formula injection prevention: prefix with single-quote if it begins with dangerous characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Standard CSV escaping: wrap in quotes if contains comma, quote, or newline
  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function connectorInput(value: unknown): {
  name: string;
  source_type: "generic_json" | "apify" | "custom_scraper" | "automation_webhook";
  description?: string;
  collection_id?: string | null;
  default_qualification_mode: "strict" | "best_match";
  field_mapping: Record<string, string>;
  enrichment_enabled: boolean;
  auto_enroll_campaign_id?: string | null;
  rate_limit_per_minute: number;
  batch_size_limit: number;
} {
  const b = object(value);
  const name = text(b.name, "name", 200);
  const source_type = text(b.source_type, "source_type", 50);
  if (!["generic_json", "apify", "custom_scraper", "automation_webhook"].includes(source_type)) {
    fail("Invalid source_type. Supported: generic_json, apify, custom_scraper, automation_webhook");
  }
  const mode = b.default_qualification_mode ?? "strict";
  if (!["strict", "best_match"].includes(String(mode))) fail("Invalid default_qualification_mode");

  const rawMapping = b.field_mapping && typeof b.field_mapping === "object" && !Array.isArray(b.field_mapping)
    ? (b.field_mapping as Record<string, unknown>)
    : {};
  const field_mapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawMapping)) {
    if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
      field_mapping[k.trim().slice(0, 100)] = v.trim().slice(0, 100);
    }
  }

  return {
    name,
    source_type: source_type as "generic_json" | "apify" | "custom_scraper" | "automation_webhook",
    description: text(b.description, "description", 1000, true) || undefined,
    collection_id: b.collection_id ? uuid(b.collection_id) : null,
    default_qualification_mode: mode as "strict" | "best_match",
    field_mapping,
    enrichment_enabled: Boolean(b.enrichment_enabled),
    auto_enroll_campaign_id: b.auto_enroll_campaign_id ? uuid(b.auto_enroll_campaign_id) : null,
    rate_limit_per_minute: integer(Number(b.rate_limit_per_minute ?? 60), "rate_limit_per_minute", 1, 600),
    batch_size_limit: integer(Number(b.batch_size_limit ?? 100), "batch_size_limit", 1, 500),
  };
}

export function collectionInput(value: unknown): {
  name: string;
  description?: string;
  qualification_overrides: Record<string, unknown>;
} {
  const b = object(value);
  return {
    name: text(b.name, "name", 200),
    description: text(b.description, "description", 1000, true) || undefined,
    qualification_overrides: b.qualification_overrides && typeof b.qualification_overrides === "object" && !Array.isArray(b.qualification_overrides)
      ? (b.qualification_overrides as Record<string, unknown>)
      : {},
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function applyFieldMapping(
  rawRecord: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rawRecord };

  // Explicit user-configured mapping takes precedence (supports both source->target and target->source)
  for (const [k, v] of Object.entries(mapping)) {
    if (k in rawRecord && rawRecord[k] !== undefined) {
      result[v] = rawRecord[k];
    } else if (v in rawRecord && rawRecord[v] !== undefined) {
      result[k] = rawRecord[v];
    }
  }

  // Canonical fallback aliases if target field not populated
  const aliases: Record<string, string[]> = {
    company_name: ["company", "companyName", "business_name", "businessName", "org_name", "organization", "title"],
    website: ["url", "domain", "web", "siteUrl", "site"],
    person_name: ["name", "contact_name", "contactName", "full_name", "fullName", "decision_maker"],
    person_role: ["role", "job_title", "jobTitle", "position", "contact_role"],
    email: ["contact_email", "mail", "emailAddress", "work_email"],
    phone: ["telephone", "tel", "phone_number", "mobile", "contact_phone"],
    location: ["city", "address", "country", "geo", "headquarters"],
    industry: ["category", "sector", "niche", "categoryName"],
    company_size: ["size", "employee_count", "employees", "headcount"],
    external_id: ["id", "_id", "record_id", "externalId", "lead_id", "placeId"],
  };

  for (const [targetField, candidates] of Object.entries(aliases)) {
    if (result[targetField] === undefined || result[targetField] === null || result[targetField] === "") {
      for (const candidate of candidates) {
        if (rawRecord[candidate] !== undefined && rawRecord[candidate] !== null && rawRecord[candidate] !== "") {
          result[targetField] = rawRecord[candidate];
          break;
        }
      }
    }
  }

  return result;
}

export function policyInput(value: unknown): LeadPolicy {
  const b = object(value);
  for (const k of Object.keys(b)) if (!(k in DEFAULT_POLICY)) fail(`Unknown policy setting: ${k}`);
  const p = { ...DEFAULT_POLICY, ...b } as LeadPolicy;
  if (typeof p.enabled !== "boolean" || typeof p.subscription_limits_enabled !== "boolean")
    fail("Policy flags must be booleans");
  for (const key of Object.keys(DEFAULT_POLICY) as Array<keyof LeadPolicy>) {
    if (typeof DEFAULT_POLICY[key] === "number")
      integer(
        p[key],
        key,
        key === "min_fit_score" ? 0 : 1,
        key === "min_fit_score" ? 100 : key === "scheduling_weight" ? 10 : key === "daily_tokens" ? 10_000_000 : 1_000_000,
      );
  }
  if (
    p.max_active_tasks > 100 ||
    p.max_categories > 20 ||
    p.max_rounds > 10 ||
    p.max_candidates > 1000 ||
    p.max_target_count > 1000 ||
    p.run_deadline_seconds > 86400
  )
    fail("Policy exceeds technical safety ceilings");
  return p;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function key(value: unknown): string {
  return text(value, "Idempotency-Key", 128);
}
