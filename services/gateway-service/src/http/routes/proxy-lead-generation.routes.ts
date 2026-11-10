import { createServiceRouter, asyncHandler, type RouteModule } from "@quickstart/http-server";
import { createProtectedWorkspaceProxyChain } from "../../lib/protected-workspace-proxy.js";
import { proxyToUpstream } from "../../lib/proxy.js";
import type { GatewayHttpContext } from "../context.js";

export const createLeadGenerationProxyRoutes: RouteModule<GatewayHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const upstream = ctx.config.leadGenerationUrl ?? "http://127.0.0.1:3019";
  const chain = createProtectedWorkspaceProxyChain(ctx, upstream);
  router.all("/v1/workspaces/:workspaceId/lead-generation", ...chain);
  router.all("/v1/workspaces/:workspaceId/lead-generation/*", ...chain);

  router.post(
    "/v1/inbound/ingest/:connectorId",
    asyncHandler(async (req, res) => {
      await proxyToUpstream(req, res, upstream, {
        timeoutMs: ctx.config.httpRequestTimeoutMs,
      });
    }),
  );

  return router;
};
