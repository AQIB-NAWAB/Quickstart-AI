import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import { routeParam } from "../utils/route-param.js";
import type { FactsService } from "../services/facts.service.js";

export function createInternalController(facts: FactsService) {
  return {
    listFacts: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const subjectKey = String(req.query.subject_key ?? "");
      const limit = req.query.limit;
      const result = await facts.listInternal(workspaceId, subjectKey, limit);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        facts: result.facts,
        total: result.total,
      });
    }) as RequestHandler,
    createFact: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as {
        subject_key?: unknown;
        fact_key?: unknown;
        fact_text?: unknown;
      };
      const fact = await facts.create(workspaceId, "runtime", {
        subject_key: body.subject_key,
        fact_key: body.fact_key,
        fact_text: body.fact_text,
      });
      sendPlatformJson(res, 201, { request_id: requestId, fact });
    }) as RequestHandler,
  };
}
