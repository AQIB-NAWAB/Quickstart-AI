import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  ComparisonCategoryItem,
  EvalCase,
  EvalCaseResult,
  EvalComparison,
  EvalDataset,
  EvalPolicy,
  EvalRun,
  EvalSummary,
  EvaluationGateCheckRequest,
  EvaluationGateCheckResponse,
  ExpectedToolCall,
  FixtureResponse,
  ScoringMethod,
} from "../domain/types.js";
import type { EvalRepository } from "../repository/eval.repository.js";
import type { RuntimeEvalClient } from "../clients/runtime.client.js";
import {
  deterministicVector,
  meanScorePercent,
  scoreExactMatch,
  scoreRetrievalQuality,
  scoreSafetyRefusal,
  scoreSemanticSimilarity,
  scoreToolTrace,
} from "../utils/score.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EvalServiceLimits = {
  maxCasesPerRun: number;
  maxRunsPerWorkspacePerDay: number;
  caseTimeoutMs: number;
  openaiApiKey?: string;
  embeddingProvider?: "openai" | "fake";
};

export class EvalService {
  constructor(
    private readonly repo: EvalRepository,
    private readonly runtime: RuntimeEvalClient | null,
    private readonly limits: EvalServiceLimits,
  ) {}

  /* ========================================================================== */
  /* Datasets                                                                   */
  /* ========================================================================== */

  async createDataset(
    workspaceId: string,
    body: {
      agent_id?: string;
      agentId?: string;
      name: string;
      description?: string;
      tags?: string[];
    },
  ): Promise<EvalDataset> {
    const agentId = (body.agent_id ?? body.agentId ?? "").trim();
    if (!UUID_RE.test(agentId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "agent_id must be a UUID" });
    }
    const name = (body.name ?? "").trim();
    if (!name) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "name is required" });
    }
    return this.repo.createDataset(workspaceId, agentId, {
      name,
      description: body.description,
      tags: body.tags,
    });
  }

  async listDatasets(
    workspaceId: string,
    query: {
      agent_id?: string;
      agentId?: string;
      search?: string;
      sort?: "updated" | "cases" | "pass_rate";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ datasets: EvalDataset[]; total: number }> {
    return this.repo.listDatasets(workspaceId, {
      agentId: query.agent_id ?? query.agentId,
      search: query.search,
      sort: query.sort,
      limit: query.limit,
      offset: query.offset,
    });
  }

  async getDataset(workspaceId: string, datasetId: string): Promise<EvalDataset> {
    if (!UUID_RE.test(datasetId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "datasetId must be a UUID" });
    }
    const dataset = await this.repo.getDataset(workspaceId, datasetId);
    if (!dataset) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Dataset not found" });
    }
    return dataset;
  }

  async updateDataset(
    workspaceId: string,
    datasetId: string,
    body: {
      name?: string;
      description?: string | null;
      tags?: string[];
      expected_record_version?: number;
      expectedRecordVersion?: number;
    },
  ): Promise<EvalDataset> {
    if (!UUID_RE.test(datasetId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "datasetId must be a UUID" });
    }
    return this.repo.updateDataset(workspaceId, datasetId, {
      name: body.name,
      description: body.description,
      tags: body.tags,
      expectedRecordVersion: body.expected_record_version ?? body.expectedRecordVersion,
    });
  }

  async archiveDataset(workspaceId: string, datasetId: string): Promise<void> {
    if (!UUID_RE.test(datasetId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "datasetId must be a UUID" });
    }
    const success = await this.repo.archiveDataset(workspaceId, datasetId);
    if (!success) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Dataset not found or already archived" });
    }
  }

  /* ========================================================================== */
  /* Test Cases                                                                 */
  /* ========================================================================== */

  async createCase(
    workspaceId: string,
    datasetId: string,
    body: {
      name?: string;
      input: string;
      expected_output?: string;
      expectedOutput?: string;
      expected_tools?: ExpectedToolCall[];
      expectedTools?: ExpectedToolCall[];
      fixture_responses?: FixtureResponse[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
    },
  ): Promise<EvalCase> {
    const dataset = await this.getDataset(workspaceId, datasetId);
    const input = (body.input ?? "").trim();
    if (!input) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "input is required" });
    }
    const expectedOutput = (body.expected_output ?? body.expectedOutput ?? "").trim();
    const expectedTools = body.expected_tools ?? body.expectedTools ?? [];
    const fixtureResponses = body.fixture_responses ?? body.fixtureResponses ?? [];

    return this.repo.createCase(workspaceId, datasetId, dataset.agentId, {
      name: body.name,
      input,
      expectedOutput,
      expectedTools,
      fixtureResponses,
      tags: body.tags,
    });
  }

  async listCases(
    workspaceId: string,
    datasetId: string,
    options: { search?: string; tag?: string; offset?: number; limit?: number } = {},
  ): Promise<{ cases: EvalCase[]; total: number }> {
    await this.getDataset(workspaceId, datasetId);
    return this.repo.listCasesByDataset(workspaceId, datasetId, options);
  }

  async getCase(workspaceId: string, datasetId: string, caseId: string): Promise<EvalCase> {
    if (!UUID_RE.test(caseId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "caseId must be a UUID" });
    }
    const testCase = await this.repo.getCase(workspaceId, datasetId, caseId);
    if (!testCase) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Case not found" });
    }
    return testCase;
  }

  async updateCase(
    workspaceId: string,
    datasetId: string,
    caseId: string,
    body: {
      name?: string;
      input?: string;
      expected_output?: string;
      expectedOutput?: string;
      expected_tools?: ExpectedToolCall[];
      expectedTools?: ExpectedToolCall[];
      fixture_responses?: FixtureResponse[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
      expected_record_version?: number;
      expectedRecordVersion?: number;
    },
  ): Promise<EvalCase> {
    await this.getDataset(workspaceId, datasetId);
    return this.repo.updateCase(workspaceId, datasetId, caseId, {
      name: body.name,
      input: body.input,
      expectedOutput: body.expected_output ?? body.expectedOutput,
      expectedTools: body.expected_tools ?? body.expectedTools,
      fixtureResponses: body.fixture_responses ?? body.fixtureResponses,
      tags: body.tags,
      expectedRecordVersion: body.expected_record_version ?? body.expectedRecordVersion,
    });
  }

  async deleteCase(workspaceId: string, datasetId: string, caseId: string): Promise<void> {
    await this.getDataset(workspaceId, datasetId);
    const deleted = await this.repo.deleteCase(workspaceId, datasetId, caseId);
    if (!deleted) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Case not found" });
    }
  }

  async importCases(
    workspaceId: string,
    datasetId: string,
    body: {
      cases: Array<{
        name?: string;
        input: string;
        expected_output?: string;
        expectedOutput?: string;
        expected_tools?: ExpectedToolCall[];
        expectedTools?: ExpectedToolCall[];
        fixture_responses?: FixtureResponse[];
        fixtureResponses?: FixtureResponse[];
        tags?: string[];
      }>;
    },
  ): Promise<{ importedCount: number; newRevision: number }> {
    const dataset = await this.getDataset(workspaceId, datasetId);
    const rawCases = Array.isArray(body.cases) ? body.cases : [];
    if (rawCases.length === 0) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "cases array cannot be empty" });
    }
    if (rawCases.length > 1000) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Maximum 1,000 cases per import" });
    }

    const validatedCases = rawCases.map((c, index) => {
      const input = (c.input ?? "").trim();
      if (!input) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: `Row ${index + 1}: input is required`,
        });
      }
      return {
        name: (c.name ?? "").trim() || `Imported case ${index + 1}`,
        input,
        expectedOutput: (c.expected_output ?? c.expectedOutput ?? "").trim(),
        expectedTools: c.expected_tools ?? c.expectedTools ?? [],
        fixtureResponses: c.fixture_responses ?? c.fixtureResponses ?? [],
        tags: c.tags ?? [],
      };
    });

    return this.repo.batchImportCases(workspaceId, datasetId, dataset.agentId, validatedCases);
  }

  /* ========================================================================== */
  /* Runs                                                                       */
  /* ========================================================================== */

  async createRun(
    workspaceId: string,
    body: {
      agent_id?: string;
      agentId?: string;
      agent_version_id?: string;
      agentVersionId?: string;
      dataset_id?: string;
      datasetId?: string;
      expected_dataset_revision?: number;
      expectedDatasetRevision?: number;
      case_ids?: string[];
      caseIds?: string[];
      policy?: {
        method?: ScoringMethod;
        config?: Record<string, unknown>;
        scorer_version?: string;
      };
      fixture_config?: Record<string, unknown>;
      idempotency_key?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{ run: EvalRun; created: boolean }> {
    const agentId = (body.agent_id ?? body.agentId ?? "").trim();
    if (!UUID_RE.test(agentId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "agent_id must be a UUID" });
    }
    const agentVersionId = (body.agent_version_id ?? body.agentVersionId ?? "").trim();
    if (!UUID_RE.test(agentVersionId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "agent_version_id must be a UUID" });
    }

    const idempotencyKey = (body.idempotency_key ?? body.idempotencyKey)?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.repo.findRunByIdempotencyKey(workspaceId, idempotencyKey);
      if (existing) return { run: existing, created: false };
    }

    const runsToday = await this.repo.countRunsToday(workspaceId);
    if (runsToday >= this.limits.maxRunsPerWorkspacePerDay) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Run cap exceeded: max ${this.limits.maxRunsPerWorkspacePerDay} runs per workspace per day`,
      });
    }

    // Resolve dataset
    let datasetId = (body.dataset_id ?? body.datasetId ?? "").trim();
    let dataset: EvalDataset;
    if (datasetId) {
      dataset = await this.getDataset(workspaceId, datasetId);
    } else {
      dataset = await this.repo.getOrCreateDefaultDataset(workspaceId, agentId);
      datasetId = dataset.id;
    }

    const expectedRevision = body.expected_dataset_revision ?? body.expectedDatasetRevision;
    if (expectedRevision !== undefined && dataset.revision !== expectedRevision) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: `Dataset revision changed from ${expectedRevision} to ${dataset.revision}. Please refresh.`,
      });
    }

    const requestedIds = body.case_ids ?? body.caseIds;
    let cases: EvalCase[];
    if (requestedIds && requestedIds.length > 0) {
      cases = await this.repo.getCasesByIds(workspaceId, requestedIds);
      if (cases.length !== requestedIds.length) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "One or more case_ids were not found in this workspace",
        });
      }
    } else {
      const listRes = await this.repo.listCasesByDataset(workspaceId, datasetId, { limit: 1000 });
      cases = listRes.cases;
    }

    if (cases.length === 0) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Cannot launch evaluation: dataset has 0 test cases",
      });
    }
    if (cases.length > this.limits.maxCasesPerRun) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: `Case cap exceeded: selected ${cases.length} cases (max allowed: ${this.limits.maxCasesPerRun})`,
      });
    }

    const rawPolicy = body.policy ?? {};
    const method: ScoringMethod = rawPolicy.method ?? "exact_match";
    const policy: EvalPolicy = {
      method,
      config: rawPolicy.config ?? {},
      scorerVersion: rawPolicy.scorer_version ?? "v1",
    };

    // Validate policy vs cases requirements
    if (method === "exact_match" || method === "semantic_similarity") {
      const missingExpected = cases.some((c) => !c.expectedOutput && (!c.expectedTools || c.expectedTools.length === 0));
      if (missingExpected) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: `${method} requires test cases to have an expected response`,
        });
      }
    }

    // Freeze dataset snapshot
    const snapshot = await this.repo.createDatasetSnapshot(
      workspaceId,
      datasetId,
      dataset.revision,
      cases,
    );

    try {
      const run = await this.repo.createRun({
        workspaceId,
        agentId,
        agentVersionId,
        datasetId,
        datasetRevision: dataset.revision,
        datasetSnapshotId: snapshot.id,
        cases,
        policy,
        fixtureConfig: body.fixture_config,
        idempotencyKey,
      });
      return { run, created: true };
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "23505" && idempotencyKey) {
        const existing = await this.repo.findRunByIdempotencyKey(workspaceId, idempotencyKey);
        if (existing) return { run: existing, created: false };
      }
      throw err;
    }
  }

  async getRun(
    workspaceId: string,
    runId: string,
  ): Promise<{ run: EvalRun; results: EvalCaseResult[] }> {
    if (!UUID_RE.test(runId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "runId must be a UUID" });
    }
    const run = await this.repo.getRun(workspaceId, runId);
    if (!run) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Eval run not found" });
    }
    const results = await this.repo.listResults(workspaceId, runId);
    return { run, results };
  }

  async listRuns(
    workspaceId: string,
    filters: {
      agent_id?: string;
      agentId?: string;
      version_id?: string;
      versionId?: string;
      status?: string;
      start_date?: string;
      end_date?: string;
      limit?: number;
      offset?: number;
      cursor?: string;
    } = {},
  ): Promise<{ runs: EvalRun[]; total: number; nextCursor: string | null }> {
    return this.repo.listRuns(workspaceId, {
      agentId: filters.agent_id ?? filters.agentId,
      versionId: filters.version_id ?? filters.versionId,
      status: filters.status,
      startDate: filters.start_date ? new Date(filters.start_date) : undefined,
      endDate: filters.end_date ? new Date(filters.end_date) : undefined,
      limit: filters.limit,
      offset: filters.offset,
      cursor: filters.cursor,
    });
  }

  /* ========================================================================== */
  /* Comparisons                                                                */
  /* ========================================================================== */

  async createOrGetComparison(
    workspaceId: string,
    body: { baseline_run_id?: string; baselineRunId?: string; candidate_run_id?: string; candidateRunId?: string },
  ): Promise<EvalComparison> {
    const baselineId = (body.baseline_run_id ?? body.baselineRunId ?? "").trim();
    const candidateId = (body.candidate_run_id ?? body.candidateRunId ?? "").trim();
    if (!UUID_RE.test(baselineId) || !UUID_RE.test(candidateId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "baseline and candidate run IDs must be UUIDs" });
    }
    if (baselineId === candidateId) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Cannot compare a run with itself" });
    }

    const { run: baselineRun, results: baselineResults } = await this.getRun(workspaceId, baselineId);
    const { run: candidateRun, results: candidateResults } = await this.getRun(workspaceId, candidateId);

    if (baselineRun.agentId !== candidateRun.agentId) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Compared runs must evaluate the same agent" });
    }

    if (baselineRun.datasetId && candidateRun.datasetId && baselineRun.datasetId !== candidateRun.datasetId) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Compared runs must evaluate against the same dataset for trustworthy comparison",
      });
    }

    const candidateMap = new Map<string, EvalCaseResult>();
    for (const r of candidateResults) {
      candidateMap.set(r.caseId, r);
    }

    const fixed: ComparisonCategoryItem[] = [];
    const regressed: ComparisonCategoryItem[] = [];
    const unchangedPassed: ComparisonCategoryItem[] = [];
    const unchangedFailed: ComparisonCategoryItem[] = [];

    for (const base of baselineResults) {
      const cand = candidateMap.get(base.caseId);
      if (!cand) continue;

      const item: ComparisonCategoryItem = {
        caseId: base.caseId,
        caseName: base.caseName || "Case",
        baselinePassed: base.passed,
        candidatePassed: cand.passed,
        baselineOutput: base.actualOutput,
        candidateOutput: cand.actualOutput,
        expectedOutput: base.expectedOutput,
        status: "unchanged_passed",
      };

      if (!base.passed && cand.passed) {
        item.status = "fixed";
        fixed.push(item);
      } else if (base.passed && !cand.passed) {
        item.status = "regressed";
        regressed.push(item);
      } else if (base.passed && cand.passed) {
        item.status = "unchanged_passed";
        unchangedPassed.push(item);
      } else {
        item.status = "unchanged_failed";
        unchangedFailed.push(item);
      }
    }

    const matchedCount = fixed.length + regressed.length + unchangedPassed.length + unchangedFailed.length;
    const basePassed = unchangedPassed.length + regressed.length;
    const candPassed = unchangedPassed.length + fixed.length;

    const baselinePassRate = matchedCount > 0 ? Math.round((basePassed / matchedCount) * 1000) / 10 : 0;
    const candidatePassRate = matchedCount > 0 ? Math.round((candPassed / matchedCount) * 1000) / 10 : 0;
    const deltaPercentagePoints = Math.round((candidatePassRate - baselinePassRate) * 10) / 10;

    let latencyDeltaMs: number | null = null;
    if (baselineRun.averageLatencyMs !== null && candidateRun.averageLatencyMs !== null) {
      latencyDeltaMs = Math.round(candidateRun.averageLatencyMs - baselineRun.averageLatencyMs);
    }

    const compatibilityFingerprint = `${baselineRun.agentId}:${baselineRun.datasetId}:${baselineRun.policy.method}`;

    return this.repo.createOrGetComparison({
      workspaceId,
      agentId: baselineRun.agentId,
      baselineRunId: baselineId,
      candidateRunId: candidateId,
      datasetId: candidateRun.datasetId,
      datasetRevision: candidateRun.datasetRevision,
      compatibilityFingerprint,
      matchedCaseCount: matchedCount,
      fixedCount: fixed.length,
      regressedCount: regressed.length,
      unchangedPassedCount: unchangedPassed.length,
      unchangedFailedCount: unchangedFailed.length,
      baselinePassRate,
      candidatePassRate,
      deltaPercentagePoints,
      latencyDeltaMs,
      categories: {
        fixed,
        regressed,
        unchangedPassed,
        unchangedFailed,
      },
    });
  }

  async getComparison(workspaceId: string, comparisonId: string): Promise<EvalComparison> {
    if (!UUID_RE.test(comparisonId)) {
      throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "comparisonId must be a UUID" });
    }
    const comparison = await this.repo.getComparison(workspaceId, comparisonId);
    if (!comparison) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Comparison not found" });
    }
    return comparison;
  }

  async getSummary(workspaceId: string): Promise<EvalSummary> {
    return this.repo.getSummaryMetrics(workspaceId);
  }

  /* ========================================================================== */
  /* Embeddings Helper                                                          */
  /* ========================================================================== */

  private async getEmbedding(text: string): Promise<number[] | null> {
    const isExplicitTestMode =
      process.env.NODE_ENV === "test" ||
      this.limits.embeddingProvider === "fake" ||
      process.env.EVAL_TEST_MODE === "true";

    if (this.limits.embeddingProvider === "openai" && this.limits.openaiApiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.limits.caseTimeoutMs || 10000);
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.limits.openaiApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: text.slice(0, 8000),
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
          if (body.data?.[0]?.embedding) {
            return body.data[0].embedding;
          }
        }
      } catch {
        // Scorer provider unreachable or timed out
      }
    }

    if (isExplicitTestMode) {
      return deterministicVector(text);
    }

    // In production, NEVER publish fake semantic vectors. Distinguish scorer unavailability.
    return null;
  }

  /* ========================================================================== */
  /* Worker Run Processing                                                      */
  /* ========================================================================== */

  async processRun(run: EvalRun, workerId: string = "eval-worker"): Promise<EvalRun> {
    const fenceToken = run.fenceToken ?? workerId;
    const snapshots = await this.repo.listRunCaseSnapshots(run.id);

    let passedCount = 0;
    let failedCount = 0;
    let erroredCount = 0;
    let unavailableCount = 0;
    let totalLatency = 0;
    let latencyReportedCount = 0;
    let hardError: string | null = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    const policy = run.policy;
    const method = policy.method ?? "exact_match";

    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const requestId = randomUUID();

      try {
        let actualOutput: string = "";
        let actualTools: Array<{ name: string; arguments?: Record<string, unknown>; status?: string }> = [];
        let caseLatency: number | null = null;
        let caseTokens: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

        if (this.runtime) {
          const turn = await this.runtime.executeEvalTurn({
            workspaceId: run.workspaceId,
            agentId: run.agentId,
            agentVersionId: run.agentVersionId,
            message: snap.input,
            fixtures: snap.fixtureResponses,
            allowTools: method === "tool_trace" || snap.expectedTools.length > 0,
            idempotencyKey: `${run.id}:${snap.caseId}`,
            requestId,
            deadlineMs: this.limits.caseTimeoutMs,
          });
          actualOutput = turn.assistant_text;
          actualTools = turn.tool_calls ?? [];
          caseLatency = turn.latency_ms;
          caseTokens = turn.token_usage ?? null;
        } else {
          // Synthetic deterministic reply for standalone unit proof
          actualOutput = `fake-reply:${snap.input}`;
          actualTools = snap.expectedTools.map((t) => ({ name: t.name, arguments: t.arguments, status: "succeeded" }));
          caseLatency = 25;
        }

        if (caseLatency !== null) {
          totalLatency += caseLatency;
          latencyReportedCount++;
        }
        if (caseTokens) {
          totalPromptTokens += caseTokens.prompt_tokens ?? 0;
          totalCompletionTokens += caseTokens.completion_tokens ?? 0;
        }

        // Apply scoring
        let scoreVal = 0;
        let isPassed = false;
        let failureReason: string | null = null;
        let executionError: string | null = null;
        let scorerUnavailable = false;

        if (method === "exact_match") {
          const res = scoreExactMatch(snap.expectedOutput, actualOutput);
          isPassed = res.passed;
          scoreVal = res.score;
          failureReason = res.failureReason;
        } else if (method === "semantic_similarity") {
          const threshold = Number(policy.config.threshold ?? 0.85);
          const expVec = await this.getEmbedding(snap.expectedOutput);
          const actVec = await this.getEmbedding(actualOutput);
          if (!expVec || !actVec) {
            isPassed = false;
            scoreVal = 0;
            scorerUnavailable = true;
            failureReason = "Scorer unavailable: embedding provider failed or was not configured";
            executionError = "SCORER_UNAVAILABLE: Embedding provider unreachable or unconfigured in production";
            unavailableCount++;
          } else {
            const res = scoreSemanticSimilarity(expVec, actVec, threshold);
            isPassed = res.passed;
            scoreVal = res.score;
            failureReason = res.failureReason;
          }
        } else if (method === "tool_trace") {
          const res = scoreToolTrace(snap.expectedTools, actualTools, {
            requireOrder: policy.config.requireOrder !== false,
            allowUnexpectedTools: policy.config.allowUnexpectedTools === true,
          });
          isPassed = res.passed;
          scoreVal = res.score;
          failureReason = res.failureReason;
        } else if (method === "safety_refusal") {
          const res = scoreSafetyRefusal(
            policy.config.expectedRefusal ?? true,
            actualOutput,
            actualTools,
            policy.config.forbiddenTools ?? [],
          );
          isPassed = res.passed;
          scoreVal = res.score;
          failureReason = res.failureReason;
        } else if (method === "retrieval_relevance") {
          const expectedList = policy.config.expectedKeywords ?? [snap.expectedOutput];
          const res = scoreRetrievalQuality(
            expectedList,
            actualOutput,
            Number(policy.config.threshold ?? 0.8),
          );
          isPassed = res.passed;
          scoreVal = res.score;
          failureReason = res.failureReason;
        }

        // Latency threshold enforcement if configured
        if (
          isPassed &&
          typeof policy.config.maxLatencyMs === "number" &&
          caseLatency !== null &&
          caseLatency > policy.config.maxLatencyMs
        ) {
          isPassed = false;
          scoreVal = 0;
          failureReason = `Latency ${caseLatency}ms exceeded policy threshold of ${policy.config.maxLatencyMs}ms`;
        }

        if (isPassed) {
          passedCount++;
        } else {
          failedCount++;
        }

        await this.repo.insertCaseResult({
          runId: run.id,
          caseId: snap.caseId,
          workspaceId: run.workspaceId,
          caseName: snap.caseName,
          input: snap.input,
          expectedOutput: snap.expectedOutput,
          actualOutput,
          expectedTools: snap.expectedTools,
          actualTools,
          passed: isPassed,
          score: scoreVal,
          scoringMethod: method,
          failureReason,
          executionError,
          scorerUnavailable,
          latencyMs: caseLatency,
          tokenUsage: caseTokens,
        });
      } catch (err) {
        erroredCount++;
        failedCount++;
        const errMsg = err instanceof Error ? err.message : String(err);
        hardError = errMsg;

        await this.repo.insertCaseResult({
          runId: run.id,
          caseId: snap.caseId,
          workspaceId: run.workspaceId,
          caseName: snap.caseName,
          input: snap.input,
          expectedOutput: snap.expectedOutput,
          actualOutput: null,
          expectedTools: snap.expectedTools,
          actualTools: [],
          passed: false,
          score: 0,
          scoringMethod: method,
          failureReason: `Execution error: ${errMsg}`,
          executionError: errMsg,
          scorerUnavailable: false,
          latencyMs: null,
          tokenUsage: null,
        });
      }

      // Progress reporting & lease extension every 5 cases
      if (i % 5 === 0 || i === snapshots.length - 1) {
        await this.repo.updateRunProgress(run.id, fenceToken, {
          progress: i + 1,
          passedCount,
          failedCount,
          erroredCount,
        });
        await this.repo.renewLease(run.id, fenceToken, 60);
      }
    }

    const finalScore = meanScorePercent(passedCount, snapshots.length);
    const avgLatency =
      latencyReportedCount > 0 ? Math.round(totalLatency / latencyReportedCount) : null;

    const unavailableReason =
      unavailableCount > 0
        ? `${unavailableCount} of ${snapshots.length} cases could not be scored due to scorer unavailability.`
        : null;

    // Run status semantics:
    // "Completed" means execution processed cases. Individual case assertions failing is normal.
    // "Failed" is only for execution-level failure when 0 cases could be evaluated due to hard infrastructure error.
    const isRunFailed = snapshots.length > 0 && erroredCount === snapshots.length;
    const runStatus = isRunFailed ? "failed" : "completed";

    return this.repo.completeRun(run.id, fenceToken, {
      status: runStatus,
      score: isRunFailed ? null : finalScore,
      passedCount,
      failedCount,
      erroredCount,
      unavailableCount,
      unavailableReason,
      averageLatencyMs: avgLatency,
      totalCost: null,
      tokenUsage:
        totalPromptTokens + totalCompletionTokens > 0
          ? {
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalPromptTokens + totalCompletionTokens,
            }
          : null,
      error: isRunFailed ? hardError : unavailableReason,
    });
  }

  /* ========================================================================== */
  /* Evaluation Promotion & Regression Gate Checking                            */
  /* ========================================================================== */

  async evaluatePromotionGate(
    workspaceId: string,
    input: EvaluationGateCheckRequest,
  ): Promise<EvaluationGateCheckResponse> {
    const runsRes = await this.repo.listRuns(workspaceId, {
      agentId: input.agentId,
      versionId: input.candidateVersionId,
      limit: 10,
    });

    const candidateRun = runsRes.runs.find((r) => r.status === "completed");
    const reasons: string[] = [];

    if (!candidateRun) {
      reasons.push(`No completed evaluation run found for version ${input.candidateVersionId}`);
    } else {
      const minPassRate = input.gateConfig?.minPassRatePercent ?? 90;
      if (candidateRun.score === null || candidateRun.score < minPassRate) {
        reasons.push(
          `Candidate pass rate ${candidateRun.score ?? 0}% is below required gate threshold of ${minPassRate}%`,
        );
      }

      if (
        input.gateConfig?.disallowUnavailableScorers !== false &&
        (candidateRun.unavailableCount ?? 0) > 0
      ) {
        reasons.push(
          `Evaluation run contained ${candidateRun.unavailableCount} case(s) with unavailable scorers`,
        );
      }

      if (
        typeof input.gateConfig?.maxAverageLatencyMs === "number" &&
        candidateRun.averageLatencyMs !== null &&
        candidateRun.averageLatencyMs > input.gateConfig.maxAverageLatencyMs
      ) {
        reasons.push(
          `Average latency ${candidateRun.averageLatencyMs}ms exceeded threshold of ${input.gateConfig.maxAverageLatencyMs}ms`,
        );
      }
    }

    let regressedCount = 0;
    if (candidateRun && input.baselineVersionId) {
      const baselineRuns = await this.repo.listRuns(workspaceId, {
        agentId: input.agentId,
        versionId: input.baselineVersionId,
        limit: 10,
      });
      const baselineRun = baselineRuns.runs.find((r) => r.status === "completed");
      if (baselineRun) {
        const comparison = await this.createOrGetComparison(workspaceId, {
          baselineRunId: baselineRun.id,
          candidateRunId: candidateRun.id,
        });
        regressedCount = comparison.regressedCount;
        const maxRegressed = input.gateConfig?.maxRegressedCases ?? 0;
        if (regressedCount > maxRegressed) {
          reasons.push(
            `Found ${regressedCount} regressed test cases against baseline release (maximum allowed: ${maxRegressed})`,
          );
        }
      }
    }

    const gatePassed = reasons.length === 0;
    const isOverridden = !gatePassed && Boolean(input.override?.approved && input.override.reason?.trim());
    const blocked = !gatePassed && !isOverridden;

    const metrics = {
      candidatePassRatePercent: candidateRun?.score ?? null,
      candidateRunId: candidateRun?.id ?? null,
      regressedCasesCount: regressedCount,
      averageLatencyMs: candidateRun?.averageLatencyMs ?? null,
      unavailableCasesCount: candidateRun?.unavailableCount ?? 0,
    };

    let overrideAudit: EvaluationGateCheckResponse["overrideAudit"] = undefined;
    if (isOverridden && input.override) {
      overrideAudit = {
        actorUserId: input.override.actorUserId,
        reason: input.override.reason,
        timestamp: new Date().toISOString(),
      };
    }

    await this.repo.recordGateAudit({
      workspaceId,
      agentId: input.agentId,
      agentVersionId: input.candidateVersionId,
      gatePassed,
      blocked,
      reasons,
      overridden: isOverridden,
      overrideActorId: input.override?.actorUserId ?? null,
      overrideReason: input.override?.reason ?? null,
      metrics,
    });

    return {
      passed: gatePassed || isOverridden,
      blocked,
      reasons,
      metrics,
      overridden: isOverridden,
      overrideAudit,
    };
  }

  /* ========================================================================== */
  /* Legacy Endpoint Compatibility                                              */
  /* ========================================================================== */

  async listLegacyCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    return this.repo.listLegacyCases(workspaceId, agentId);
  }

  async createLegacyCase(
    workspaceId: string,
    agentId: string,
    body: { name?: string; input: string; expected_output?: string; expectedOutput?: string },
  ): Promise<EvalCase> {
    const defaultDs = await this.repo.getOrCreateDefaultDataset(workspaceId, agentId);
    return this.createCase(workspaceId, defaultDs.id, body);
  }

  async listLegacyRuns(workspaceId: string, agentId: string): Promise<EvalRun[]> {
    const res = await this.repo.listRuns(workspaceId, { agentId, limit: 100 });
    return res.runs;
  }
}
