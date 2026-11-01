import { gatewayFetch, getAccessTokenFromCookies } from "@/lib/server/gateway/fetch";
import { mapApiCase, mapApiCaseResult, mapApiDataset, mapApiRun, mapApiSummary } from "./mappers";
import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationDataset,
  EvaluationOverviewData,
  EvaluationRepository,
  EvaluationRun,
  RepositoryResult,
} from "./types";

function fail<T>(status: number, message: string): RepositoryResult<T> {
  if (status === 404) return { status: "not_found", message };
  if (status === 403) return { status: "forbidden", message };
  if (status === 503) return { status: "unavailable", message };
  return { status: "error", message };
}

export const serverEvaluationRepository: EvaluationRepository = {
  async getOverview(
    workspaceId: string,
    agentId: string,
    datasetId?: string,
  ): Promise<RepositoryResult<EvaluationOverviewData>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const [datasetsRes, runsRes, summaryRes] = await Promise.all([
      gatewayFetch<{ datasets: any[]; total: number }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets?limit=50`,
        { accessToken: token },
      ),
      gatewayFetch<{ runs: any[]; total: number }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/runs?limit=20`,
        { accessToken: token },
      ),
      gatewayFetch<{ summary: any }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/summary`,
        { accessToken: token },
      ),
    ]);

    if (!datasetsRes.ok) return fail(datasetsRes.status, datasetsRes.error.message);

    const datasets = (datasetsRes.data.datasets ?? []).map(mapApiDataset);
    const runs = runsRes.ok ? (runsRes.data.runs ?? []).map(mapApiRun) : [];
    const summary = summaryRes.ok ? mapApiSummary(summaryRes.data.summary) : undefined;

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
        summary,
      },
    };
  },

  async listDatasets(workspaceId: string): Promise<RepositoryResult<EvaluationDataset[]>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const res = await gatewayFetch<{ datasets: any[]; total: number }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets?limit=100`,
      { accessToken: token },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return {
      status: "ready",
      data: (res.data.datasets ?? []).map(mapApiDataset),
    };
  },

  async getDataset(
    workspaceId: string,
    datasetId: string,
  ): Promise<RepositoryResult<{ dataset: EvaluationDataset; cases: EvaluationCase[] }>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const [datasetRes, casesRes] = await Promise.all([
      gatewayFetch<{ dataset: any }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}`,
        { accessToken: token },
      ),
      gatewayFetch<{ cases: any[]; total: number }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases?limit=200`,
        { accessToken: token },
      ),
    ]);

    if (!datasetRes.ok) return fail(datasetRes.status, datasetRes.error.message);

    const dataset = mapApiDataset(datasetRes.data.dataset);
    const cases = casesRes.ok ? (casesRes.data.cases ?? []).map(mapApiCase) : [];

    return {
      status: "ready",
      data: { dataset, cases },
    };
  },

  async createDataset(
    workspaceId: string,
    data: { agentId?: string; name: string; description?: string; tags?: string[] },
  ): Promise<RepositoryResult<EvaluationDataset>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");
    if (!data.agentId) return fail(400, "Select an agent before creating a dataset");

    const res = await gatewayFetch<{ dataset: any }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets`,
      {
        accessToken: token,
        method: "POST",
        body: JSON.stringify({ ...data, agent_id: data.agentId }),
      },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return { status: "ready", data: mapApiDataset(res.data.dataset) };
  },

  async saveTestCase(
    workspaceId: string,
    datasetId: string,
    caseData: Partial<EvaluationCase> & { input: string; name: string },
  ): Promise<RepositoryResult<EvaluationCase>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    if (caseData.id) {
      const res = await gatewayFetch<{ case: any }>(
        `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseData.id)}`,
        {
          accessToken: token,
          method: "PATCH",
          body: JSON.stringify({
            name: caseData.name,
            input: caseData.input,
            expected_output: caseData.expectedOutput,
            expected_tools: caseData.expectedTools,
            fixture_responses: caseData.fixtureResponses,
            tags: caseData.tags,
            expected_record_version: caseData.recordVersion,
          }),
        },
      );
      if (!res.ok) return fail(res.status, res.error.message);
      return { status: "ready", data: mapApiCase(res.data.case) };
    }

    const res = await gatewayFetch<{ case: any }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/cases`,
      {
        accessToken: token,
        method: "POST",
        body: JSON.stringify({
          name: caseData.name,
          input: caseData.input,
          expected_output: caseData.expectedOutput,
          expected_tools: caseData.expectedTools,
          fixture_responses: caseData.fixtureResponses,
          tags: caseData.tags,
        }),
      },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return { status: "ready", data: mapApiCase(res.data.case) };
  },

  async importCases(
    workspaceId: string,
    datasetId: string,
    cases: Partial<EvaluationCase>[],
  ): Promise<RepositoryResult<{ importedCount: number; newRevision: number }>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const res = await gatewayFetch<{ imported_count: number; new_revision: number }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(datasetId)}/import`,
      {
        accessToken: token,
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

    if (!res.ok) return fail(res.status, res.error.message);
    return {
      status: "ready",
      data: {
        importedCount: res.data.imported_count,
        newRevision: res.data.new_revision,
      },
    };
  },

  async listRuns(
    workspaceId: string,
    filter?: { agentId?: string; status?: string },
  ): Promise<RepositoryResult<EvaluationRun[]>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const qs = new URLSearchParams();
    if (filter?.agentId) qs.set("agent_id", filter.agentId);
    if (filter?.status) qs.set("status", filter.status);
    qs.set("limit", "50");

    const res = await gatewayFetch<{ runs: any[]; total: number }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/runs?${qs.toString()}`,
      { accessToken: token },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return {
      status: "ready",
      data: (res.data.runs ?? []).map(mapApiRun),
    };
  },

  async getRun(
    workspaceId: string,
    runId: string,
  ): Promise<RepositoryResult<{ run: EvaluationRun; results: EvaluationCaseResult[] }>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const res = await gatewayFetch<{ run: any; results: any[] }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/runs/${encodeURIComponent(runId)}`,
      { accessToken: token },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return {
      status: "ready",
      data: {
        run: mapApiRun(res.data.run),
        results: (res.data.results ?? []).map(mapApiCaseResult),
      },
    };
  },

  async startRun(
    workspaceId: string,
    data: { agentId: string; versionId: string; datasetId: string },
  ): Promise<RepositoryResult<EvaluationRun>> {
    const token = await getAccessTokenFromCookies();
    if (!token) return fail(401, "Not signed in");

    const res = await gatewayFetch<{ run: any; created: boolean }>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/eval/runs`,
      {
        accessToken: token,
        method: "POST",
        body: JSON.stringify({
          agent_id: data.agentId,
          agent_version_id: data.versionId,
          dataset_id: data.datasetId,
          policy: {
            method: "exact_match",
            config: {},
            scorer_version: "v1",
          },
        }),
      },
    );

    if (!res.ok) return fail(res.status, res.error.message);
    return { status: "ready", data: mapApiRun(res.data.run) };
  },
};
