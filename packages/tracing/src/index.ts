export { applyRequestAttributes, type RequestSpanAttributes } from "./attributes.js";
export { initTracing, shutdownTracing, type InitTracingOptions } from "./init.js";
export { getTraceIds, runWithSpan } from "./run-span.js";
export {
  recordHttpRequest,
  recordGatewayRedisFailure,
  recordModelTimeout,
  recordAgentPublish,
} from "./metrics.js";
