import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { requireWorkspacePermission } from "../../middleware/require-workspace-permission.middleware.js";
import type { AgentHttpContext } from "../context.js";

export const createAgentsRoutes: RouteModule<AgentHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const { tenantMiddleware, workspaceAccess, agentsCtrl } = ctx;
  const chain = tenantMiddleware;

  router.post(
    "/v1/workspaces/:workspaceId/agents",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_CREATE),
    asyncHandler(agentsCtrl.createAgent),
  );
  router.get(
    "/v1/workspaces/:workspaceId/agents",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.listAgents),
  );
  router.get(
    "/v1/workspaces/:workspaceId/agents/catalog",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getCatalog),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/archive-batch",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_UPDATE),
    asyncHandler(agentsCtrl.archiveAgents),
  );
  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getAgent),
  );
  router.patch(
    "/v1/workspaces/:workspaceId/agents/:agentId",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_UPDATE),
    asyncHandler(agentsCtrl.updateAgent),
  );
  router.delete(
    "/v1/workspaces/:workspaceId/agents/:agentId",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_DELETE),
    asyncHandler(agentsCtrl.deleteAgent),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/archive",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_UPDATE),
    asyncHandler(agentsCtrl.archiveAgent),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/canary",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_PUBLISH),
    asyncHandler(agentsCtrl.setCanary),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/schedule-release",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_PUBLISH),
    asyncHandler(agentsCtrl.scheduleRelease),
  );
  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/environments",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getEnvironmentComparison),
  );
  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/release-readiness",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getReleaseReadiness),
  );

  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/graph",
    ...chain,
    ctx.graphAuthGuard,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getGraph),
  );
  router.put(
    "/v1/workspaces/:workspaceId/agents/:agentId/graph",
    ...chain,
    ctx.graphAuthGuard,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_UPDATE),
    asyncHandler(agentsCtrl.updateGraph),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/validate-graph",
    ...chain,
    ctx.graphAuthGuard,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.validateGraph),
  );
  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/ai-edit",
    ...chain,
    ctx.graphAuthGuard,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_UPDATE),
    asyncHandler(agentsCtrl.proposeAiEdit),
  );

  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/publish",
    ...chain,
    ctx.graphAuthGuard,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_PUBLISH),
    asyncHandler(agentsCtrl.publishAgent),
  );

  router.post(
    "/v1/workspaces/:workspaceId/agents/:agentId/rollback",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_PUBLISH),
    asyncHandler(agentsCtrl.rollbackAgent),
  );

  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/versions",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.listVersions),
  );

  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/versions/:leftId/diff/:rightId",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.diffVersions),
  );

  router.get(
    "/v1/workspaces/:workspaceId/agents/:agentId/versions/:versionId",
    ...chain,
    requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.AGENT_READ),
    asyncHandler(agentsCtrl.getVersion),
  );

  return router;
};
