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
  const poolTotal = meter.createGauge("quickstart.db.pool.total", {
    description: "Postgres pool connections",
  });
  const poolIdle = meter.createGauge("quickstart.db.pool.idle", {
    description: "Idle Postgres pool connections",
  });
  const poolWaiting = meter.createGauge("quickstart.db.pool.waiting", {
    description: "Requests waiting for a Postgres connection",
  });
  return {
    requests,
    duration,
    redisFailures,
    modelTimeouts,
    rateLimited,
    publishes,
    poolTotal,
    poolIdle,
    poolWaiting,
  };
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

export function recordPoolStats(pool: string, total: number, idle: number, waiting: number): void {
  const instruments = getInstruments();
  instruments.poolTotal.record(total, { pool });
  instruments.poolIdle.record(idle, { pool });
  instruments.poolWaiting.record(waiting, { pool });
}
