import { AppError, ErrorCode } from "@quickstart/errors";
import { fetchWithPolicy } from "@quickstart/utilities";

export type RetrievedChunk = {
  chunk_id: string;
  source_id: string;
  text: string;
  score: number;
};

export class KnowledgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs: number,
  ) {}

  async readyCount(workspaceId: string, requestId: string): Promise<number> {
    const url = `${this.baseUrl}/internal/workspaces/${encodeURIComponent(workspaceId)}/knowledge/ready-count`;
    try {
      const res = await fetchWithPolicy(
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
            "x-request-id": requestId,
          },
        },
        { timeoutMs: this.timeoutMs, maxRetries: 0 },
      );
      if (!res.ok) {
        // Treat unreachable/degraded knowledge as "no ready sources" so chat turns
        // still complete (same fail-open shape as MemoryClient.listFacts).
        return 0;
      }
      const body = (await res.json()) as { ready_count?: number };
      return body.ready_count ?? 0;
    } catch {
      return 0;
    }
  }

  async retrieve(
    workspaceId: string,
    query: string,
    requestId: string,
    limit = 5,
    signal?: AbortSignal,
    options: { sourceIds?: string[]; searchMethod?: "semantic" | "keyword" | "hybrid" } = {},
  ): Promise<RetrievedChunk[]> {
    const url = `${this.baseUrl}/internal/retrieve`;
    const res = await fetchWithPolicy(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.internalToken}`,
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          query,
          limit,
          ...(options.sourceIds?.length ? { source_ids: options.sourceIds } : {}),
          ...(options.searchMethod ? { search_method: options.searchMethod } : {}),
        }),
        signal,
      },
      { timeoutMs: this.timeoutMs, maxRetries: 0 },
    );
    if (!res.ok) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: "Knowledge retrieval failed",
        requestId,
      });
    }
    const body = (await res.json()) as { chunks?: RetrievedChunk[] };
    return body.chunks ?? [];
  }
}
