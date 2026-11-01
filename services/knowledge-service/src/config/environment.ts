export type KnowledgeConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwtAccessSecret: string;
  workspaceUrl: string;
  httpRequestTimeoutMs: number;
  membershipCacheTtlSec: number;
  membershipCacheNegativeTtlSec: number;
  opensearchUrl: string;
  opensearchIndex: string;
  sqsEndpoint: string;
  sqsRegion: string;
  sqsQueueName: string;
  internalToken: string;
  embeddingProvider: "fake" | "openai";
  openaiApiKey?: string;
  workerPollMs: number;
  s3Bucket?: string;
  s3Endpoint?: string;
  s3Region: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle: boolean;
};

export function loadKnowledgeConfig(): KnowledgeConfig {
  const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
  if (!jwtAccessSecret || jwtAccessSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be set and at least 32 characters");
  }

  const internalToken = process.env.KNOWLEDGE_INTERNAL_TOKEN ?? process.env.INTERNAL_TOKEN;
  if (!internalToken || internalToken.length < 32) {
    throw new Error("KNOWLEDGE_INTERNAL_TOKEN must be set and at least 32 characters");
  }

  const requestedEmbeddingProvider = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();
  const embeddingProvider: KnowledgeConfig["embeddingProvider"] =
    requestedEmbeddingProvider === "openai" ||
    (!requestedEmbeddingProvider && Boolean(process.env.OPENAI_API_KEY))
      ? "openai"
      : "fake";

  return {
    port: Number(process.env.PORT ?? process.env.KNOWLEDGE_PORT ?? 3009),
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    jwtAccessSecret,
    workspaceUrl: (process.env.WORKSPACE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, ""),
    httpRequestTimeoutMs: Number(process.env.HTTP_REQUEST_TIMEOUT_MS ?? 30_000),
    membershipCacheTtlSec: Number(process.env.MEMBERSHIP_CACHE_TTL_SEC ?? 60),
    membershipCacheNegativeTtlSec: Number(process.env.MEMBERSHIP_CACHE_NEGATIVE_TTL_SEC ?? 30),
    opensearchUrl: (process.env.OPENSEARCH_URL ?? "http://127.0.0.1:9200").replace(/\/$/, ""),
    opensearchIndex: process.env.KNOWLEDGE_OPENSEARCH_INDEX ?? "quickstart-knowledge-chunks",
    sqsEndpoint: (process.env.SQS_ENDPOINT ?? "http://127.0.0.1:9324").replace(/\/$/, ""),
    sqsRegion: process.env.AWS_REGION ?? "us-east-1",
    sqsQueueName: process.env.KNOWLEDGE_INGEST_QUEUE ?? "quickstart-knowledge-ingest",
    internalToken,
    embeddingProvider,
    openaiApiKey: process.env.OPENAI_API_KEY,
    workerPollMs: Number(process.env.KNOWLEDGE_WORKER_POLL_MS ?? 1000),
    s3Bucket: process.env.KNOWLEDGE_S3_BUCKET ?? process.env.S3_BUCKET,
    s3Endpoint: process.env.S3_ENDPOINT?.replace(/\/$/, ""),
    s3Region: process.env.AWS_REGION ?? process.env.S3_REGION ?? "us-east-1",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  };
}
