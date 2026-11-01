import { fileURLToPath } from "node:url";
import { createLogger } from "@quickstart/logging";
import { initTracing, shutdownTracing } from "@quickstart/tracing";
import {
  createCachedWorkspaceAccessClient,
  createHttpWorkspaceAccessClient,
} from "@quickstart/workspace-access";
import { createRedisClient } from "@quickstart/utilities";
import { AgentClient } from "./clients/agent.client.js";
import { ConversationClient } from "./clients/conversation.client.js";
import { KnowledgeClient } from "./clients/knowledge.client.js";
import { MemoryClient } from "./clients/memory.client.js";
import { ModelGatewayClient } from "./clients/model-gateway.client.js";
import { SecretsClient } from "./clients/secrets.client.js";
import { ToolCallsClient } from "./clients/tool-calls.client.js";
import { WebFetchClient } from "./clients/web-fetch.client.js";
import { LeadClient } from "./clients/lead.client.js";
import { CalendarClient } from "./clients/calendar.client.js";
import { IntegrationClient } from "./clients/integration.client.js";
import { loadRuntimeConfig } from "./config/environment.js";
import { createHttpServer, SERVICE_NAME } from "./http/create-server.js";
import { McpToolRunner } from "./services/mcp-tool-runner.js";
import { ToolExecutor } from "./services/tool-executor.js";
import { ToolLoop } from "./services/tool-loop.js";
import { TurnsService } from "./services/turns.service.js";
import { GraphNodeRegistry } from "./graph/registry.js";
import { GraphSessionStore } from "./graph/session-store.js";
import { GraphEngine } from "./graph/engine.js";
import { GraphTurnsService } from "./services/graph-turns.service.js";

export { SERVICE_NAME, createHttpServer } from "./http/create-server.js";

export async function main(): Promise<void> {
  await initTracing({ serviceName: SERVICE_NAME });
  const logger = createLogger({ service: SERVICE_NAME });
  const config = loadRuntimeConfig();

  const agentClient = new AgentClient(
    config.agentServiceUrl,
    config.httpRequestTimeoutMs,
    config.internalToken,
  );
  const conversationClient = new ConversationClient(
    config.conversationServiceUrl,
    config.httpRequestTimeoutMs,
    config.internalToken,
  );
  const modelGatewayClient = new ModelGatewayClient(
    config.modelGatewayUrl,
    config.modelGatewayInternalToken,
    config.httpRequestTimeoutMs,
  );

  const knowledgeClient = new KnowledgeClient(
    config.knowledgeServiceUrl,
    config.knowledgeInternalToken,
    config.httpRequestTimeoutMs,
  );
  const memoryClient = new MemoryClient({
    baseUrl: config.memoryServiceUrl,
    internalToken: config.memoryInternalToken,
    timeoutMs: config.httpRequestTimeoutMs,
    logger,
  });
  const toolCallsClient = new ToolCallsClient(
    config.conversationServiceUrl,
    config.httpRequestTimeoutMs,
    config.internalToken,
  );
  const webFetchClient = new WebFetchClient(
    config.webFetchUrl,
    config.webFetchInternalToken,
    config.httpRequestTimeoutMs,
  );
  const secretsClient = new SecretsClient({
    baseUrl: config.secretsServiceUrl,
    internalToken: config.secretsInternalToken,
    timeoutMs: config.httpRequestTimeoutMs,
  });
  const toolExecutor = new ToolExecutor(
    webFetchClient,
    new McpToolRunner(config.httpRequestTimeoutMs),
    secretsClient,
    new LeadClient(
      config.leadServiceUrl,
      config.leadInternalToken,
      config.httpRequestTimeoutMs,
    ),
    new CalendarClient(
      config.workspaceUrl,
      config.workspaceInternalToken,
      config.httpRequestTimeoutMs,
    ),
    new IntegrationClient(
      config.workspaceUrl,
      config.workspaceInternalToken,
      config.httpRequestTimeoutMs,
    ),
  );
  const toolLoop = new ToolLoop(modelGatewayClient, toolCallsClient, toolExecutor);

  const redisClient = createRedisClient(config.redisUrl);
  await redisClient.connect();
  logger.info("redis.connected", { url: config.redisUrl.replace(/:[^:@/]+@/, ":***@") });

  const graphRegistry = new GraphNodeRegistry({
    modelGateway: modelGatewayClient,
    toolExecutor,
    knowledgeClient,
    conversationClient,
    memoryClient,
    agentClient,
    toolLoop,
  });
  const sessionStore = new GraphSessionStore(redisClient);
  const graphEngine = new GraphEngine(graphRegistry, sessionStore);
  const graphTurnsService = new GraphTurnsService(agentClient, graphEngine, sessionStore);

  const turnsService = new TurnsService(
    agentClient,
    conversationClient,
    modelGatewayClient,
    knowledgeClient,
    memoryClient,
    toolLoop,
    graphEngine,
  );

  const workspaceAccess = createCachedWorkspaceAccessClient({
    redis: redisClient,
    inner: createHttpWorkspaceAccessClient(config.workspaceUrl, config.httpRequestTimeoutMs),
    ttlSec: config.membershipCacheTtlSec,
    negativeTtlSec: config.membershipCacheNegativeTtlSec,
    onCacheDegraded: (detail) => logger.warn("membership.cache_degraded", { detail }),
  });

  const app = createHttpServer({
    logger,
    turnsService,
    graphTurnsService,
    workspaceAccess,
    jwtSecret: config.jwtAccessSecret,
    internalToken: config.internalToken,
    requestTimeoutMs: config.httpRequestTimeoutMs,
    rateLimitWindowMs: config.httpRateLimitWindowMs,
    rateLimitMax: config.httpRateLimitMax,
    readinessProbes: [
      async () => {
        await redisClient.ping();
      },
    ],
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const httpServer = app.listen(config.port, "0.0.0.0", () => resolve(httpServer));
  });

  logger.info("runtime service listening", { port: config.port });

  const shutdown = async () => {
    logger.info("shutting down runtime service");
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
    await shutdownTracing();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  void main();
}
