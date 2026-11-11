import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createLogger } from "@quickstart/logging";
import { Router } from "express";
import { createPlatformApp } from "../create-platform-app.js";

test("error log retains request id without leaking error messages or credentials", async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const router = Router();
  router.get("/failure", () => {
    throw new Error("secret-in-upstream-error");
  });
  const server = createPlatformApp({
    logger: createLogger({ service: "test" }),
    apiRouter: router,
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/failure`, {
      headers: { "x-request-id": "test-request-123", authorization: "Bearer secret-in-header" },
    });
    assert.equal(response.status, 500);
    const line = lines
      .map((value) => JSON.parse(value))
      .find((value) => value.msg === "request.failed");
    assert.equal(line?.request_id, "test-request-123");
    assert.equal(line?.error_code, "INTERNAL_ERROR");
    assert.doesNotMatch(lines.join("\n"), /secret-in-upstream-error|secret-in-header/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    console.log = original;
  }
});
