import type { Pool, PoolClient } from "pg";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  EvalCase,
  EvalCaseResult,
  EvalComparison,
  EvalDataset,
  EvalDatasetSnapshot,
  EvalPolicy,
  EvalRun,
  EvalRunCaseSnapshot,
  EvalRunStatus,
  EvalSummary,
  ExpectedToolCall,
  FixtureResponse,
  ScoringMethod,
} from "../domain/types.js";

type DatasetRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  name: string;
  description: string | null;
  tags: string[];
  revision: number;
  record_version: number;
  case_count?: string | number;
  last_evaluated_version?: string | null;
  last_pass_rate?: string | number | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CaseRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  dataset_id: string;
  name: string;
  input: string;
  expected_output: string;
  expected_tools: unknown;
  fixture_responses: unknown;
  tags: string[];
  record_version: number;
  created_at: Date;
  updated_at: Date;
};

type RunRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  agent_version_id: string;
  dataset_id: string | null;
  dataset_snapshot_id: string | null;
  dataset_revision: number;
  policy: unknown;
  fixture_config: unknown;
  status: EvalRunStatus;
  case_count: number;
  progress: number;
  score: string | number | null;
  passed_count: number;
  failed_count: number;
  errored_count: number;
  unavailable_count?: number;
  unavailable_reason?: string | null;
  average_latency_ms: string | number | null;
  total_cost: string | number | null;
  token_usage: unknown;
  idempotency_key: string | null;
  error: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  lease_expires_at: Date | null;
  fence_token: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type ResultRow = {
  id: string;
  run_id: string;
  case_id: string;
  workspace_id: string;
  case_name: string;
  input: string;
  expected_output: string;
  actual_output: string | null;
  expected_tools: unknown;
  actual_tools: unknown;
  passed: boolean;
  score: string | number | null;
  scoring_method: string;
  failure_reason: string | null;
  execution_error: string | null;
  scorer_unavailable?: boolean;
  latency_ms: string | number | null;
  token_usage: unknown;
  error: string | null;
  created_at: Date;
};

type ComparisonRow = {
  id: string;
  workspace_id: string;
  agent_id: string;
  baseline_run_id: string;
  candidate_run_id: string;
  dataset_id: string | null;
  dataset_revision: number | null;
  compatibility_fingerprint: string;
  matched_case_count: number;
  fixed_count: number;
  regressed_count: number;
  unchanged_passed_count: number;
  unchanged_failed_count: number;
  baseline_pass_rate: string | number;
  candidate_pass_rate: string | number;
  delta_percentage_points: string | number;
  latency_delta_ms: string | number | null;
  categories_json: unknown;
  created_at: Date;
};

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapDataset(row: DatasetRow): EvalDataset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    tags: Array.isArray(row.tags) ? row.tags : [],
    revision: Number(row.revision ?? 1),
    recordVersion: Number(row.record_version ?? 1),
    caseCount: Number(row.case_count ?? 0),
    lastEvaluatedVersion: row.last_evaluated_version ?? null,
    lastPassRate: toNumber(row.last_pass_rate),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCase(row: CaseRow): EvalCase {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    datasetId: row.dataset_id,
    name: row.name,
    input: row.input,
    expectedOutput: row.expected_output,
    expectedTools: Array.isArray(row.expected_tools) ? (row.expected_tools as ExpectedToolCall[]) : [],
    fixtureResponses: Array.isArray(row.fixture_responses)
      ? (row.fixture_responses as FixtureResponse[])
      : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    recordVersion: Number(row.record_version ?? 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): EvalRun {
  const policyObj = (row.policy && typeof row.policy === "object" ? row.policy : {}) as Partial<EvalPolicy>;
  const policy: EvalPolicy = {
    method: (policyObj.method as ScoringMethod) ?? "exact_match",
    config: (policyObj.config as EvalPolicy["config"]) ?? {},
    scorerVersion: policyObj.scorerVersion ?? "v1",
  };

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    datasetId: row.dataset_id,
    datasetSnapshotId: row.dataset_snapshot_id,
    datasetRevision: Number(row.dataset_revision ?? 1),
    policy,
    fixtureConfig: (row.fixture_config as Record<string, unknown>) ?? null,
    status: row.status,
    caseCount: Number(row.case_count ?? 0),
    progress: Number(row.progress ?? 0),
    score: toNumber(row.score),
    passedCount: Number(row.passed_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    erroredCount: Number(row.errored_count ?? 0),
    unavailableCount: Number(row.unavailable_count ?? 0),
    unavailableReason: row.unavailable_reason ?? null,
    averageLatencyMs: toNumber(row.average_latency_ms),
    totalCost: toNumber(row.total_cost),
    tokenUsage: (row.token_usage as EvalRun["tokenUsage"]) ?? null,
    idempotencyKey: row.idempotency_key,
    error: row.error,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    fenceToken: row.fence_token,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResult(row: ResultRow): EvalCaseResult {
  return {
    id: row.id,
    runId: row.run_id,
    caseId: row.case_id,
    workspaceId: row.workspace_id,
    caseName: row.case_name ?? "",
    input: row.input ?? "",
    expectedOutput: row.expected_output,
    actualOutput: row.actual_output,
    expectedTools: Array.isArray(row.expected_tools) ? (row.expected_tools as ExpectedToolCall[]) : [],
    actualTools: Array.isArray(row.actual_tools) ? (row.actual_tools as EvalCaseResult["actualTools"]) : [],
    passed: row.passed,
    score: toNumber(row.score),
    scoringMethod: (row.scoring_method as ScoringMethod) ?? "exact_match",
    failureReason: row.failure_reason,
    executionError: row.execution_error,
    scorerUnavailable: Boolean(row.scorer_unavailable),
    latencyMs: toNumber(row.latency_ms),
    tokenUsage: (row.token_usage as EvalCaseResult["tokenUsage"]) ?? null,
    error: row.error,
    createdAt: row.created_at,
  };
}

function mapComparison(row: ComparisonRow): EvalComparison {
  const categories = (row.categories_json && typeof row.categories_json === "object"
    ? row.categories_json
    : {}) as EvalComparison["categories"];

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    baselineRunId: row.baseline_run_id,
    candidateRunId: row.candidate_run_id,
    datasetId: row.dataset_id,
    datasetRevision: row.dataset_revision,
    compatibilityFingerprint: row.compatibility_fingerprint,
    matchedCaseCount: Number(row.matched_case_count ?? 0),
    fixedCount: Number(row.fixed_count ?? 0),
    regressedCount: Number(row.regressed_count ?? 0),
    unchangedPassedCount: Number(row.unchanged_passed_count ?? 0),
    unchangedFailedCount: Number(row.unchanged_failed_count ?? 0),
    baselinePassRate: Number(row.baseline_pass_rate ?? 0),
    candidatePassRate: Number(row.candidate_pass_rate ?? 0),
    deltaPercentagePoints: Number(row.delta_percentage_points ?? 0),
    latencyDeltaMs: toNumber(row.latency_delta_ms),
    categories: {
      fixed: categories.fixed ?? [],
      regressed: categories.regressed ?? [],
      unchangedPassed: categories.unchangedPassed ?? [],
      unchangedFailed: categories.unchangedFailed ?? [],
    },
    createdAt: row.created_at,
  };
}

export class EvalRepository {
  constructor(private readonly pool: Pool) {}

  /* ========================================================================== */
  /* Datasets                                                                   */
  /* ========================================================================== */

  async createDataset(
    workspaceId: string,
    agentId: string,
    input: { name: string; description?: string; tags?: string[] },
  ): Promise<EvalDataset> {
    const result = await this.pool.query<DatasetRow>(
      `INSERT INTO eval_datasets (
         workspace_id, agent_id, name, description, tags, revision, record_version
       ) VALUES ($1, $2, $3, $4, $5, 1, 1)
       RETURNING *`,
      [
        workspaceId,
        agentId,
        input.name.trim().slice(0, 255),
        input.description?.trim().slice(0, 2000) || null,
        input.tags ? input.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean) : [],
      ],
    );
    return mapDataset(result.rows[0]);
  }

  async listDatasets(
    workspaceId: string,
    filters: {
      agentId?: string;
      search?: string;
      sort?: "updated" | "cases" | "pass_rate";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ datasets: EvalDataset[]; total: number }> {
    const conditions = ["d.workspace_id = $1", "d.archived_at IS NULL"];
    const params: unknown[] = [workspaceId];

    if (filters.agentId) {
      params.push(filters.agentId);
      conditions.push(`d.agent_id = $${params.length}`);
    }

    if (filters.search) {
      params.push(`%${filters.search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(d.name) LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE LOWER(t) LIKE $${params.length}))`,
      );
    }

    let orderBy = "d.updated_at DESC";
    if (filters.sort === "cases") {
      orderBy = "case_count DESC, d.updated_at DESC";
    } else if (filters.sort === "pass_rate") {
      orderBy = "last_pass_rate DESC NULLS LAST, d.updated_at DESC";
    }

    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    const countQuery = `
      SELECT COUNT(*)::text AS total
      FROM eval_datasets d
      WHERE ${conditions.join(" AND ")}
    `;
    const countResult = await this.pool.query<{ total: string }>(countQuery, params);
    const total = Number(countResult.rows[0]?.total ?? 0);

    const query = `
      SELECT
        d.*,
        COALESCE(c.case_count, 0) AS case_count,
        lr.agent_version_id AS last_evaluated_version,
        lr.score AS last_pass_rate
      FROM eval_datasets d
      LEFT JOIN (
        SELECT dataset_id, COUNT(*) AS case_count
        FROM eval_cases
        GROUP BY dataset_id
      ) c ON c.dataset_id = d.id
      LEFT JOIN LATERAL (
        SELECT r.agent_version_id, r.score
        FROM eval_runs r
        WHERE r.dataset_id = d.id AND r.status = 'completed'
        ORDER BY r.finished_at DESC NULLS LAST
        LIMIT 1
      ) lr ON true
      WHERE ${conditions.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const result = await this.pool.query<DatasetRow>(query, [...params, limit, offset]);
    return {
      datasets: result.rows.map(mapDataset),
      total,
    };
  }

  async getDataset(workspaceId: string, datasetId: string): Promise<EvalDataset | null> {
    const result = await this.pool.query<DatasetRow>(
      `SELECT
         d.*,
         COALESCE(c.case_count, 0) AS case_count,
         lr.agent_version_id AS last_evaluated_version,
         lr.score AS last_pass_rate
       FROM eval_datasets d
       LEFT JOIN (
         SELECT dataset_id, COUNT(*) AS case_count
         FROM eval_cases
         GROUP BY dataset_id
       ) c ON c.dataset_id = d.id
       LEFT JOIN LATERAL (
         SELECT r.agent_version_id, r.score
         FROM eval_runs r
         WHERE r.dataset_id = d.id AND r.status = 'completed'
         ORDER BY r.finished_at DESC NULLS LAST
         LIMIT 1
       ) lr ON true
       WHERE d.id = $1 AND d.workspace_id = $2`,
      [datasetId, workspaceId],
    );
    return result.rows[0] ? mapDataset(result.rows[0]) : null;
  }

  async updateDataset(
    workspaceId: string,
    datasetId: string,
    patch: {
      name?: string;
      description?: string | null;
      tags?: string[];
      expectedRecordVersion?: number;
    },
  ): Promise<EvalDataset> {
    const existing = await this.getDataset(workspaceId, datasetId);
    if (!existing) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Dataset not found" });
    }
    if (
      patch.expectedRecordVersion !== undefined &&
      existing.recordVersion !== patch.expectedRecordVersion
    ) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "Dataset was modified concurrently. Please refresh.",
      });
    }

    const updates: string[] = ["record_version = record_version + 1", "updated_at = NOW()"];
    const params: unknown[] = [datasetId, workspaceId];

    if (patch.name !== undefined) {
      params.push(patch.name.trim().slice(0, 255));
      updates.push(`name = $${params.length}`);
    }
    if (patch.description !== undefined) {
      params.push(patch.description?.trim().slice(0, 2000) || null);
      updates.push(`description = $${params.length}`);
    }
    if (patch.tags !== undefined) {
      params.push(patch.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean));
      updates.push(`tags = $${params.length}`);
    }

    const result = await this.pool.query<DatasetRow>(
      `UPDATE eval_datasets
       SET ${updates.join(", ")}
       WHERE id = $1 AND workspace_id = $2
       RETURNING *`,
      params,
    );
    return mapDataset(result.rows[0]);
  }

  async incrementDatasetRevision(client: PoolClient | Pool, datasetId: string): Promise<number> {
    const result = await client.query<{ revision: number }>(
      `UPDATE eval_datasets
       SET revision = revision + 1,
           record_version = record_version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING revision`,
      [datasetId],
    );
    return Number(result.rows[0]?.revision ?? 1);
  }

  async archiveDataset(workspaceId: string, datasetId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE eval_datasets
       SET archived_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL`,
      [datasetId, workspaceId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /* ========================================================================== */
  /* Test Cases                                                                 */
  /* ========================================================================== */

  async createCase(
    workspaceId: string,
    datasetId: string,
    agentId: string,
    input: {
      name?: string;
      input: string;
      expectedOutput?: string;
      expectedTools?: ExpectedToolCall[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
    },
  ): Promise<EvalCase> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<CaseRow>(
        `INSERT INTO eval_cases (
           workspace_id, dataset_id, agent_id, name, input, expected_output,
           expected_tools, fixture_responses, tags, record_version, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())
         RETURNING *`,
        [
          workspaceId,
          datasetId,
          agentId,
          (input.name ?? "").trim().slice(0, 255),
          input.input.trim().slice(0, 20_000),
          (input.expectedOutput ?? "").trim().slice(0, 20_000),
          JSON.stringify(input.expectedTools ?? []),
          JSON.stringify(input.fixtureResponses ?? []),
          input.tags ? input.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean) : [],
        ],
      );
      await this.incrementDatasetRevision(client, datasetId);
      await client.query("COMMIT");
      return mapCase(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listCasesByDataset(
    workspaceId: string,
    datasetId: string,
    options: { search?: string; tag?: string; offset?: number; limit?: number } = {},
  ): Promise<{ cases: EvalCase[]; total: number }> {
    const conditions = ["workspace_id = $1", "dataset_id = $2"];
    const params: unknown[] = [workspaceId, datasetId];

    if (options.search) {
      params.push(`%${options.search.toLowerCase()}%`);
      conditions.push(
        `(LOWER(name) LIKE $${params.length} OR LOWER(input) LIKE $${params.length} OR LOWER(expected_output) LIKE $${params.length})`,
      );
    }
    if (options.tag) {
      params.push(options.tag.toLowerCase());
      conditions.push(`EXISTS (SELECT 1 FROM unnest(tags) t WHERE LOWER(t) = $${params.length})`);
    }

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM eval_cases WHERE ${conditions.join(" AND ")}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const limit = Math.min(Math.max(Number(options.limit ?? 100), 1), 1000);
    const offset = Math.max(Number(options.offset ?? 0), 0);

    const result = await this.pool.query<CaseRow>(
      `SELECT * FROM eval_cases
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return {
      cases: result.rows.map(mapCase),
      total,
    };
  }

  async getCase(
    workspaceId: string,
    datasetId: string,
    caseId: string,
  ): Promise<EvalCase | null> {
    const result = await this.pool.query<CaseRow>(
      `SELECT * FROM eval_cases WHERE id = $1 AND dataset_id = $2 AND workspace_id = $3`,
      [caseId, datasetId, workspaceId],
    );
    return result.rows[0] ? mapCase(result.rows[0]) : null;
  }

  async updateCase(
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
  ): Promise<EvalCase> {
    const existing = await this.getCase(workspaceId, datasetId, caseId);
    if (!existing) {
      throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Case not found" });
    }
    if (
      patch.expectedRecordVersion !== undefined &&
      existing.recordVersion !== patch.expectedRecordVersion
    ) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        message: "Case was modified concurrently. Please refresh.",
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updates: string[] = ["record_version = record_version + 1", "updated_at = NOW()"];
      const params: unknown[] = [caseId, datasetId, workspaceId];

      if (patch.name !== undefined) {
        params.push(patch.name.trim().slice(0, 255));
        updates.push(`name = $${params.length}`);
      }
      if (patch.input !== undefined) {
        params.push(patch.input.trim().slice(0, 20_000));
        updates.push(`input = $${params.length}`);
      }
      if (patch.expectedOutput !== undefined) {
        params.push(patch.expectedOutput.trim().slice(0, 20_000));
        updates.push(`expected_output = $${params.length}`);
      }
      if (patch.expectedTools !== undefined) {
        params.push(JSON.stringify(patch.expectedTools));
        updates.push(`expected_tools = $${params.length}`);
      }
      if (patch.fixtureResponses !== undefined) {
        params.push(JSON.stringify(patch.fixtureResponses));
        updates.push(`fixture_responses = $${params.length}`);
      }
      if (patch.tags !== undefined) {
        params.push(patch.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean));
        updates.push(`tags = $${params.length}`);
      }

      const result = await client.query<CaseRow>(
        `UPDATE eval_cases
         SET ${updates.join(", ")}
         WHERE id = $1 AND dataset_id = $2 AND workspace_id = $3
         RETURNING *`,
        params,
      );

      await this.incrementDatasetRevision(client, datasetId);
      await client.query("COMMIT");
      return mapCase(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteCase(workspaceId: string, datasetId: string, caseId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `DELETE FROM eval_cases WHERE id = $1 AND dataset_id = $2 AND workspace_id = $3`,
        [caseId, datasetId, workspaceId],
      );
      if ((result.rowCount ?? 0) > 0) {
        await this.incrementDatasetRevision(client, datasetId);
      }
      await client.query("COMMIT");
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async batchImportCases(
    workspaceId: string,
    datasetId: string,
    agentId: string,
    cases: Array<{
      name?: string;
      input: string;
      expectedOutput?: string;
      expectedTools?: ExpectedToolCall[];
      fixtureResponses?: FixtureResponse[];
      tags?: string[];
    }>,
  ): Promise<{ importedCount: number; newRevision: number }> {
    if (cases.length === 0) {
      const ds = await this.getDataset(workspaceId, datasetId);
      return { importedCount: 0, newRevision: ds?.revision ?? 1 };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        const name = (c.name ?? "").trim() || `Imported case ${i + 1}`;
        await client.query(
          `INSERT INTO eval_cases (
             workspace_id, dataset_id, agent_id, name, input, expected_output,
             expected_tools, fixture_responses, tags, record_version, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())`,
          [
            workspaceId,
            datasetId,
            agentId,
            name.slice(0, 255),
            c.input.trim().slice(0, 20_000),
            (c.expectedOutput ?? "").trim().slice(0, 20_000),
            JSON.stringify(c.expectedTools ?? []),
            JSON.stringify(c.fixtureResponses ?? []),
            c.tags ? c.tags.map((t) => t.trim().slice(0, 40)).filter(Boolean) : [],
          ],
        );
      }

      const newRevision = await this.incrementDatasetRevision(client, datasetId);
      await client.query("COMMIT");
      return { importedCount: cases.length, newRevision };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getCasesByIds(workspaceId: string, caseIds: string[]): Promise<EvalCase[]> {
    if (caseIds.length === 0) return [];
    const result = await this.pool.query<CaseRow>(
      `SELECT * FROM eval_cases
       WHERE workspace_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at ASC`,
      [workspaceId, caseIds],
    );
    return result.rows.map(mapCase);
  }

  /* ========================================================================== */
  /* Snapshots                                                                  */
  /* ========================================================================== */

  async createDatasetSnapshot(
    workspaceId: string,
    datasetId: string,
    revision: number,
    cases: EvalCase[],
  ): Promise<EvalDatasetSnapshot> {
    const ds = await this.getDataset(workspaceId, datasetId);
    const result = await this.pool.query<{
      id: string;
      dataset_id: string;
      workspace_id: string;
      agent_id: string;
      revision: number;
      dataset_name: string;
      cases: unknown;
      schema_version: number;
      created_at: Date;
    }>(
      `INSERT INTO eval_dataset_snapshots (
         dataset_id, workspace_id, agent_id, revision, dataset_name, cases, schema_version
       ) VALUES ($1, $2, $3, $4, $5, $6, 1)
       RETURNING *`,
      [
        datasetId,
        workspaceId,
        ds?.agentId ?? cases[0]?.agentId,
        revision,
        ds?.name ?? "Dataset",
        JSON.stringify(cases),
      ],
    );
    const row = result.rows[0];
    return {
      id: row.id,
      datasetId: row.dataset_id,
      workspaceId: row.workspace_id,
      agentId: row.agent_id,
      revision: row.revision,
      datasetName: row.dataset_name,
      cases: Array.isArray(row.cases) ? (row.cases as EvalCase[]) : [],
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
    };
  }

  async getDatasetSnapshot(snapshotId: string): Promise<EvalDatasetSnapshot | null> {
    const result = await this.pool.query<{
      id: string;
      dataset_id: string;
      workspace_id: string;
      agent_id: string;
      revision: number;
      dataset_name: string;
      cases: unknown;
      schema_version: number;
      created_at: Date;
    }>(`SELECT * FROM eval_dataset_snapshots WHERE id = $1`, [snapshotId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      datasetId: row.dataset_id,
      workspaceId: row.workspace_id,
      agentId: row.agent_id,
      revision: row.revision,
      datasetName: row.dataset_name,
      cases: Array.isArray(row.cases) ? (row.cases as EvalCase[]) : [],
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
    };
  }

  /* ========================================================================== */
  /* Runs                                                                       */
  /* ========================================================================== */

  async countRunsToday(workspaceId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM eval_runs
       WHERE workspace_id = $1 AND created_at >= date_trunc('day', NOW())`,
      [workspaceId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async findRunByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<EvalRun | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM eval_runs WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async createRun(input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    datasetId: string;
    datasetRevision: number;
    datasetSnapshotId: string;
    cases: EvalCase[];
    policy: EvalPolicy;
    fixtureConfig?: Record<string, unknown>;
    idempotencyKey: string | null;
  }): Promise<EvalRun> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runResult = await client.query<RunRow>(
        `INSERT INTO eval_runs (
           workspace_id, agent_id, agent_version_id, dataset_id, dataset_snapshot_id,
           dataset_revision, policy, fixture_config, status, case_count, progress,
           passed_count, failed_count, errored_count, idempotency_key, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', $9, 0, 0, 0, 0, $10, NOW(), NOW())
         RETURNING *`,
        [
          input.workspaceId,
          input.agentId,
          input.agentVersionId,
          input.datasetId,
          input.datasetSnapshotId,
          input.datasetRevision,
          JSON.stringify(input.policy),
          JSON.stringify(input.fixtureConfig ?? {}),
          input.cases.length,
          input.idempotencyKey,
        ],
      );
      const run = mapRun(runResult.rows[0]);

      for (const c of input.cases) {
        await client.query(
          `INSERT INTO eval_run_cases (run_id, case_id, workspace_id, input, expected_output)
           VALUES ($1, $2, $3, $4, $5)`,
          [run.id, c.id, input.workspaceId, c.input, c.expectedOutput],
        );
      }
      await client.query("COMMIT");
      return run;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalRun | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM eval_runs WHERE id = $1 AND workspace_id = $2`,
      [runId, workspaceId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async listRuns(
    workspaceId: string,
    filters: {
      agentId?: string;
      versionId?: string;
      status?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
      offset?: number;
      cursor?: string;
    } = {},
  ): Promise<{ runs: EvalRun[]; total: number; nextCursor: string | null }> {
    const conditions = ["workspace_id = $1"];
    const params: unknown[] = [workspaceId];

    if (filters.agentId) {
      params.push(filters.agentId);
      conditions.push(`agent_id = $${params.length}`);
    }
    if (filters.versionId) {
      params.push(filters.versionId);
      conditions.push(`agent_version_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.startDate) {
      params.push(filters.startDate);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filters.endDate) {
      params.push(filters.endDate);
      conditions.push(`created_at <= $${params.length}`);
    }

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM eval_runs WHERE ${conditions.join(" AND ")}`,
      params,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
    const offset = Math.max(Number(filters.offset ?? 0), 0);

    if (filters.cursor) {
      let cursor: { createdAt: string; id: string };
      try {
        if (filters.cursor.length > 512 || offset > 0) throw new Error("Invalid cursor");
        cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
        if (
          typeof cursor.createdAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(cursor.createdAt) ||
          !Number.isFinite(Date.parse(cursor.createdAt)) ||
          typeof cursor.id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
        ) throw new Error("Invalid cursor");
      } catch {
        throw new AppError({ code: ErrorCode.VALIDATION_FAILED, message: "Invalid run cursor" });
      }
      params.push(cursor.createdAt, cursor.id);
      conditions.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    const result = await this.pool.query<RunRow & { cursor_created_at: string }>(
      `SELECT *, created_at::text AS cursor_created_at FROM eval_runs
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit + 1, offset],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      runs: rows.map(mapRun),
      total,
      nextCursor: result.rows.length > limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.cursor_created_at, id: last.id })).toString("base64url")
        : null,
    };
  }

  async listResults(workspaceId: string, runId: string): Promise<EvalCaseResult[]> {
    const result = await this.pool.query<ResultRow>(
      `SELECT * FROM eval_case_results
       WHERE workspace_id = $1 AND run_id = $2
       ORDER BY created_at ASC`,
      [workspaceId, runId],
    );
    return result.rows.map(mapResult);
  }

  async claimNextRun(workerId: string, leaseDurationSec = 60): Promise<EvalRun | null> {
    const fenceToken = `${workerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.pool.query<RunRow>(
      `UPDATE eval_runs
       SET status = 'running',
           claimed_by = $1,
           claimed_at = NOW(),
           lease_expires_at = NOW() + ($2 || ' seconds')::interval,
           fence_token = $3,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
       WHERE id = (
         SELECT id FROM eval_runs
         WHERE status = 'queued'
            OR (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, leaseDurationSec, fenceToken],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  }

  async renewLease(runId: string, fenceToken: string, extendSec = 60): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE eval_runs
       SET lease_expires_at = NOW() + ($3 || ' seconds')::interval,
           updated_at = NOW()
       WHERE id = $1 AND fence_token = $2 AND status = 'running'`,
      [runId, fenceToken, extendSec],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateRunProgress(
    runId: string,
    fenceToken: string,
    patch: {
      progress: number;
      passedCount: number;
      failedCount: number;
      erroredCount: number;
    },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE eval_runs
       SET progress = $3,
           passed_count = $4,
           failed_count = $5,
           errored_count = $6,
           updated_at = NOW()
       WHERE id = $1 AND fence_token = $2 AND status = 'running'`,
      [runId, fenceToken, patch.progress, patch.passedCount, patch.failedCount, patch.erroredCount],
    );
  }

  async listRunCaseSnapshots(runId: string): Promise<EvalRunCaseSnapshot[]> {
    const runResult = await this.pool.query<{ dataset_snapshot_id: string | null }>(
      `SELECT dataset_snapshot_id FROM eval_runs WHERE id = $1`,
      [runId],
    );
    const snapshotId = runResult.rows[0]?.dataset_snapshot_id;

    if (snapshotId) {
      const snap = await this.getDatasetSnapshot(snapshotId);
      if (snap && snap.cases.length > 0) {
        return snap.cases.map((c) => ({
          runId,
          caseId: c.id,
          workspaceId: c.workspaceId,
          caseName: c.name,
          input: c.input,
          expectedOutput: c.expectedOutput,
          expectedTools: c.expectedTools ?? [],
          fixtureResponses: c.fixtureResponses ?? [],
        }));
      }
    }

    const legacyResult = await this.pool.query<{
      run_id: string;
      case_id: string;
      workspace_id: string;
      input: string;
      expected_output: string;
    }>(`SELECT * FROM eval_run_cases WHERE run_id = $1`, [runId]);
    return legacyResult.rows.map((r) => ({
      runId: r.run_id,
      caseId: r.case_id,
      workspaceId: r.workspace_id,
      caseName: "Case",
      input: r.input,
      expectedOutput: r.expected_output,
      expectedTools: [],
      fixtureResponses: [],
    }));
  }

  async insertCaseResult(input: {
    runId: string;
    caseId: string;
    workspaceId: string;
    caseName: string;
    input: string;
    expectedOutput: string;
    actualOutput: string | null;
    expectedTools: ExpectedToolCall[];
    actualTools: Array<{ name: string; arguments?: Record<string, unknown>; status?: string }>;
    passed: boolean;
    score: number | null;
    scoringMethod: ScoringMethod;
    failureReason: string | null;
    executionError: string | null;
    scorerUnavailable?: boolean;
    latencyMs: number | null;
    tokenUsage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO eval_case_results (
         run_id, case_id, workspace_id, case_name, input, expected_output, actual_output,
         expected_tools, actual_tools, passed, score, scoring_method, failure_reason,
         execution_error, scorer_unavailable, latency_ms, token_usage, error, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())`,
      [
        input.runId,
        input.caseId,
        input.workspaceId,
        input.caseName,
        input.input,
        input.expectedOutput,
        input.actualOutput,
        JSON.stringify(input.expectedTools),
        JSON.stringify(input.actualTools),
        input.passed,
        input.score,
        input.scoringMethod,
        input.failureReason,
        input.executionError,
        input.scorerUnavailable ?? false,
        input.latencyMs,
        JSON.stringify(input.tokenUsage ?? null),
        input.executionError,
      ],
    );
  }

  async completeRun(
    runId: string,
    fenceToken: string,
    patch: {
      status: "completed" | "failed";
      score: number | null;
      passedCount: number;
      failedCount: number;
      erroredCount: number;
      unavailableCount?: number;
      unavailableReason?: string | null;
      averageLatencyMs?: number | null;
      totalCost?: number | null;
      tokenUsage?: unknown;
      error: string | null;
    },
  ): Promise<EvalRun> {
    const result = await this.pool.query<RunRow>(
      `UPDATE eval_runs
       SET status = $3,
           score = $4,
           passed_count = $5,
           failed_count = $6,
           errored_count = $7,
           unavailable_count = $8,
           unavailable_reason = $9,
           average_latency_ms = $10,
           total_cost = $11,
           token_usage = $12,
           error = $13,
           finished_at = NOW(),
           lease_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND fence_token = $2
       RETURNING *`,
      [
        runId,
        fenceToken,
        patch.status,
        patch.score,
        patch.passedCount,
        patch.failedCount,
        patch.erroredCount,
        patch.unavailableCount ?? 0,
        patch.unavailableReason ?? null,
        patch.averageLatencyMs ?? null,
        patch.totalCost ?? null,
        JSON.stringify(patch.tokenUsage ?? null),
        patch.error,
      ],
    );
    if (!result.rows[0]) {
      const fallback = await this.pool.query<RunRow>(`SELECT * FROM eval_runs WHERE id = $1`, [
        runId,
      ]);
      return mapRun(fallback.rows[0]);
    }
    return mapRun(result.rows[0]);
  }

  async recordGateAudit(input: {
    workspaceId: string;
    agentId: string;
    agentVersionId: string;
    gatePassed: boolean;
    blocked: boolean;
    reasons: string[];
    overridden: boolean;
    overrideActorId?: string | null;
    overrideReason?: string | null;
    metrics: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO eval_gate_audits (
         workspace_id, agent_id, agent_version_id, gate_passed, blocked,
         reasons, overridden, override_actor_id, override_reason, metrics, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
      [
        input.workspaceId,
        input.agentId,
        input.agentVersionId,
        input.gatePassed,
        input.blocked,
        input.reasons,
        input.overridden,
        input.overrideActorId ?? null,
        input.overrideReason ?? null,
        JSON.stringify(input.metrics),
      ],
    );
  }

  /* ========================================================================== */
  /* Comparisons                                                                */
  /* ========================================================================== */

  async createOrGetComparison(input: {
    workspaceId: string;
    agentId: string;
    baselineRunId: string;
    candidateRunId: string;
    datasetId?: string | null;
    datasetRevision?: number | null;
    compatibilityFingerprint: string;
    matchedCaseCount: number;
    fixedCount: number;
    regressedCount: number;
    unchangedPassedCount: number;
    unchangedFailedCount: number;
    baselinePassRate: number;
    candidatePassRate: number;
    deltaPercentagePoints: number;
    latencyDeltaMs?: number | null;
    categories: EvalComparison["categories"];
  }): Promise<EvalComparison> {
    const existing = await this.pool.query<ComparisonRow>(
      `SELECT * FROM eval_comparisons
       WHERE workspace_id = $1 AND baseline_run_id = $2 AND candidate_run_id = $3`,
      [input.workspaceId, input.baselineRunId, input.candidateRunId],
    );
    if (existing.rows[0]) {
      return mapComparison(existing.rows[0]);
    }

    const result = await this.pool.query<ComparisonRow>(
      `INSERT INTO eval_comparisons (
         workspace_id, agent_id, baseline_run_id, candidate_run_id, dataset_id,
         dataset_revision, compatibility_fingerprint, matched_case_count, fixed_count,
         regressed_count, unchanged_passed_count, unchanged_failed_count, baseline_pass_rate,
         candidate_pass_rate, delta_percentage_points, latency_delta_ms, categories_json, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
       ON CONFLICT (workspace_id, baseline_run_id, candidate_run_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [
        input.workspaceId,
        input.agentId,
        input.baselineRunId,
        input.candidateRunId,
        input.datasetId ?? null,
        input.datasetRevision ?? null,
        input.compatibilityFingerprint,
        input.matchedCaseCount,
        input.fixedCount,
        input.regressedCount,
        input.unchangedPassedCount,
        input.unchangedFailedCount,
        input.baselinePassRate,
        input.candidatePassRate,
        input.deltaPercentagePoints,
        input.latencyDeltaMs ?? null,
        JSON.stringify(input.categories),
      ],
    );
    return mapComparison(result.rows[0]);
  }

  async getComparison(
    workspaceId: string,
    comparisonId: string,
  ): Promise<EvalComparison | null> {
    const result = await this.pool.query<ComparisonRow>(
      `SELECT * FROM eval_comparisons WHERE id = $1 AND workspace_id = $2`,
      [comparisonId, workspaceId],
    );
    return result.rows[0] ? mapComparison(result.rows[0]) : null;
  }

  /* ========================================================================== */
  /* Summary Metrics                                                            */
  /* ========================================================================== */

  async getSummaryMetrics(workspaceId: string): Promise<EvalSummary> {
    // Current period (last 30 days)
    const currentRunStats = await this.pool.query<{
      avg_pass_rate: string | null;
      completed_count: string;
    }>(
      `SELECT
         AVG(score)::numeric(6, 2) AS avg_pass_rate,
         COUNT(*)::text AS completed_count
       FROM eval_runs
       WHERE workspace_id = $1
         AND status = 'completed'
         AND score IS NOT NULL
         AND finished_at >= NOW() - INTERVAL '30 days'`,
      [workspaceId],
    );

    // Previous period (30–60 days ago)
    const prevRunStats = await this.pool.query<{
      avg_pass_rate: string | null;
      completed_count: string;
    }>(
      `SELECT
         AVG(score)::numeric(6, 2) AS avg_pass_rate,
         COUNT(*)::text AS completed_count
       FROM eval_runs
       WHERE workspace_id = $1
         AND status = 'completed'
         AND score IS NOT NULL
         AND finished_at >= NOW() - INTERVAL '60 days'
         AND finished_at < NOW() - INTERVAL '30 days'`,
      [workspaceId],
    );

    // Active cases count
    const activeCasesResult = await this.pool.query<{ active_cases: string }>(
      `SELECT COUNT(c.id)::text AS active_cases
       FROM eval_cases c
       JOIN eval_datasets d ON d.id = c.dataset_id
       WHERE c.workspace_id = $1 AND d.archived_at IS NULL`,
      [workspaceId],
    );

    // Regressions flagged in last 30 days
    const regressionsResult = await this.pool.query<{ total_regressed: string }>(
      `SELECT COALESCE(SUM(regressed_count), 0)::text AS total_regressed
       FROM eval_comparisons
       WHERE workspace_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [workspaceId],
    );

    const currAvg = toNumber(currentRunStats.rows[0]?.avg_pass_rate);
    const prevAvg = toNumber(prevRunStats.rows[0]?.avg_pass_rate);
    const avgPassRateDelta =
      currAvg !== null && prevAvg !== null ? Math.round((currAvg - prevAvg) * 10) / 10 : null;

    const currCompleted = Number(currentRunStats.rows[0]?.completed_count ?? 0);
    const prevCompleted = Number(prevRunStats.rows[0]?.completed_count ?? 0);
    const evaluatedRunsDelta =
      prevCompleted > 0 ? Math.round(((currCompleted - prevCompleted) / prevCompleted) * 100) : null;

    return {
      averagePassRate: currAvg,
      averagePassRateDelta: avgPassRateDelta,
      evaluatedRuns: currCompleted,
      evaluatedRunsDelta,
      activeTestCases: Number(activeCasesResult.rows[0]?.active_cases ?? 0),
      regressionsFlagged: Number(regressionsResult.rows[0]?.total_regressed ?? 0),
      period: "Last 30 days",
    };
  }

  /* ========================================================================== */
  /* Legacy Adapter Support                                                     */
  /* ========================================================================== */

  async listLegacyCases(workspaceId: string, agentId: string): Promise<EvalCase[]> {
    const result = await this.pool.query<CaseRow>(
      `SELECT * FROM eval_cases
       WHERE workspace_id = $1 AND agent_id = $2
       ORDER BY created_at DESC
       LIMIT 500`,
      [workspaceId, agentId],
    );
    return result.rows.map(mapCase);
  }

  async getOrCreateDefaultDataset(workspaceId: string, agentId: string): Promise<EvalDataset> {
    const existing = await this.pool.query<DatasetRow>(
      `SELECT * FROM eval_datasets
       WHERE workspace_id = $1 AND agent_id = $2 AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [workspaceId, agentId],
    );
    if (existing.rows[0]) {
      return mapDataset(existing.rows[0]);
    }
    return this.createDataset(workspaceId, agentId, {
      name: "Default Dataset",
      description: "Default evaluation dataset",
      tags: ["default"],
    });
  }
}
