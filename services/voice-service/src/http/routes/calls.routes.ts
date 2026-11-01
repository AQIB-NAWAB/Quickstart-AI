import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import { requireWorkspacePermission } from "../../middleware/require-workspace-permission.middleware.js";
import type { VoiceHttpContext } from "../context.js";

export const createCallsRoutes: RouteModule<VoiceHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const { authGuard, tenantGuard, workspaceAccess, callsCtrl, inboundCallsCtrl } = ctx;
  const tenant = [authGuard, tenantGuard];
  const read = requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.VOICE_CALLS_READ);
  const manage = requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.VOICE_CALLS_MANAGE);
  const listenRecording = requireWorkspacePermission(workspaceAccess, WORKSPACE_PERMISSIONS.VOICE_RECORDINGS_LISTEN);

  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound",
    ...tenant,
    read,
    asyncHandler(callsCtrl.listInbound),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/summary",
    ...tenant,
    read,
    asyncHandler(callsCtrl.summary),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/live",
    ...tenant,
    read,
    asyncHandler(callsCtrl.listLiveInbound),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/inbound/simulate",
    ...tenant,
    manage,
    asyncHandler(callsCtrl.simulateInbound),
  );
  router.post(
    "/v1/workspaces/:workspaceId/voice/inbound/:callId/stop",
    ...tenant,
    manage,
    asyncHandler(inboundCallsCtrl.staffStopCall),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/:callId",
    ...tenant,
    read,
    asyncHandler(callsCtrl.getInbound),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/:callId/transcript",
    ...tenant,
    read,
    asyncHandler(callsCtrl.getTranscript),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/:callId/waveform",
    ...tenant,
    read,
    asyncHandler(callsCtrl.getWaveform),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/inbound/:callId/recording",
    ...tenant,
    listenRecording,
    asyncHandler(callsCtrl.getRecording),
  );
  router.get(
    "/v1/workspaces/:workspaceId/voice/outbound",
    ...tenant,
    read,
    asyncHandler(callsCtrl.listOutbound),
  );

  return router;
};
