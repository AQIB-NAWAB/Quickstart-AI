import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  ExplicitBucketHistogramAggregation,
  PeriodicExportingMetricReader,
  View,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

export type InitTracingOptions = {
  serviceName: string;
  otlpEndpoint?: string;
  debugOtel?: boolean;
};

export async function initTracing(options: InitTracingOptions): Promise<void> {
  if (sdk) {
    return;
  }

  if (options.debugOtel) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const endpoint =
    options.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318";

  const traceExporter = new OTLPTraceExporter({
    url: endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });

  sdk = new NodeSDK({
    // Process command-line arguments can contain secrets; keep exported resources bounded.
    autoDetectResources: false,
    resource: new Resource({
      [ATTR_SERVICE_NAME]: options.serviceName,
      "service.instance.id": randomUUID(),
    }),
    traceExporter,
    views: [
      new View({
        instrumentName: "quickstart.http.duration",
        aggregation: new ExplicitBucketHistogramAggregation([
          0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
        ]),
      }),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${endpoint.replace(/\/v1\/traces\/?$/, "").replace(/\/$/, "")}/v1/metrics`,
      }),
      exportIntervalMillis: 15_000,
    }),
  });

  sdk.start();
}

export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }
  await sdk.shutdown();
  sdk = undefined;
}
