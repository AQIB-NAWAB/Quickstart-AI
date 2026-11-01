import { bearerTokenFromHeader, verifyAccessToken } from "@quickstart/auth";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { Logger } from "@quickstart/logging";
import { createPlatformApp, type Application } from "@quickstart/http-server";
import { createAgentsController } from "../controllers/agents.controller.js";
import { createCustomToolsController } from "../controllers/custom-tools.controller.js";
import { SERVICE_NAME } from "../controllers/health.controller.js";
import type { ReadinessProbe } from "../controllers/health.controller.js";
import type { WorkspaceAccessClient } from "../lib/workspace-access-client.js";
import { createAuthMiddleware } from "../middleware/auth.middleware.js";
import { createRequireInternalTokenMiddleware } from "../middleware/require-internal-token.js";
import { requireTenantContext } from "../middleware/tenant.middleware.js";
import type { AgentsService } from "../services/agents.service.js";
import type { CustomToolsService } from "../services/custom-tools.service.js";
import type { AgentHttpContext } from "./context.js";
import { createAgentApiRouter } from "./routes/index.js";

export { SERVICE_NAME };

export type CreateAgentHttpServerOptions = {
  logger: Logger;
  agents: AgentsService;
  customTools: CustomToolsService;
  jwtSecret: string;
  internalToken: string;
  workspaceAccess: WorkspaceAccessClient;
  requestTimeoutMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  readinessProbes?: ReadinessProbe[];
};

export function createHttpServer(options: CreateAgentHttpServerOptions): Application {
  const { logger, agents, customTools, jwtSecret, workspaceAccess } = options;

  const authGuard = createAuthMiddleware(jwtSecret);
  const tenantGuard = requireTenantContext();

  const httpContext: AgentHttpContext = {
    readinessProbes: options.readinessProbes ?? [],
    authGuard,
    graphAuthGuard: async (req, res, next) => {
      try {
        const token = bearerTokenFromHeader(req.headers.authorization);
        if (!token || !jwtSecret)
          throw new AppError({
            code: ErrorCode.UNAUTHORIZED,
            message: "A verified access token is required for canvas operations.",
          });
        const claims = await verifyAccessToken(token, jwtSecret);
        res.locals.actorUserId = claims.sub;
        if (res.locals.tenantContext)
          res.locals.tenantContext = {
            workspaceId: res.locals.tenantContext.workspaceId,
            actorId: claims.sub,
          };
        next();
      } catch {
        next(
          new AppError({
            code: ErrorCode.UNAUTHORIZED,
            message: "Invalid or missing canvas access token.",
          }),
        );
      }
    },
    internalAuth: createRequireInternalTokenMiddleware(options.internalToken),
    tenantMiddleware: [authGuard, tenantGuard],
    workspaceAccess,
    agentsCtrl: createAgentsController(agents),
    customToolsCtrl: createCustomToolsController(customTools),
  };

  const apiRouter = createAgentApiRouter(httpContext);

  return createPlatformApp({
    logger,
    apiRouter,
    requestTimeoutMs: options.requestTimeoutMs,
    globalRateLimit: {
      windowMs: options.rateLimitWindowMs ?? 60_000,
      max: options.rateLimitMax ?? 120,
      skipPaths: ["/healthz", "/health", "/readyz"],
    },
  });
}
