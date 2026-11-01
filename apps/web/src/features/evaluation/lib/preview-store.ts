import {
  SAMPLE_CASES_SUPPORT_BASICS,
  SAMPLE_CASE_RESULTS_RUN_2048,
  SAMPLE_COMPARISON_POINTS,
  SAMPLE_DATASETS,
  SAMPLE_RUNS,
} from "./fixtures";
import type {
  EvaluationCase,
  EvaluationCaseResult,
  EvaluationDataset,
  EvaluationOverviewData,
  EvaluationRepository,
  EvaluationRun,
  RepositoryResult,
} from "./types";

class EvaluationPreviewStore implements EvaluationRepository {
  private datasets: EvaluationDataset[] = [...SAMPLE_DATASETS];
  private casesByDataset: Map<string, EvaluationCase[]> = new Map([
    ["support-basics", [...SAMPLE_CASES_SUPPORT_BASICS]],
    ["tool-routing", []],
    ["safety-responses", []],
  ]);
  private runs: EvaluationRun[] = [...SAMPLE_RUNS];
  private resultsByRun: Map<string, EvaluationCaseResult[]> = new Map([
    ["run_2048", [...SAMPLE_CASE_RESULTS_RUN_2048]],
  ]);

  async getOverview(
    _workspaceId: string,
    agentId: string,
    datasetId = "support-basics",
  ): Promise<RepositoryResult<EvaluationOverviewData>> {
    void _workspaceId;
    const selectedDs = this.datasets.find((d) => d.id === datasetId) || this.datasets[0];
    const latestRun = this.runs.find((r) => r.status === "completed") || null;

    return {
      status: "ready",
      data: {
        agentId,
        agentName: "Support assistant",
        selectedDataset: selectedDs,
        scoringPolicy: "support-v1",
        latestScore: latestRun ? (latestRun.overallScore ?? latestRun.score ?? 82) : 82,
        scoreScale: 100,
        passedCases: latestRun ? (latestRun.passedCount ?? 8) : 8,
        failedCases: latestRun ? (latestRun.failedCount ?? 2) : 2,
        totalCases: selectedDs.caseCount,
        latestRun,
        comparison: [...SAMPLE_COMPARISON_POINTS],
        datasets: [...this.datasets],
        recentRuns: [...this.runs],
      },
    };
  }

  async listDatasets(_workspaceId: string): Promise<RepositoryResult<EvaluationDataset[]>> {
    void _workspaceId;
    return {
      status: "ready",
      data: [...this.datasets],
    };
  }

  async getDataset(
    _workspaceId: string,
    datasetId: string,
  ): Promise<RepositoryResult<{ dataset: EvaluationDataset; cases: EvaluationCase[] }>> {
    void _workspaceId;
    const ds = this.datasets.find((d) => d.id === datasetId);
    if (!ds) {
      return { status: "not_found", message: "Dataset not found" };
    }
    const cases = this.casesByDataset.get(datasetId) || [];
    return {
      status: "ready",
      data: {
        dataset: { ...ds },
        cases: [...cases],
      },
    };
  }

  async createDataset(
    workspaceId: string,
    data: { agentId?: string; name: string; description?: string },
  ): Promise<RepositoryResult<EvaluationDataset>> {
    const newDs: EvaluationDataset = {
      id: `ds_${Math.random().toString(36).substring(2, 8)}`,
      workspaceId,
      agentId: data.agentId ?? "all",
      name: data.name,
      description: data.description,
      tags: [],
      revision: 1,
      recordVersion: 1,
      caseCount: 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.datasets.unshift(newDs);
    this.casesByDataset.set(newDs.id, []);
    return { status: "ready", data: newDs };
  }

  async saveTestCase(
    _workspaceId: string,
    datasetId: string,
    caseData: Partial<EvaluationCase> & { input: string; name: string },
  ): Promise<RepositoryResult<EvaluationCase>> {
    void _workspaceId;
    const cases = this.casesByDataset.get(datasetId) || [];
    let savedCase: EvaluationCase;

    if (caseData.id) {
      const idx = cases.findIndex((c) => c.id === caseData.id);
      if (idx !== -1) {
        savedCase = {
          ...cases[idx],
          name: caseData.name,
          input: caseData.input,
          expectedOutput: caseData.expectedOutput || "",
          expectedTools: caseData.expectedTools || [],
        };
        cases[idx] = savedCase;
      } else {
        savedCase = {
          id: caseData.id,
          workspaceId: _workspaceId,
          datasetId,
          name: caseData.name,
          input: caseData.input,
          expectedOutput: caseData.expectedOutput || "",
          expectedTools: caseData.expectedTools || [],
          fixtureResponses: [],
          tags: [],
          recordVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        cases.push(savedCase);
      }
    } else {
      savedCase = {
        id: `case_${Math.random().toString(36).substring(2, 7)}`,
        workspaceId: _workspaceId,
        datasetId,
        name: caseData.name,
        input: caseData.input,
        expectedOutput: caseData.expectedOutput || "",
        expectedTools: caseData.expectedTools || [],
        fixtureResponses: [],
        tags: [],
        recordVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      cases.push(savedCase);
    }

    this.casesByDataset.set(datasetId, cases);

    // Increment dataset revision
    const dsIdx = this.datasets.findIndex((d) => d.id === datasetId);
    if (dsIdx !== -1) {
      this.datasets[dsIdx] = {
        ...this.datasets[dsIdx],
        revision: this.datasets[dsIdx].revision + 1,
        caseCount: cases.length,
        updatedAt: new Date().toISOString(),
      };
    }

    return { status: "ready", data: savedCase };
  }

  async importCases(
    _workspaceId: string,
    datasetId: string,
    newCases: Partial<EvaluationCase>[],
  ): Promise<RepositoryResult<{ importedCount: number; newRevision: number }>> {
    void _workspaceId;
    const cases = this.casesByDataset.get(datasetId) || [];
    const added: EvaluationCase[] = newCases.map((c, i) => ({
      id: `case_import_${Date.now()}_${i}`,
      workspaceId: _workspaceId,
      datasetId,
      name: c.name || `Imported case ${i + 1}`,
      input: c.input || "",
      expectedOutput: c.expectedOutput || "",
      expectedTools: c.expectedTools || [],
      fixtureResponses: [],
      tags: c.tags || [],
      recordVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const combined = [...cases, ...added];
    this.casesByDataset.set(datasetId, combined);

    let newRevision = 1;
    const dsIdx = this.datasets.findIndex((d) => d.id === datasetId);
    if (dsIdx !== -1) {
      newRevision = this.datasets[dsIdx].revision + 1;
      this.datasets[dsIdx] = {
        ...this.datasets[dsIdx],
        revision: newRevision,
        caseCount: combined.length,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      status: "ready",
      data: {
        importedCount: added.length,
        newRevision,
      },
    };
  }

  async listRuns(
    _workspaceId: string,
    filter?: { agentId?: string; status?: string },
  ): Promise<RepositoryResult<EvaluationRun[]>> {
    void _workspaceId;
    let result = [...this.runs];
    if (filter?.agentId) {
      result = result.filter((r) => r.agentId === filter.agentId);
    }
    if (filter?.status && filter.status !== "all") {
      result = result.filter((r) => r.status === filter.status);
    }
    return { status: "ready", data: result };
  }

  async getRun(
    _workspaceId: string,
    runId: string,
  ): Promise<RepositoryResult<{ run: EvaluationRun; results: EvaluationCaseResult[] }>> {
    void _workspaceId;
    const run = this.runs.find((r) => r.id === runId);
    if (!run) {
      return { status: "not_found", message: "Run not found" };
    }
    const results = this.resultsByRun.get(runId) || SAMPLE_CASE_RESULTS_RUN_2048;
    return {
      status: "ready",
      data: {
        run: { ...run },
        results: [...results],
      },
    };
  }

  async startRun(
    workspaceId: string,
    data: { agentId: string; versionId: string; datasetId: string },
  ): Promise<RepositoryResult<EvaluationRun>> {
    const ds = this.datasets.find((d) => d.id === data.datasetId) || this.datasets[0];
    const newRun: EvaluationRun = {
      id: `run_${Math.floor(1000 + Math.random() * 9000)}`,
      workspaceId,
      agentId: data.agentId,
      agentName: "Support assistant",
      versionId: data.versionId,
      displayVersion: data.versionId.replace("ver_", "").toUpperCase(),
      datasetId: ds.id,
      datasetName: ds.name,
      datasetRevision: ds.revision,
      scoringPolicy: "support-v1",
      status: "running",
      overallScore: null,
      scoreScale: 100,
      passedCount: null,
      failedCount: null,
      totalCases: ds.caseCount,
      startedAt: new Date().toISOString(),
    };
    this.runs.unshift(newRun);
    return { status: "ready", data: newRun };
  }
}

export const evaluationPreviewStore = new EvaluationPreviewStore();
