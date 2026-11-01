import { createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { createProtectedWorkspaceProxyChain } from "../../lib/protected-workspace-proxy.js";
import type { GatewayHttpContext } from "../context.js";

export const createAgentProxyRoutes: RouteModule<GatewayHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const chain = createProtectedWorkspaceProxyChain(ctx, ctx.config.agentUrl);

  router.post("/v1/workspaces/:workspaceId/agents", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/catalog", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/archive-batch", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/:agentId", ...chain);
  router.patch("/v1/workspaces/:workspaceId/agents/:agentId", ...chain);
  router.delete("/v1/workspaces/:workspaceId/agents/:agentId", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/archive", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/canary", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/schedule-release", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/:agentId/environments", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/:agentId/release-readiness", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/:agentId/graph", ...chain);
  router.put("/v1/workspaces/:workspaceId/agents/:agentId/graph", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/validate-graph", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/ai-edit", ...chain);

  router.post("/v1/workspaces/:workspaceId/agents/:agentId/publish", ...chain);
  router.post("/v1/workspaces/:workspaceId/agents/:agentId/rollback", ...chain);
  router.get("/v1/workspaces/:workspaceId/agents/:agentId/versions", ...chain);
  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/versions/:leftId/diff/:rightId",
    ...chain,
  );
  router.get("/v1/workspaces/:workspaceId/agents/:agentId/versions/:versionId", ...chain);

  router.get("/v1/workspaces/:workspaceId/custom-tools", ...chain);
  router.post("/v1/workspaces/:workspaceId/custom-tools", ...chain);
  router.get("/v1/workspaces/:workspaceId/custom-tools/:toolId", ...chain);
  router.patch("/v1/workspaces/:workspaceId/custom-tools/:toolId", ...chain);
  router.delete("/v1/workspaces/:workspaceId/custom-tools/:toolId", ...chain);

  return router;
};
