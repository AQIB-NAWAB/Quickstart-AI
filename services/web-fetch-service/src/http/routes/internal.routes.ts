import { asyncHandler, createServiceRouter, type RouteModule } from "@quickstart/http-server";
import type { WebFetchHttpContext } from "../context.js";

export const createInternalRoutes: RouteModule<WebFetchHttpContext> = (ctx) => {
  const router = createServiceRouter();
  const auth = ctx.internalAuth;
  const ctrl = ctx.internalCtrl;

  router.post("/internal/scrape", auth, asyncHandler(ctrl.scrape));
  router.post("/internal/crawl", auth, asyncHandler(ctrl.crawl));
  router.post("/internal/search", auth, asyncHandler(ctrl.search));
  router.post("/internal/enrich-profile", auth, asyncHandler(ctrl.enrichProfile));
  router.get("/internal/jobs/:jobId", auth, asyncHandler(ctrl.getJob));

  return router;
};
