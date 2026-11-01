import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { requireWidgetInternalTenant } from "../../middleware/widget-internal-tenant.middleware.js";
import type { AgentHttpContext } from "../context.js";

export const createInternalWidgetRoutes: RouteModule<AgentHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const tenant = requireWidgetInternalTenant();
  const { internalAuth, agentsCtrl } = ctx;

  router.get(
    "/internal/workspaces/:workspaceId/widget/agents/:agentId",
    internalAuth,
    tenant,
    asyncHandler(agentsCtrl.getAgent),
  );
  router.get(
    "/internal/workspaces/:workspaceId/widget/agents/:agentId/versions/:versionId",
    internalAuth,
    tenant,
    asyncHandler(agentsCtrl.getVersion),
  );
  router.post(
    "/internal/workspaces/:workspaceId/widget/agents/:agentId/canary",
    internalAuth,
    tenant,
    asyncHandler(agentsCtrl.setCanary),
  );

  return router;
};
