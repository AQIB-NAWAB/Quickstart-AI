import type { Logger } from "@quickstart/logging";
import { AppError, ErrorCode } from "@quickstart/errors";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { requestIdFromResponse } from "./request-id.js";
import { sendPlatformError } from "../send-platform-json.js";

export function notFoundMiddleware(): RequestHandler {
  return (_req, res) => {
    const requestId = requestIdFromResponse(res);
    sendPlatformError(
      res,
      new AppError({ code: ErrorCode.NOT_FOUND, message: "Route not found", requestId }),
      requestId,
    );
  };
}

export function platformErrorMiddleware(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const requestId = requestIdFromResponse(res);
    logger.warn("request.failed", {
      request_id: requestId,
      error_code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
    });
    sendPlatformError(res, error, requestId);
  };
}
