import { requestIdFromResponse, sendPlatformJson, type RequestHandler } from "@quickstart/http-server";
import { routeParam } from "../utils/route-param.js";
import type { RetrieveService } from "../services/retrieve.service.js";
import type { SourcesService } from "../services/sources.service.js";

export function createInternalController(sources: SourcesService, retrieve: RetrieveService) {
  return {
    readyCount: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const result = await sources.readyCount(workspaceId);
      sendPlatformJson(res, 200, { request_id: requestId, ...result });
    }) as RequestHandler,

    retrieve: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const body = req.body as {
        workspace_id?: string;
        query?: string;
        limit?: number;
        source_ids?: string[];
        search_method?: "semantic" | "keyword" | "hybrid";
      };
      if (!body.workspace_id) {
        sendPlatformJson(res, 400, {
          request_id: requestId,
          error: { code: "VALIDATION_FAILED", message: "workspace_id is required" },
        });
        return;
      }
      const result = await retrieve.retrieve({
        workspaceId: body.workspace_id,
        query: body.query ?? "",
        limit: body.limit,
        sourceIds: body.source_ids,
        searchMethod: body.search_method,
      });
      sendPlatformJson(res, 200, { request_id: requestId, ...result });
    }) as RequestHandler,
  };
}
