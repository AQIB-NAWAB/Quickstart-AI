import type { Logger } from "@quickstart/logging";
import express, { type Application, type Router } from "express";
import { notFoundMiddleware, platformErrorMiddleware } from "./middleware/errors.js";
import { jsonBodyErrorMiddleware } from "./middleware/json-body-error.js";
import { createRateLimitMiddleware, type RateLimitOptions } from "./middleware/rate-limit.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requestTimeoutMiddleware } from "./middleware/timeout.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { httpMetricsMiddleware } from "./middleware/metrics.js";

export type PlatformHttpOptions = {
  logger: Logger;
  /** Service API router (compose with {@link createApiRouter} in the service). */
  apiRouter: Router;
  requestTimeoutMs?: number;
  jsonBodyLimit?: string;
  /** Per-service IP limit (still useful when gateway is not in path). */
  globalRateLimit?: RateLimitOptions;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_JSON_LIMIT = "1mb";

function captureRawBody(
  req: express.Request,
  _res: express.Response,
  buffer: Buffer,
): void {
  req.rawBody = buffer.toString("utf8");
}

/**
 * Express app with the platform middleware order used inside each HTTP service:
 * request id → tracing → timeout → JSON body → rate limit → routes → 404 → errors.
 *
 * The JSON/urlencoded parsers also store the exact bytes in `req.rawBody` so
 * carrier webhooks (Telnyx Ed25519, Twilio HMAC) can verify what was signed.
 *
 * Slot 06 gateway adds another layer (tenant, edge rate limits, JWT for public clients).
 */
export function createPlatformApp(options: PlatformHttpOptions): Application {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestIdMiddleware());
  app.use(httpMetricsMiddleware());
  app.use(tracingMiddleware(options.logger));
  app.use(requestTimeoutMiddleware(options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS));
  app.use(
    express.json({
      limit: options.jsonBodyLimit ?? DEFAULT_JSON_LIMIT,
      type: ["application/json", "application/*+json", "application/webhook+json"],
      verify: captureRawBody,
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      limit: options.jsonBodyLimit ?? DEFAULT_JSON_LIMIT,
      verify: captureRawBody,
    }),
  );
  app.use(jsonBodyErrorMiddleware());

  if (options.globalRateLimit) {
    app.use(createRateLimitMiddleware(options.globalRateLimit));
  }

  app.use(options.apiRouter);

  app.use(notFoundMiddleware());
  app.use(platformErrorMiddleware(options.logger));

  return app;
}
