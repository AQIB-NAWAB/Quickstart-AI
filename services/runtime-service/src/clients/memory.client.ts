import type { Logger } from "@quickstart/logging";
import { fetchWithPolicy } from "@quickstart/utilities";

export type MemoryFact = {
  id: string;
  workspace_id: string;
  subject_key: string;
  fact_key: string | null;
  fact_text: string;
};

export type MemoryClientOptions = {
  baseUrl: string;
  internalToken: string;
  timeoutMs: number;
  logger?: Logger;
};

export class MemoryClient {
  constructor(private readonly options: MemoryClientOptions) {}

  async listFacts(
    workspaceId: string,
    subjectKey: string,
    requestId: string,
    limit = 20,
  ): Promise<MemoryFact[]> {
    const params = new URLSearchParams({
      subject_key: subjectKey,
      limit: String(limit),
    });
    const url = `${this.options.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/memory/facts?${params}`;
    try {
      const res = await fetchWithPolicy(
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.options.internalToken}`,
            "x-request-id": requestId,
          },
        },
        { timeoutMs: this.options.timeoutMs, maxRetries: 0 },
      );
      if (!res.ok) {
        this.options.logger?.warn("memory.read_degraded", {
          requestId,
          status: res.status,
        });
        return [];
      }
      const body = (await res.json()) as { facts?: MemoryFact[] };
      return body.facts ?? [];
    } catch (error) {
      this.options.logger?.warn("memory.read_degraded", {
        requestId,
        detail: error instanceof Error ? error.message : "unknown",
      });
      return [];
    }
  }

  async rememberFact(
    workspaceId: string,
    subjectKey: string,
    factKey: string,
    factText: string,
    requestId: string,
  ): Promise<void> {
    const url = `${this.options.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/memory/facts`;
    try {
      const res = await fetchWithPolicy(
        url,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.internalToken}`,
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({ subject_key: subjectKey, fact_key: factKey, fact_text: factText }),
        },
        { timeoutMs: Math.min(this.options.timeoutMs, 1000), maxRetries: 0 },
      );
      if (!res.ok) {
        this.options.logger?.warn("memory.write_degraded", { requestId, status: res.status });
      }
    } catch (error) {
      this.options.logger?.warn("memory.write_degraded", {
        requestId,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
