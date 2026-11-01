import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { createInternalController } from "../../controllers/internal.controller.js";
import type { MemoryHttpContext } from "../context.js";

export const createInternalRoutes: RouteModule<MemoryHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const ctrl = createInternalController(ctx.facts);
  router.get(
    "/internal/workspaces/:workspaceId/memory/facts",
    ctx.internalAuth,
    asyncHandler(ctrl.listFacts),
  );
  router.post(
    "/internal/workspaces/:workspaceId/memory/facts",
    ctx.internalAuth,
    asyncHandler(ctrl.createFact),
  );
  return router;
};
