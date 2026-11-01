import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { createInternalSecretsController } from "../../controllers/secrets.controller.js";
import type { SecretsHttpContext } from "../context.js";

export const createInternalRoutes: RouteModule<SecretsHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const ctrl = createInternalSecretsController(ctx.secrets);

  router.get(
    "/internal/workspaces/:workspaceId/secrets",
    ctx.internalAuth,
    asyncHandler(ctrl.list),
  );

  // Internal-only: returns plaintext value. Guarded by internal bearer token only.
  router.get(
    "/internal/workspaces/:workspaceId/secrets/:name/value",
    ctx.internalAuth,
    asyncHandler(ctrl.reveal),
  );

  // Internal-only: store encrypted secret from trusted services. Guarded by internal bearer token only.
  router.post(
    "/internal/workspaces/:workspaceId/secrets",
    ctx.internalAuth,
    asyncHandler(ctrl.create),
  );

  // Internal-only: delete secret from trusted services. Guarded by internal bearer token only.
  router.delete(
    "/internal/workspaces/:workspaceId/secrets/:name",
    ctx.internalAuth,
    asyncHandler(ctrl.deleteByName),
  );

  return router;
};
