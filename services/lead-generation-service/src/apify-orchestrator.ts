import { AppError, ErrorCode } from "@quickstart/errors";
import type { LeadContactPoint, LeadEvidence, LeadEntityType } from "@quickstart/contracts";
import { normalizeWebsite } from "./domain.js";
import { validateEmail, validatePhone } from "./contact-validation.js";

export type ApifyRecipeKind =
  | "google_places"
  | "instagram"
  | "youtube"
  | "linkedin"
  | "custom";

export interface ApifyRecipeConfig {
  kind: ApifyRecipeKind;
  actorId: string;
  defaultInput?: Record<string, unknown>;
  fieldMapping?: Record<string, string>;
}

export const KNOWN_APIFY_RECIPES: Record<ApifyRecipeKind, ApifyRecipeConfig> = {
  google_places: {
    kind: "google_places",
    actorId: "compass~crawler-google-places",
    defaultInput: {
      maxCrawledPlacesPerSearch: 20,
      language: "en",
    },
  },
  instagram: {
    kind: "instagram",
    actorId: "apify~instagram-scraper",
    defaultInput: {
      resultsLimit: 20,
      searchType: "user",
    },
  },
  youtube: {
    kind: "youtube",
    actorId: "streamers~youtube-scraper",
    defaultInput: {
      maxResults: 20,
    },
  },
  linkedin: {
    kind: "linkedin",
    actorId: "dev_fusion~linkedin-profile-scraper",
    defaultInput: {
      maxItems: 20,
    },
  },
  custom: {
    kind: "custom",
    actorId: "",
  },
};

export interface CanonicalScrapedCandidate {
  company_name: string;
  website?: string | null;
  person_name?: string | null;
  person_role?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  category: string;
  source_url?: string;
  external_record_id?: string;
  entity_type: LeadEntityType;
  contact_points: LeadContactPoint[];
  evidence: LeadEvidence[];
  raw_item: Record<string, unknown>;
}

export interface ApifyOrchestratorOptions {
  secretsUrl?: string;
  internalToken?: string;
  apiBaseUrl?: string;
  mockDriver?: boolean;
}

export class ApifyActorOrchestrator {
  private readonly secretsUrl: string;
  private readonly internalToken: string;
  private readonly apiBaseUrl: string;
  private readonly mockDriver: boolean;

  // Mock test registry to allow deterministic unit/integration testing
  private static mockRuns = new Map<
    string,
    { status: string; datasetId: string; items: Record<string, unknown>[] }
  >();

  constructor(options: ApifyOrchestratorOptions = {}) {
    this.secretsUrl = (options.secretsUrl ?? process.env.SECRETS_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");
    this.internalToken = options.internalToken ?? process.env.SECRETS_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? "";
    this.apiBaseUrl = (options.apiBaseUrl ?? process.env.APIFY_BASE_URL ?? "https://api.apify.com").replace(/\/$/, "");
    this.mockDriver = options.mockDriver ?? false;
  }

  static registerMockDataset(
    _actorId: string,
    items: Record<string, unknown>[],
    status: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  ): string {
    const runId = `mock_run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const datasetId = `mock_ds_${runId}`;
    ApifyActorOrchestrator.mockRuns.set(runId, { status, datasetId, items });
    return runId;
  }

  /**
   * Strictly resolves customer-provided BYO token for the workspace.
   * NEVER uses developer or platform credentials.
   */
  async resolveCustomerToken(workspaceId: string): Promise<string> {
    if (this.mockDriver) {
      return "mock-customer-apify-token";
    }

    try {
      const url = `${this.secretsUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/secrets/integration_apify_credentials/value`;
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${this.internalToken}`,
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "APIFY_CONNECTION_REQUIRED: Apify integration is not connected for this workspace. Please connect Apify in workspace settings.",
        });
      }

      const body = (await res.json()) as { value?: string };
      if (!body.value) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "APIFY_CONNECTION_REQUIRED: Apify credentials missing in workspace vault.",
        });
      }

      const parsed = JSON.parse(body.value);
      const token = (parsed.apiToken || parsed.token || parsed.apiKey || parsed.api_token || "").trim();

      if (!token) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "APIFY_CONNECTION_REQUIRED: Apify API token not found in connected credentials.",
        });
      }

      return token;
    } catch (e: any) {
      if (e instanceof AppError) throw e;
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: `APIFY_CONNECTION_REQUIRED: Unable to verify workspace Apify integration (${e.message || "service unreachable"}).`,
      });
    }
  }

  /**
   * Build input for known recipes or generic custom actor.
   */
  buildActorInput(
    recipe: ApifyRecipeKind,
    params: {
      query: string;
      location?: string;
      limit?: number;
      actorId?: string;
      customInput?: Record<string, unknown>;
    },
  ): { actorId: string; input: Record<string, unknown> } {
    const limit = Math.min(params.limit ?? 25, 200);

    switch (recipe) {
      case "google_places":
        return {
          actorId: KNOWN_APIFY_RECIPES.google_places.actorId,
          input: {
            ...KNOWN_APIFY_RECIPES.google_places.defaultInput,
            searchStringsArray: [params.location ? `${params.query} in ${params.location}` : params.query],
            locationQuery: params.location || undefined,
            maxCrawledPlacesPerSearch: limit,
          },
        };
      case "instagram":
        return {
          actorId: KNOWN_APIFY_RECIPES.instagram.actorId,
          input: {
            ...KNOWN_APIFY_RECIPES.instagram.defaultInput,
            search: params.query,
            resultsLimit: limit,
          },
        };
      case "youtube":
        return {
          actorId: KNOWN_APIFY_RECIPES.youtube.actorId,
          input: {
            ...KNOWN_APIFY_RECIPES.youtube.defaultInput,
            searchKeywords: params.query,
            maxResults: limit,
          },
        };
      case "linkedin":
        return {
          actorId: KNOWN_APIFY_RECIPES.linkedin.actorId,
          input: {
            ...KNOWN_APIFY_RECIPES.linkedin.defaultInput,
            searchQueries: [params.query],
            locations: params.location ? [params.location] : undefined,
            maxItems: limit,
          },
        };
      case "custom":
        if (!params.actorId) {
          throw new AppError({
            code: ErrorCode.VALIDATION_FAILED,
            message: "Custom recipe requires a valid actorId.",
          });
        }
        return {
          actorId: params.actorId,
          input: params.customInput || {},
        };
    }
  }

  /**
   * Starts an asynchronous Apify Actor run.
   */
  async startActorRun(
    token: string,
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<{ runId: string; datasetId: string; status: string }> {
    if (this.mockDriver) {
      const runId = ApifyActorOrchestrator.registerMockDataset(actorId, [
        {
          title: "Mock Business from Actor",
          website: "https://mockbusiness.example",
          phone: "+14155550188",
          address: "San Francisco, CA",
          categoryName: "Technology",
        },
      ]);
      const mock = ApifyActorOrchestrator.mockRuns.get(runId)!;
      return { runId, datasetId: mock.datasetId, status: "READY" };
    }

    const encodedActorId = encodeURIComponent(actorId);
    const url = `${this.apiBaseUrl}/v2/acts/${encodedActorId}/runs?timeout=180`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `Apify start run failed (HTTP ${res.status}): ${errText.slice(0, 200)}`,
        details: { upstream_status: res.status, creation_rejected: true },
      });
    }

    const json = (await res.json()) as { data?: { id?: string; defaultDatasetId?: string; status?: string } };
    const data = json.data || {};
    if (!data.id || !data.defaultDatasetId) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Apify returned an invalid run creation response.",
      });
    }

    return {
      runId: data.id,
      datasetId: data.defaultDatasetId,
      status: data.status || "READY",
    };
  }

  async getActorRun(token: string, runId: string): Promise<{ status: string; datasetId?: string }> {
    if (this.mockDriver) {
      const run = ApifyActorOrchestrator.mockRuns.get(runId);
      if (!run) throw new Error("APIFY_RUN_NOT_FOUND");
      return { status: run.status, datasetId: run.datasetId };
    }
    const response = await fetch(`${this.apiBaseUrl}/v2/actor-runs/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok) throw new Error(`APIFY_STATUS_HTTP_${response.status}`);
    const body = await response.json() as { data?: { status?: string; defaultDatasetId?: string } };
    if (!body.data?.status) throw new Error("APIFY_INVALID_STATUS");
    return { status: body.data.status, datasetId: body.data.defaultDatasetId };
  }

  /**
   * Polls run status with bounded exponential backoff until terminal state.
   */
  async pollActorRun(
    token: string,
    runId: string,
    options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
  ): Promise<{ status: string; datasetId?: string }> {
    if (this.mockDriver) {
      const mock = ApifyActorOrchestrator.mockRuns.get(runId);
      return { status: mock?.status || "SUCCEEDED", datasetId: mock?.datasetId };
    }

    const maxWaitMs = options.maxWaitMs ?? 180000; // 3 minutes max
    const startTime = Date.now();
    let delay = options.pollIntervalMs ?? 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const url = `${this.apiBaseUrl}/v2/actor-runs/${encodeURIComponent(runId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: `Apify poll run failed (HTTP ${res.status}): ${errText.slice(0, 200)}`,
        });
      }

      const json = (await res.json()) as { data?: { status?: string; defaultDatasetId?: string } };
      const data = json.data || {};
      const status = data.status || "RUNNING";

      if (status === "SUCCEEDED") {
        return { status, datasetId: data.defaultDatasetId };
      }

      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: `Apify run ended with terminal failure status: ${status}`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 5000);
    }

    throw new AppError({
      code: ErrorCode.RATE_LIMITED,
      message: `Apify run ${runId} timed out waiting for completion.`,
    });
  }

  /**
   * Fetches paginated items from an Apify dataset with checkpoint offset support.
   */
  async fetchDatasetItemsPaged(
    token: string,
    datasetId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: Record<string, unknown>[]; offset: number; total: number }> {
    if (this.mockDriver) {
      for (const [, run] of ApifyActorOrchestrator.mockRuns) {
        if (run.datasetId === datasetId) {
          const slice = run.items.slice(offset, offset + limit);
          return { items: slice, offset, total: run.items.length };
        }
      }
      return { items: [], offset, total: 0 };
    }

    const url = `${this.apiBaseUrl}/v2/datasets/${encodeURIComponent(datasetId)}/items?offset=${offset}&limit=${limit}&clean=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `Apify dataset fetch failed (HTTP ${res.status}): ${errText.slice(0, 200)}`,
      });
    }

    const totalCount = Number(res.headers.get("x-apify-pagination-total") ?? 0);
    const items = (await res.json()) as Record<string, unknown>[];

    return {
      items: Array.isArray(items) ? items : [],
      offset,
      total: totalCount || items.length,
    };
  }

  /**
   * Aborts an active Apify Actor run cleanly.
   */
  async abortActorRun(token: string, runId: string): Promise<boolean> {
    if (this.mockDriver) {
      const mock = ApifyActorOrchestrator.mockRuns.get(runId);
      if (mock) mock.status = "ABORTED";
      return true;
    }

    try {
      const url = `${this.apiBaseUrl}/v2/actor-runs/${encodeURIComponent(runId)}/abort`;
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes raw Apify output records into canonical candidate leads.
   */
  async normalizeCandidate(
    raw: Record<string, unknown>,
    recipe: ApifyRecipeKind,
    fallbackCategory: string,
    fieldMapping?: Record<string, string>,
  ): Promise<CanonicalScrapedCandidate> {
    // Apply user-defined field overrides if configured
    const r: Record<string, unknown> = { ...raw };
    if (fieldMapping) {
      for (const [targetField, sourceField] of Object.entries(fieldMapping)) {
        if (raw[sourceField] !== undefined) {
          r[targetField] = raw[sourceField];
        }
      }
    }

    let companyName = "";
    let website: string | null = null;
    let personName: string | null = null;
    let personRole: string | null = null;
    let email: string | null = null;
    let phone: string | null = null;
    let location: string | null = null;
    let category = fallbackCategory;
    let sourceUrl = "";
    let externalId = "";
    let entityType: LeadEntityType = "business";

    switch (recipe) {
      case "google_places": {
        companyName = String(r.title || r.name || r.company_name || "").trim();
        website = r.website ? String(r.website).trim() : null;
        phone = r.phone || r.phoneUnformatted ? String(r.phone || r.phoneUnformatted).trim() : null;
        location = r.address || r.city ? String(r.address || r.city).trim() : null;
        category = String(r.categoryName || r.category || fallbackCategory).trim();
        sourceUrl = r.url ? String(r.url).trim() : "";
        externalId = r.placeId || r.id ? String(r.placeId || r.id).trim() : "";
        entityType = "business";
        break;
      }
      case "instagram": {
        personName = String(r.fullName || r.name || r.username || "").trim();
        companyName = personName;
        website = r.externalUrl ? String(r.externalUrl).trim() : null;
        email = r.businessEmail || r.email ? String(r.businessEmail || r.email).trim() : null;
        phone = r.businessPhoneNumber || r.phone ? String(r.businessPhoneNumber || r.phone).trim() : null;
        sourceUrl = r.url ? String(r.url).trim() : (r.username ? `https://www.instagram.com/${r.username}` : "");
        externalId = r.id ? String(r.id).trim() : "";
        entityType = r.isBusinessAccount ? "business" : "consumer";
        break;
      }
      case "youtube": {
        companyName = String(r.channelTitle || r.title || "").trim();
        personName = companyName;
        website = r.channelUrl ? String(r.channelUrl).trim() : null;
        sourceUrl = r.channelUrl || r.url ? String(r.channelUrl || r.url).trim() : "";
        externalId = r.id || r.channelId ? String(r.id || r.channelId).trim() : "";
        entityType = "professional";
        break;
      }
      case "linkedin": {
        personName = String(r.fullName || `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || r.name || "").trim();
        personRole = String(r.headline || r.jobTitle || r.currentPosition || "").trim() || null;
        companyName = String(r.companyName || r.currentCompany || "").trim();
        location = r.location ? String(r.location).trim() : null;
        sourceUrl = r.profileUrl || r.linkedinUrl || r.url ? String(r.profileUrl || r.linkedinUrl || r.url).trim() : "";
        externalId = r.id || r.publicIdentifier ? String(r.id || r.publicIdentifier).trim() : "";
        entityType = "professional";
        break;
      }
      case "custom": {
        companyName = String(r.company_name || r.company || r.title || r.name || "").trim();
        website = r.website || r.url ? String(r.website || r.url).trim() : null;
        personName = r.person_name || r.name ? String(r.person_name || r.name).trim() : null;
        personRole = r.person_role || r.role || r.job_title ? String(r.person_role || r.role || r.job_title).trim() : null;
        email = r.email || r.contact_email ? String(r.email || r.contact_email).trim() : null;
        phone = r.phone || r.contact_phone ? String(r.phone || r.contact_phone).trim() : null;
        location = r.location || r.address ? String(r.location || r.address).trim() : null;
        category = String(r.category || fallbackCategory).trim();
        sourceUrl = r.source_url || r.url ? String(r.source_url || r.url).trim() : "";
        externalId = r.id || r.external_id ? String(r.id || r.external_id).trim() : "";
        entityType = (["business", "professional", "consumer"].includes(String(r.entity_type))
          ? r.entity_type
          : "business") as LeadEntityType;
        break;
      }
    }

    // Try extracting emails and phones if embedded in text fields
    if (!email && typeof r.text === "string") {
      const match = r.text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (match) email = match[0];
    }

    // Normalize and validate website
    let normalizedSite: string | null = null;
    if (website) {
      try {
        normalizedSite = normalizeWebsite(website.includes("://") ? website : `https://${website}`);
      } catch {
        normalizedSite = null;
      }
    }

    const contactPoints: LeadContactPoint[] = [];
    const evidence: LeadEvidence[] = [];

    if (email) {
      const v = await validateEmail(email);
      contactPoints.push({
        type: "email",
        raw_value: email,
        normalized_value: v.normalized,
        status: v.formatValid ? "format_valid" : "format_invalid",
        observed_at: new Date().toISOString(),
        source_url: sourceUrl || undefined,
      });
      evidence.push({
        field: "email",
        value: v.normalized,
        source_url: sourceUrl || "apify",
        quote: email,
      });
    }

    if (phone) {
      const v = validatePhone(phone, location || undefined);
      contactPoints.push({
        type: "phone",
        raw_value: phone,
        normalized_value: v.normalized || phone,
        status: v.formatValid ? "format_valid" : "format_invalid",
        observed_at: new Date().toISOString(),
        source_url: sourceUrl || undefined,
      });
      evidence.push({
        field: "phone",
        value: v.normalized || phone,
        source_url: sourceUrl || "apify",
        quote: phone,
      });
    }

    if (companyName) {
      evidence.push({
        field: "company_name",
        value: companyName,
        source_url: sourceUrl || "apify",
        quote: companyName,
      });
    }

    if (location) {
      evidence.push({
        field: "location",
        value: location,
        source_url: sourceUrl || "apify",
        quote: location,
      });
    }

    return {
      company_name: companyName || personName || "Unnamed Lead",
      website: normalizedSite,
      person_name: personName,
      person_role: personRole,
      email: email ? email.toLowerCase() : null,
      phone: phone,
      location: location,
      category,
      source_url: sourceUrl,
      external_record_id: externalId,
      entity_type: entityType,
      contact_points: contactPoints,
      evidence: evidence,
      raw_item: raw,
    };
  }
}
