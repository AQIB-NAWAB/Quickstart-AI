import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import type { AnalyticsService } from "../services/analytics.service.js";
import { routeParam } from "../utils/route-param.js";

export const ANALYTICS_READ = WORKSPACE_PERMISSIONS.ANALYTICS_READ;

export function createAnalyticsController(analytics: AnalyticsService) {
  return {
    getAnalytics: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const q = req.query as Record<string, string | undefined>;
      const result = await analytics.getRollup(workspaceId, {
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        agentId: q.agent_id,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    getSummary: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const q = req.query as Record<string, string | undefined>;
      const result = await analytics.getRollup(workspaceId, {
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        agentId: q.agent_id,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        range: result.range,
        summary: result.summary,
        previous_period: result.previous_period,
      });
    }) as RequestHandler,

    getTokens: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const q = req.query as Record<string, string | undefined>;
      const result = await analytics.getRollup(workspaceId, {
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        agentId: q.agent_id,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        range: result.range,
        daily_tokens: result.daily_tokens,
        total_tokens: result.summary.total_tokens,
      });
    }) as RequestHandler,

    getLatency: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const q = req.query as Record<string, string | undefined>;
      const result = await analytics.getRollup(workspaceId, {
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        agentId: q.agent_id,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        range: result.range,
        daily_latency: result.daily_latency,
        latency_p50_ms: result.summary.latency_p50_ms,
        latency_p95_ms: result.summary.latency_p95_ms,
      });
    }) as RequestHandler,

    getUsage: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const q = req.query as Record<string, string | undefined>;
      const result = await analytics.getRollup(workspaceId, {
        from: q.from,
        to: q.to,
        timezone: q.timezone,
        agentId: q.agent_id,
      });
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        range: result.range,
        usage_by_service: result.usage_by_service,
      });
    }) as RequestHandler,
  };
}
