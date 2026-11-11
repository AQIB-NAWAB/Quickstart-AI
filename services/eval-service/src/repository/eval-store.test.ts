/**
 * Feature 25 LLD: caps, tenant isolation, async scripted match.
 * Uses in-process PGlite (no Docker / pg native deps required).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import { AppError } from "@quickstart/errors";
import type { Pool } from "pg";
import { EvalRepository } from "./eval.repository.js";
import { EvalService } from "../services/eval.service.js";

type SqlPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
  end: () => Promise<void>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    release: () => void;
  }>;
};

async function openPglitePool(): Promise<SqlPool> {
  const href = pathToFileURL(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../node_modules/.pnpm/@electric-sql+pglite@0.3.16/node_modules/@electric-sql/pglite/dist/index.js",
    ),
  ).href;
  const { PGlite } = (await import(href)) as {
    PGlite: new () => {
      waitReady: Promise<unknown>;
      query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
      exec: (sql: string) => Promise<unknown>;
      close: () => Promise<void>;
    };
  };
  const db = new PGlite();
  await db.waitReady;
  const sql1 = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../migrations/001_eval.sql"),
    "utf8",
  ).replace(/CREATE EXTENSION[^;]+;/gi, "");
  await db.exec(sql1);

  const sql2 = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../migrations/002_eval_suite_v2.sql"),
    "utf8",
  ).replace(/CREATE EXTENSION[^;]+;/gi, "");
  await db.exec(sql2);

  const sql3 = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../migrations/003_eval_gates_and_unavailability.sql"),
    "utf8",
  ).replace(/CREATE EXTENSION[^;]+;/gi, "");
  await db.exec(sql3);

  return {
    query: (text, params) => db.query(text, params ?? []),
    connect: async () => ({
      query: (text, params) => {
        const upper = text.trim().toUpperCase();
        if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") {
          return Promise.resolve({ rows: [] });
        }
        return db.query(text, params ?? []);
      },
      release: () => undefined,
    }),
    end: async () => db.close(),
  };
}

async function withDb(run: (service: EvalService, repo: EvalRepository) => Promise<void>) {
  const pool = await openPglitePool();
  try {
    const repo = new EvalRepository(pool as unknown as Pool);
    const service = new EvalService(repo, null, {
      maxCasesPerRun: 3,
      maxRunsPerWorkspacePerDay: 2,
      caseTimeoutMs: 5_000,
    });
    await run(service, repo);
  } finally {
    await pool.end();
  }
}

test("run cursors preserve ordering across equal timestamps and isolate workspaces", async () => {
  const pool = await openPglitePool();
  try {
    const repo = new EvalRepository(pool as unknown as Pool);
    const workspace = randomUUID();
    const otherWorkspace = randomUUID();
    const agent = randomUUID();
    const version = randomUUID();
    const ids = Array.from({ length: 3 }, () => randomUUID());
    for (const [index, id] of ids.entries()) {
      await pool.query(
        "INSERT INTO eval_runs (id, workspace_id, agent_id, agent_version_id, created_at) VALUES ($1, $2, $3, $4, $5)",
        [id, workspace, agent, version, index === 2 ? "2026-01-01T00:00:00.123123Z" : "2026-01-01T00:00:00.123456Z"],
      );
    }
    await pool.query(
      "INSERT INTO eval_runs (workspace_id, agent_id, agent_version_id) VALUES ($1, $2, $3)",
      [otherWorkspace, agent, version],
    );
    const first = await repo.listRuns(workspace, { limit: 2 });
    assert.equal(first.total, 3);
    assert.ok(first.nextCursor);
    await pool.query(
      "INSERT INTO eval_runs (workspace_id, agent_id, agent_version_id) VALUES ($1, $2, $3)",
      [workspace, agent, version],
    );
    const second = await repo.listRuns(workspace, { limit: 2, cursor: first.nextCursor });
    assert.equal(second.nextCursor, null);
    assert.deepEqual([...first.runs, ...second.runs].map((run) => run.id).sort(), ids.sort());
    assert.equal((await repo.listRuns(otherWorkspace, { cursor: first.nextCursor })).runs.length, 0);
    await assert.rejects(repo.listRuns(workspace, { cursor: "invalid" }), /Invalid run cursor/);
  } finally {
    await pool.end();
  }
});

test("cap rejects extra case on run create", async () => {
  await withDb(async (service) => {
    const workspaceId = randomUUID();
    const agentId = randomUUID();
    const dataset = await service.createDataset(workspaceId, { agent_id: agentId, name: "Default" });
    for (let i = 0; i < 4; i++) {
      await service.createCase(workspaceId, dataset.id, {
        input: `q${i}`,
        expected_output: `fake-reply:q${i}`,
      });
    }
    await assert.rejects(
      () =>
        service.createRun(workspaceId, {
          agent_id: agentId,
          agent_version_id: randomUUID(),
          dataset_id: dataset.id,
        }),
      (err: unknown) => err instanceof AppError && /Case cap exceeded/.test(err.message),
    );
  });
});

test("daily run cap rejects extra run", async () => {
  await withDb(async (service) => {
    const workspaceId = randomUUID();
    const agentId = randomUUID();
    const dataset = await service.createDataset(workspaceId, { agent_id: agentId, name: "Default" });
    await service.createCase(workspaceId, dataset.id, {
      input: "hi",
      expected_output: "fake-reply:hi",
    });
    const versionId = randomUUID();
    await service.createRun(workspaceId, {
      agent_id: agentId,
      agent_version_id: versionId,
      dataset_id: dataset.id,
      idempotency_key: `r1-${randomUUID()}`,
    });
    await service.createRun(workspaceId, {
      agent_id: agentId,
      agent_version_id: versionId,
      dataset_id: dataset.id,
      idempotency_key: `r2-${randomUUID()}`,
    });
    await assert.rejects(
      () =>
        service.createRun(workspaceId, {
          agent_id: agentId,
          agent_version_id: versionId,
          dataset_id: dataset.id,
          idempotency_key: `r3-${randomUUID()}`,
        }),
      (err: unknown) => err instanceof AppError && /Run cap exceeded/.test(err.message),
    );
  });
});

test("cross-workspace cannot read the report", async () => {
  await withDb(async (service) => {
    const wsA = randomUUID();
    const wsB = randomUUID();
    const agentId = randomUUID();
    const dataset = await service.createDataset(wsA, { agent_id: agentId, name: "Default" });
    await service.createCase(wsA, dataset.id, {
      input: "hello",
      expected_output: "fake-reply:hello",
    });
    const { run } = await service.createRun(wsA, {
      agent_id: agentId,
      agent_version_id: randomUUID(),
      dataset_id: dataset.id,
    });
    await assert.rejects(
      () => service.getRun(wsB, run.id),
      (err: unknown) => err instanceof AppError && err.message.includes("not found"),
    );
  });
});

test("async processRun matches scripted fake-reply answers", async () => {
  await withDb(async (service, repo) => {
    const workspaceId = randomUUID();
    const agentId = randomUUID();
    const versionId = randomUUID();
    const dataset = await service.createDataset(workspaceId, { agent_id: agentId, name: "Default" });
    await service.createCase(workspaceId, dataset.id, {
      input: "ping",
      expected_output: "fake-reply:ping",
    });
    await service.createCase(workspaceId, dataset.id, {
      input: "pong",
      expected_output: "fake-reply:pong",
    });
    const { run } = await service.createRun(workspaceId, {
      agent_id: agentId,
      agent_version_id: versionId,
      dataset_id: dataset.id,
      idempotency_key: `async-${randomUUID()}`,
    });
    assert.equal(run.status, "queued");

    const claimed = await repo.claimNextRun("test-worker");
    assert.ok(claimed);
    assert.equal(claimed!.id, run.id);
    assert.equal(claimed!.status, "running");

    const finished = await service.processRun(claimed!);
    assert.equal(finished.status, "completed");
    assert.equal(finished.score, 100);

    const { results } = await service.getRun(workspaceId, run.id);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.passed));
    const actuals = new Set(results.map((r) => r.actualOutput));
    assert.ok(actuals.has("fake-reply:ping"));
    assert.ok(actuals.has("fake-reply:pong"));
  });
});

test("idempotent run create returns first row", async () => {
  await withDb(async (service) => {
    const workspaceId = randomUUID();
    const agentId = randomUUID();
    const dataset = await service.createDataset(workspaceId, { agent_id: agentId, name: "Default" });
    const key = `idem-${randomUUID()}`;
    await service.createCase(workspaceId, dataset.id, {
      input: "x",
      expected_output: "fake-reply:x",
    });
    const first = await service.createRun(workspaceId, {
      agent_id: agentId,
      agent_version_id: randomUUID(),
      dataset_id: dataset.id,
      idempotency_key: key,
    });
    assert.equal(first.created, true);
    const second = await service.createRun(workspaceId, {
      agent_id: agentId,
      agent_version_id: randomUUID(),
      dataset_id: dataset.id,
      idempotency_key: key,
    });
    assert.equal(second.created, false);
    assert.equal(second.run.id, first.run.id);
  });
});
