export type AcquisitionDriverKind = "fake" | "direct_http" | "olostep" | "firecrawl" | "apify";

export type AcquisitionProviderProfileConfig = {
  id: string;
  driver: AcquisitionDriverKind;
  enabled: boolean;
  priority: number;
  unitCostMicrosScrape: number;
  unitCostMicrosSearch: number;
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
};

export type WebFetchConfig = {
  port: number;
  redisUrl: string;
  databaseUrl: string;
  internalToken: string;
  maxInflight: number;
  scrapeTimeoutMs: number;
  dailyUnitsPerWorkspace: number;
  crawlMaxPagesCap: number;
  crawlMaxDepthCap: number;
  artifactMaxBytes: number;
  searchMaxResultsCap: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  httpRateLimitWindowMs: number;
  httpRateLimitMax: number;
  olostepApiKey?: string;
  olostepBaseUrl: string;
  firecrawlApiKey?: string;
  directHttpMaxBytes: number;
  providerProfiles: AcquisitionProviderProfileConfig[];
  workerPollMs: number;
  /** Fire-and-forget ledger ingest (Feature 26). */
  usageUrl: string;
  usageInternalToken: string;
};

function requireToken(): string {
  const token =
    process.env.WEB_FETCH_INTERNAL_TOKEN ?? process.env.WEB_ACQUISITION_INTERNAL_TOKEN;
  if (!token || token.length < 32) {
    throw new Error("WEB_FETCH_INTERNAL_TOKEN must be set and at least 32 characters");
  }
  return token;
}

function resolveApiKey(profile: { apiKey?: string; apiKeyEnv?: string }): string | undefined {
  if (profile.apiKey) return profile.apiKey;
  if (profile.apiKeyEnv) {
    return process.env[profile.apiKeyEnv];
  }
  return undefined;
}

function loadProfilesFromJson(): AcquisitionProviderProfileConfig[] | null {
  const raw = process.env.ACQUISITION_PROVIDER_PROFILES_JSON;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as AcquisitionProviderProfileConfig[];
  return parsed.map((p) => ({
    ...p,
    apiKey: resolveApiKey(p),
  }));
}

function defaultProfiles(olostepKey?: string, firecrawlKey?: string): AcquisitionProviderProfileConfig[] {
  const hasBrowserKey = Boolean(olostepKey || firecrawlKey);
  const profiles: AcquisitionProviderProfileConfig[] = [
    {
      id: "fake",
      driver: "fake",
      enabled: true,
      priority: 0,
      unitCostMicrosScrape: 0,
      unitCostMicrosSearch: 0,
    },
    {
      id: "direct_http",
      driver: "direct_http",
      enabled: true,
      priority: hasBrowserKey ? 50 : 10,
      unitCostMicrosScrape: 10,
      unitCostMicrosSearch: 0,
    },
  ];

  if (firecrawlKey) {
    profiles.push({
      id: "firecrawl",
      driver: "firecrawl",
      enabled: true,
      priority: 10,
      unitCostMicrosScrape: 500,
      unitCostMicrosSearch: 800,
      apiKey: firecrawlKey,
      baseUrl: process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev",
    });
  }

  if (olostepKey) {
    profiles.push({
      id: "olostep",
      driver: "olostep",
      enabled: true,
      priority: 20,
      unitCostMicrosScrape: 500,
      unitCostMicrosSearch: 800,
      apiKey: olostepKey,
      baseUrl: process.env.OLOSTEP_BASE_URL ?? "https://api.olostep.com",
    });
  }

  return profiles;
}

/** A custom profile JSON must not drop Firecrawl or Olostep when those keys are set. */
function mergeKeyedProviders(
  profiles: AcquisitionProviderProfileConfig[],
  olostepKey?: string,
  firecrawlKey?: string,
  apifyKey?: string,
): AcquisitionProviderProfileConfig[] {
  const out = [...profiles];
  const has = (driver: string) => out.some((p) => p.driver === driver && p.enabled !== false);
  if (olostepKey && !has("olostep")) {
    out.push({
      id: "olostep",
      driver: "olostep",
      enabled: true,
      priority: 5,
      unitCostMicrosScrape: 500,
      unitCostMicrosSearch: 800,
      apiKey: olostepKey,
      baseUrl: process.env.OLOSTEP_BASE_URL ?? "https://api.olostep.com",
    });
  }
  if (firecrawlKey && !has("firecrawl")) {
    out.push({
      id: "firecrawl",
      driver: "firecrawl",
      enabled: true,
      priority: 15,
      unitCostMicrosScrape: 500,
      unitCostMicrosSearch: 800,
      apiKey: firecrawlKey,
      baseUrl: process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev",
    });
  }
  if (apifyKey && !has("apify")) {
    out.push({
      id: "apify",
      driver: "apify",
      enabled: true,
      priority: 90,
      unitCostMicrosScrape: 500,
      unitCostMicrosSearch: 0,
      apiKey: apifyKey,
      baseUrl: process.env.APIFY_BASE_URL ?? "https://api.apify.com",
    });
  }
  return out;
}

export function loadWebFetchConfig(): WebFetchConfig {
  const apifyApiKey = process.env.APIFY_TOKEN ?? process.env.APIFY_API_KEY;
  const olostepApiKey = process.env.OLOSTEP_API_KEY;
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
  const fromJson = loadProfilesFromJson();
  const providerProfiles = mergeKeyedProviders(
    fromJson ?? defaultProfiles(olostepApiKey, firecrawlApiKey),
    olostepApiKey,
    firecrawlApiKey,
    apifyApiKey,
  );
  const internalToken = requireToken();

  return {
    port: Number(
      process.env.PORT ?? process.env.WEB_FETCH_PORT ?? process.env.WEB_ACQUISITION_PORT ?? 3007,
    ),
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
    internalToken,
    maxInflight: Number(process.env.ACQUISITION_MAX_INFLIGHT ?? 200),
    scrapeTimeoutMs: Number(process.env.ACQUISITION_SCRAPE_TIMEOUT_MS ?? 30_000),
    dailyUnitsPerWorkspace: Number(process.env.ACQUISITION_DAILY_UNITS_PER_WORKSPACE ?? 10_000),
    crawlMaxPagesCap: Number(process.env.ACQUISITION_CRAWL_MAX_PAGES_CAP ?? 50),
    crawlMaxDepthCap: Number(process.env.ACQUISITION_CRAWL_MAX_DEPTH_CAP ?? 3),
    artifactMaxBytes: Number(process.env.ACQUISITION_ARTIFACT_MAX_BYTES ?? 2_097_152),
    searchMaxResultsCap: Number(process.env.ACQUISITION_SEARCH_MAX_RESULTS_CAP ?? 5),
    circuitFailureThreshold: Number(process.env.ACQUISITION_CIRCUIT_FAILURE_THRESHOLD ?? 5),
    circuitCooldownMs: Number(process.env.ACQUISITION_CIRCUIT_COOLDOWN_MS ?? 30_000),
    httpRateLimitWindowMs: Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? 60_000),
    httpRateLimitMax: Number(process.env.HTTP_RATE_LIMIT_MAX ?? 120),
    olostepApiKey,
    olostepBaseUrl: process.env.OLOSTEP_BASE_URL ?? "https://api.olostep.com",
    firecrawlApiKey,
    directHttpMaxBytes: Number(process.env.ACQUISITION_DIRECT_HTTP_MAX_BYTES ?? 1_048_576),
    providerProfiles,
    workerPollMs: Number(process.env.ACQUISITION_WORKER_POLL_MS ?? 500),
    usageUrl: (process.env.USAGE_URL ?? process.env.USAGE_SERVICE_URL ?? "http://127.0.0.1:3017").replace(
      /\/$/,
      "",
    ),
    usageInternalToken:
      process.env.USAGE_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? internalToken,
  };
}
