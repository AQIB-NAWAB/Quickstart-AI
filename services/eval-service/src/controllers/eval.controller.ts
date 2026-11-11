import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import { sendPlatformJson, type RequestHandler } from "@quickstart/http-server";
import type {
  EvalCase,
  EvalCaseResult,
  EvalComparison,
  EvalDataset,
  EvalRun,
  EvalSummary,
} from "../domain/types.js";
import type { EvalService } from "../services/eval.service.js";
import { routeParam } from "../utils/route-param.js";

export const EVAL_READ = WORKSPACE_PERMISSIONS.EVAL_READ;
export const EVAL_WRITE = WORKSPACE_PERMISSIONS.EVAL_WRITE;
export const EVAL_RUN = WORKSPACE_PERMISSIONS.EVAL_RUN;

function toApiDataset(d: EvalDataset) {
  return {
    id: d.id,
    workspace_id: d.workspaceId,
    agent_id: d.agentId,
    name: d.name,
    description: d.description,
    tags: d.tags,
    revision: d.revision,
    record_version: d.recordVersion,
    case_count: d.caseCount,
    last_evaluated_version: d.lastEvaluatedVersion ?? null,
    last_pass_rate: d.lastPassRate ?? null,
    archived_at: d.archivedAt?.toISOString() ?? null,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

function toApiCase(c: EvalCase) {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    agent_id: c.agentId,
    dataset_id: c.datasetId,
    name: c.name,
    input: c.input,
    expected_output: c.expectedOutput,
    expected_tools: c.expectedTools,
    fixture_responses: c.fixtureResponses,
    tags: c.tags,
    record_version: c.recordVersion,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

function toApiRun(run: EvalRun) {
  return {
    id: run.id,
    workspace_id: run.workspaceId,
    agent_id: run.agentId,
    agent_version_id: run.agentVersionId,
    dataset_id: run.datasetId,
    dataset_snapshot_id: run.datasetSnapshotId,
    dataset_revision: run.datasetRevision,
    policy: run.policy,
    fixture_config: run.fixtureConfig,
    status: run.status,
    case_count: run.caseCount,
    progress: run.progress,
    score: run.score,
    passed_count: run.passedCount,
    failed_count: run.failedCount,
    errored_count: run.erroredCount,
    average_latency_ms: run.averageLatencyMs,
    total_cost: run.totalCost,
    token_usage: run.tokenUsage,
    idempotency_key: run.idempotencyKey,
    error: run.error,
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
  };
}

function toApiResult(r: EvalCaseResult) {
  return {
    id: r.id,
    run_id: r.runId,
    case_id: r.caseId,
    workspace_id: r.workspaceId,
    case_name: r.caseName,
    input: r.input,
    expected_output: r.expectedOutput,
    actual_output: r.actualOutput,
    expected_tools: r.expectedTools,
    actual_tools: r.actualTools,
    passed: r.passed,
    score: r.score,
    scoring_method: r.scoringMethod,
    failure_reason: r.failureReason,
    execution_error: r.executionError,
    latency_ms: r.latencyMs,
    token_usage: r.tokenUsage,
    error: r.error,
    created_at: r.createdAt.toISOString(),
  };
}

function toApiComparison(c: EvalComparison) {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    agent_id: c.agentId,
    baseline_run_id: c.baselineRunId,
    candidate_run_id: c.candidateRunId,
    dataset_id: c.datasetId,
    dataset_revision: c.datasetRevision,
    compatibility_fingerprint: c.compatibilityFingerprint,
    matched_case_count: c.matchedCaseCount,
    fixed_count: c.fixedCount,
    regressed_count: c.regressedCount,
    unchanged_passed_count: c.unchangedPassedCount,
    unchanged_failed_count: c.unchangedFailedCount,
    baseline_pass_rate: c.baselinePassRate,
    candidate_pass_rate: c.candidatePassRate,
    delta_percentage_points: c.deltaPercentagePoints,
    latency_delta_ms: c.latencyDeltaMs,
    categories: c.categories,
    created_at: c.createdAt.toISOString(),
  };
}

function toApiSummary(s: EvalSummary) {
  return {
    average_pass_rate: s.averagePassRate,
    average_pass_rate_delta: s.averagePassRateDelta,
    evaluated_runs: s.evaluatedRuns,
    evaluated_runs_delta: s.evaluatedRunsDelta,
    active_test_cases: s.activeTestCases,
    regressions_flagged: s.regressionsFlagged,
    period: s.period,
  };
}

/** Sanitize CSV cell against formula injection */
function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  let str = typeof val === "string" ? val : JSON.stringify(val);
  // Protect against formula injection in spreadsheet applications
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape inner double quotes
  return `"${str.replace(/"/g, '""')}"`;
}

export function createEvalController(evals: EvalService) {
  return {
    /* Summary */
    getSummary: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const summary = await evals.getSummary(workspaceId);
      sendPlatformJson(res, 200, { summary: toApiSummary(summary) });
    }) as RequestHandler,

    /* Datasets */
    listDatasets: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const { agent_id, agentId, search, sort, limit, offset } = req.query as Record<string, string>;
      const { datasets, total } = await evals.listDatasets(workspaceId, {
        agentId: agent_id ?? agentId,
        search,
        sort: sort as "updated" | "cases" | "pass_rate",
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      sendPlatformJson(res, 200, {
        datasets: datasets.map(toApiDataset),
        total,
      });
    }) as RequestHandler,

    createDataset: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const dataset = await evals.createDataset(workspaceId, {
        agent_id: body.agent_id as string | undefined,
        agentId: body.agentId as string | undefined,
        name: String(body.name ?? ""),
        description: body.description as string | undefined,
        tags: body.tags as string[] | undefined,
      });
      sendPlatformJson(res, 201, { dataset: toApiDataset(dataset) });
    }) as RequestHandler,

    getDataset: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const dataset = await evals.getDataset(workspaceId, datasetId);
      sendPlatformJson(res, 200, { dataset: toApiDataset(dataset) });
    }) as RequestHandler,

    updateDataset: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const dataset = await evals.updateDataset(workspaceId, datasetId, {
        name: body.name as string | undefined,
        description: body.description as string | null | undefined,
        tags: body.tags as string[] | undefined,
        expected_record_version: body.expected_record_version as number | undefined,
        expectedRecordVersion: body.expectedRecordVersion as number | undefined,
      });
      sendPlatformJson(res, 200, { dataset: toApiDataset(dataset) });
    }) as RequestHandler,

    archiveDataset: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      await evals.archiveDataset(workspaceId, datasetId);
      sendPlatformJson(res, 200, { ok: true });
    }) as RequestHandler,

    /* Test Cases */
    listCases: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const { search, tag, limit, offset } = req.query as Record<string, string>;
      const { cases, total } = await evals.listCases(workspaceId, datasetId, {
        search,
        tag,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
      });
      sendPlatformJson(res, 200, {
        cases: cases.map(toApiCase),
        total,
      });
    }) as RequestHandler,

    createCase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const c = await evals.createCase(workspaceId, datasetId, {
        name: body.name as string | undefined,
        input: String(body.input ?? ""),
        expected_output: body.expected_output as string | undefined,
        expectedOutput: body.expectedOutput as string | undefined,
        expected_tools: body.expected_tools as any,
        expectedTools: body.expectedTools as any,
        fixture_responses: body.fixture_responses as any,
        fixtureResponses: body.fixtureResponses as any,
        tags: body.tags as string[] | undefined,
      });
      sendPlatformJson(res, 201, { case: toApiCase(c) });
    }) as RequestHandler,

    getCase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const caseId = routeParam(req.params.caseId);
      const c = await evals.getCase(workspaceId, datasetId, caseId);
      sendPlatformJson(res, 200, { case: toApiCase(c) });
    }) as RequestHandler,

    updateCase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const caseId = routeParam(req.params.caseId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const c = await evals.updateCase(workspaceId, datasetId, caseId, {
        name: body.name as string | undefined,
        input: body.input as string | undefined,
        expected_output: body.expected_output as string | undefined,
        expectedOutput: body.expectedOutput as string | undefined,
        expected_tools: body.expected_tools as any,
        expectedTools: body.expectedTools as any,
        fixture_responses: body.fixture_responses as any,
        fixtureResponses: body.fixtureResponses as any,
        tags: body.tags as string[] | undefined,
        expected_record_version: body.expected_record_version as number | undefined,
        expectedRecordVersion: body.expectedRecordVersion as number | undefined,
      });
      sendPlatformJson(res, 200, { case: toApiCase(c) });
    }) as RequestHandler,

    deleteCase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const caseId = routeParam(req.params.caseId);
      await evals.deleteCase(workspaceId, datasetId, caseId);
      sendPlatformJson(res, 200, { ok: true });
    }) as RequestHandler,

    importCases: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const body = (req.body ?? {}) as { cases?: any[] };
      const { importedCount, newRevision } = await evals.importCases(workspaceId, datasetId, {
        cases: body.cases ?? [],
      });
      sendPlatformJson(res, 201, {
        imported_count: importedCount,
        new_revision: newRevision,
      });
    }) as RequestHandler,

    exportCases: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const datasetId = routeParam(req.params.datasetId);
      const { cases } = await evals.listCases(workspaceId, datasetId, { limit: 10000 });
      const dataset = await evals.getDataset(workspaceId, datasetId);

      const headers = ["name", "input", "expected_output", "expected_tools", "tags"];
      const lines = [headers.join(",")];

      for (const c of cases) {
        lines.push(
          [
            escapeCsvCell(c.name),
            escapeCsvCell(c.input),
            escapeCsvCell(c.expectedOutput),
            escapeCsvCell(c.expectedTools.length > 0 ? JSON.stringify(c.expectedTools) : ""),
            escapeCsvCell(c.tags.join(";")),
          ].join(","),
        );
      }

      const csvContent = lines.join("\r\n");
      const filename = `dataset-${dataset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-r${dataset.revision}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.status(200).send(csvContent);
    }) as RequestHandler,

    /* Runs */
    listRuns: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const { agent_id, agentId, version_id, versionId, status, start_date, end_date, limit, offset, cursor } =
        req.query as Record<string, string>;
      const { runs, total, nextCursor } = await evals.listRuns(workspaceId, {
        agentId: agent_id ?? agentId,
        versionId: version_id ?? versionId,
        status,
        start_date,
        end_date,
        limit: limit ? Number(limit) : undefined,
        offset: offset ? Number(offset) : undefined,
        cursor,
      });
      sendPlatformJson(res, 200, {
        runs: runs.map(toApiRun),
        total,
        next_cursor: nextCursor,
      });
    }) as RequestHandler,

    createRun: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { run, created } = await evals.createRun(workspaceId, {
        agent_id: body.agent_id as string | undefined,
        agentId: body.agentId as string | undefined,
        agent_version_id: body.agent_version_id as string | undefined,
        agentVersionId: body.agentVersionId as string | undefined,
        dataset_id: body.dataset_id as string | undefined,
        datasetId: body.datasetId as string | undefined,
        expected_dataset_revision: body.expected_dataset_revision as number | undefined,
        expectedDatasetRevision: body.expectedDatasetRevision as number | undefined,
        case_ids: body.case_ids as string[] | undefined,
        caseIds: body.caseIds as string[] | undefined,
        policy: body.policy as any,
        fixture_config: body.fixture_config as any,
        idempotency_key: (body.idempotency_key ?? body.idempotencyKey) as string | null | undefined,
      });
      sendPlatformJson(res, created ? 201 : 200, { run: toApiRun(run), created });
    }) as RequestHandler,

    getRun: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const runId = routeParam(req.params.runId);
      const { run, results } = await evals.getRun(workspaceId, runId);
      sendPlatformJson(res, 200, {
        run: toApiRun(run),
        results: results.map(toApiResult),
      });
    }) as RequestHandler,

    getRunResults: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const runId = routeParam(req.params.runId);
      const { results } = await evals.getRun(workspaceId, runId);
      sendPlatformJson(res, 200, { results: results.map(toApiResult) });
    }) as RequestHandler,

    /* Comparisons */
    createComparison: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const comparison = await evals.createOrGetComparison(workspaceId, {
        baseline_run_id: body.baseline_run_id as string | undefined,
        baselineRunId: body.baselineRunId as string | undefined,
        candidate_run_id: body.candidate_run_id as string | undefined,
        candidateRunId: body.candidateRunId as string | undefined,
      });
      sendPlatformJson(res, 201, { comparison: toApiComparison(comparison) });
    }) as RequestHandler,

    getComparison: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const comparisonId = routeParam(req.params.comparisonId);
      const comparison = await evals.getComparison(workspaceId, comparisonId);
      sendPlatformJson(res, 200, { comparison: toApiComparison(comparison) });
    }) as RequestHandler,

    /* Promotion & Regression Gates */
    checkPromotionGate: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const agentId = routeParam(
        req.params.agentId ?? (body.agent_id as string) ?? (body.agentId as string),
      );
      const candidateVersionId = String(
        body.candidate_version_id ?? body.candidateVersionId ?? "",
      );
      const baselineVersionId =
        body.baseline_version_id ?? body.baselineVersionId
          ? String(body.baseline_version_id ?? body.baselineVersionId)
          : undefined;
      const gateConfig = (body.gate_config ?? body.gateConfig) as any;
      const override = body.override as any;

      const actorUserId = res.locals.actorUserId as string | undefined;
      if (override?.approved && !override.actorUserId && actorUserId) {
        override.actorUserId = actorUserId;
      }

      const gateResult = await evals.evaluatePromotionGate(workspaceId, {
        agentId,
        candidateVersionId,
        baselineVersionId,
        gateConfig,
        override,
      });

      sendPlatformJson(res, 200, { gate: gateResult });
    }) as RequestHandler,

    /* Legacy endpoints */
    legacyListCases: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const agentId = routeParam(req.params.agentId);
      const cases = await evals.listLegacyCases(workspaceId, agentId);
      sendPlatformJson(res, 200, { cases: cases.map(toApiCase) });
    }) as RequestHandler,

    legacyCreateCase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const agentId = routeParam(req.params.agentId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const c = await evals.createLegacyCase(workspaceId, agentId, {
        name: typeof body.name === "string" ? body.name : undefined,
        input: String(body.input ?? ""),
        expected_output: String(body.expected_output ?? body.expectedOutput ?? ""),
      });
      sendPlatformJson(res, 201, { case: toApiCase(c) });
    }) as RequestHandler,

    legacyListRuns: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const agentId = routeParam(req.params.agentId);
      const runs = await evals.listLegacyRuns(workspaceId, agentId);
      sendPlatformJson(res, 200, { runs: runs.map(toApiRun) });
    }) as RequestHandler,
  };
}
