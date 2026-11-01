export type RunStatus = "queued" | "running" | "completed" | "failed";
export type ScoringMethod = "exact_match" | "semantic_similarity" | "tool_trace";

export interface ExpectedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  order?: number;
}

export interface FixtureResponse {
  toolName: string;
  matchArgs?: Record<string, unknown>;
  response: Record<string, unknown>;
}

export interface EvaluationDataset {
  id: string;
  workspaceId: string;
  agentId?: string;
  agentName?: string;
  name: string;
  description?: string | null;
  tags?: string[];
  revision: number;
  recordVersion?: number;
  caseCount: number;
  lastEvaluatedVersion?: string | null;
  lastPassRate?: number | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationCase {
  id: string;
  workspaceId?: string;
  agentId?: string;
  datasetId: string;
  name: string;
  input: string;
  expectedOutput: string;
  expectedTools: ExpectedToolCall[];
  fixtureResponses?: FixtureResponse[];
  tags?: string[];
  recordVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EvaluationRun {
  id: string;
  workspaceId: string;
  agentId: string;
  agentName?: string;
  agentVersionId?: string;
  versionId?: string;
  displayVersion?: string;
  datasetId: string | null;
  datasetName?: string;
  datasetSnapshotId?: string | null;
  datasetRevision: number;
  scoringPolicy?: string;
  scoreScale?: number;
  policy?: {
    method: ScoringMethod;
    config: Record<string, unknown>;
    scorerVersion: string;
  };
  fixtureConfig?: Record<string, unknown> | null;
  status: RunStatus;
  caseCount?: number;
  totalCases?: number;
  progress?: number;
  score?: number | null;
  overallScore?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  erroredCount?: number | null;
  averageLatencyMs?: number | null;
  totalCost?: number | null;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  idempotencyKey?: string | null;
  error?: string | null;
  startedAt: string | null;
  finishedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EvaluationCaseResult {
  id?: string;
  runCaseId?: string;
  runId: string;
  caseId: string;
  workspaceId?: string;
  caseName: string;
  input: string;
  expectedOutput: string;
  actualOutput: string | null;
  expectedTools: ExpectedToolCall[];
  actualTools: Array<{ name: string; arguments?: Record<string, unknown>; status?: string }>;
  passed?: boolean;
  outcome?: "passed" | "failed" | "error";
  score: number | null;
  scoreScale?: number;
  scoringMethod?: ScoringMethod;
  failureReason?: string | null;
  failureReasons?: string[] | null;
  executionError?: string | null;
  latencyMs?: number | null;
  tokenUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  error?: string | null;
  createdAt?: string;
}

export interface ComparisonCategoryItem {
  caseId: string;
  caseName: string;
  baselinePassed: boolean;
  candidatePassed: boolean;
  baselineOutput?: string | null;
  candidateOutput?: string | null;
  expectedOutput?: string;
  status: "fixed" | "regressed" | "unchanged_passed" | "unchanged_failed";
}

export interface EvaluationComparison {
  id: string;
  workspaceId: string;
  agentId: string;
  baselineRunId: string;
  candidateRunId: string;
  datasetId: string | null;
  datasetRevision: number | null;
  compatibilityFingerprint: string;
  matchedCaseCount: number;
  fixedCount: number;
  regressedCount: number;
  unchangedPassedCount: number;
  unchangedFailedCount: number;
  baselinePassRate: number;
  candidatePassRate: number;
  deltaPercentagePoints: number;
  latencyDeltaMs: number | null;
  categories: {
    fixed: ComparisonCategoryItem[];
    regressed: ComparisonCategoryItem[];
    unchangedPassed: ComparisonCategoryItem[];
    unchangedFailed: ComparisonCategoryItem[];
  };
  createdAt: string;
}

export interface VersionComparisonPoint {
  version: string;
  score: number;
  passed: number;
  total: number;
  date: string;
}

export type RepositoryResult<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "not_found"; message: string }
  | { status: "error"; message: string };

export interface EvaluationSummary {
  averagePassRate: number | null;
  averagePassRateDelta: number | null;
  evaluatedRuns: number;
  evaluatedRunsDelta: number | null;
  activeTestCases: number;
  regressionsFlagged: number;
  period: string;
}

export interface EvaluationOverviewData {
  agentId: string;
  agentName: string;
  selectedDataset: EvaluationDataset;
  scoringPolicy: string;
  latestScore: number | null;
  scoreScale: number;
  passedCases: number | null;
  failedCases: number | null;
  totalCases: number;
  latestRun: EvaluationRun | null;
  comparison: VersionComparisonPoint[];
  datasets: EvaluationDataset[];
  recentRuns: EvaluationRun[];
  summary?: EvaluationSummary;
}

export interface EvaluationRepository {
  getOverview(
    workspaceId: string,
    agentId: string,
    datasetId?: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<EvaluationOverviewData>>;

  listDatasets(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<EvaluationDataset[]>>;

  getDataset(
    workspaceId: string,
    datasetId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ dataset: EvaluationDataset; cases: EvaluationCase[] }>>;

  createDataset(
    workspaceId: string,
    data: { agentId?: string; name: string; description?: string; tags?: string[] },
  ): Promise<RepositoryResult<EvaluationDataset>>;

  saveTestCase(
    workspaceId: string,
    datasetId: string,
    caseData: Partial<EvaluationCase> & { input: string; name: string },
  ): Promise<RepositoryResult<EvaluationCase>>;

  importCases(
    workspaceId: string,
    datasetId: string,
    cases: Partial<EvaluationCase>[],
  ): Promise<RepositoryResult<{ importedCount: number; newRevision: number }>>;

  listRuns(
    workspaceId: string,
    filter?: { agentId?: string; status?: string },
    signal?: AbortSignal,
  ): Promise<RepositoryResult<EvaluationRun[]>>;

  getRun(
    workspaceId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<RepositoryResult<{ run: EvaluationRun; results: EvaluationCaseResult[] }>>;

  startRun(
    workspaceId: string,
    data: { agentId: string; versionId: string; datasetId: string },
  ): Promise<RepositoryResult<EvaluationRun>>;
}
