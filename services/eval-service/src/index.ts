import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createLogger } from "@quickstart/logging";
import { initTracing, shutdownTracing, recordPoolStats } from "@quickstart/tracing";
import {
  createCachedWorkspaceAccessClient,
  createHttpWorkspaceAccessClient,
} from "@quickstart/workspace-access";
import { createRedisClient } from "@quickstart/utilities";
import { RuntimeEvalClient } from "./clients/runtime.client.js";
import { loadEvalConfig } from "./config/environment.js";
import { createAuthMiddleware } from "./middleware/auth.middleware.js";
import { requireTenantContext } from "./middleware/tenant.middleware.js";
import { EvalRepository } from "./repository/eval.repository.js";
import { EvalService } from "./services/eval.service.js";
import { EvalWorker } from "./services/eval.worker.js";
import { createHttpServer, SERVICE_NAME } from "./http/create-server.js";

export async function startEvalServer(): Promise<{
  server: Server;
  shutdown: () => Promise<void>;
}> {
  const config = loadEvalConfig();
  const logger = createLogger({ service: SERVICE_NAME });
  await initTracing({ serviceName: SERVICE_NAME });

  const pool = new Pool({ connectionString: config.databaseUrl });
  const poolMetrics = setInterval(() => recordPoolStats("eval", pool.totalCount, pool.idleCount, pool.waitingCount), 10_000);
  poolMetrics.unref();
  const repo = new EvalRepository(pool);
  const runtime = new RuntimeEvalClient(
    config.runtimeUrl,
    config.runtimeInternalToken,
    config.httpRequestTimeoutMs,
  );
  const evals = new EvalService(repo, runtime, {
    maxCasesPerRun: config.maxCasesPerRun,
    maxRunsPerWorkspacePerDay: config.maxRunsPerWorkspacePerDay,
    caseTimeoutMs: config.caseTimeoutMs,
    openaiApiKey: config.openaiApiKey,
    embeddingProvider: config.embeddingProvider,
  });

  const redisClient = createRedisClient(config.redisUrl);
  await redisClient.connect();

  const workspaceAccess = createCachedWorkspaceAccessClient({
    redis: redisClient,
    inner: createHttpWorkspaceAccessClient(config.workspaceUrl, config.httpRequestTimeoutMs),
    ttlSec: config.membershipCacheTtlSec,
    negativeTtlSec: config.membershipCacheNegativeTtlSec,
    onCacheDegraded: (detail) => logger.warn("membership.cache_degraded", { detail }),
  });

  const worker = new EvalWorker(repo, evals, logger, {
    workerId: config.workerId,
    pollIntervalMs: config.workerPollIntervalMs,
  });
  worker.start();

  const app = createHttpServer({
    logger,
    requestTimeoutMs: config.httpRequestTimeoutMs,
    readinessProbes: [
      async () => {
        await pool.query("SELECT 1");
      },
      async () => {
        await redisClient.ping();
      },
    ],
    authGuard: createAuthMiddleware(config.jwtAccessSecret),
    tenantGuard: requireTenantContext(),
    workspaceAccess,
    evals,
  });

  const server: Server = await new Promise((resolve) => {
    const httpServer = app.listen(config.port, "0.0.0.0", () => resolve(httpServer));
  });
  logger.info("listening", { port: config.port, service: SERVICE_NAME });

  const shutdown = async () => {
    await worker.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    clearInterval(poolMetrics);
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    await shutdownTracing();
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

  return { server, shutdown };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  void startEvalServer();
}
