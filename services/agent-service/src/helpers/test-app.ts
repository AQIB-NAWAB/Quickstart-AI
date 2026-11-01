import type { Server } from "node:http";
import { signAccessToken } from "@quickstart/auth";
import type { WorkspaceRole } from "@quickstart/contracts";
import { createLogger } from "@quickstart/logging";
import type { ServiceConfig } from "../config/environment.js";
import { createHttpServer } from "../http/create-server.js";
import type { WorkspaceAccessClient } from "../lib/workspace-access-client.js";
import { MemoryAgentStore } from "../repository/memory.js";
import { MemoryCustomToolStore } from "../repository/memory-custom-tools.js";
import { AgentsService } from "../services/agents.service.js";
import { CustomToolsService } from "../services/custom-tools.service.js";
import type { SecretReadinessClient } from "../clients/secrets-readiness.client.js";
import type { AgentModelGateway } from "../clients/model-gateway.client.js";

export function testServiceConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    port: 0,
    databaseUrl: "postgresql://unused",
    redisUrl: "redis://unused",
    jwtAccessSecret: "test-secret-at-least-32-characters-long!!",
    internalToken: "test-internal-token-at-least-32-chars!!",
    secretsUrl: "http://127.0.0.1:9",
    workspaceUrl: "http://127.0.0.1:9",
    httpRequestTimeoutMs: 5_000,
    httpRateLimitWindowMs: 60_000,
    httpRateLimitMax: 10_000,
    membershipCacheTtlSec: 60,
    membershipCacheNegativeTtlSec: 30,
    modelGatewayUrl: "http://127.0.0.1:9",
    modelGatewayInternalToken: "test-internal-token-at-least-32-chars!!",
    ...overrides,
  };
}

export function createMockWorkspaceAccess(role: WorkspaceRole): WorkspaceAccessClient {
  return {
    async resolveRole() {
      return role;
    },
  };
}

export async function createTestToken(
  userId: string,
  orgId: string = "00000000-0000-0000-0000-000000000001",
  jwtSecret: string = "test-secret-at-least-32-characters-long!!",
): Promise<string> {
  return signAccessToken(
    { sub: userId, org_id: orgId, sid: "session-test" },
    { secret: jwtSecret, ttlSeconds: 3600 },
  );
}

export async function withAgentServer(
  run: (ctx: {
    port: number;
    store: MemoryAgentStore;
    jwtSecret: string;
    createToken: (userId: string, orgId?: string) => Promise<string>;
  }) => Promise<void>,
  options?: {
    role?: WorkspaceRole;
    store?: MemoryAgentStore;
    secrets?: SecretReadinessClient;
    modelGateway?: AgentModelGateway;
  },
): Promise<void> {
  const store = options?.store ?? new MemoryAgentStore();
  const config = testServiceConfig();
  const agents = new AgentsService(store, options?.secrets, options?.modelGateway);
  const customTools = new CustomToolsService(new MemoryCustomToolStore());
  const workspaceAccess = createMockWorkspaceAccess(options?.role ?? "developer");

  const app = createHttpServer({
    agents,
    customTools,
    jwtSecret: config.jwtAccessSecret,
    internalToken: config.internalToken,
    workspaceAccess,
    logger: createLogger({ service: "service-agent-test" }),
  });

  const server = await new Promise<Server>((resolve) => {
    const httpServer = app.listen(0, () => resolve(httpServer));
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected bound port");
    }
    await run({
      port: address.port,
      store,
      jwtSecret: config.jwtAccessSecret,
      createToken: (userId, orgId) => createTestToken(userId, orgId, config.jwtAccessSecret),
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  }
}
