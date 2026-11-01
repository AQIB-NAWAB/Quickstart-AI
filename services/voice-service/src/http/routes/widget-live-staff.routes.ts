import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { requireWorkspacePermission } from "../../middleware/require-workspace-permission.middleware.js";
import type { VoiceHttpContext } from "../context.js";

export const createWidgetLiveStaffRoutes: RouteModule<VoiceHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const { authGuard, tenantGuard, workspaceAccess, widgetVoiceLiveCtrl } = ctx;
  const tenant = [authGuard, tenantGuard];
  const read = requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.CONVERSATION_READ);
  const handoff = requireWorkspacePermission(
    workspaceAccess,
    WORKSPACE_PERMISSIONS.CONVERSATION_HANDOFF,
  );
  const manageCalls = requireWorkspacePermission(
    workspaceAccess,
    WORKSPACE_PERMISSIONS.VOICE_CALLS_MANAGE,
  );

  router.get(
    "/v1/workspaces/:workspaceId/voice/widget-live",
    ...tenant,
    read,
    asyncHandler(widgetVoiceLiveCtrl.staffList),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId",
    ...tenant,
    read,
    asyncHandler(widgetVoiceLiveCtrl.staffGet),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId/join",
    ...tenant,
    handoff,
    asyncHandler(widgetVoiceLiveCtrl.staffJoin),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId/leave",
    ...tenant,
    handoff,
    asyncHandler(widgetVoiceLiveCtrl.staffLeave),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId/stop",
    ...tenant,
    manageCalls,
    asyncHandler(widgetVoiceLiveCtrl.staffStop),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId/audio",
    ...tenant,
    handoff,
    asyncHandler(widgetVoiceLiveCtrl.staffAudio),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/widget-live/:conversationId/stream",
    ...tenant,
    handoff,
    asyncHandler(widgetVoiceLiveCtrl.staffStream),
  );

  return router;
};
