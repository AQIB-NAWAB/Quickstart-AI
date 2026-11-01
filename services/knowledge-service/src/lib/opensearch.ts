import type { KnowledgeConfig } from "../config/environment.js";

export type ChunkDocument = {
  workspace_id: string;
  source_id: string;
  source_version: number;
  chunk_id: string;
  chunk_index: number;
  text: string;
  start_char: number | null;
  end_char: number | null;
  vector: number[];
};

export type PublicChunkItem = {
  id: string;
  chunk_index: number;
  text: string;
  start_char: number | null;
  end_char: number | null;
};

export class OpenSearchClient {
  constructor(
    private readonly config: KnowledgeConfig,
    private readonly dimensions: number,
  ) {}

  async ensureIndex(): Promise<void> {
    const index = this.config.opensearchIndex;
    const head = await fetch(`${this.config.opensearchUrl}/${index}`);
    if (head.status === 200) {
      return;
    }
    const res = await fetch(`${this.config.opensearchUrl}/${index}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: { "index.knn": true },
        mappings: {
          properties: {
            workspace_id: { type: "keyword" },
            source_id: { type: "keyword" },
            source_version: { type: "integer" },
            chunk_id: { type: "keyword" },
            chunk_index: { type: "integer" },
            start_char: { type: "integer" },
            end_char: { type: "integer" },
            text: { type: "text" },
            vector: { type: "knn_vector", dimension: this.dimensions },
          },
        },
      }),
    });
    if (!res.ok && res.status !== 400) {
      throw new Error(`OpenSearch create index failed: ${res.status}`);
    }
  }

  async deleteBySource(workspaceId: string, sourceId: string, version?: number): Promise<void> {
    const index = this.config.opensearchIndex;
    const filters: Record<string, unknown>[] = [
      { term: { workspace_id: workspaceId } },
      { term: { source_id: sourceId } },
    ];
    if (version !== undefined) {
      filters.push({ term: { source_version: version } });
    }

    await fetch(`${this.config.opensearchUrl}/${index}/_delete_by_query?refresh=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: {
          bool: {
            filter: filters,
          },
        },
      }),
    });
  }

  async deleteOlderVersions(workspaceId: string, sourceId: string, currentVersion: number): Promise<void> {
    const index = this.config.opensearchIndex;
    await fetch(`${this.config.opensearchUrl}/${index}/_delete_by_query?refresh=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: {
          bool: {
            filter: [
              { term: { workspace_id: workspaceId } },
              { term: { source_id: sourceId } },
              { range: { source_version: { lt: currentVersion } } },
            ],
          },
        },
      }),
    });
  }

  async indexChunks(docs: ChunkDocument[]): Promise<void> {
    if (docs.length === 0) {
      return;
    }
    const index = this.config.opensearchIndex;
    const bodyLines: string[] = [];
    for (const doc of docs) {
      bodyLines.push(JSON.stringify({ index: { _index: index, _id: doc.chunk_id } }));
      bodyLines.push(JSON.stringify(doc));
    }

    const res = await fetch(`${this.config.opensearchUrl}/_bulk?refresh=true`, {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body: `${bodyLines.join("\n")}\n`,
    });

    if (!res.ok) {
      throw new Error(`OpenSearch bulk index HTTP failed: ${res.status}`);
    }

    // Explicit item-level verification
    const bulkResponse = (await res.json().catch(() => ({}))) as {
      errors?: boolean;
      items?: Array<Record<string, { error?: { reason?: string; type?: string }; status?: number }>>;
    };

    if (bulkResponse.errors && Array.isArray(bulkResponse.items)) {
      const failedItems = bulkResponse.items
        .map((item) => {
          const action = Object.values(item)[0];
          return action?.error ? `${action.status}: ${action.error.reason || action.error.type}` : null;
        })
        .filter(Boolean);
      throw new Error(`OpenSearch bulk indexing item failures: ${failedItems.slice(0, 3).join("; ")}`);
    }
  }

  async listSourceChunks(
    workspaceId: string,
    sourceId: string,
    version?: number,
    limit: number = 20,
    cursor?: string,
  ): Promise<{
    chunk_count: number;
    chunks: PublicChunkItem[];
    next_cursor: string | null;
  }> {
    const index = this.config.opensearchIndex;
    const boundedLimit = Math.min(Math.max(limit, 1), 100);

    const filters: Record<string, unknown>[] = [
      { term: { workspace_id: workspaceId } },
      { term: { source_id: sourceId } },
    ];
    if (version !== undefined && version > 0) {
      filters.push({ term: { source_version: version } });
    }

    let searchAfter: [number, string] | undefined;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [number, string];
        if (Array.isArray(decoded) && decoded.length === 2) {
          searchAfter = decoded;
        }
      } catch {
        // ignore invalid cursor
      }
    }

    const searchQuery: Record<string, unknown> = {
      size: boundedLimit + 1,
      _source: ["chunk_id", "chunk_index", "text", "start_char", "end_char"],
      query: {
        bool: {
          filter: filters,
        },
      },
      sort: [
        { chunk_index: { order: "asc" } },
        { chunk_id: { order: "asc" } },
      ],
      track_total_hits: true,
    };

    if (searchAfter) {
      searchQuery.search_after = searchAfter;
    }

    const res = await fetch(`${this.config.opensearchUrl}/${index}/_search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(searchQuery),
    });

    if (!res.ok) {
      // If index doesn't exist yet or query fails, return empty
      return { chunk_count: 0, chunks: [], next_cursor: null };
    }

    const data = (await res.json().catch(() => ({}))) as {
      hits?: {
        total?: { value: number } | number;
        hits?: Array<{
          _source: ChunkDocument;
          sort?: [number, string];
        }>;
      };
    };

    const totalValue =
      typeof data.hits?.total === "number"
        ? data.hits.total
        : data.hits?.total?.value ?? 0;

    const rawHits = data.hits?.hits ?? [];
    const hasMore = rawHits.length > boundedLimit;
    const hits = hasMore ? rawHits.slice(0, boundedLimit) : rawHits;

    const chunks: PublicChunkItem[] = hits.map((h) => ({
      id: h._source.chunk_id,
      chunk_index: h._source.chunk_index,
      text: h._source.text,
      start_char: typeof h._source.start_char === "number" ? h._source.start_char : null,
      end_char: typeof h._source.end_char === "number" ? h._source.end_char : null,
    }));

    let nextCursor: string | null = null;
    if (hasMore && hits.length > 0) {
      const lastHit = hits[hits.length - 1];
      if (lastHit.sort) {
        nextCursor = Buffer.from(JSON.stringify(lastHit.sort)).toString("base64url");
      }
    }

    return {
      chunk_count: totalValue,
      chunks,
      next_cursor: nextCursor,
    };
  }

  async search(
    workspaceId: string,
    queryText: string,
    vector: number[],
    limit: number,
    sourceIds?: string[],
    searchMethod: "semantic" | "keyword" | "hybrid" = "hybrid",
  ) {
    const index = this.config.opensearchIndex;
    const body = buildSearchBody(workspaceId, queryText, vector, limit, sourceIds, searchMethod);
    const res = await fetch(`${this.config.opensearchUrl}/${index}/_search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const fallback = await fetch(`${this.config.opensearchUrl}/${index}/_search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          size: limit,
          query: {
            bool: {
              filter: [
                { term: { workspace_id: workspaceId } },
                ...(sourceIds?.length ? [{ terms: { source_id: sourceIds } }] : []),
              ],
              must: [{ match: { text: queryText } }],
            },
          },
        }),
      });
      if (!fallback.ok) {
        throw new Error(`OpenSearch search failed: ${res.status}`);
      }
      const data = (await fallback.json()) as {
        hits: { hits: Array<{ _score: number; _source: ChunkDocument }> };
      };
      return data.hits.hits.map((hit) => ({
        chunk_id: hit._source.chunk_id,
        source_id: hit._source.source_id,
        text: hit._source.text,
        score: hit._score,
      }));
    }
    const data = (await res.json()) as {
      hits: { hits: Array<{ _score: number; _source: ChunkDocument }> };
    };
    return data.hits.hits.map((hit) => ({
      chunk_id: hit._source.chunk_id,
      source_id: hit._source.source_id,
      text: hit._source.text,
      score: hit._score,
    }));
  }
}

export function buildHybridSearchBody(
  workspaceId: string,
  queryText: string,
  vector: number[],
  limit: number,
  sourceIds?: string[],
): Record<string, unknown> {
  const k = Math.min(Math.max(limit * 2, limit), 40);
  return {
    size: limit,
    query: {
      bool: {
        filter: [
          { term: { workspace_id: workspaceId } },
          ...(sourceIds?.length ? [{ terms: { source_id: sourceIds } }] : []),
        ],
        must: [
          {
            knn: {
              vector: {
                vector,
                k,
              },
            },
          },
        ],
        should: [
          {
            match: {
              text: {
                query: queryText,
                boost: 0.25,
              },
            },
          },
        ],
      },
    },
  };
}

export function buildSearchBody(
  workspaceId: string,
  queryText: string,
  vector: number[],
  limit: number,
  sourceIds: string[] | undefined,
  searchMethod: "semantic" | "keyword" | "hybrid",
): Record<string, unknown> {
  if (searchMethod === "keyword") {
    return {
      size: limit,
      query: {
        bool: {
          filter: [
            { term: { workspace_id: workspaceId } },
            ...(sourceIds?.length ? [{ terms: { source_id: sourceIds } }] : []),
          ],
          must: [{ match: { text: { query: queryText } } }],
        },
      },
    };
  }

  if (searchMethod === "semantic") {
    const k = Math.min(Math.max(limit * 2, limit), 40);
    return {
      size: limit,
      query: {
        bool: {
          filter: [
            { term: { workspace_id: workspaceId } },
            ...(sourceIds?.length ? [{ terms: { source_id: sourceIds } }] : []),
          ],
          must: [{ knn: { vector: { vector, k } } }],
        },
      },
    };
  }

  return buildHybridSearchBody(workspaceId, queryText, vector, limit, sourceIds);
}
