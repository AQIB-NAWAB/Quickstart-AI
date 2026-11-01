import test from "node:test";
import assert from "node:assert/strict";
import { htmlToPlainText } from "../lib/html-to-text.js";
import { decideAcquisitionProviders } from "../policy/decide.js";
import { ApifyAcquisitionProvider } from "../providers/apify.provider.js";

test("contact and store locator links survive HTML conversion", () => {
  const text = htmlToPlainText(
    '<script>do not include</script><a href="/our-stores/london">London &amp; stores</a><a href="mailto:Info@example.com">Email</a><a href="tel:+442079460000">Call</a><p>Watchmaker&#39;s showroom</p>',
  );
  assert.ok(text.includes("[London & stores](/our-stores/london)"));
  assert.ok(text.includes("Info@example.com"));
  assert.ok(text.includes("+442079460000"));
  assert.ok(text.includes("Watchmaker's showroom"));
  assert.ok(!text.includes("do not include"));
});

test("ordinary HTML uses direct HTTP before launching paid Apify browser work", () => {
  const result = decideAcquisitionProviders({
    action: "scrape",
    renderJs: false,
    profiles: [
      {
        id: "apify",
        driver: "apify",
        enabled: true,
        priority: 0,
        unitCostMicrosScrape: 0,
        unitCostMicrosSearch: 0,
      },
      {
        id: "direct",
        driver: "direct_http",
        enabled: true,
        priority: 99,
        unitCostMicrosScrape: 0,
        unitCostMicrosSearch: 0,
      },
    ],
  });
  assert.equal(result.allow, true);
  if (result.allow) assert.equal(result.profileIds[0], "direct");
});

test("Maps enrichment cannot substitute an unrelated business sharing a similar name", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) =>
    String(url).includes("/secrets/")
      ? new Response(JSON.stringify({ value: JSON.stringify({ token: "customer-test-key" }) }))
      : new Response(
          JSON.stringify([
            {
              title: "The Limited Edition Consultancy",
              website: "https://unrelated.example/",
              address: "London, UK",
              phone: "+442079460000",
            },
          ]),
        );
  const provider = new ApifyAcquisitionProvider(
    {
      id: "apify",
      driver: "apify",
      apiKey: "test-only-token",
      enabled: true,
      priority: 1,
      unitCostMicrosScrape: 0,
      unitCostMicrosSearch: 0,
    },
    1000,
  );
  assert.equal(
    await provider.enrichBusinessProfile({
      workspaceId: "workspace",
      businessName: "The Limited Edition",
      website: "https://watch-retailer.example/",
      location: "London, UK",
    }),
    null,
  );
});
