export type Config = ReturnType<typeof loadConfig>;
export function loadConfig() {
  const required = (name: string) => {
    const v = process.env[name];
    if (!v || v.length < 32) throw new Error(`${name} must contain at least 32 characters`);
    return v;
  };
  const jwt = required("JWT_ACCESS_SECRET");
  const admin = required("LEAD_GENERATION_ADMIN_TOKEN");
  const live = process.env.LEAD_GENERATION_MODE !== "demo";
  const webToken = live ? required("WEB_FETCH_INTERNAL_TOKEN") : "demo";
  const modelToken = live ? required("MODEL_GATEWAY_INTERNAL_TOKEN") : "demo";
  const modelProfile = process.env.LEAD_MODEL_PROFILE ?? "openai";
  const modelId = process.env.LEAD_MODEL_ID ?? "";
  if (live && (!modelId || modelProfile === "fake"))
    throw new Error("Live mode requires LEAD_MODEL_ID and a real LEAD_MODEL_PROFILE");
  return {
    host: process.env.LEAD_GENERATION_HOST ?? "127.0.0.1",
    port: Number(process.env.LEAD_GENERATION_PORT ?? 3019),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
    workspaceUrl: process.env.WORKSPACE_URL ?? "http://127.0.0.1:3002",
    webUrl: process.env.WEB_FETCH_URL ?? "http://127.0.0.1:3007",
    modelUrl: process.env.MODEL_GATEWAY_URL ?? "http://127.0.0.1:3008",
    leadServiceUrl: (
      process.env.LEAD_SERVICE_URL ??
      process.env.LEAD_URL ??
      "http://127.0.0.1:3014"
    ).replace(/\/$/, ""),
    leadInternalToken:
      process.env.LEAD_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? "",
    jwt,
    admin,
    webToken,
    modelToken,
    live,
    modelProfile,
    modelId,
    campaignUrl: process.env.LEAD_CAMPAIGN_INGEST_URL ?? "",
    campaignToken: process.env.LEAD_CAMPAIGN_TOKEN ?? "",
    pollMs: 1000,
    leaseSeconds: 120,
    requestTimeoutMs: 45000,
    maxOutputTokens: Math.max(1500, Math.min(16000, Number(process.env.LEAD_MODEL_MAX_OUTPUT_TOKENS ?? (modelProfile === "gemini" ? 6000 : 1500)))),
    modelMinIntervalSeconds: Math.max(0, Math.min(300, Number(process.env.LEAD_MODEL_MIN_INTERVAL_SECONDS ?? 45))),
    workersEnabled: process.env.LEAD_WORKERS_ENABLED !== "false",
  };
}
