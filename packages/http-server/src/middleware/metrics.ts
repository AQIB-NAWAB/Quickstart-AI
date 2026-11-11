import { recordHttpRequest } from "@quickstart/tracing";
import type { RequestHandler } from "express";

export function httpMetricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/healthz" || req.path === "/readyz" || req.path === "/health") return next();
    const started = process.hrtime.bigint();
    res.once("finish", () => {
      recordHttpRequest(
        req.method,
        res.statusCode,
        Number(process.hrtime.bigint() - started) / 1e9,
      );
    });
    next();
  };
}
