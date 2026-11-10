import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { requireWorkspacePermission } from "../../middleware/require-workspace-permission.middleware.js";
import type { VoiceHttpContext } from "../context.js";

/**
 * Workspace number inventory: search Telnyx, purchase/claim, assign an agent,
 * register bring-your-own SIP numbers, view connection info, and release numbers.
 */
export const createPhoneNumbersRoutes: RouteModule<VoiceHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const { authGuard, tenantGuard, workspaceAccess, phoneNumbersCtrl } = ctx;
  const tenant = [authGuard, tenantGuard];
  const read = requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.VOICE_NUMBERS_READ);
  const manage = requireWorkspacePermission(
    workspaceAccess,
    WORKSPACE_PERMISSIONS.VOICE_NUMBERS_MANAGE,
  );

  router.get(
    "/v1/workspaces/:workspaceId/voice/sip/setup",
    ...tenant,
    read,
    asyncHandler(phoneNumbersCtrl.setup),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/numbers",
    ...tenant,
    read,
    asyncHandler(phoneNumbersCtrl.list),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/numbers/available",
    ...tenant,
    read,
    asyncHandler(phoneNumbersCtrl.available),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/numbers",
    ...tenant,
    manage,
    asyncHandler(phoneNumbersCtrl.purchase),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/numbers/byo",
    ...tenant,
    manage,
    asyncHandler(phoneNumbersCtrl.registerByo),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/numbers/:numberId/sip",
    ...tenant,
    read,
    asyncHandler(phoneNumbersCtrl.getSipConnection),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/numbers/:numberId/sip/rotate-credentials",
    ...tenant,
    manage,
    asyncHandler(phoneNumbersCtrl.rotateCredentials),
  );
  router.patch(
    "/v1/workspaces/:workspaceId/voice/numbers/:numberId",
    ...tenant,
    manage,
    asyncHandler(phoneNumbersCtrl.update),
  );
  router.delete(
    "/v1/workspaces/:workspaceId/voice/numbers/:numberId",
    ...tenant,
    manage,
    asyncHandler(phoneNumbersCtrl.release),
  );

  return router;
};
