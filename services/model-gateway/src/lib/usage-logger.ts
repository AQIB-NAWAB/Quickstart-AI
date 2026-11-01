import type { Logger } from "@quickstart/logging";
import type { UsageIngestClient } from "../clients/usage.client.js";

export type UsageRecord = {
  workspace_id: string;
  request_id: string;
  agent_id?: string;
  conversation_id?: string;
  channel?: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
};

export function logModelUsage(
  logger: Logger,
  record: UsageRecord,
  ingest?: UsageIngestClient,
): void {
  logger.info("model.usage", record);
  if (!ingest) return;
  const tokens = record.input_tokens + record.output_tokens;
  ingest.emit({
    workspace_id: record.workspace_id,
    kind: "model",
    units: tokens,
    unit_label: "tokens",
    provider: record.provider,
    model: record.model,
    idempotency_key: `model:${record.workspace_id}:${record.request_id}`,
    request_id: record.request_id,
    detail: {
      input_tokens: record.input_tokens,
      output_tokens: record.output_tokens,
      latency_ms: record.latency_ms,
      ...(record.agent_id ? { agent_id: record.agent_id } : {}),
      ...(record.conversation_id ? { conversation_id: record.conversation_id } : {}),
      ...(record.channel ? { channel: record.channel } : {}),
    },
  });
}
