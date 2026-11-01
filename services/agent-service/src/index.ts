import "reflect-metadata";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import type { DataSource } from "typeorm";
import { createLogger } from "@quickstart/logging";
import { initTracing, shutdownTracing } from "@quickstart/tracing";
import { createRedisClient } from "@quickstart/utilities";
import { loadServiceConfig } from "./config/environment.js";
import { createHttpServer, SERVICE_NAME } from "./http/create-server.js";
import {
  createCachedWorkspaceAccessClient,
  createHttpWorkspaceAccessClient,
} from "@quickstart/workspace-access";
import { createAgentDataSource } from "./repository/typeorm/data-source.js";
import { createTypeOrmAgentStore } from "./repository/typeorm/agent-typeorm-store.js";
import { createTypeOrmCustomToolStore } from "./repository/typeorm/custom-tool-typeorm-store.js";
import { AgentsService } from "./services/agents.service.js";
import { CustomToolsService } from "./services/custom-tools.service.js";
import { createSecretsReadinessClient } from "./clients/secrets-readiness.client.js";
import { ModelGatewayClient } from "./clients/model-gateway.client.js";

export async function startAgentServer(): Promise<{
  server: Server;
  shutdown: () => Promise<void>;
  dataSource: DataSource;
}> {
  const config = loadServiceConfig();
  const logger = createLogger({ service: SERVICE_NAME });

  await initTracing({ serviceName: SERVICE_NAME });

  const dataSource = createAgentDataSource(config.databaseUrl);
  await dataSource.initialize();
  const store = createTypeOrmAgentStore(dataSource);
  const modelGateway = new ModelGatewayClient(
    config.modelGatewayUrl,
    config.modelGatewayInternalToken,
    config.httpRequestTimeoutMs,
  );
  const agents = new AgentsService(
    store,
    createSecretsReadinessClient({
      baseUrl: config.secretsUrl,
      internalToken: config.internalToken,
      timeoutMs: config.httpRequestTimeoutMs,
    }),
    modelGateway,
  );
  const customTools = new CustomToolsService(createTypeOrmCustomToolStore(dataSource));

  const redisClient = createRedisClient(config.redisUrl);
  try {
    await redisClient.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new Error(
      `Valkey/Redis connection failed. Start the data plane: make up. Detail: ${message}`,
    );
  }
  logger.info("redis.connected", { url: config.redisUrl.replace(/:[^:@/]+@/, ":***@") });

  const workspaceAccess = createCachedWorkspaceAccessClient({
    redis: redisClient,
    inner: createHttpWorkspaceAccessClient(config.workspaceUrl, config.httpRequestTimeoutMs),
    ttlSec: config.membershipCacheTtlSec,
    negativeTtlSec: config.membershipCacheNegativeTtlSec,
    onCacheDegraded: (detail) => logger.warn("membership.cache_degraded", { detail }),
  });

  const readinessProbes = [
    async () => {
      await dataSource.query("SELECT 1");
    },
    async () => {
      await redisClient.ping();
    },
  ];

  const app = createHttpServer({
    logger,
    agents,
    customTools,
    jwtSecret: config.jwtAccessSecret,
    internalToken: config.internalToken,
    workspaceAccess,
    requestTimeoutMs: config.httpRequestTimeoutMs,
    rateLimitWindowMs: config.httpRateLimitWindowMs,
    rateLimitMax: config.httpRateLimitMax,
    readinessProbes,
  });

  const server: Server = await new Promise((resolve) => {
    const httpServer = app.listen(config.port, "0.0.0.0", () => resolve(httpServer));
  });

  logger.info("listening", { port: config.port, service: SERVICE_NAME });

  const scheduleTimer = setInterval(() => {
    void agents.applyDueSchedules().catch((error) =>
      logger.warn("scheduled_release.apply_failed", {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }, 15_000);

  const shutdown = async () => {
    logger.info("shutdown", { service: SERVICE_NAME });
    clearInterval(scheduleTimer);
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await shutdownTracing();
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  return { server, shutdown, dataSource };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  void startAgentServer();
}
