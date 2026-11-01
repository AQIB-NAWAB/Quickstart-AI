import { AppError, ErrorCode } from "@quickstart/errors";
import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import { routeParam } from "../lib/route-param.js";
import type { WidgetVoiceLiveSessionManager } from "../widget-voice/session-manager.js";

function sseWrite(
  res: { write: (chunk: string) => void; flush?: () => void },
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

export function createWidgetVoiceLiveController(
  manager: WidgetVoiceLiveSessionManager | null,
) {
  return {
    start: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured on the voice service",
          requestId,
        });
      }
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const body = (req.body ?? {}) as { actor_id?: string };
      const actorId = body.actor_id?.trim() || "widget-visitor";
      const sessionId = await manager.create({
        workspaceId,
        conversationId,
        actorId,
      });
      sendPlatformJson(res, 201, { request_id: requestId, session_id: sessionId });
    }) as RequestHandler,

    stream: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const sessionId =
        typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
      if (!sessionId) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "session_id is required",
          requestId,
        });
      }
      const record = manager.get(sessionId);
      if (!record) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Voice session not found or expired",
          requestId,
        });
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("x-request-id", requestId);
      res.flushHeaders?.();
      sseWrite(res, "ready", { type: "ready" });

      const unsubscribe = manager.subscribe(sessionId, (event) => {
        sseWrite(res, event.type, event);
      });
      const keepAlive = setInterval(() => {
        if (res.writableEnded) return;
        res.write(`: ping\n\n`);
        (res as { flush?: () => void }).flush?.();
      }, 15_000);
      if (!unsubscribe) {
        res.end();
        return;
      }

      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        // Keep the Deepgram session alive while the visitor still sends audio chunks.
        // The widget calls /voice-live/stop when the user hangs up.
      });
    }) as RequestHandler,

    audio: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const body = (req.body ?? {}) as { session_id?: string; pcm_b64?: string };
      const sessionId = body.session_id?.trim();
      const pcmB64 = body.pcm_b64?.trim();
      if (!sessionId || !pcmB64) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "session_id and pcm_b64 are required",
          requestId,
        });
      }
      const pcm = Buffer.from(pcmB64, "base64");
      manager.pushAudio(sessionId, pcm);
      res.status(204).end();
    }) as RequestHandler,

    recording: (async (req, res) => {
      const body = (req.body ?? {}) as {
        session_id?: string;
        workspace_id?: string;
        action?: string;
        content_type?: string;
        chunk_b64?: string;
      };
      const sessionId = body.session_id?.trim();
      if (!sessionId || !body.workspace_id || !body.action || !manager) {
        throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "session_id and action are required" });
      }
      if (body.action === "start") {
        await manager.startRecording(sessionId, body.workspace_id, body.content_type ?? "audio/webm");
      } else if (body.action === "chunk") {
        if (!body.chunk_b64 || body.chunk_b64.length > 700_000) {
          throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Recording chunk is missing or too large" });
        }
        await manager.appendRecording(sessionId, body.workspace_id, Buffer.from(body.chunk_b64, "base64"));
      } else if (body.action === "finish") {
        await manager.finishRecording(sessionId, body.workspace_id);
      } else {
        throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Unsupported recording action" });
      }
      res.status(204).end();
    }) as RequestHandler,

    stop: (async (req, res) => {
      const body = (req.body ?? {}) as { session_id?: string };
      const sessionId = body.session_id?.trim();
      if (sessionId && manager) {
        await manager.close(sessionId);
      }
      res.status(204).end();
    }) as RequestHandler,

    staffList: (async (req, res) => {
      if (!manager) {
        sendPlatformJson(res, 200, { request_id: requestIdFromResponse(res), calls: [] });
        return;
      }
      const workspaceId = routeParam(req.params.workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        calls: manager.list(workspaceId),
      });
    }) as RequestHandler,

    staffGet: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const call = manager?.describe(workspaceId, conversationId) ?? null;
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        live: Boolean(call),
        call,
      });
    }) as RequestHandler,

    staffJoin: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const userId = res.locals.tenantContext?.actorId ?? "";
      const body = (req.body ?? {}) as { display_name?: string };
      const name = body.display_name?.trim().slice(0, 80) || "Teammate";
      const result = manager.join(workspaceId, conversationId, { userId, name });
      if (result === "missing") {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "This live call is no longer on the voice service",
          requestId,
        });
      }
      if (result === "conflict") {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Another teammate is already on this call",
          requestId,
        });
      }
      sendPlatformJson(res, 200, { request_id: requestId, joined: true, name });
    }) as RequestHandler,

    staffLeave: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const userId = res.locals.tenantContext?.actorId ?? "";
      manager?.leave(workspaceId, conversationId, userId);
      res.status(204).end();
    }) as RequestHandler,

    staffStop: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const stopped = await manager.stopConversation(workspaceId, conversationId);
      if (!stopped) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "No active call was found for this conversation",
          requestId,
        });
      }
      sendPlatformJson(res, 200, { request_id: requestId, stopped: true });
    }) as RequestHandler,

    staffAudio: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const userId = res.locals.tenantContext?.actorId ?? "";
      const body = (req.body ?? {}) as { pcm_b64?: string };
      const pcmB64 = body.pcm_b64?.trim();
      if (!pcmB64) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "pcm_b64 is required",
          requestId,
        });
      }
      const ok = manager.pushHumanAudio(workspaceId, conversationId, userId, Buffer.from(pcmB64, "base64"));
      if (!ok) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Join the call before sending audio",
          requestId,
        });
      }
      res.status(204).end();
    }) as RequestHandler,

    staffStream: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      if (!manager) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Widget live voice is not configured",
          requestId,
        });
      }
      const workspaceId = routeParam(req.params.workspaceId);
      const conversationId = routeParam(req.params.conversationId);
      const userId = res.locals.tenantContext?.actorId ?? "";
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("x-request-id", requestId);
      res.flushHeaders?.();
      sseWrite(res, "ready", { type: "ready" });
      const unsubscribe = manager.subscribeAgent(workspaceId, conversationId, userId, (event) => {
        sseWrite(res, event.type, event);
      });
      const keepAlive = setInterval(() => {
        if (res.writableEnded) return;
        res.write(`: ping\n\n`);
        (res as { flush?: () => void }).flush?.();
      }, 15_000);
      if (!unsubscribe) {
        sseWrite(res, "error", { message: "Join the call before listening" });
        clearInterval(keepAlive);
        res.end();
        return;
      }
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    }) as RequestHandler,
  };
}
