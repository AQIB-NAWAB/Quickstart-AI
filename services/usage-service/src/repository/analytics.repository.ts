import type { Pool } from "pg";
import type {
  AnalyticsDailyLatencyBucket,
  AnalyticsDailyTokenBucket,
  AnalyticsResponse,
  AnalyticsServiceUsage,
  AnalyticsSummary,
  MetricCoverage,
  MetricCoverageIndicators,
} from "@quickstart/contracts";

export type AnalyticsQueryOpts = {
  from: Date;
  to: Date;
  timezone?: string;
  agentId?: string;
};

export class AnalyticsRepository {
  constructor(private readonly pool: Pool) {}

  async getWorkspaceAnalytics(
    workspaceId: string,
    opts: AnalyticsQueryOpts,
  ): Promise<AnalyticsResponse> {
    const fromIso = opts.from.toISOString();
    const toIso = opts.to.toISOString();
    const durationMs = opts.to.getTime() - opts.from.getTime();
    const priorFromIso = new Date(opts.from.getTime() - durationMs).toISOString();
    const priorToIso = fromIso;
    const agentFilter = opts.agentId ? "AND detail->>'agent_id' = $4" : "";
    const agentParams = opts.agentId ? [opts.agentId] : [];

    // Validate IANA timezone or default to UTC
    const tz = opts.timezone && /^[a-zA-Z0-9_+\-/]+$/.test(opts.timezone) ? opts.timezone : "UTC";

    // 1. Current interval summary query
    const summaryRes = await this.pool.query<{
      total_tokens: string | null;
      input_tokens: string | null;
      output_tokens: string | null;
      conversations: string | null;
      p50_latency_ms: string | null;
      p95_latency_ms: string | null;
      model_price_micros: string | null;
      voice_price_micros: string | null;
      total_price_micros: string | null;
      voice_units: string | null;
      voice_calls: string | null;
      acquisition_units: string | null;
      model_with_token_detail: string | null;
      total_model_turns: string | null;
      turns_with_latency: string | null;
      total_entries: string | null;
      unpriced_count: string | null;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'model' THEN units ELSE 0 END), 0)::text AS total_tokens,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'input_tokens')::numeric, (detail->>'prompt_tokens')::numeric, 0) ELSE 0 END), 0)::text AS input_tokens,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'output_tokens')::numeric, (detail->>'completion_tokens')::numeric, 0) ELSE 0 END), 0)::text AS output_tokens,
         COUNT(DISTINCT COALESCE(source_id, detail->>'conversation_id', id::text))::text AS conversations,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY NULLIF((detail->>'latency_ms')::numeric, 0))::text AS p50_latency_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF((detail->>'latency_ms')::numeric, 0))::text AS p95_latency_ms,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN price_micros ELSE 0 END), 0)::text AS model_price_micros,
         COALESCE(SUM(CASE WHEN kind = 'voice' THEN price_micros ELSE 0 END), 0)::text AS voice_price_micros,
         COALESCE(SUM(price_micros), 0)::text AS total_price_micros,
         COALESCE(SUM(CASE WHEN kind = 'voice' THEN units ELSE 0 END), 0)::text AS voice_units,
         COUNT(DISTINCT CASE WHEN kind = 'voice' THEN COALESCE(source_id, detail->>'call_id', id::text) ELSE NULL END)::text AS voice_calls,
         COALESCE(SUM(CASE WHEN kind = 'acquisition' THEN units ELSE 0 END), 0)::text AS acquisition_units,
         COUNT(CASE WHEN kind = 'model' AND (detail->>'input_tokens' IS NOT NULL OR detail->>'prompt_tokens' IS NOT NULL) THEN 1 ELSE NULL END)::text AS model_with_token_detail,
         COUNT(CASE WHEN kind = 'model' THEN 1 ELSE NULL END)::text AS total_model_turns,
         COUNT(CASE WHEN NULLIF((detail->>'latency_ms')::numeric, 0) IS NOT NULL THEN 1 ELSE NULL END)::text AS turns_with_latency,
         COUNT(*)::text AS total_entries,
         COUNT(CASE WHEN units > 0 AND price_micros = 0 THEN 1 ELSE NULL END)::text AS unpriced_count
       FROM usage_entries
       WHERE workspace_id = $1
         AND created_at >= $2
         AND created_at < $3
         ${agentFilter}`,
      [workspaceId, fromIso, toIso, ...agentParams],
    );

    // 2. Prior interval summary query for trend comparison
    const priorRes = await this.pool.query<{
      total_tokens: string | null;
      conversations: string | null;
      total_price_micros: string | null;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'model' THEN units ELSE 0 END), 0)::text AS total_tokens,
         COUNT(DISTINCT COALESCE(source_id, detail->>'conversation_id', id::text))::text AS conversations,
         COALESCE(SUM(price_micros), 0)::text AS total_price_micros
       FROM usage_entries
       WHERE workspace_id = $1
         AND created_at >= $2
         AND created_at < $3
         ${agentFilter}`,
      [workspaceId, priorFromIso, priorToIso, ...agentParams],
    );

    // 3. Daily token and latency aggregations in requested IANA timezone
    const dailyAgentFilter = opts.agentId ? "AND detail->>'agent_id' = $5" : "";
    const dailyRes = await this.pool.query<{
      bucket_date: string;
      total_tokens: string | null;
      input_tokens: string | null;
      output_tokens: string | null;
      cost_micros: string | null;
      p50_latency_ms: string | null;
      p95_latency_ms: string | null;
      turns_count: string | null;
    }>(
      `SELECT
         to_char(created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS bucket_date,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN units ELSE 0 END), 0)::text AS total_tokens,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'input_tokens')::numeric, (detail->>'prompt_tokens')::numeric, 0) ELSE 0 END), 0)::text AS input_tokens,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'output_tokens')::numeric, (detail->>'completion_tokens')::numeric, 0) ELSE 0 END), 0)::text AS output_tokens,
         COALESCE(SUM(price_micros), 0)::text AS cost_micros,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY NULLIF((detail->>'latency_ms')::numeric, 0))::text AS p50_latency_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY NULLIF((detail->>'latency_ms')::numeric, 0))::text AS p95_latency_ms,
         COUNT(CASE WHEN kind = 'model' THEN 1 ELSE NULL END)::text AS turns_count
       FROM usage_entries
       WHERE workspace_id = $1
         AND created_at >= $2
         AND created_at < $3
         ${dailyAgentFilter}
       GROUP BY bucket_date
       ORDER BY bucket_date ASC`,
      [workspaceId, fromIso, toIso, tz, ...agentParams],
    );

    // 4. Usage breakdown by service/model without artificial token ratio
    const breakdownRes = await this.pool.query<{
      kind: string;
      provider: string | null;
      model: string | null;
      unit_label: string | null;
      units: string | null;
      input_tokens: string | null;
      output_tokens: string | null;
      cost_micros: string | null;
      unpriced_count: string | null;
    }>(
      `SELECT
         kind,
         provider,
         model,
         unit_label,
         COALESCE(SUM(units), 0)::text AS units,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'input_tokens')::numeric, (detail->>'prompt_tokens')::numeric, 0) ELSE 0 END), 0)::text AS input_tokens,
         COALESCE(SUM(CASE WHEN kind = 'model' THEN COALESCE((detail->>'output_tokens')::numeric, (detail->>'completion_tokens')::numeric, 0) ELSE 0 END), 0)::text AS output_tokens,
         COALESCE(SUM(price_micros), 0)::text AS cost_micros,
         COUNT(CASE WHEN units > 0 AND price_micros = 0 THEN 1 ELSE NULL END)::text AS unpriced_count
       FROM usage_entries
       WHERE workspace_id = $1
         AND created_at >= $2
         AND created_at < $3
         ${agentFilter}
       GROUP BY kind, provider, model, unit_label
       ORDER BY SUM(price_micros) DESC, SUM(units) DESC`,
      [workspaceId, fromIso, toIso, ...agentParams],
    );

    // Operational metrics are sourced from conversation/evaluation tables when
    // those services have been migrated. Keep analytics usable during staggered
    // local/rolling deployments where one of those tables may not exist yet.
    let operationalMetrics: AnalyticsResponse["operational_metrics"];
    try {
      const operationsAgentFilter = opts.agentId ? "AND c.agent_id = $4" : "";
      const operationsParams = opts.agentId
        ? [workspaceId, fromIso, toIso, opts.agentId]
        : [workspaceId, fromIso, toIso];
      const operationsRes = await this.pool.query<{
        tool_calls: string;
        successful_tool_calls: string;
        failed_tool_calls: string;
        handoffs: string;
        evaluation_runs: string;
        evaluation_pass_rate_pct: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*)::text
              FROM tool_calls tc
              JOIN conversations c ON c.id = tc.conversation_id AND c.workspace_id = tc.workspace_id
             WHERE tc.workspace_id = $1
               AND tc.created_at >= $2
               AND tc.created_at < $3
               ${operationsAgentFilter}) AS tool_calls,
           (SELECT COUNT(*) FILTER (WHERE tc.status IN ('succeeded', 'success'))::text
              FROM tool_calls tc
              JOIN conversations c ON c.id = tc.conversation_id AND c.workspace_id = tc.workspace_id
             WHERE tc.workspace_id = $1
               AND tc.created_at >= $2
               AND tc.created_at < $3
               ${operationsAgentFilter}) AS successful_tool_calls,
           (SELECT COUNT(*) FILTER (WHERE tc.status IN ('failed', 'error'))::text
              FROM tool_calls tc
              JOIN conversations c ON c.id = tc.conversation_id AND c.workspace_id = tc.workspace_id
             WHERE tc.workspace_id = $1
               AND tc.created_at >= $2
               AND tc.created_at < $3
               ${operationsAgentFilter}) AS failed_tool_calls,
           (SELECT COUNT(*) FILTER (WHERE c.state IN ('waiting', 'human'))::text
              FROM conversations c
             WHERE c.workspace_id = $1
               AND c.updated_at >= $2
               AND c.updated_at < $3
               ${opts.agentId ? "AND c.agent_id = $4" : ""}) AS handoffs,
           (SELECT COUNT(*) FILTER (WHERE er.status = 'completed')::text
              FROM eval_runs er
             WHERE er.workspace_id = $1
               AND er.created_at >= $2
               AND er.created_at < $3
               ${opts.agentId ? "AND er.agent_id = $4" : ""}) AS evaluation_runs,
           (SELECT AVG(er.score) FILTER (WHERE er.status = 'completed')::text
              FROM eval_runs er
             WHERE er.workspace_id = $1
               AND er.created_at >= $2
               AND er.created_at < $3
               ${opts.agentId ? "AND er.agent_id = $4" : ""}) AS evaluation_pass_rate_pct`,
        operationsParams,
      );
      const row = operationsRes.rows[0];
      const toolCalls = Number(row?.tool_calls ?? 0);
      const successfulToolCalls = Number(row?.successful_tool_calls ?? 0);
      operationalMetrics = {
        tool_calls: toolCalls,
        successful_tool_calls: successfulToolCalls,
        failed_tool_calls: Number(row?.failed_tool_calls ?? 0),
        tool_success_rate_pct:
          toolCalls > 0 ? Math.round((successfulToolCalls / toolCalls) * 1000) / 10 : null,
        handoffs: Number(row?.handoffs ?? 0),
        evaluation_runs: Number(row?.evaluation_runs ?? 0),
        evaluation_pass_rate_pct: row?.evaluation_pass_rate_pct
          ? Math.round(Number(row.evaluation_pass_rate_pct) * 10) / 10
          : null,
      };
    } catch {
      operationalMetrics = undefined;
    }

    const sRow = summaryRes.rows[0];
    const pRow = priorRes.rows[0];

    const currentConvs = Number(sRow?.conversations ?? 0);
    const priorConvs = Number(pRow?.conversations ?? 0);
    let convTrendPct: number | null = null;
    if (priorConvs > 0) {
      convTrendPct = Math.round(((currentConvs - priorConvs) / priorConvs) * 1000) / 10;
    }

    const summary: AnalyticsSummary = {
      total_tokens: Math.round(Number(sRow?.total_tokens ?? 0)),
      input_tokens: Math.round(Number(sRow?.input_tokens ?? 0)),
      output_tokens: Math.round(Number(sRow?.output_tokens ?? 0)),
      conversations: currentConvs,
      conversations_trend_pct: convTrendPct,
      latency_p50_ms: sRow?.p50_latency_ms ? Math.round(Number(sRow.p50_latency_ms)) : null,
      latency_p95_ms: sRow?.p95_latency_ms ? Math.round(Number(sRow.p95_latency_ms)) : null,
      estimated_spend_usd: Number(sRow?.total_price_micros ?? 0) / 1_000_000,
      model_spend_usd: Number(sRow?.model_price_micros ?? 0) / 1_000_000,
      voice_spend_usd: Number(sRow?.voice_price_micros ?? 0) / 1_000_000,
      voice_minutes: Math.round(Number(sRow?.voice_units ?? 0)),
      voice_calls: Number(sRow?.voice_calls ?? 0),
      billable_acquisition_actions: Math.round(Number(sRow?.acquisition_units ?? 0)),
      as_of: new Date().toISOString(),
    };

    // Build contiguous daily map
    const dailyMap = new Map(dailyRes.rows.map((r) => [r.bucket_date, r]));

    const dailyTokens: AnalyticsDailyTokenBucket[] = [];
    const dailyLatency: AnalyticsDailyLatencyBucket[] = [];

    // Format calendar dates using requested IANA timezone
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const seenDates = new Set<string>();
    const cur = new Date(opts.from);
    const end = new Date(opts.to);

    while (cur <= end) {
      const dKey = dtf.format(cur);
      if (!seenDates.has(dKey)) {
        seenDates.add(dKey);
        const row = dailyMap.get(dKey);

        dailyTokens.push({
          date: dKey,
          input_tokens: row ? Math.round(Number(row.input_tokens)) : 0,
          output_tokens: row ? Math.round(Number(row.output_tokens)) : 0,
          total_tokens: row ? Math.round(Number(row.total_tokens)) : 0,
          estimated_cost_usd: row ? Number(row.cost_micros) / 1_000_000 : 0,
        });

        dailyLatency.push({
          date: dKey,
          p50_ms: row?.p50_latency_ms ? Math.round(Number(row.p50_latency_ms)) : null,
          p95_ms: row?.p95_latency_ms ? Math.round(Number(row.p95_latency_ms)) : null,
          concurrent_turns: row ? Number(row.turns_count) : 0,
        });
      }
      cur.setTime(cur.getTime() + 24 * 60 * 60 * 1000);
    }

    const usageByService: AnalyticsServiceUsage[] = breakdownRes.rows.map((r) => {
      const isVoice = r.kind === "voice";
      const isAcquisition = r.kind === "acquisition";
      let serviceName = r.model ?? r.provider ?? r.kind;
      const unitLabel = r.unit_label ?? (isVoice ? "minutes" : isAcquisition ? "units" : "tokens");
      if (isVoice && !r.model) {
        serviceName = "voice-telephony";
      }

      return {
        service: serviceName,
        provider: r.provider ?? (isVoice ? "twilio" : "openai"),
        kind: r.kind,
        units: Math.round(Number(r.units ?? 0)),
        unit_label: unitLabel,
        input_tokens: r.kind === "model" ? Math.round(Number(r.input_tokens ?? 0)) : null,
        output_tokens: r.kind === "model" ? Math.round(Number(r.output_tokens ?? 0)) : null,
        estimated_cost_usd: Number(r.cost_micros ?? 0) / 1_000_000,
        is_unpriced: Number(r.unpriced_count ?? 0) > 0,
      };
    });

    // Calculate metric coverage indicators
    const totalModelTurns = Number(sRow?.total_model_turns ?? 0);
    const modelWithTokenDetail = Number(sRow?.model_with_token_detail ?? 0);
    const turnsWithLatency = Number(sRow?.turns_with_latency ?? 0);
    const totalEntries = Number(sRow?.total_entries ?? 0);
    const unpricedCount = Number(sRow?.unpriced_count ?? 0);
    const voiceCallsCount = Number(sRow?.voice_calls ?? 0);

    const tokenCoverage: MetricCoverage =
      totalModelTurns === 0
        ? "complete"
        : modelWithTokenDetail === totalModelTurns
          ? "complete"
          : modelWithTokenDetail > 0
            ? "partial"
            : "unavailable";

    const latencyCoverage: MetricCoverage =
      totalEntries === 0
        ? "complete"
        : turnsWithLatency === totalEntries
          ? "complete"
          : turnsWithLatency > 0
            ? "partial"
            : "unavailable";

    const spendCoverage: MetricCoverage =
      totalEntries === 0
        ? "complete"
        : unpricedCount === 0
          ? "complete"
          : unpricedCount < totalEntries
            ? "partial"
            : "unavailable";

    const coverage: MetricCoverageIndicators = {
      tokens: tokenCoverage,
      latency: latencyCoverage,
      spend: spendCoverage,
      conversations: "complete",
      voice: voiceCallsCount > 0 ? "complete" : "unavailable",
    };

    return {
      range: {
        from: fromIso.slice(0, 10),
        to: toIso.slice(0, 10),
        timezone: tz,
      },
      coverage,
      summary,
      daily_tokens: dailyTokens,
      daily_latency: dailyLatency,
      usage_by_service: usageByService,
      ...(operationalMetrics ? { operational_metrics: operationalMetrics } : {}),
      previous_period: {
        from: priorFromIso.slice(0, 10),
        to: priorToIso.slice(0, 10),
        total_tokens: Math.round(Number(pRow?.total_tokens ?? 0)),
        conversations: priorConvs,
        estimated_spend_usd: Number(pRow?.total_price_micros ?? 0) / 1_000_000,
      },
    };
  }
}
