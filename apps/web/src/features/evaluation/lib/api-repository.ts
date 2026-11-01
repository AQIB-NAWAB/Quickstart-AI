import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationComparison,
  EvaluationDataset,
  EvaluationRepository,
  EvaluationRun,
  EvaluationSummary,
  ExpectedToolCall,
  FixtureResponse,
  ScoringMethod,
} from "./types";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string } | string;
      };
      const message =
        typeof body.error === "string"
          ? body.error
          : body.error?.message || `Request failed with status ${res.status}`;
      return { ok: false, error: message, status: res.status };
    }

    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
      status: 0,
    };
  }
}

export class EvaluationApiClient {
  /* Summary */
  static async getSummary(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<{ summary: EvaluationSummary }>> {
    return apiFetch<{ summary: EvaluationSummary }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/summary`,
      { signal },
    );
  }

  /* Datasets */
  static async listDatasets(
    workspaceId: string,
    filters: {
      agentId?: string;
      search?: string;
      sort?: "updated" | "cases" | "pass_rate";
      limit?: number;
      offset?: number;
    } = {},
    signal?: AbortSignal,
  ): Promise<ApiResult<{ datasets: EvaluationDataset[]; total: number }>> {
    const params = new URLSearchParams();
    if (filters.agentId) params.set("agent_id", filters.agentId);
    if (filters.search) params.set("search", filters.search);
    if (filters.sort) params.set("sort", filters.sort);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();

    return apiFetch<{ datasets: EvaluationDataset[]; total: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets${qs ? `?${qs}` : ""}`,
      { signal },
    );
  }

  static async getDataset(
    workspaceId: string,
    datasetId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<{ dataset: EvaluationDataset }>> {
    return apiFetch<{ dataset: EvaluationDataset }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}`,
      { signal },
    );
  }

  static async createDataset(
    workspaceId: string,
    data: {
      agentId: string;
      name: string;
      description?: string;
      tags?: string[];
    },
  ): Promise<ApiResult<{ dataset: EvaluationDataset }>> {
    return apiFetch<{ dataset: EvaluationDataset }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets`,
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: data.agentId,
          name: data.name,
          description: data.description,
          tags: data.tags,
        }),
      },
    );
  }

  static async updateDataset(
    workspaceId: string,
    datasetId: string,
    patch: {
      name?: string;
      description?: string | null;
      tags?: string[];
      expectedRecordVersion?: number;
    },
  ): Promise<ApiResult<{ dataset: EvaluationDataset }>> {
    return apiFetch<{ dataset: EvaluationDataset }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: patch.name,
          description: patch.description,
          tags: patch.tags,
          expected_record_version: patch.expectedRecordVersion,
        }),
      },
    );
  }

  static async archiveDataset(
    workspaceId: string,
    datasetId: string,
  ): Promise<ApiResult<{ ok: boolean }>> {
    return apiFetch<{ ok: boolean }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}`,
      { method: "DELETE" },
    );
  }

  /* Test Cases */
  static async listCases(
    workspaceId: string,
    datasetId: string,
    options: { search?: string; tag?: string; offset?: number; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<ApiResult<{ cases: EvaluationCase[]; total: number }>> {
    const params = new URLSearchParams();
    if (options.search) params.set("search", options.search);
    if (options.tag) params.set("tag", options.tag);
    if (options.offset) params.set("offset", String(options.offset));
    if (options.limit) params.set("limit", String(options.limit));
    const qs = params.toString();

    return apiFetch<{ cases: EvaluationCase[]; total: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases${qs ? `?${qs}` : ""}`,
      { signal },
    );
  }

  static async getCase(
    workspaceId: string,
    datasetId: string,
    caseId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<{ case: EvaluationCase }>> {
    return apiFetch<{ case: EvaluationCase }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
      { signal },
    );
  }

  static async createCase(
    workspaceId: string,
    datasetId: string,
    data: {
      name?: string;
      input: string;
      expectedOutput?: string;
      expectedTools?: ExpectedToolCall[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
    },
  ): Promise<ApiResult<{ case: EvaluationCase }>> {
    return apiFetch<{ case: EvaluationCase }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases`,
      {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          input: data.input,
          expected_output: data.expectedOutput,
          expected_tools: data.expectedTools,
          fixture_responses: data.fixtureResponses,
          tags: data.tags,
        }),
      },
    );
  }

  static async updateCase(
    workspaceId: string,
    datasetId: string,
    caseId: string,
    patch: {
      name?: string;
      input?: string;
      expectedOutput?: string;
      expectedTools?: ExpectedToolCall[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
      expectedRecordVersion?: number;
    },
  ): Promise<ApiResult<{ case: EvaluationCase }>> {
    return apiFetch<{ case: EvaluationCase }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: patch.name,
          input: patch.input,
          expected_output: patch.expectedOutput,
          expected_tools: patch.expectedTools,
          fixture_responses: patch.fixtureResponses,
          tags: patch.tags,
          expected_record_version: patch.expectedRecordVersion,
        }),
      },
    );
  }

  static async deleteCase(
    workspaceId: string,
    datasetId: string,
    caseId: string,
  ): Promise<ApiResult<{ ok: boolean }>> {
    return apiFetch<{ ok: boolean }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
      { method: "DELETE" },
    );
  }

  static async importCases(
    workspaceId: string,
    datasetId: string,
    cases: Array<{
      name?: string;
      input: string;
      expectedOutput?: string;
      expectedTools?: ExpectedToolCall[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
    }>,
  ): Promise<ApiResult<{ imported_count: number; new_revision: number }>> {
    return apiFetch<{ imported_count: number; new_revision: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/import`,
      {
        method: "POST",
        body: JSON.stringify({
          cases: cases.map((c) => ({
            name: c.name,
            input: c.input,
            expected_output: c.expectedOutput,
            expected_tools: c.expectedTools,
            fixture_responses: c.fixtureResponses,
            tags: c.tags,
          })),
        }),
      },
    );
  }

  /* Runs */
  static async listRuns(
    workspaceId: string,
    filters: {
      agentId?: string;
      versionId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {},
    signal?: AbortSignal,
  ): Promise<ApiResult<{ runs: EvaluationRun[]; total: number }>> {
    const params = new URLSearchParams();
    if (filters.agentId) params.set("agent_id", filters.agentId);
    if (filters.versionId) params.set("version_id", filters.versionId);
    if (filters.status) params.set("status", filters.status);
    if (filters.startDate) params.set("start_date", filters.startDate);
    if (filters.endDate) params.set("end_date", filters.endDate);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();

    return apiFetch<{ runs: EvaluationRun[]; total: number }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/runs${qs ? `?${qs}` : ""}`,
      { signal },
    );
  }

  static async getRun(
    workspaceId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<{ run: EvaluationRun; results: EvaluationCaseResult[] }>> {
    return apiFetch<{ run: EvaluationRun; results: EvaluationCaseResult[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/runs/${encodeURIComponent(runId)}`,
      { signal },
    );
  }

  static async startRun(
    workspaceId: string,
    data: {
      agentId: string;
      agentVersionId: string;
      datasetId: string;
      expectedDatasetRevision?: number;
      caseIds?: string[];
      policy: {
        method: ScoringMethod;
        config: Record<string, unknown>;
        scorerVersion?: string;
      };
      fixtureConfig?: Record<string, unknown>;
      idempotencyKey?: string;
    },
  ): Promise<ApiResult<{ run: EvaluationRun; created: boolean }>> {
    return apiFetch<{ run: EvaluationRun; created: boolean }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          agent_id: data.agentId,
          agent_version_id: data.agentVersionId,
          dataset_id: data.datasetId,
          expected_dataset_revision: data.expectedDatasetRevision,
          case_ids: data.caseIds,
          policy: {
            method: data.policy.method,
            config: data.policy.config,
            scorer_version: data.policy.scorerVersion ?? "v1",
          },
          fixture_config: data.fixtureConfig,
          idempotency_key: data.idempotencyKey,
        }),
      },
    );
  }

  /* Comparisons */
  static async createComparison(
    workspaceId: string,
    data: {
      baselineRunId: string;
      candidateRunId: string;
    },
  ): Promise<ApiResult<{ comparison: EvaluationComparison }>> {
    return apiFetch<{ comparison: EvaluationComparison }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/comparisons`,
      {
        method: "POST",
        body: JSON.stringify({
          baseline_run_id: data.baselineRunId,
          candidate_run_id: data.candidateRunId,
        }),
      },
    );
  }

  static async getComparison(
    workspaceId: string,
    comparisonId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<{ comparison: EvaluationComparison }>> {
    return apiFetch<{ comparison: EvaluationComparison }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/comparisons/${encodeURIComponent(comparisonId)}`,
      { signal },
    );
  }
}

export const apiEvaluationRepository: EvaluationRepository = {
  async getOverview(workspaceId, agentId, datasetId, signal) {
    const [summaryRes, datasetsRes, runsRes] = await Promise.all([
      EvaluationApiClient.getSummary(workspaceId, signal),
      EvaluationApiClient.listDatasets(workspaceId, { agentId }, signal),
      EvaluationApiClient.listRuns(workspaceId, { agentId }, signal),
    ]);

    const datasets = datasetsRes.ok ? datasetsRes.data.datasets : [];
    const runs = runsRes.ok ? runsRes.data.runs : [];
    const selectedDataset = (datasetId ? datasets.find((d) => d.id === datasetId) : null) ||
      datasets[0] || {
        id: "default",
        workspaceId,
        agentId,
        name: "Default Dataset",
        description: null,
        tags: [],
        revision: 1,
        recordVersion: 1,
        caseCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

    const latestRun = runs[0] ?? null;

    return {
      status: "ready",
      data: {
        agentId,
        agentName: latestRun?.agentName ?? "Agent",
        selectedDataset,
        scoringPolicy: latestRun?.policy?.method ?? "exact_match",
        latestScore: latestRun?.score ?? null,
        scoreScale: 100,
        passedCases: latestRun?.passedCount ?? null,
        failedCases: latestRun?.failedCount ?? null,
        totalCases: selectedDataset.caseCount,
        latestRun,
        comparison: [],
        datasets,
        recentRuns: runs,
        summary: summaryRes.ok ? summaryRes.data.summary : undefined,
      },
    };
  },

  async listDatasets(workspaceId, signal) {
    const res = await EvaluationApiClient.listDatasets(workspaceId, {}, signal);
    if (!res.ok) {
      return { status: res.status === 404 ? "not_found" : "error", message: res.error };
    }
    return { status: "ready", data: res.data.datasets };
  },

  async getDataset(workspaceId, datasetId, signal) {
    const [datasetRes, casesRes] = await Promise.all([
      EvaluationApiClient.getDataset(workspaceId, datasetId, signal),
      EvaluationApiClient.listCases(workspaceId, datasetId, {}, signal),
    ]);
    if (!datasetRes.ok) {
      return {
        status: datasetRes.status === 404 ? "not_found" : "error",
        message: datasetRes.error,
      };
    }
    return {
      status: "ready",
      data: {
        dataset: datasetRes.data.dataset,
        cases: casesRes.ok ? casesRes.data.cases : [],
      },
    };
  },

  async createDataset(workspaceId, data) {
    const res = await EvaluationApiClient.createDataset(workspaceId, {
      agentId: data.agentId ?? "",
      name: data.name,
      description: data.description,
      tags: data.tags,
    });
    if (!res.ok) {
      return { status: "error", message: res.error };
    }
    return { status: "ready", data: res.data.dataset };
  },

  async saveTestCase(workspaceId, datasetId, caseData) {
    if (caseData.id) {
      const res = await EvaluationApiClient.updateCase(workspaceId, datasetId, caseData.id, {
        name: caseData.name,
        input: caseData.input,
        expectedOutput: caseData.expectedOutput,
        expectedTools: caseData.expectedTools,
        fixtureResponses: caseData.fixtureResponses,
        tags: caseData.tags,
        expectedRecordVersion: caseData.recordVersion,
      });
      if (!res.ok) return { status: "error", message: res.error };
      return { status: "ready", data: res.data.case };
    }

    const res = await EvaluationApiClient.createCase(workspaceId, datasetId, {
      name: caseData.name,
      input: caseData.input,
      expectedOutput: caseData.expectedOutput,
      expectedTools: caseData.expectedTools,
      fixtureResponses: caseData.fixtureResponses,
      tags: caseData.tags,
    });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "ready", data: res.data.case };
  },

  async importCases(workspaceId, datasetId, cases) {
    const res = await EvaluationApiClient.importCases(workspaceId, datasetId, cases as any);
    if (!res.ok) return { status: "error", message: res.error };
    return {
      status: "ready",
      data: {
        importedCount: res.data.imported_count,
        newRevision: res.data.new_revision,
      },
    };
  },

  async listRuns(workspaceId, filter, signal) {
    const res = await EvaluationApiClient.listRuns(workspaceId, filter ?? {}, signal);
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "ready", data: res.data.runs };
  },

  async getRun(workspaceId, runId, signal) {
    const res = await EvaluationApiClient.getRun(workspaceId, runId, signal);
    if (!res.ok) {
      return { status: res.status === 404 ? "not_found" : "error", message: res.error };
    }
    return { status: "ready", data: res.data };
  },

  async startRun(workspaceId, data) {
    const res = await EvaluationApiClient.startRun(workspaceId, {
      agentId: data.agentId,
      agentVersionId: data.versionId,
      datasetId: data.datasetId,
      policy: {
        method: "exact_match",
        config: {},
        scorerVersion: "v1",
      },
    });
    if (!res.ok) return { status: "error", message: res.error };
    return { status: "ready", data: res.data.run };
  },
};
