import { AppError, ErrorCode } from "@quickstart/errors";
import { requestIdFromResponse, sendPlatformError, type RequestHandler } from "@quickstart/http-server";
import type { RedisClientType } from "redis";
import { recordGatewayRedisFailure } from "@quickstart/tracing";

export type RedisRateLimitBucket = {
  name: string;
  max: number;
  test: (path: string) => boolean;
};

export type RedisRateLimitOptions = {
  windowMs: number;
  max: number;
  skipPaths?: string[];
  keyPrefix?: string;
  /** Separate ceilings so a noisy route cannot exhaust sign-in or the rest of the API. */
  buckets?: RedisRateLimitBucket[];
};

function clientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) {
    return raw.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip ?? "unknown";
}

export function createRedisRateLimitMiddleware(
  redis: RedisClientType,
  options: RedisRateLimitOptions,
): RequestHandler {
  const skipPaths = new Set(options.skipPaths ?? []);
  const prefix = options.keyPrefix ?? "gateway:rl";
  const windowSec = Math.max(1, Math.ceil(options.windowMs / 1000));

  return async (req, res, next) => {
    if (skipPaths.has(req.path)) {
      return next();
    }

    const requestId = requestIdFromResponse(res);
    const path = req.path ?? "";
    const matched = options.buckets?.find((bucket) => bucket.test(path));
    const limit = matched?.max ?? options.max;
    const bucketName = matched?.name ?? "api";
    const windowId = Math.floor(Date.now() / options.windowMs);
    const key = `${prefix}:${bucketName}:${clientIp(req)}:${windowId}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }
      if (count > limit) {
        return sendPlatformError(
          res,
          new AppError({
            code: ErrorCode.RATE_LIMITED,
            message: "Too many requests",
            requestId,
          }),
          requestId,
        );
      }
      return next();
    } catch {
      recordGatewayRedisFailure();
      return sendPlatformError(
        res,
        new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "Rate limit store unavailable",
          requestId,
        }),
        requestId,
      );
    }
  };
}
