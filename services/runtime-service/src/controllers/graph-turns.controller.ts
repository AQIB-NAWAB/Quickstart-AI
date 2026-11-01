import type { Request, Response } from "@quickstart/http-server";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { GraphTurnsService } from "../services/graph-turns.service.js";

function extractParam(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val[0];
  return val ?? "";
}

function extractAuthHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }
  const tenantId =
    req.headers["x-tenant-id"] ??
    (req as unknown as { tenant?: { tenantId?: string } }).tenant?.tenantId;
  if (tenantId && typeof tenantId === "string") {
    headers["x-tenant-id"] = tenantId;
  }
  const requestId = req.headers["x-request-id"];
  if (requestId && typeof requestId === "string") {
    headers["x-request-id"] = requestId;
  }
  return headers;
}

export function createGraphTurnsController(graphTurnsService: GraphTurnsService) {
  return {
    async initPreviewSession(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const agentId = extractParam(req.params.agentId);
      const { sessionId, channel, variables } = req.body ?? {};
      if (channel && !["chat", "voice"].includes(channel))
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Preview channel must be chat or voice.",
        });
      const requestId = (req.headers["x-request-id"] as string) || `req_${Date.now()}`;
      const authHeaders = extractAuthHeaders(req);

      const result = await graphTurnsService.initPreviewSession(
        workspaceId,
        agentId,
        { sessionId, channel, variables },
        authHeaders,
        requestId,
      );

      res.status(200).json(result);
    },

    async executePreviewTurn(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const agentId = extractParam(req.params.agentId);
      const { sessionId, message, channel, timeoutMs } = req.body ?? {};
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 16000 ||
        (channel && !["chat", "voice"].includes(channel)) ||
        (timeoutMs !== undefined &&
          (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000))
      )
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Provide a nonempty message and valid preview channel/deadline.",
        });

      if (!sessionId) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "sessionId is required to execute a preview turn",
        });
      }

      const requestId = (req.headers["x-request-id"] as string) || `req_${Date.now()}`;
      const authHeaders = extractAuthHeaders(req);

      const result = await graphTurnsService.executePreviewTurn(
        workspaceId,
        agentId,
        {
          sessionId,
          message,
          channel,
          requestId,
          timeoutMs,
          idempotencyKey:
            typeof req.headers["idempotency-key"] === "string"
              ? req.headers["idempotency-key"]
              : undefined,
        },
        authHeaders,
      );

      res.status(200).json(result);
    },

    async resetPreviewSession(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const agentId = extractParam(req.params.agentId);
      const { sessionId } = req.body ?? {};

      if (!sessionId) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "sessionId is required to reset a preview session",
        });
      }

      const requestId = (req.headers["x-request-id"] as string) || `req_${Date.now()}`;
      const authHeaders = extractAuthHeaders(req);

      const result = await graphTurnsService.resetPreviewSession(
        workspaceId,
        agentId,
        sessionId,
        authHeaders,
        requestId,
      );

      res.status(200).json(result);
    },

    async getPreviewTrace(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const runId = extractParam(req.params.runId);
      const trace = await graphTurnsService.getTrace(
        workspaceId,
        runId,
        extractParam(req.params.agentId),
      );
      if (!trace) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Trace not found",
        });
      }
      res.status(200).json({ trace });
    },

    async listPreviewTraces(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const sessionId = (req.query.sessionId as string | undefined) || undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const traces = await graphTurnsService.listTraces(
        workspaceId,
        sessionId,
        limit,
        extractParam(req.params.agentId),
      );
      res.status(200).json({ traces });
    },

    async streamPreviewTrace(req: Request, res: Response): Promise<void> {
      const workspaceId = extractParam(req.params.workspaceId);
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({ error: "sessionId query parameter is required" });
        return;
      }

      await graphTurnsService.authorizePreviewSession(
        workspaceId,
        extractParam(req.params.agentId),
        sessionId,
      );
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const unsubscribe = graphTurnsService.subscribeTrace(workspaceId, sessionId, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
      res.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  };
}
