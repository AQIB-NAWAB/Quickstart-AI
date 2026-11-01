export type ProviderDriverKind =
  | "fake"
  | "openai_compatible"
  | "openrouter"
  | "anthropic";

export type ProviderProfileConfig = {
  id: string;
  driver: ProviderDriverKind;
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultHeaders?: Record<string, string>;
};

export type ModelGatewayConfig = {
  port: number;
  redisUrl: string;
  internalToken: string;
  modelMaxInflight: number;
  completionTimeoutMs: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
  openRouterApiKey?: string;
  jevModel: string;
  openRouterDecisionsUrl: string;
  httpRateLimitWindowMs: number;
  httpRateLimitMax: number;
  providerProfiles: ProviderProfileConfig[];
  /** Fire-and-forget ledger ingest (Feature 26). Empty disables emit. */
  usageUrl: string;
  usageInternalToken: string;
};

function requireToken(): string {
  const token = process.env.MODEL_GATEWAY_INTERNAL_TOKEN;
  if (!token || token.length < 32) {
    throw new Error("MODEL_GATEWAY_INTERNAL_TOKEN must be set and at least 32 characters");
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

function loadProfilesFromJson(): ProviderProfileConfig[] | null {
  const raw = process.env.PROVIDER_PROFILES_JSON;
  if (!raw) return null;
  const parsed = JSON.parse(raw) as ProviderProfileConfig[];
  return parsed.map((p) => ({
    ...p,
    apiKey: resolveApiKey(p),
  }));
}

function defaultProfiles(openRouterKey?: string): ProviderProfileConfig[] {
  const profiles: ProviderProfileConfig[] = [
    { id: "fake", driver: "fake" },
  ];

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    profiles.push({
      id: "openai",
      driver: "openai_compatible",
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: openaiKey,
    });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    profiles.push({
      id: "gemini",
      driver: "openai_compatible",
      baseUrl: process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: geminiKey,
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    profiles.push({
      id: "groq",
      driver: "openai_compatible",
      baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
      apiKey: groqKey,
    });
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    profiles.push({
      id: "deepseek",
      driver: "openai_compatible",
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
      apiKey: deepseekKey,
    });
  }

  const bluemindsKey = process.env.BLUEMINDS_API_KEY ?? process.env.BLUESMINDS_API_KEY;
  if (bluemindsKey) {
    const bluemindsBase =
      process.env.BLUEMINDS_BASE_URL ??
      process.env.BLUESMINDS_BASE_URL ??
      "https://api.bluesminds.com/v1";
    profiles.push({
      id: "blueminds",
      driver: "openai_compatible",
      baseUrl: bluemindsBase,
      apiKey: bluemindsKey,
    });
    profiles.push({
      id: "bluesminds",
      driver: "openai_compatible",
      baseUrl: bluemindsBase,
      apiKey: bluemindsKey,
    });
  }

  if (openRouterKey) {
    profiles.push({
      id: "openrouter",
      driver: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openRouterKey,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://quickstart.local",
        "X-Title": process.env.OPENROUTER_TITLE ?? "QuickStart",
      },
    });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    profiles.push({
      id: "anthropic",
      driver: "anthropic",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      apiKey: anthropicKey,
    });
  }

  return profiles;
}

export function loadModelGatewayConfig(): ModelGatewayConfig {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const fromJson = loadProfilesFromJson();
  const providerProfiles = fromJson ?? defaultProfiles(openRouterApiKey);

  const internalToken = requireToken();
  return {
    port: Number(process.env.PORT ?? process.env.MODEL_GATEWAY_PORT ?? 3005),
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    internalToken,
    modelMaxInflight: Number(process.env.MODEL_MAX_INFLIGHT ?? 500),
    completionTimeoutMs: Number(process.env.MODEL_COMPLETION_TIMEOUT_MS ?? 60_000),
    circuitFailureThreshold: Number(process.env.MODEL_CIRCUIT_FAILURE_THRESHOLD ?? 5),
    circuitCooldownMs: Number(process.env.MODEL_CIRCUIT_COOLDOWN_MS ?? 30_000),
    openRouterApiKey,
    jevModel: process.env.JEV_MODEL ?? "typesafe/jev-1.13",
    openRouterDecisionsUrl:
      process.env.OPENROUTER_DECISIONS_URL ?? "https://openrouter.ai/api/alpha/decisions",
    httpRateLimitWindowMs: Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? 60_000),
    httpRateLimitMax: Number(process.env.HTTP_RATE_LIMIT_MAX ?? 120),
    providerProfiles,
    usageUrl: (process.env.USAGE_URL ?? process.env.USAGE_SERVICE_URL ?? "http://127.0.0.1:3017").replace(
      /\/$/,
      "",
    ),
    usageInternalToken:
      process.env.USAGE_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? internalToken,
  };
}
