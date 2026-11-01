export type ServiceConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  internalToken: string;
  modelGatewayUrl: string;
  modelGatewayInternalToken: string;
  secretsUrl: string;
  workspaceUrl: string;
  httpRequestTimeoutMs: number;
  httpRateLimitWindowMs: number;
  httpRateLimitMax: number;
  membershipCacheTtlSec: number;
  membershipCacheNegativeTtlSec: number;
};

export function loadServiceConfig(): ServiceConfig {
  const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be set and at least 32 characters");
  }

  const internalToken = process.env.AGENT_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN;
  if (!internalToken || internalToken.length < 32) {
    throw new Error("AGENT_INTERNAL_TOKEN must be set and at least 32 characters");
  }

  return {
    port: Number(process.env.PORT ?? process.env.AGENT_PORT ?? 3003),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    jwtAccessSecret,
    internalToken,
    modelGatewayUrl: (process.env.MODEL_GATEWAY_URL ?? "http://127.0.0.1:3005").replace(/\/$/, ""),
    modelGatewayInternalToken:
      process.env.MODEL_GATEWAY_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN ?? internalToken,
    secretsUrl: (process.env.SECRETS_URL ?? "http://127.0.0.1:3011").replace(/\/$/, ""),
    workspaceUrl: (process.env.WORKSPACE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, ""),
    httpRequestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 30_000),
    httpRateLimitWindowMs: Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? 60_000),
    httpRateLimitMax: Number(process.env.HTTP_RATE_LIMIT_MAX ?? 120),
    membershipCacheTtlSec: Number(process.env.MEMBERSHIP_CACHE_TTL_SEC ?? 60),
    membershipCacheNegativeTtlSec: Number(process.env.MEMBERSHIP_CACHE_NEGATIVE_TTL_SEC ?? 30),
  };
}
