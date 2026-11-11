import assert from "node:assert/strict";
import test from "node:test";
import { metrics } from "@opentelemetry/api";
import * as instruments from "../metrics.js";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

test("metrics export bounded request labels and failure counters", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  try {
    instruments.recordHttpRequest("CUSTOM-user-supplied", 503, 0.2);
    instruments.recordGatewayRedisFailure();
    instruments.recordModelTimeout();
    instruments.recordHttpRequest("GET", 429, 0.1);
    instruments.recordAgentPublish();
    await provider.forceFlush();
    const output = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics));
    const requests = output.find((metric) => metric.descriptor.name === "quickstart.http.requests");
    assert.ok(requests);
    assert.deepEqual(requests.dataPoints[0]?.attributes, { method: "OTHER", status_class: "5xx" });
    assert.equal(requests.dataPoints[0]?.value, 1);
    assert.ok(
      output.some((metric) => metric.descriptor.name === "quickstart.gateway.redis_fail_closed"),
    );
    assert.ok(output.some((metric) => metric.descriptor.name === "quickstart.model.timeout"));
    assert.ok(output.some((metric) => metric.descriptor.name === "quickstart.http.rate_limited"));
    assert.ok(output.some((metric) => metric.descriptor.name === "quickstart.agent.published"));
  } finally {
    await provider.shutdown();
    metrics.disable();
  }
});
