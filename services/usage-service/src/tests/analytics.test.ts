import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ErrorCode } from "@quickstart/errors";
import { AnalyticsService } from "../services/analytics.service.js";
import type { AnalyticsRepository } from "../repository/analytics.repository.js";
import type { AnalyticsResponse } from "@quickstart/contracts";

const VALID_WORKSPACE = "a0000000-0000-4000-a000-000000000001";

function createMockRepository(mockData?: Partial<AnalyticsResponse>): AnalyticsRepository {
  const dummy: AnalyticsResponse = {
    range: {
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-07T23:59:59.999Z",
      timezone: "UTC",
    },
    summary: {
      total_tokens: 3420000,
      input_tokens: 2840000,
      output_tokens: 580000,
      conversations: 420,
      conversations_trend_pct: 12.4,
      latency_p50_ms: 185,
      latency_p95_ms: 420,
      estimated_spend_usd: 124.5,
      model_spend_usd: 110.0,
      voice_spend_usd: 14.5,
      voice_minutes: 58,
      voice_calls: 32,
      billable_acquisition_actions: 0,
      as_of: "2026-05-07T23:59:59.999Z",
    },
    daily_tokens: [],
    daily_latency: [],
    usage_by_service: [],
    ...mockData,
  };

  return {
    getWorkspaceAnalytics: async (_wsId: string, _opts: any) => dummy,
  } as unknown as AnalyticsRepository;
}

test("AnalyticsService validates workspace UUID", async () => {
  const service = new AnalyticsService(createMockRepository());

  await assert.rejects(
    async () => service.getRollup("invalid-uuid", {}),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.VALIDATION_FAILED);
      assert.match(err.message, /Valid workspace UUID required/);
      return true;
    },
  );
});

test("AnalyticsService rejects invalid date formats and inverted ranges", async () => {
  const service = new AnalyticsService(createMockRepository());

  // Non-parseable date
  await assert.rejects(
    async () => service.getRollup(VALID_WORKSPACE, { from: "not-a-date" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.VALIDATION_FAILED);
      return true;
    },
  );

  // from >= to
  await assert.rejects(
    async () =>
      service.getRollup(VALID_WORKSPACE, {
        from: "2026-05-10",
        to: "2026-05-01",
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.VALIDATION_FAILED);
      assert.match(err.message, /strictly before/);
      return true;
    },
  );

  // Range exceeds 366 days
  await assert.rejects(
    async () =>
      service.getRollup(VALID_WORKSPACE, {
        from: "2024-01-01",
        to: "2026-01-01",
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.VALIDATION_FAILED);
      assert.match(err.message, /cannot exceed 366 days/);
      return true;
    },
  );
});

test("AnalyticsService validates an optional per-agent filter", async () => {
  const service = new AnalyticsService(createMockRepository());
  await assert.rejects(
    async () => service.getRollup(VALID_WORKSPACE, { agentId: "not-a-uuid" }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, ErrorCode.VALIDATION_FAILED);
      assert.match(err.message, /agent_id/);
      return true;
    },
  );
});

test("AnalyticsService normalizes YYYY-MM-DD date inputs and queries repository", async () => {
  let capturedOpts: any = null;
  const mockRepo = {
    getWorkspaceAnalytics: async (_wsId: string, opts: { from: Date; to: Date; timezone?: string }) => {
      capturedOpts = opts;
      return {
        range: {
          from: opts.from.toISOString(),
          to: opts.to.toISOString(),
          timezone: opts.timezone ?? "UTC",
        },
        summary: {
          total_tokens: 200,
          input_tokens: 150,
          output_tokens: 50,
          conversations: 10,
          conversations_trend_pct: 0,
          latency_p50_ms: 100,
          latency_p95_ms: 200,
          estimated_spend_usd: 1.0,
          model_spend_usd: 1.0,
          voice_spend_usd: 0,
          voice_minutes: 0,
          voice_calls: 0,
          billable_acquisition_actions: 0,
          as_of: new Date().toISOString(),
        },
        daily_tokens: [],
        daily_latency: [],
        usage_by_service: [],
      };
    },
  } as unknown as AnalyticsRepository;

  const service = new AnalyticsService(mockRepo);

  const result = await service.getRollup(VALID_WORKSPACE, {
    from: "2026-05-01",
    to: "2026-05-07",
    timezone: "America/New_York",
  });

  if (!capturedOpts) {
    assert.fail("capturedOpts should be defined");
  }
  assert.equal(
    capturedOpts.from.toISOString(),
    "2026-05-01T00:00:00.000Z",
    "from date string should start at start of day UTC",
  );
  assert.equal(
    capturedOpts.to.toISOString(),
    "2026-05-07T23:59:59.999Z",
    "to date string should end at end of day UTC",
  );
  assert.equal(capturedOpts.timezone, "America/New_York");
  await service.getRollup(VALID_WORKSPACE, {
    from: "2026-05-01",
    to: "2026-05-07",
    agentId: "a0000000-0000-4000-a000-000000000002",
  });
  assert.equal(capturedOpts.agentId, "a0000000-0000-4000-a000-000000000002");
  assert.equal(result.summary.total_tokens, 200);
  assert.equal(result.summary.latency_p95_ms, 200);
});
