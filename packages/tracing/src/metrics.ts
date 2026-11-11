import { metrics } from "@opentelemetry/api";

function createInstruments() {
  const meter = metrics.getMeter("quickstart");
  const requests = meter.createCounter("quickstart.http.requests", {
    description: "Completed HTTP requests",
  });
  const duration = meter.createHistogram("quickstart.http.duration", {
    description: "Completed HTTP request duration",
    unit: "s",
  });
  const redisFailures = meter.createCounter("quickstart.gateway.redis_fail_closed", {
    description: "Requests rejected because the gateway rate-limit store failed",
  });
  const modelTimeouts = meter.createCounter("quickstart.model.timeout", {
    description: "Timed-out model provider attempts",
  });
  const rateLimited = meter.createCounter("quickstart.http.rate_limited", {
    description: "HTTP responses with status 429",
  });
  const publishes = meter.createCounter("quickstart.agent.published", {
    description: "Successful agent publishes",
  });
  return { requests, duration, redisFailures, modelTimeouts, rateLimited, publishes };
}

let instruments: ReturnType<typeof createInstruments> | undefined;
function getInstruments() {
  return (instruments ??= createInstruments());
}

export function recordHttpRequest(method: string, status: number, seconds: number): void {
  const knownMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const attributes = {
    method: knownMethods.includes(method) ? method : "OTHER",
    status_class: status >= 100 && status <= 599 ? `${Math.floor(status / 100)}xx` : "other",
  };
  const { requests, duration, rateLimited } = getInstruments();
  requests.add(1, attributes);
  duration.record(seconds, attributes);
  if (status === 429) rateLimited.add(1);
}

export function recordGatewayRedisFailure(): void {
  getInstruments().redisFailures.add(1);
}
export function recordModelTimeout(): void {
  getInstruments().modelTimeouts.add(1);
}
export function recordAgentPublish(): void {
  getInstruments().publishes.add(1);
}
