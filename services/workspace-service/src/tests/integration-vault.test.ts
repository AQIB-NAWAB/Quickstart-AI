import test from "node:test";
import assert from "node:assert/strict";
import { SecretsClient } from "../clients/secrets.client.js";

test("a failed vault write cannot become a successful connection or in-memory credential fallback", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Response("vault failure", { status: 500 });
  const client = new SecretsClient({ internalToken: "test-service-token" });
  await assert.rejects(
    () => client.storeIntegrationSecret("workspace", "apify", { token: "test-not-real" }),
    /Connection was not saved/,
  );
  globalThis.fetch = async () => new Response("missing", { status: 404 });
  assert.equal(await client.getIntegrationSecret("workspace", "apify"), null);
});
