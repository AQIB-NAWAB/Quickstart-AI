import { ResearchError } from "./research-error.js";
import { randomUUID, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  BusinessInput,
  LeadPolicy,
  LeadRunInput,
  CampaignLeadDelivery,
  InboundConnector,
  LeadCollection,
  InboundBatchEvent,
  InboundBatchRecordOutcome,
  ShortfallExplanation,
  ShortfallExpansionOption,
  QualificationMode,
  CriterionEvaluation,
  SalesStatus,
  LeadSchedule,
  CrmMapping,
  LeadObservation,
} from "@quickstart/contracts";
import {
  DEFAULT_POLICY,
  domain,
  fail,
  fingerprint,
  policyInput,
  hashToken,
  applyFieldMapping,
  connectorInput,
  collectionInput,
  normalizeWebsite,
  escapeCsvField,
} from "./domain.js";
import { ErrorCode } from "@quickstart/errors";

import type { Config } from "./config.js";

export type Identity = { orgId: string; workspaceId: string; actorId: string; requestId: string };
export type Task = {
  id: string;
  org_id: string;
  workspace_id: string;
  run_id: string | null;
  kind: "profile" | "search" | "candidate" | "delivery";
  payload: Record<string, unknown>;
  lease_token: string;
  attempts: number;
  request_id: string;
};
export type Run = {
  id: string;
  org_id: string;
  workspace_id: string;
  brief: LeadRunInput;
  policy_snapshot: LeadPolicy;
  policy_version: string;
  status: string;
  profile_id: string | null;
  profile_snapshot: { supplied: BusinessInput; researched: Json | null };
  accepted: number;
  errors: number;
  rounds: number;
  deadline_at: Date;
  stop_reason: string | null;
};
type Json = Record<string, unknown>;
export class Store {
  constructor(
    readonly pool: Pool,
    readonly mode: "demo" | "live" = "live",
  ) {}
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async initialize(): Promise<void> {
    await this.pool.query(
      "INSERT INTO lg_control(id,default_policy) VALUES(1,$1) ON CONFLICT DO NOTHING",
      [DEFAULT_POLICY],
    );
  }
  private async global(c: PoolClient) {
    return (await c.query("SELECT * FROM lg_control WHERE id=1 FOR UPDATE")).rows[0];
  }
  private async tenant(c: PoolClient, org: string) {
    await c.query("INSERT INTO lg_tenants(org_id) VALUES($1) ON CONFLICT DO NOTHING", [org]);
    return (await c.query("SELECT * FROM lg_tenants WHERE org_id=$1 FOR UPDATE", [org])).rows[0];
  }
  private async effective(
    c: PoolClient,
    org: string,
  ): Promise<{ policy: LeadPolicy; version: string }> {
    const global = (await c.query("SELECT * FROM lg_control WHERE id=1")).rows[0];
    const tenant = (await c.query("SELECT * FROM lg_tenants WHERE org_id=$1", [org])).rows[0];
    const tier = tenant?.tier_name
      ? (await c.query("SELECT * FROM lg_tiers WHERE name=$1", [tenant.tier_name])).rows[0]
      : null;
    return {
      policy: policyInput({ ...global.default_policy, ...tier?.policy, ...tenant?.policy }),
      version: `${global.version}:${tier?.version ?? 0}:${tenant?.policy_version ?? 0}`,
    };
  }
  async policy(org: string) {
    return this.tx(async (c) => {
      await this.global(c);
      await this.tenant(c, org);
      return this.effective(c, org);
    });
  }
  private async audit(
    c: PoolClient,
    i: Identity,
    action: string,
    previous: unknown,
    next: unknown,
    reason: string,
  ) {
    await c.query(
      "INSERT INTO lg_audit(org_id,workspace_id,actor_id,action,previous,next,reason,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        i.orgId || null,
        i.workspaceId || null,
        i.actorId,
        action,
        previous,
        next,
        reason,
        i.requestId,
      ],
    );
  }
  async settings(): Promise<unknown> {
    const control = (await this.pool.query("SELECT * FROM lg_control")).rows[0];
    const tiers = (await this.pool.query("SELECT * FROM lg_tiers ORDER BY name")).rows;
    return { control, tiers };
  }
  async changeSettings(
    i: Identity,
    input: {
      scope: "global" | "tier" | "tenant";
      name?: string;
      org_id?: string;
      expected_version: number;
      policy?: Partial<LeadPolicy> | null;
      tier_name?: string | null;
      global_active_limit?: number;
      reason: string;
    },
  ) {
    return this.tx(async (c) => {
      const g = await this.global(c);
      let previous: unknown;
      let next: unknown;
      if (input.scope === "global") {
        if (g.version !== input.expected_version)
          fail("Configuration version changed", ErrorCode.CONFLICT);
        const p = policyInput({ ...g.default_policy, ...input.policy });
        const cap = input.global_active_limit ?? g.global_active_limit;
        previous = g;
        next = (
          await c.query(
            "UPDATE lg_control SET default_policy=$1,global_active_limit=$2,version=version+1 WHERE id=1 RETURNING *",
            [p, cap],
          )
        ).rows[0];
      } else if (input.scope === "tier") {
        const prior = (await c.query("SELECT * FROM lg_tiers WHERE name=$1", [input.name])).rows[0];
        if ((prior?.version ?? 0) !== input.expected_version)
          fail("Tier version changed", ErrorCode.CONFLICT);
        const patch = { ...prior?.policy, ...input.policy };
        policyInput({ ...g.default_policy, ...patch });
        previous = prior ?? null;
        next = (
          await c.query(
            "INSERT INTO lg_tiers(name,policy) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET policy=$2,version=lg_tiers.version+1 RETURNING *",
            [input.name, patch],
          )
        ).rows[0];
      } else {
        const t = await this.tenant(c, input.org_id!);
        if (t.policy_version !== input.expected_version)
          fail("Tenant version changed", ErrorCode.CONFLICT);
        const tierName = input.tier_name === undefined ? t.tier_name : input.tier_name;
        const tier = tierName
          ? (await c.query("SELECT * FROM lg_tiers WHERE name=$1", [tierName])).rows[0]
          : null;
        if (tierName && !tier) fail("Unknown tier");
        const patch = input.policy === null ? null : { ...t.policy, ...input.policy };
        policyInput({ ...g.default_policy, ...tier?.policy, ...patch });
        previous = t;
        next = (
          await c.query(
            "UPDATE lg_tenants SET tier_name=$2,policy=$3,policy_version=policy_version+1 WHERE org_id=$1 RETURNING *",
            [input.org_id, tierName, patch],
          )
        ).rows[0];
      }
      await this.audit(
        c,
        { ...i, orgId: input.scope === "tenant" ? input.org_id! : "" },
        `settings.${input.scope}`,
        previous,
        next,
        input.reason,
      );
      return next;
    });
  }
  async apiRate(org: string, write = true): Promise<void> {
    await this.tx(async (c) => {
      await this.global(c);
      const t = await this.tenant(c, org);
      const { policy: p } = await this.effective(c, org);
      if (write && !p.enabled) fail("Lead generation is disabled", ErrorCode.FORBIDDEN);
      const row = (await c.query("SELECT date_trunc('minute',now()) AS minute")).rows[0];
      const count = t.api_minute?.getTime() === row.minute.getTime() ? t.api_count : 0;
      const limit = write ? p.request_rate_per_minute : Math.max(1200, p.request_rate_per_minute * 10);
      if (count >= limit)
        fail("Tenant API rate exceeded", ErrorCode.RATE_LIMITED);
      await c.query("UPDATE lg_tenants SET api_minute=$2,api_count=$3 WHERE org_id=$1", [
        org,
        row.minute,
        count + 1,
      ]);
    });
  }
  async profile(i: Identity) {
    return (
      (
        await this.pool.query(
          "SELECT * FROM lg_profiles WHERE workspace_id=$1 AND org_id=$2 AND execution_mode=$3 ORDER BY version DESC LIMIT 1",
          [i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0] ?? null
    );
  }
  async putProfile(i: Identity, supplied: BusinessInput, expectedVersion: number) {
    return this.tx(async (c) => {
      await this.global(c);
      await this.tenant(c, i.orgId);
      const previous = (
        await c.query(
          "SELECT * FROM lg_profiles WHERE workspace_id=$1 AND org_id=$2 AND execution_mode=$3 ORDER BY version DESC LIMIT 1",
          [i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0];
      if ((previous?.version ?? 0) !== expectedVersion)
        fail("Profile version changed", ErrorCode.CONFLICT);
      const { policy: p } = await this.effective(c, i.orgId);
      await this.backlog(c, i.orgId, p);
      const profile = (
        await c.query(
          "INSERT INTO lg_profiles(org_id,workspace_id,version,supplied,execution_mode,name,target_audience,value_proposition) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            i.orgId,
            i.workspaceId,
            expectedVersion + 1,
            supplied,
            this.mode,
            supplied.name || "Default Profile",
            supplied.target_audience || null,
            supplied.value_proposition || null,
          ],
        )
      ).rows[0];
      await this.task(c, i, "profile", { profile_id: profile.id }, `profile:${profile.id}`);
      await this.audit(
        c,
        i,
        "profile.updated",
        previous?.supplied ?? null,
        supplied,
        "User updated business details",
      );
      return profile;
    });
  }
  private async backlog(c: PoolClient, org: string, p: LeadPolicy) {
    const n = Number(
      (
        await c.query(
          "SELECT count(*) FROM lg_tasks WHERE org_id=$1 AND kind='profile' AND state IN ('queued','running')",
          [org],
        )
      ).rows[0].count,
    );
    if (n >= p.max_queued_runs) fail("Onboarding backlog full", ErrorCode.RATE_LIMITED);
  }
  private async task(
    c: PoolClient,
    i: Identity,
    kind: Task["kind"],
    payload: unknown,
    dedup: string,
    run: string | null = null,
  ) {
    await c.query(
      "INSERT INTO lg_tasks(org_id,workspace_id,kind,payload,dedup_key,run_id,request_id,execution_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,dedup_key) DO NOTHING",
      [i.orgId, i.workspaceId, kind, payload, dedup, run, i.requestId, this.mode],
    );
  }
  private async daily(c: PoolClient, org: string) {
    await c.query(
      "INSERT INTO lg_usage_daily(org_id,day) VALUES($1,CURRENT_DATE) ON CONFLICT DO NOTHING",
      [org],
    );
    return (
      await c.query(
        "SELECT * FROM lg_usage_daily WHERE org_id=$1 AND day=CURRENT_DATE FOR UPDATE",
        [org],
      )
    ).rows[0];
  }
  async reviseBrief(t: Task, brief: LeadRunInput) {
    if (!t.run_id) return;
    await this.pool.query("UPDATE lg_runs SET brief=$2 WHERE id=$1 AND workspace_id=$3", [
      t.run_id,
      brief,
      t.workspace_id,
    ]);
  }
  async createRun(i: Identity, brief: LeadRunInput, idempotency: string) {
    return this.tx(async (c) => {
      await this.global(c);
      await this.tenant(c, i.orgId);
      const hash = fingerprint(brief);
      const prior = (
        await c.query(
          "SELECT * FROM lg_runs WHERE workspace_id=$1 AND org_id=$2 AND idempotency_key=$3 AND execution_mode=$4",
          [i.workspaceId, i.orgId, idempotency, this.mode],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash)
          fail("Idempotency-Key reused with different request", ErrorCode.CONFLICT);
        return { run: prior, deduplicated: true };
      }
      const { policy: p, version } = await this.effective(c, i.orgId);
      // Until outbound source recipes are actually wired, fail explicitly instead
      // of silently running company-web searches for a different requested source.
      if (this.mode === "live") {
        if (brief.entity_type && brief.entity_type !== "business") fail("SOURCE_CAPABILITY_UNAVAILABLE: Live person/consumer discovery is not connected yet; use an appropriate inbound connector", ErrorCode.CONFLICT);
        const preferred = brief.source_policy?.preferred_sources ?? [];
        const disallowed = brief.source_policy?.disallowed_sources ?? [];
        if (preferred.some((source) => !["web", "google_maps"].includes(source)) || (disallowed.includes("web") && disallowed.includes("google_maps"))) {
          fail("SOURCE_CAPABILITY_UNAVAILABLE: Only web and customer-connected Google Maps discovery are supported; selected source policy cannot be honored", ErrorCode.CONFLICT);
        }
      }
      if (brief.budget_limits?.max_cost_usd !== undefined) fail("COST_CAP_UNSUPPORTED: Provider spending caps are not enforced by this discovery path", ErrorCode.CONFLICT);
      if (brief.budget_limits?.max_candidates) p.max_candidates = Math.min(p.max_candidates, brief.budget_limits.max_candidates);
      if (brief.budget_limits?.max_runtime_seconds) p.run_deadline_seconds = Math.min(p.run_deadline_seconds, brief.budget_limits.max_runtime_seconds);
      if (!p.enabled) fail("Lead generation disabled", ErrorCode.FORBIDDEN);
      if (brief.categories.length > p.max_categories || brief.target_count > p.max_target_count)
        fail("Run exceeds category or target safety limit", ErrorCode.RATE_LIMITED);
      const active = Number(
        (
          await c.query(
            "SELECT count(*) FROM lg_runs WHERE org_id=$1 AND status IN ('queued','running')",
            [i.orgId],
          )
        ).rows[0].count,
      );
      if (active >= p.max_queued_runs) fail("Tenant run backlog full", ErrorCode.RATE_LIMITED);
      const usage = await this.daily(c, i.orgId);
      if (p.subscription_limits_enabled && usage.runs >= p.daily_runs)
        fail("Daily run quota reached", ErrorCode.RATE_LIMITED);
      const profile = (
        await c.query(
          "SELECT * FROM lg_profiles WHERE workspace_id=$1 AND org_id=$2 AND execution_mode=$3 ORDER BY version DESC LIMIT 1",
          [i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0];
      const profileSnapshot = profile
        ? { supplied: profile.supplied, researched: profile.researched }
        : { supplied: { name: "", description: "", offerings: [], target_categories: [], locations: [] }, researched: null };
      if (brief.collection_id) {
        const coll = (
          await c.query(
            "SELECT * FROM lg_collections WHERE id=$1 AND workspace_id=$2",
            [brief.collection_id, i.workspaceId],
          )
        ).rows[0];
        if (!coll) fail("Collection not found in authorized workspace", ErrorCode.NOT_FOUND);
      }
      const qualificationMode = brief.qualification_mode ?? "strict";
      const priorities = brief.priorities ?? [];
      const entityType = brief.entity_type ?? "business";
      const criteria = brief.criteria ?? [];
      const assumptions = brief.confirmed_assumptions ?? [];
      const budgetLimits = brief.budget_limits ?? {};
      const sourcePolicy = brief.source_policy ?? {};

      const run = (
        await c.query(
          `INSERT INTO lg_runs(
            org_id,workspace_id,profile_id,brief,policy_snapshot,policy_version,
            idempotency_key,request_hash,request_id,deadline_at,execution_mode,
            profile_snapshot,qualification_mode,priorities,collection_id,
            entity_type,criteria,confirmed_assumptions,budget_limits,source_policy
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+$10*interval '1 second',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
          [
            i.orgId,
            i.workspaceId,
            profile?.id ?? null,
            brief,
            p,
            version,
            idempotency,
            hash,
            i.requestId,
            p.run_deadline_seconds,
            this.mode,
            profileSnapshot,
            qualificationMode,
            JSON.stringify(priorities),
            brief.collection_id ?? null,
            entityType,
            JSON.stringify(criteria),
            JSON.stringify(assumptions),
            JSON.stringify(budgetLimits),
            JSON.stringify(sourcePolicy),
          ],
        )
      ).rows[0];
      await c.query("UPDATE lg_usage_daily SET runs=runs+1 WHERE org_id=$1 AND day=CURRENT_DATE", [
        i.orgId,
      ]);
      for (const category of brief.categories)
        await this.task(
          c,
          i,
          "search",
          { category, round: 0 },
          `search:${run.id}:${category}:0`,
          run.id,
        );
      await this.audit(
        c,
        i,
        "run.created",
        null,
        { run_id: run.id, brief },
        "User requested lead generation",
      );
      return { run, deduplicated: false };
    });
  }
  async run(i: Identity, id: string): Promise<Run> {
    const row = (
      await this.pool.query(
        "SELECT * FROM lg_runs WHERE workspace_id=$1 AND org_id=$2 AND id=$3 AND execution_mode=$4",
        [i.workspaceId, i.orgId, id, this.mode],
      )
    ).rows[0];
    if (!row) fail("Run not found", ErrorCode.NOT_FOUND);
    const progress = (
      await this.pool.query(
        "SELECT status,count(*)::int AS count FROM lg_candidates WHERE run_id=$1 GROUP BY status",
        [id],
      )
    ).rows;
    const sourceRuns = (await this.pool.query(
      "SELECT s.actor_id,s.status,s.state->>'runId' AS external_run_id,s.state->>'datasetId' AS dataset_id,s.state->>'error' AS error FROM lg_source_runs s JOIN lg_tasks t ON t.id=s.task_id WHERE t.run_id=$1 AND s.workspace_id=$2 ORDER BY s.created_at",
      [id, i.workspaceId],
    )).rows;
    return { ...row, progress, source_runs: sourceRuns };
  }
  async list(
    i: Identity,
    resource: "runs" | "leads" | "audit",
    after: string | null,
    limit: number,
  ) {
    if (resource === "audit")
      return (
        await this.pool.query(
          "SELECT id,action,reason,actor_id,created_at FROM lg_audit WHERE workspace_id=$1 AND org_id=$2 AND id>$3 ORDER BY id LIMIT $4",
          [i.workspaceId, i.orgId, after ?? "0", limit],
        )
      ).rows;
    const table = resource === "runs" ? "lg_runs" : "lg_leads";
    const modeFilter = ` AND execution_mode='${this.mode}'`;
    return (
      await this.pool.query(
        `SELECT * FROM ${table} WHERE workspace_id=$1 AND org_id=$2${modeFilter} AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,
        [i.workspaceId, i.orgId, after, limit],
      )
    ).rows;
  }
  async results(i: Identity, id: string, after: string | null, limit: number) {
    await this.run(i, id);
    const rows = (
      await this.pool.query(
        `SELECT c.id, c.url, c.category, c.status, c.assessment, c.lead_id,
                l.sales_status, l.notes, l.activity_history, l.refresh_history, l.contact_points
         FROM lg_candidates c
         LEFT JOIN lg_leads l ON l.id = c.lead_id
         WHERE c.run_id=$1 AND c.workspace_id=$2 AND ($3::uuid IS NULL OR c.id>$3::uuid)
         ORDER BY c.id LIMIT $4`,
        [id, i.workspaceId, after, limit],
      )
    ).rows;
    return rows.map((r: any) => {
      if (r.assessment && typeof r.assessment === "object") {
        if (r.lead_id) r.assessment.lead_id = r.lead_id;
        if (r.sales_status) r.assessment.sales_status = r.sales_status;
        if (r.notes) r.assessment.notes = r.notes;
        if (r.activity_history) r.assessment.activity_history = r.activity_history;
        if (r.refresh_history) r.assessment.refresh_history = r.refresh_history;
        if (r.contact_points) r.assessment.contact_points = r.contact_points;
      }
      return r;
    });
  }
  async deliveries(i: Identity, id: string) {
    await this.run(i, id);
    return (
      await this.pool.query(
        "SELECT id,state,attempts,error_code,available_at,result FROM lg_tasks WHERE run_id=$1 AND workspace_id=$2 AND kind='delivery' ORDER BY created_at LIMIT 1000",
        [id, i.workspaceId],
      )
    ).rows;
  }
  async cancel(i: Identity, id: string) {
    return this.tx(async (c) => {
      await this.global(c);
      const run = (
        await c.query(
          "SELECT * FROM lg_runs WHERE id=$1 AND workspace_id=$2 AND org_id=$3 AND execution_mode=$4 FOR UPDATE",
          [id, i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0] as Run;
      if (!run) fail("Run not found", ErrorCode.NOT_FOUND);
      if (["completed", "completed_with_errors", "failed", "cancelled"].includes(run.status))
        return run;
      await c.query(
        "UPDATE lg_runs SET status='cancelled',stop_reason='user_cancelled' WHERE id=$1",
        [id],
      );
      await c.query(
        "UPDATE lg_tasks SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE run_id=$1 AND kind!='delivery' AND state IN ('queued','running')",
        [id],
      );
      await c.query(
        "UPDATE lg_candidates SET status='cancelled' WHERE run_id=$1 AND status='queued'",
        [id],
      );
      await this.audit(
        c,
        i,
        "run.cancelled",
        { status: run.status },
        { status: "cancelled" },
        "User cancelled research",
      );
      return { ...run, status: "cancelled", stop_reason: "user_cancelled" };
    });
  }
  /** One DB lock coordinates all replicas. Caps aggregate all workspaces within an organization. */
  async claim(leaseSeconds: number): Promise<Task | null> {
    return this.tx(async (c) => {
      const g = await this.global(c);
      await c.query(
        "UPDATE lg_tasks SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,available_at=now(),lease_token=NULL,lease_until=NULL,error_code='LEASE_EXPIRED' WHERE state='running' AND lease_until<now()",
      );
      await c.query(
        "UPDATE lg_runs SET status='completed_with_errors',stop_reason='deadline_reached' WHERE status IN ('queued','running') AND deadline_at<now()",
      );
      await c.query(
        "UPDATE lg_tasks t SET state='cancelled',lease_token=NULL,lease_until=NULL FROM lg_runs r WHERE t.run_id=r.id AND t.kind!='delivery' AND t.state IN ('queued','running') AND r.status NOT IN ('queued','running')",
      );
      await c.query(
        "UPDATE lg_candidates c SET status='cancelled' WHERE c.status='queued' AND EXISTS(SELECT 1 FROM lg_tasks t WHERE t.kind='candidate' AND t.state='cancelled' AND t.payload->>'candidate_id'=c.id::text)",
      );
      await c.query(
        "UPDATE lg_profiles p SET research_status='failed' WHERE EXISTS(SELECT 1 FROM lg_tasks t WHERE t.kind='profile' AND t.state='failed' AND t.payload->>'profile_id'=p.id::text)",
      );
      await c.query(
        "UPDATE lg_candidates c SET status='failed' WHERE c.status='queued' AND EXISTS(SELECT 1 FROM lg_tasks t WHERE t.kind='candidate' AND t.state='failed' AND t.payload->>'candidate_id'=c.id::text)",
      );
      const active = Number(
        (await c.query("SELECT count(*) FROM lg_tasks WHERE state='running'")).rows[0].count,
      );
      if (active >= g.global_active_limit) return null;
      const tenants = (
        await c.query(
          "SELECT t.* FROM lg_tenants t WHERE EXISTS(SELECT 1 FROM lg_tasks j WHERE j.org_id=t.org_id AND j.state='queued' AND j.available_at<=now() AND j.execution_mode=$1) ORDER BY t.virtual_finish,t.org_id",
          [this.mode],
        )
      ).rows;
      for (const t of tenants) {
        const { policy: p } = await this.effective(c, t.org_id);
        if (!p.enabled) continue;
        const count = Number(
          (
            await c.query("SELECT count(*) FROM lg_tasks WHERE org_id=$1 AND state='running'", [
              t.org_id,
            ])
          ).rows[0].count,
        );
        if (count >= p.max_active_tasks) continue;
        const task = (
          await c.query(
            "SELECT * FROM lg_tasks WHERE org_id=$1 AND state='queued' AND available_at<=now() AND execution_mode=$2 AND (kind<>'search' OR NOT EXISTS (SELECT 1 FROM lg_tasks pending WHERE pending.run_id=lg_tasks.run_id AND pending.kind='candidate' AND pending.state IN ('queued','running'))) ORDER BY (kind='candidate') DESC,created_at,(payload->>'discovery_rank')::int NULLS LAST,id FOR UPDATE SKIP LOCKED LIMIT 1",
            [t.org_id, this.mode],
          )
        ).rows[0];
        if (!task) continue;
        const token = randomUUID();
        const claimed = (
          await c.query(
            "UPDATE lg_tasks SET state='running',attempts=attempts+1,lease_token=$2,lease_until=now()+$3*interval '1 second' WHERE id=$1 RETURNING *",
            [task.id, token, leaseSeconds],
          )
        ).rows[0];
        // Charge expensive kinds more; cap catch-up credit for previously idle tenants.
        const cost = task.kind === "candidate" ? 3 : 1;
        const min = Number(tenants[0].virtual_finish);
        await c.query(
          "UPDATE lg_tenants SET virtual_finish=GREATEST(virtual_finish,$2)+$3 WHERE org_id=$1",
          [t.org_id, min - 10, cost / p.scheduling_weight],
        );
        if (task.run_id && task.kind !== "delivery")
          await c.query("UPDATE lg_runs SET status='running' WHERE id=$1 AND status='queued'", [
            task.run_id,
          ]);
        return claimed;
      }
      return null;
    });
  }
  private async live(c: PoolClient, t: Task) {
    const row = (
      await c.query(
        "SELECT * FROM lg_tasks WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now() FOR UPDATE",
        [t.id, t.lease_token],
      )
    ).rows[0];
    if (!row) fail("Task lease lost", ErrorCode.CONFLICT);
    return row;
  }
  async heartbeat(t: Task, seconds: number): Promise<boolean> {
    return (
      (
        await this.pool.query(
          "UPDATE lg_tasks SET lease_until=now()+$3*interval '1 second' WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now()",
          [t.id, t.lease_token, seconds],
        )
      ).rowCount === 1
    );
  }
  async context(t: Task) {
    const i = {
      orgId: t.org_id,
      workspaceId: t.workspace_id,
      actorId: "worker",
      requestId: t.request_id,
    };
    const run = t.run_id ? await this.run(i, t.run_id) : null;
    if (run) return { run, profile: run.profile_snapshot };
    const profile = (
      await this.pool.query("SELECT * FROM lg_profiles WHERE id=$1 AND workspace_id=$2", [
        t.payload.profile_id,
        t.workspace_id,
      ])
    ).rows[0];
    return { run, profile };
  }
  async reserve(t: Task, action: string, tokens: number, minIntervalSeconds = 0) {
    return this.tx(async (c) => {
      await this.global(c);
      await this.live(c, t);
      if (action === "model.complete" && minIntervalSeconds > 0) {
        // The configured gateway model is shared across tenants; serialize admission under the global lock.
        const timing = (await c.query("SELECT EXTRACT(EPOCH FROM (max(created_at)+$1*interval '1 second'-now())) AS wait FROM lg_usage_events WHERE action='model.complete'", [minIntervalSeconds])).rows[0];
        const wait = Math.ceil(Number(timing.wait));
        if (wait > 0) throw new ResearchError("MODEL_PACING_WAIT", true, wait);
      }
      await this.tenant(c, t.org_id);
      const { policy: p, version } = await this.effective(c, t.org_id);
      const daily = await this.daily(c, t.org_id);
      if (!p.enabled) fail("Research disabled", ErrorCode.RATE_LIMITED);
      // These daily provider safeguards apply even when commercial subscription limits are off.
      if (Number(daily.units) + 1 > p.daily_units || Number(daily.tokens) + tokens > p.daily_tokens)
        fail("Provider usage safety budget reached", ErrorCode.RATE_LIMITED);
      await c.query(
        "UPDATE lg_usage_daily SET units=units+1,tokens=tokens+$2 WHERE org_id=$1 AND day=CURRENT_DATE",
        [t.org_id, tokens],
      );
      const row = (
        await c.query(
          "INSERT INTO lg_usage_events(task_id,org_id,day,action,policy_version,reserved_tokens) VALUES($1,$2,CURRENT_DATE,$3,$4,$5) RETURNING id",
          [t.id, t.org_id, action, version, tokens],
        )
      ).rows[0];
      return row.id as string;
    });
  }
  async sourceRun(t: Task) {
    return (await this.pool.query("SELECT * FROM lg_source_runs WHERE task_id=$1 AND workspace_id=$2", [t.id, t.workspace_id])).rows[0] ?? null;
  }
  async beginSourceRun(t: Task, actorId: string) {
    return this.tx(async (c) => {
      await this.live(c, t);
      return (await c.query(
        "INSERT INTO lg_source_runs(task_id,workspace_id,actor_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *",
        [t.id, t.workspace_id, actorId],
      )).rows[0] ?? null;
    });
  }
  async saveSourceRun(t: Task, status: string, state: Record<string, unknown>) {
    return this.tx(async (c) => {
      await this.live(c, t);
      await c.query("UPDATE lg_source_runs SET status=$3,state=$4,updated_at=now() WHERE task_id=$1 AND workspace_id=$2", [t.id, t.workspace_id, status, JSON.stringify(state)]);
    });
  }

  async settle(eventId: string, actualTokens: number): Promise<void> {
    await this.tx(async (c) => {
      const e = (await c.query("SELECT * FROM lg_usage_events WHERE id=$1 FOR UPDATE", [eventId]))
        .rows[0];
      if (!e || e.state !== "reserved") return;
      await c.query("UPDATE lg_usage_events SET state='settled',actual_tokens=$2 WHERE id=$1", [
        eventId,
        actualTokens,
      ]);
      await c.query(
        "UPDATE lg_usage_daily SET tokens=GREATEST(0,tokens+$3) WHERE org_id=$1 AND day=$2",
        [e.org_id, e.day, actualTokens - e.reserved_tokens],
      );
    });
  }
  async finishProfile(t: Task, researched: Json) {
    await this.tx(async (c) => {
      await this.global(c);
      await this.live(c, t);
      await c.query(
        "UPDATE lg_profiles SET researched=$2,research_status='ready' WHERE id=$1 AND workspace_id=$3",
        [t.payload.profile_id, researched, t.workspace_id],
      );
      await this.done(c, t);
    });
  }
  private async done(c: PoolClient, t: Task, result: unknown = null) {
    await c.query(
      "UPDATE lg_tasks SET state='done',result=$2,lease_until=NULL,lease_token=NULL WHERE id=$1",
      [t.id, result],
    );
  }
  async discovered(t: Task, urls: Array<{ url: string; category: string; source_page?: { url: string; text: string }; source_record?: Record<string, unknown> }>) {
    await this.tx(async (c) => {
      await this.global(c);
      await this.live(c, t);
      const run = (await c.query("SELECT * FROM lg_runs WHERE id=$1 FOR UPDATE", [t.run_id]))
        .rows[0] as Run;
      if (!["queued", "running"].includes(run.status)) return;
      let n = Number(
        (await c.query("SELECT count(*) FROM lg_candidates WHERE run_id=$1", [run.id])).rows[0]
          .count,
      );
      const { policy: current } = await this.effective(c, t.org_id);
      const cap = Math.min(run.policy_snapshot.max_candidates, current.max_candidates);
      for (const [discoveryRank, u] of urls.entries()) {
        if (n >= cap) break;
        const host = new URL(u.url).hostname.toLowerCase().replace(/^www\./, "");
        const ownDomain = run.profile_snapshot?.supplied?.website
          ? domain(run.profile_snapshot.supplied.website)
          : null;
        if (ownDomain && (host === ownDomain || host.endsWith(`.${ownDomain}`))) continue;
        if (run.brief.excluded_domains.some((d) => host === d || host.endsWith(`.${d}`))) continue;
        const rows = (
          await c.query(
            "INSERT INTO lg_candidates(run_id,workspace_id,domain,url,category) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
            [run.id, t.workspace_id, host, u.url, u.category],
          )
        ).rows;
        if (rows.length) {
          n++;
          await this.task(
            c,
            {
              orgId: t.org_id,
              workspaceId: t.workspace_id,
              actorId: "worker",
              requestId: t.request_id,
            },
            "candidate",
            { candidate_id: rows[0].id, url: u.url, category: u.category, source_page: u.source_page, source_record: u.source_record, discovery_rank: discoveryRank },
            `candidate:${rows[0].id}`,
            run.id,
          );
        }
      }
      const round = Number(t.payload.round);
      if (round + 1 < Math.min(run.policy_snapshot.max_rounds, current.max_rounds) && n < cap) {
        const category = String(t.payload.category);
        await this.task(
          c,
          {
            orgId: t.org_id,
            workspaceId: t.workspace_id,
            actorId: "worker",
            requestId: t.request_id,
          },
          "search",
          { category, round: round + 1 },
          `search:${run.id}:${category}:${round + 1}`,
          run.id,
        );
      }
      await c.query("UPDATE lg_runs SET rounds=GREATEST(rounds,$2) WHERE id=$1", [
        run.id,
        round + 1,
      ]);
      await this.done(c, t, { discovered: urls.length });
    });
    await this.finalizeRuns();
  }
  async assessed(
    t: Task,
    data: CampaignLeadDelivery["lead"],
    accepted: boolean,
  ): Promise<{ leadId: string | null; lead: CampaignLeadDelivery["lead"] | null }> {
    data = { ...data, data_origin: this.mode };
    let leadId: string | null = null;
    let leadOut: CampaignLeadDelivery["lead"] | null = null;
    await this.tx(async (c) => {
      await this.global(c);
      await this.live(c, t);
      const run = (await c.query("SELECT * FROM lg_runs WHERE id=$1 FOR UPDATE", [t.run_id]))
        .rows[0] as Run;
      if (!["queued", "running"].includes(run.status)) return;
      const host = data.website ? domain(data.website) : null;
      const ownDomain = run.profile_snapshot?.supplied?.website
        ? domain(run.profile_snapshot.supplied.website)
        : null;
      const excluded =
        (host && ownDomain && (host === ownDomain || host.endsWith(`.${ownDomain}`))) ||
        (host && run.brief.excluded_domains.some((d) => host === d || host.endsWith(`.${d}`)));
      const isAccepted = accepted && !excluded && run.accepted < run.brief.target_count;
      let added = false;
      await c.query(
        "UPDATE lg_candidates SET status=$2,assessment=$3 WHERE id=$1 AND workspace_id=$4",
        [t.payload.candidate_id, isAccepted ? "accepted" : "rejected", JSON.stringify(data), t.workspace_id],
      );
      if (isAccepted) {
        let lead: any;
        const entityType = data.entity_type || (run as any).entity_type || "business";

        if (!host) {
          // Entity without domain (e.g. consumer or independent professional)
          if (data.email) {
            lead = (
              await c.query(
                "SELECT * FROM lg_leads WHERE workspace_id=$1 AND lower(contact_email)=lower($2) AND execution_mode=$3 LIMIT 1",
                [t.workspace_id, data.email, this.mode],
              )
            ).rows[0];
          }
          // A name without contact/provider identity is not a deduplication key.
        } else if (data.person_name) {
          if (data.email) {
            lead = (
              await c.query(
                "SELECT * FROM lg_leads WHERE workspace_id=$1 AND domain=$2 AND lower(contact_email)=lower($3) AND execution_mode=$4 LIMIT 1",
                [t.workspace_id, host, data.email, this.mode],
              )
            ).rows[0];
          }
        } else if (data.email) {
          lead = (
            await c.query(
              "SELECT * FROM lg_leads WHERE workspace_id=$1 AND domain=$2 AND lower(contact_email)=lower($3) AND execution_mode=$4 LIMIT 1",
              [t.workspace_id, host, data.email, this.mode],
            )
          ).rows[0];
        } else {
          lead = (
            await c.query(
              "SELECT * FROM lg_leads WHERE workspace_id=$1 AND domain=$2 AND execution_mode=$3 AND person_name IS NULL LIMIT 1",
              [t.workspace_id, host, this.mode],
            )
          ).rows[0];
        }

        const contactPoints = Array.isArray(data.contact_points) ? data.contact_points : [];
        if (!contactPoints.length) {
          if (data.email) {
            contactPoints.push({
              type: "email",
              raw_value: data.email,
              normalized_value: data.email.toLowerCase(),
              status: (data as any).email_validation_status ?? "observed",
              observed_at: new Date().toISOString(),
            });
          }
          if (data.phone) {
            contactPoints.push({
              type: "phone",
              raw_value: data.phone,
              normalized_value: data.phone,
              status: (data as any).phone_validation_status ?? "observed",
              observed_at: new Date().toISOString(),
            });
          }
        }

        const serializedData = JSON.stringify({ ...data, data_origin: this.mode });
        if (lead) {
          // Preserve user edits, notes, and sales status
          const existingUserEdits = lead.user_edits || {};
          const refreshHistory = Array.isArray(lead.refresh_history) ? lead.refresh_history : [];
          refreshHistory.push({
            refreshed_at: new Date().toISOString(),
            run_id: run.id,
            previous_summary: lead.data?.summary ?? null,
            new_summary: data.summary ?? null,
            fit_score: data.fit_score ?? null,
          });

          const presentData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== ""));
          const mergedData = { ...lead.data, ...presentData, ...existingUserEdits, data_origin: this.mode };
          const mergedContacts = [
            ...contactPoints,
            ...(Array.isArray(lead.contact_points) ? lead.contact_points : []).filter(
              (old: { type: string }) => !contactPoints.some((next: { type: string }) => next.type === old.type),
            ),
          ];

          lead = (
            await c.query(
              `UPDATE lg_leads SET
                data=$1,
                person_name=coalesce($2, lg_leads.person_name),
                person_role=coalesce($3, lg_leads.person_role),
                contact_email=coalesce($4, lg_leads.contact_email),
                contact_phone=coalesce($5, lg_leads.contact_phone),
                qualification_mode=$6,
                refresh_history=$7,
                contact_points=$8,
                checked_at=now()
              WHERE id=$9 RETURNING *`,
              [
                JSON.stringify(mergedData),
                mergedData.person_name ?? null,
                mergedData.person_role ?? null,
                mergedData.email ?? null,
                mergedData.phone ?? null,
                (run as any).qualification_mode ?? "strict",
                JSON.stringify(refreshHistory),
                JSON.stringify(mergedContacts),
                lead.id,
              ],
            )
          ).rows[0];
        } else {
          lead = (
            await c.query(
              `INSERT INTO lg_leads(
                org_id, workspace_id, domain, data, execution_mode,
                person_name, person_role, contact_email, contact_phone,
                qualification_mode, collection_id, entity_type,
                sales_status, contact_points
              ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
              RETURNING *`,
              [
                t.org_id,
                t.workspace_id,
                host,
                serializedData,
                this.mode,
                data.person_name ?? null,
                data.person_role ?? null,
                data.email ?? null,
                data.phone ?? null,
                (run as any).qualification_mode ?? "strict",
                (run as any).collection_id ?? null,
                entityType,
                "new",
                JSON.stringify(contactPoints),
              ],
            )
          ).rows[0];
        }

        if (Array.isArray(data.evidence)) {
          for (const ev of data.evidence) {
            if (ev && typeof ev === "object" && ev.field && ev.value) {
              await c.query(
                `INSERT INTO lg_observations(org_id, workspace_id, lead_id, field, value, quote, source_url, observed_at)
                 VALUES($1,$2,$3,$4,$5,$6,$7,now())`,
                [t.org_id, t.workspace_id, lead.id, String(ev.field), String(ev.value), ev.quote || null, ev.source_url || null],
              );
            }
          }
        }
        const inserted = await c.query(
          "INSERT INTO lg_run_leads(run_id,lead_id,data_snapshot) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [run.id, lead.id, serializedData],
        );
        if (inserted.rowCount) {
          added = true;
          leadId = String(lead.id);
          leadOut = data;
          await c.query("UPDATE lg_candidates SET lead_id=$1 WHERE id=$2", [lead.id, t.payload.candidate_id]);
          await c.query("UPDATE lg_runs SET accepted=accepted+1 WHERE id=$1", [run.id]);
          if (run.brief.campaign_id) {
            const delivery: CampaignLeadDelivery = {
              schema_version: 1,
              idempotency_key: `lead:${t.workspace_id}:${run.brief.campaign_id}:${lead.id}`,
              workspace_id: t.workspace_id,
              campaign_id: run.brief.campaign_id,
              run_id: run.id,
              lead_id: lead.id,
              lead: data,
            };
            await this.task(
              c,
              {
                orgId: t.org_id,
                workspaceId: t.workspace_id,
                actorId: "worker",
                requestId: t.request_id,
              },
              "delivery",
              delivery,
              `delivery:${this.mode}:${run.brief.campaign_id}:${lead.id}`,
              run.id,
            );
          }
        } else {
          const duplicateAssessment = {
            ...data,
            fit_score: data.fit_score ?? 0,
            duplicate: true,
            fit_reasons: [
              `Duplicate lead: ${data.company_name || host} has already been discovered or recorded in this workspace.`,
            ],
            explanation: `Duplicate lead: ${data.company_name || host} is already in the workspace CRM or a prior run.`,
          };
          await c.query("UPDATE lg_candidates SET status='duplicate', assessment=$2 WHERE id=$1", [
            t.payload.candidate_id,
            JSON.stringify(duplicateAssessment),
          ]);
        }
      }
      await this.done(c, t);
      if (added && run.accepted + 1 >= run.brief.target_count) {
        await c.query(
          "UPDATE lg_runs SET status=CASE WHEN errors>0 THEN 'completed_with_errors' ELSE 'completed' END,stop_reason='target_reached' WHERE id=$1",
          [run.id],
        );
        await c.query(
          "UPDATE lg_candidates SET status='cancelled' WHERE run_id=$1 AND status='queued'",
          [run.id],
        );
        await c.query(
          "UPDATE lg_tasks SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE run_id=$1 AND kind IN ('search','candidate') AND state IN ('queued','running')",
          [run.id],
        );
      }
    });
    await this.finalizeRuns();
    return { leadId, lead: leadOut };
  }
  async delivered(t: Task, result: unknown) {
    await this.tx(async (c) => {
      await this.global(c);
      await this.live(c, t);
      await this.done(c, t, result);
    });
  }
  async saveResearchPages(t: Task, pages: Array<{url: string; text: string}>) {
    await this.tx(async (c) => {
      await this.live(c, t);
      await c.query("UPDATE lg_tasks SET payload=jsonb_set(payload,'{research_pages}',$2::jsonb) WHERE id=$1", [
        t.id, JSON.stringify(pages.slice(0, 8).map(page => ({url: page.url, text: page.text.slice(0, 100000)})))
      ]);
    });
  }
  async failed(t: Task, code: string, retryable: boolean, delaySeconds = 0, errorDetail?: string) {
    await this.tx(async (c) => {
      await this.global(c);
      const live = (
        await c.query(
          "SELECT * FROM lg_tasks WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now() FOR UPDATE",
          [t.id, t.lease_token],
        )
      ).rows[0];
      if (!live) return;
      const modelCooldown = ["MODEL_RATE_LIMITED", "MODEL_PROVIDER_UNAVAILABLE"].includes(code);
      const maxAttempts = modelCooldown ? 6 : t.kind === "candidate" ? 3 : 5;
      const retry = retryable && (["SOURCE_PENDING", "MODEL_PACING_WAIT"].includes(code) || t.attempts < maxAttempts);
      const delay = Math.max(delaySeconds, modelCooldown ? Math.min(300, 60 * 2 ** (t.attempts - 1)) : Math.min(120, 2 ** t.attempts) + Math.random() * 2);
      if (modelCooldown) {
        await c.query("UPDATE lg_tasks SET available_at=GREATEST(available_at,now()+$2*interval '1 second') WHERE org_id=$1 AND state='queued' AND kind IN ('candidate','search','profile')", [t.org_id, delay]);
      }
      await c.query(
        "UPDATE lg_tasks SET state=$2,error_code=$3,available_at=now()+$4*interval '1 second',lease_token=NULL,lease_until=NULL,attempts=CASE WHEN $3 IN ('SOURCE_PENDING','MODEL_PACING_WAIT') THEN GREATEST(0,attempts-1) ELSE attempts END WHERE id=$1",
        [t.id, retry ? "queued" : "failed", code, delay],
      );
      if (!retry && t.run_id && t.kind !== "delivery") {
        await c.query("UPDATE lg_runs SET errors=errors+1 WHERE id=$1", [t.run_id]);
        if (t.kind === "candidate") {
          let failureReason = "Website scraping could not be completed";
          if (code === "PROVIDER_TIMEOUT") {
            failureReason = "Website took too long to respond (timeout after 45s)";
          } else if (code === "PROVIDER_HTTP_429") {
            failureReason = "Upstream provider rate limited (429 Too Many Requests)";
          } else if (code === "MODEL_OUTPUT_TRUNCATED") {
            failureReason = "AI response exceeded its output limit; qualification was not completed";
          } else if (code === "MODEL_QUOTA_EXHAUSTED") {
            failureReason = "AI provider daily or billing quota exhausted; retry after the provider allowance resets";
          } else if (code === "MODEL_RATE_LIMITED") {
            failureReason = "AI completion quota or rate limit reached on provider";
          } else if (code === "MODEL_PROVIDER_UNAVAILABLE") {
            failureReason = "AI model provider temporarily unavailable or cooling down";
          } else if (code?.startsWith("MODEL_")) {
            failureReason = "AI model evaluation failed";
          } else if (code === "PROVIDER_UNAVAILABLE") {
            failureReason = "Website or scrape service was unreachable";
          } else if (code === "UNSAFE_URL" || code === "UNSAFE_FINAL_URL") {
            failureReason = "Target URL resolved to an unsafe address or private network";
          } else if (code === "EMPTY_PAGE") {
            failureReason = "Website returned a blank page or blocked bot access";
          }
          const failureAssessment = {
            company_name: t.payload.url ? domain(String(t.payload.url)) : "Candidate",
            website: t.payload.url,
            fit_score: 0,
            fit_reasons: [`Service error: ${failureReason}`],
            technical_error: code,
            explanation: `${failureReason} (${code})`,
            error_details: {
              code,
              detail: errorDetail || null,
              attempts: t.attempts,
              failed_at: new Date().toISOString(),
            },
          };
          await c.query("UPDATE lg_candidates SET status='failed', assessment=$2 WHERE id=$1", [
            t.payload.candidate_id,
            JSON.stringify(failureAssessment),
          ]);
        }
      }
      if (!retry && t.kind === "profile")
        await c.query("UPDATE lg_profiles SET research_status='failed' WHERE id=$1", [
          t.payload.profile_id,
        ]);
      if (["BUDGET_REACHED", "MODEL_QUOTA_EXHAUSTED"].includes(code) && t.run_id && t.kind !== "delivery") {
        await c.query(
          "UPDATE lg_runs SET status='completed_with_errors',stop_reason=$2 WHERE id=$1 AND status IN ('queued','running')",
          [t.run_id, code === "MODEL_QUOTA_EXHAUSTED" ? "provider_quota_exhausted" : "budget_reached"],
        );
        await c.query(
          "UPDATE lg_tasks SET state='cancelled',lease_token=NULL,lease_until=NULL WHERE run_id=$1 AND kind!='delivery' AND state IN ('queued','running')",
          [t.run_id],
        );
        await c.query(
          "UPDATE lg_candidates SET status='cancelled' WHERE run_id=$1 AND status='queued'",
          [t.run_id],
        );
      }
    });
    await this.finalizeRuns();
  }
  async finalizeRuns() {
    await this.pool.query(
      "UPDATE lg_runs r SET status=CASE WHEN errors>0 OR EXISTS(SELECT 1 FROM lg_tasks t WHERE t.run_id=r.id AND t.kind!='delivery' AND t.state='failed') THEN 'completed_with_errors' ELSE 'completed' END,stop_reason=CASE WHEN accepted >= (brief->>'target_count')::int THEN 'target_reached' WHEN errors>0 THEN 'research_errors' ELSE 'research_round_limit' END WHERE r.status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM lg_tasks t WHERE t.run_id=r.id AND t.kind!='delivery' AND t.state IN ('queued','running'))",
    );
    // Auto-compute shortfall explanation for any finalized runs that fell short of target
    const unfinished = (
      await this.pool.query(
        "SELECT id FROM lg_runs WHERE status IN ('completed','completed_with_errors') AND shortfall_explanation IS NULL AND accepted < (brief->>'target_count')::int LIMIT 10",
      )
    ).rows;
    for (const row of unfinished) {
      await this.computeShortfallExplanation(row.id);
    }
  }

  async computeShortfallExplanation(runId: string): Promise<ShortfallExplanation | null> {
    const run = (await this.pool.query("SELECT * FROM lg_runs WHERE id=$1", [runId])).rows[0];
    if (!run) return null;
    const target = Number(run.brief?.target_count ?? 25);
    const found = Number(run.accepted ?? 0);
    const shortfall = Math.max(0, target - found);
    if (shortfall === 0) return null;

    const candidates = (await this.pool.query("SELECT * FROM lg_candidates WHERE run_id=$1", [runId])).rows;
    let categoryMismatch = 0;
    let locationMismatch = 0;
    let contactMissing = 0;
    let fitBelowBar = 0;

    for (const c of candidates) {
      const assessment = c.assessment ?? {};
      const reasons: string[] = Array.isArray(assessment.reject_reasons) ? assessment.reject_reasons : [];
      const text = reasons.join(" ").toLowerCase();
      if (text.includes("category")) categoryMismatch++;
      if (text.includes("location")) locationMismatch++;
      if (text.includes("email") || text.includes("phone") || text.includes("contact")) contactMissing++;
      if (text.includes("fit score") || text.includes("below")) fitBelowBar++;
    }

    const tasks = (await this.pool.query("SELECT * FROM lg_tasks WHERE run_id=$1", [runId])).rows;
    const providerLimitsHit = tasks.some(
      (t) => ["BUDGET_REACHED", "PROVIDER_HTTP_429", "MODEL_RATE_LIMITED", "MODEL_PROVIDER_UNAVAILABLE", "MODEL_QUOTA_EXHAUSTED"].includes(t.error_code),
    );

    const researchFailed = candidates.filter((candidate) => candidate.status === "failed").length;
    const causes = {
      research_failed: researchFailed,
      category_mismatch: categoryMismatch,
      location_mismatch: locationMismatch,
      contact_missing: contactMissing,
      fit_score_below_bar: fitBelowBar,
      domain_excluded: candidates.filter(
        (c) => c.status === "rejected" && String(c.assessment?.summary ?? "").includes("excluded"),
      ).length,
      provider_limits_hit: providerLimitsHit,
    };

    const expansionOptions: ShortfallExpansionOption[] = [];
    if (run.qualification_mode === "strict") {
      expansionOptions.push({
        type: "switch_mode",
        label: "Switch to Best Match mode",
        description: "Rank promising prospects that match core business criteria even when some secondary facts or direct phone numbers are unconfirmed.",
        suggested_patch: { qualification_mode: "best_match" },
      });
    }
    if (["both", "phone", "email"].includes(run.brief?.required_contact)) {
      expansionOptions.push({
        type: "relax_contact",
        label: "Relax contact requirement to Either (Email or Phone)",
        description: "Allow prospects that have either a source-observed business email or telephone number.",
        suggested_patch: { required_contact: "either" },
      });
    }
    if (run.brief?.location && locationMismatch > 0 && researchFailed === 0) {
      expansionOptions.push({
        type: "expand_geography",
        label: "Expand target location",
        description: "Broaden the geographical search boundary to include neighboring metropolitan districts or regional markets.",
        suggested_patch: { location: undefined },
      });
    }
    expansionOptions.push({
      type: "increase_rounds",
      label: "Run additional research rounds",
      description: "Search using broader industry terminology and alternative business directories.",
      suggested_patch: {},
    });

    const summaryParts: string[] = [];
    if (categoryMismatch > 0) summaryParts.push(`${categoryMismatch} candidates did not match target industry criteria`);
    if (locationMismatch > 0) summaryParts.push(`${locationMismatch} candidates had missing or nonmatching location evidence`);
    if (contactMissing > 0) summaryParts.push(`${contactMissing} candidates lacked the required contact details`);
    if (fitBelowBar > 0) summaryParts.push(`${fitBelowBar} candidates were below the qualification fit score threshold`);
    if (researchFailed > 0) summaryParts.push(`${researchFailed} candidate research tasks failed before qualification; inspect their provider errors`);
    if (providerLimitsHit) summaryParts.push("Configured provider rate or budget limits were reached");

    const summary = summaryParts.length > 0
      ? `Target of ${target} leads was not fully met (${found} found, shortfall ${shortfall}). Primary causes: ${summaryParts.join("; ")}.`
      : `Research found ${found} leads out of requested ${target}. The configured research rounds ended; this does not mean all available businesses were exhausted.`;

    const explanation: ShortfallExplanation = {
      shortfall,
      target,
      found,
      causes,
      summary,
      expansion_options: expansionOptions,
    };

    await this.pool.query("UPDATE lg_runs SET shortfall_explanation=$2 WHERE id=$1", [runId, explanation]);
    return explanation;
  }

  async confirmProfileFacts(
    i: Identity,
    input: {
      approved?: boolean;
      confirmed_facts?: Record<string, unknown>;
      inferences?: Record<string, unknown>;
      notes?: string;
    },
  ) {
    return this.tx(async (c) => {
      const profile = (
        await c.query(
          "SELECT * FROM lg_profiles WHERE workspace_id=$1 AND org_id=$2 AND execution_mode=$3 ORDER BY version DESC LIMIT 1",
          [i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0];
      if (!profile) fail("Profile not found", ErrorCode.NOT_FOUND);

      const approval = {
        approved: input.approved !== false,
        approved_at: new Date().toISOString(),
        approved_by: i.actorId,
        confirmed_facts: input.confirmed_facts ?? profile.supplied,
        notes: input.notes ?? null,
      };

      const updated = (
        await c.query(
          "UPDATE lg_profiles SET confirmed_facts=$1, inferences=coalesce($2, inferences) WHERE id=$3 RETURNING *",
          [approval, input.inferences ?? null, profile.id],
        )
      ).rows[0];

      await this.audit(
        c,
        i,
        "profile.facts_confirmed",
        profile.confirmed_facts ?? null,
        approval,
        input.approved ? "User approved AI research findings as business facts" : "User revoked fact approval",
      );

      return updated;
    });
  }

  async createConnector(
    i: Identity,
    input: ReturnType<typeof connectorInput>,
  ): Promise<{ connector: InboundConnector; raw_token: string }> {
    return this.tx(async (c) => {
      await this.global(c);
      await this.tenant(c, i.orgId);
      const rawToken = `inb_live_${randomBytes(24).toString("hex")}`;
      const tokenHash = hashToken(rawToken);
      const tokenPrefix = `inb_live_${rawToken.slice(9, 15)}...`;

      const row = (
        await c.query(
          `INSERT INTO lg_connectors(
            org_id, workspace_id, name, source_type, description, token_prefix, token_hash,
            status, collection_id, default_qualification_mode, field_mapping,
            enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            i.orgId,
            i.workspaceId,
            input.name,
            input.source_type,
            input.description ?? null,
            tokenPrefix,
            tokenHash,
            "active",
            input.collection_id ?? null,
            input.default_qualification_mode,
            JSON.stringify(input.field_mapping),
            input.enrichment_enabled,
            input.auto_enroll_campaign_id ?? null,
            input.rate_limit_per_minute,
            input.batch_size_limit,
          ],
        )
      ).rows[0];

      await this.audit(
        c,
        i,
        "connector.created",
        null,
        { connector_id: row.id, name: row.name, source_type: row.source_type },
        "Created inbound lead connector",
      );

      const connector = { ...row };
      delete connector.token_hash;
      return { connector, raw_token: rawToken };
    });
  }

  async listConnectors(i: Identity): Promise<InboundConnector[]> {
    const rows = (
      await this.pool.query(
        "SELECT id, org_id, workspace_id, name, source_type, description, token_prefix, status, collection_id, default_qualification_mode, field_mapping, enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit, payload_size_limit_bytes, created_at, last_used_at, revoked_at FROM lg_connectors WHERE workspace_id=$1 AND org_id=$2 ORDER BY created_at DESC",
        [i.workspaceId, i.orgId],
      )
    ).rows;
    return rows;
  }

  async getConnector(i: Identity, id: string, client?: PoolClient): Promise<InboundConnector> {
    const db = client ?? this.pool;
    const row = (
      await db.query(
        "SELECT id, org_id, workspace_id, name, source_type, description, token_prefix, status, collection_id, default_qualification_mode, field_mapping, enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit, payload_size_limit_bytes, created_at, last_used_at, revoked_at FROM lg_connectors WHERE id=$1 AND workspace_id=$2 AND org_id=$3",
        [id, i.workspaceId, i.orgId],
      )
    ).rows[0];
    if (!row) fail("Connector not found", ErrorCode.NOT_FOUND);
    return row;
  }

  async updateConnector(
    i: Identity,
    id: string,
    patch: Partial<ReturnType<typeof connectorInput>> & { status?: string },
  ): Promise<InboundConnector> {
    return this.tx(async (c) => {
      const existing = await this.getConnector(i, id, c);
      const name = patch.name ?? existing.name;
      const description = patch.description !== undefined ? patch.description : existing.description;
      const status = patch.status ?? existing.status;
      const collectionId = patch.collection_id !== undefined ? patch.collection_id : existing.collection_id;
      const mode = patch.default_qualification_mode ?? existing.default_qualification_mode;
      const mapping = patch.field_mapping ?? existing.field_mapping;
      const enrichment = patch.enrichment_enabled !== undefined ? patch.enrichment_enabled : existing.enrichment_enabled;
      const autoEnroll = patch.auto_enroll_campaign_id !== undefined ? patch.auto_enroll_campaign_id : existing.auto_enroll_campaign_id;

      const updated = (
        await c.query(
          `UPDATE lg_connectors SET
            name=$1, description=$2, status=$3, collection_id=$4,
            default_qualification_mode=$5, field_mapping=$6, enrichment_enabled=$7,
            auto_enroll_campaign_id=$8
          WHERE id=$9 AND workspace_id=$10 AND org_id=$11
          RETURNING id, org_id, workspace_id, name, source_type, description, token_prefix, status, collection_id, default_qualification_mode, field_mapping, enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit, payload_size_limit_bytes, created_at, last_used_at, revoked_at`,
          [
            name,
            description ?? null,
            status,
            collectionId,
            mode,
            mapping,
            enrichment,
            autoEnroll,
            id,
            i.workspaceId,
            i.orgId,
          ],
        )
      ).rows[0];

      await this.audit(c, i, "connector.updated", existing, updated, "Updated inbound connector");
      return updated;
    });
  }

  async rotateConnectorToken(i: Identity, id: string): Promise<{ connector: InboundConnector; raw_token: string }> {
    return this.tx(async (c) => {
      const existing = await this.getConnector(i, id, c);
      const rawToken = `inb_live_${randomBytes(24).toString("hex")}`;
      const tokenHash = hashToken(rawToken);
      const tokenPrefix = `inb_live_${rawToken.slice(9, 15)}...`;

      const updated = (
        await c.query(
          "UPDATE lg_connectors SET token_prefix=$1, token_hash=$2, status='active', revoked_at=NULL WHERE id=$3 AND workspace_id=$4 AND org_id=$5 RETURNING id, org_id, workspace_id, name, source_type, description, token_prefix, status, collection_id, default_qualification_mode, field_mapping, enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit, payload_size_limit_bytes, created_at, last_used_at, revoked_at",
          [tokenPrefix, tokenHash, id, i.workspaceId, i.orgId],
        )
      ).rows[0];

      await this.audit(c, i, "connector.token_rotated", { token_prefix: existing.token_prefix }, { token_prefix: tokenPrefix }, "Rotated connector token");
      return { connector: updated, raw_token: rawToken };
    });
  }

  async revokeConnector(i: Identity, id: string): Promise<InboundConnector> {
    return this.tx(async (c) => {
      const existing = await this.getConnector(i, id, c);
      const updated = (
        await c.query(
          "UPDATE lg_connectors SET status='revoked', revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND org_id=$3 RETURNING id, org_id, workspace_id, name, source_type, description, token_prefix, status, collection_id, default_qualification_mode, field_mapping, enrichment_enabled, auto_enroll_campaign_id, rate_limit_per_minute, batch_size_limit, payload_size_limit_bytes, created_at, last_used_at, revoked_at",
          [id, i.workspaceId, i.orgId],
        )
      ).rows[0];

      await this.audit(c, i, "connector.revoked", existing, updated, "Revoked inbound connector");
      return updated;
    });
  }

  async createCollection(i: Identity, input: ReturnType<typeof collectionInput>): Promise<LeadCollection> {
    return this.tx(async (c) => {
      await this.global(c);
      await this.tenant(c, i.orgId);
      const row = (
        await c.query(
          "INSERT INTO lg_collections(org_id, workspace_id, name, description, qualification_overrides) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [i.orgId, i.workspaceId, input.name, input.description ?? null, JSON.stringify(input.qualification_overrides)],
        )
      ).rows[0];
      await this.audit(c, i, "collection.created", null, { collection_id: row.id, name: row.name }, "Created lead collection");
      return row;
    });
  }

  async listCollections(i: Identity): Promise<LeadCollection[]> {
    return (
      await this.pool.query(
        "SELECT * FROM lg_collections WHERE workspace_id=$1 AND org_id=$2 ORDER BY name ASC",
        [i.workspaceId, i.orgId],
      )
    ).rows;
  }

  async getCollection(i: Identity, id: string, client?: PoolClient): Promise<LeadCollection> {
    const db = client ?? this.pool;
    const row = (
      await db.query(
        "SELECT * FROM lg_collections WHERE id=$1 AND workspace_id=$2 AND org_id=$3",
        [id, i.workspaceId, i.orgId],
      )
    ).rows[0];
    if (!row) fail("Collection not found", ErrorCode.NOT_FOUND);
    return row;
  }

  async updateCollection(
    i: Identity,
    id: string,
    input: Partial<ReturnType<typeof collectionInput>>,
  ): Promise<LeadCollection> {
    return this.tx(async (c) => {
      const existing = await this.getCollection(i, id, c);
      const name = input.name ?? existing.name;
      const description = input.description !== undefined ? input.description : existing.description;
      const overrides = input.qualification_overrides ?? existing.qualification_overrides;
      const row = (
        await c.query(
          "UPDATE lg_collections SET name=$1, description=$2, qualification_overrides=$3 WHERE id=$4 AND workspace_id=$5 AND org_id=$6 RETURNING *",
          [name, description ?? null, overrides, id, i.workspaceId, i.orgId],
        )
      ).rows[0];
      await this.audit(c, i, "collection.updated", existing, row, "Updated lead collection");
      return row;
    });
  }

  async deleteCollection(i: Identity, id: string): Promise<void> {
    await this.tx(async (c) => {
      const existing = await this.getCollection(i, id);
      await c.query("DELETE FROM lg_collections WHERE id=$1 AND workspace_id=$2 AND org_id=$3", [id, i.workspaceId, i.orgId]);
      await this.audit(c, i, "collection.deleted", existing, null, "Deleted lead collection");
    });
  }

  async ingestInboundBatch(input: {
    connectorId: string;
    token: string;
    idempotencyKey?: string;
    records: Record<string, unknown>[];
    collectionId?: string;
    config?: Config;
  }): Promise<InboundBatchEvent> {
    const tokenHash = hashToken(input.token.trim());
    const connector = (
      await this.pool.query(
        "SELECT * FROM lg_connectors WHERE id=$1",
        [input.connectorId],
      )
    ).rows[0];

    if (!connector) {
      fail("Inbound connector not found", ErrorCode.NOT_FOUND);
    }
    if (connector.status !== "active") {
      fail(`Inbound connector is ${connector.status}`, ErrorCode.FORBIDDEN);
    }
    if (connector.token_hash !== tokenHash) {
      fail("Invalid ingestion credential", ErrorCode.UNAUTHORIZED);
    }

    if (input.records.length > connector.batch_size_limit) {
      fail(`Batch exceeds limit of ${connector.batch_size_limit} records`, ErrorCode.VALIDATION_FAILED);
    }

    const workspaceId = connector.workspace_id;
    const orgId = connector.org_id;
    const effectiveIdempotencyKey = input.idempotencyKey?.trim() || randomUUID();

    // Check idempotency replay if key was explicitly provided
    if (input.idempotencyKey) {
      const existingBatch = (
        await this.pool.query(
          "SELECT * FROM lg_inbound_batches WHERE workspace_id=$1 AND connector_id=$2 AND idempotency_key=$3",
          [workspaceId, connector.id, effectiveIdempotencyKey],
        )
      ).rows[0];
      if (existingBatch) {
        return existingBatch as InboundBatchEvent;
      }
    }

    // Resolve target collection if provided
    let collection: LeadCollection | null = null;
    const targetCollectionId = input.collectionId || connector.collection_id;
    if (targetCollectionId) {
      const collRow = (
        await this.pool.query(
          "SELECT * FROM lg_collections WHERE id=$1 AND workspace_id=$2",
          [targetCollectionId, workspaceId],
        )
      ).rows[0];
      if (collRow) {
        collection = collRow;
      } else if (input.collectionId) {
        fail("Target collection does not belong to authorized workspace", ErrorCode.FORBIDDEN);
      }
    }

    // Effective qualification requirements
    const effectiveMode = (collection?.qualification_overrides?.qualification_mode as QualificationMode) ||
      connector.default_qualification_mode || "strict";
    const reqContact = collection?.qualification_overrides?.required_contact || "none";

    const outcomes: InboundBatchRecordOutcome[] = [];
    const errors: Array<{ record_index: number; external_id?: string; error: string }> = [];
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    await this.tx(async (c) => {
      for (let idx = 0; idx < input.records.length; idx++) {
        const rawItem = input.records[idx];
        if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
          failedCount++;
          errors.push({ record_index: idx, error: "Record must be a JSON object" });
          outcomes.push({
            record_index: idx,
            outcome: "failed",
            qualification_status: "disqualified",
            reasons: ["Malformed record; object required"],
            error: "Record must be a JSON object",
          });
          continue;
        }

        try {
          const mapped = applyFieldMapping(rawItem as Record<string, unknown>, connector.field_mapping || {});
          const companyName = String(mapped.company_name ?? mapped.company ?? mapped.name ?? "").trim();
          const rawWebsite = String(mapped.website ?? mapped.url ?? "").trim();
          const personName = String(mapped.person_name ?? mapped.contact_name ?? mapped.full_name ?? "").trim() || null;
          const personRole = String(mapped.person_role ?? mapped.contact_role ?? mapped.role ?? mapped.title ?? "").trim() || null;
          const rawEmail = String(mapped.email ?? mapped.contact_email ?? "").trim().toLowerCase();
          const rawPhone = String(mapped.phone ?? mapped.contact_phone ?? mapped.telephone ?? "").trim();
          const category = String(mapped.category ?? mapped.industry ?? "general").trim();
          const location = String(mapped.location ?? mapped.city ?? "").trim() || null;
          const externalId = String(mapped.external_id ?? rawItem.id ?? rawItem.external_id ?? "").trim() || null;

          if (!companyName && !personName && !rawEmail) {
            throw new Error("Record missing company name, person name, and contact details");
          }

          let leadDomain: string | null = null;
          let validUrl = "";
          if (rawWebsite) {
            try {
              validUrl = normalizeWebsite(rawWebsite.includes("://") ? rawWebsite : `https://${rawWebsite}`);
              leadDomain = domain(validUrl);
            } catch {
              // An invalid or absent website is not evidence of any domain.
              validUrl = "";
            }
          }

          const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
          const phoneDigits = rawPhone.replace(/\D/g, "");
          const validPhone = (phoneDigits.length >= 7 && phoneDigits.length <= 15) ? rawPhone : null;

          // Qualification evaluation
          const rejectReasons: string[] = [];
          {
            // Required contact channels remain mandatory in best-match mode too.
            if (reqContact === "email" && !validEmail) rejectReasons.push("Required email missing");
            if (reqContact === "phone" && !validPhone) rejectReasons.push("Required phone missing");
            if (reqContact === "both" && (!validEmail || !validPhone)) rejectReasons.push("Required email and phone missing");
            if (reqContact === "either" && (!validEmail && !validPhone)) rejectReasons.push("Neither email nor phone provided");
          }

          const isQualified = rejectReasons.length === 0;
          const qualificationStatus = isQualified
            ? "qualified"
            : (effectiveMode === "best_match" ? "best_match" : "disqualified");

          // Deduplication: look for existing lead in workspace
          let existingLead: any = null;
          if (externalId) {
            const byExt = (
              await c.query(
                "SELECT * FROM lg_leads WHERE workspace_id=$1 AND data->'provenance'->>'external_id'=$2 AND execution_mode=$3 AND data->'provenance'->>'connector_id'=$4 LIMIT 1",
                [workspaceId, externalId, this.mode, connector.id],
              )
            ).rows[0];
            if (byExt) existingLead = byExt;
          }

          if (!existingLead && validEmail) {
            const byEmail = (
              await c.query(
                "SELECT * FROM lg_leads WHERE workspace_id=$1 AND domain IS NOT DISTINCT FROM $2 AND lower(contact_email)=lower($3) AND execution_mode=$4 LIMIT 1",
                [workspaceId, leadDomain, validEmail, this.mode],
              )
            ).rows[0];
            if (byEmail) existingLead = byEmail;
          }

          if (!existingLead && leadDomain && !personName) {
            // Company-level match
            const byDomain = (
              await c.query(
                "SELECT * FROM lg_leads WHERE workspace_id=$1 AND domain=$2 AND execution_mode=$3 AND person_name IS NULL LIMIT 1",
                [workspaceId, leadDomain, this.mode],
              )
            ).rows[0];
            if (byDomain) existingLead = byDomain;
          }

          const criterionEvaluations: CriterionEvaluation[] = [
            {
              criterion: "company_name",
              status: companyName ? "matched" : "unknown",
              mandatory: true,
              value: companyName || undefined,
              explanation: companyName ? `Attributed company name "${companyName}" from inbound connector` : "Missing company name",
            },
            {
              criterion: "email",
              status: validEmail ? "matched" : "unknown",
              mandatory: reqContact === "email" || reqContact === "both",
              value: validEmail || undefined,
              explanation: validEmail ? `Supplied email: ${validEmail}` : "No valid email supplied",
            },
            {
              criterion: "phone",
              status: validPhone ? "matched" : "unknown",
              mandatory: reqContact === "phone" || reqContact === "both",
              value: validPhone || undefined,
              explanation: validPhone ? `Supplied phone: ${validPhone}` : "No valid phone supplied",
            },
          ];

          const leadData: CampaignLeadDelivery["lead"] = {
            data_origin: this.mode,
            company_name: companyName || personName || "",
            website: validUrl,
            category,
            location,
            company_size: typeof mapped.company_size === "string" ? mapped.company_size : null,
            contact_role: personRole,
            person_name: personName,
            person_role: personRole,
            decision_maker: personName ? { name: personName, role: personRole ?? undefined, email: validEmail, phone: validPhone } : undefined,
            email: validEmail,
            phone: validPhone,
            summary: String(mapped.summary ?? `${companyName} (${category}) ingested via ${connector.name}`).slice(0, 2000),
            fit_score: 0,
            fit_reasons: ["Imported record; business fit has not been researched"],
            reject_reasons: rejectReasons,
            qualification_mode: effectiveMode,
            criterion_evaluations: criterionEvaluations,
            dimensions: {
              business_fit: { score: 0, max: 100, reasons: [`Ingested from ${connector.name}`], gaps: rejectReasons },
              evidence_completeness: {
                status: "partial",
                verified_count: Number(Boolean(companyName)) + Number(Boolean(validEmail)) + Number(Boolean(validPhone)),
                unknown_count: Number(!validEmail) + Number(!validPhone),
                verified_criteria: ["company_name", ...(validEmail ? ["email"] : []), ...(validPhone ? ["phone"] : [])],
                unknown_criteria: [!validEmail ? "email" : "", !validPhone ? "phone" : ""].filter(Boolean),
              },
              contact_readiness: {
                email_available: Boolean(validEmail),
                email_verified: false,
                phone_available: Boolean(validPhone),
                phone_verified: false,
                status: (validEmail || validPhone ? "unverified" : "missing"),
              },
              outreach_eligibility: {
                eligible: false,
                channel: (validEmail && validPhone ? "both" : validEmail ? "email" : validPhone ? "phone" : "none"),
                reason: "External connector lead requires review and explicit campaign authorization",
                cold_outreach: true,
                suppressed: false,
                requires_consent: true,
              },
            },
            evidence: [
              ...(validUrl ? [{ field: "website", value: validUrl, source_url: validUrl, quote: `Inbound connector: ${connector.name}` }] : []),
            ],
            discovered_fields: {
              source_type: connector.source_type,
              connector_name: connector.name,
              ...(externalId ? { external_id: externalId } : {}),
            },
            checked_at: new Date().toISOString(),
            outreach_eligible: false,
            provenance: {
              source_type: "inbound_connector",
              connector_id: connector.id,
              connector_name: connector.name,
              external_id: externalId ?? undefined,
              raw_claims: rawItem as Record<string, unknown>,
              ingested_at: new Date().toISOString(),
            },
          };

          let leadId = "";
          let recordOutcome: "created" | "updated" = "created";

          if (existingLead) {
            // Update existing record with fresh information
            recordOutcome = "updated";
            leadId = existingLead.id;
            const existingData = (existingLead.data ?? {}) as CampaignLeadDelivery["lead"];
            const mergedData: CampaignLeadDelivery["lead"] = {
              ...existingData,
              ...Object.fromEntries(Object.entries(leadData).filter(([, value]) => value !== null && value !== undefined && value !== "")),
              ...existingLead.user_edits,
              discovered_fields: { ...existingData.discovered_fields, ...leadData.discovered_fields },
              checked_at: new Date().toISOString(),
            };


            await c.query(
              `UPDATE lg_leads SET
                data=$1,
                person_name=coalesce($2, person_name),
                person_role=coalesce($3, person_role),
                contact_email=coalesce($4, contact_email),
                contact_phone=coalesce($5, contact_phone),
                collection_id=coalesce($6, collection_id),
                inbound_connector_id=$7,
                checked_at=now()
              WHERE id=$8`,
              [
                JSON.stringify(mergedData),
                mergedData.person_name,
                mergedData.person_role,
                mergedData.email,
                mergedData.phone,
                collection?.id ?? null,
                connector.id,
                existingLead.id,
              ],
            );
            updatedCount++;
          } else {
            // Insert fresh lead
            const inserted = (
              await c.query(
                `INSERT INTO lg_leads(
                  org_id, workspace_id, domain, data, execution_mode,
                  person_name, person_role, contact_email, contact_phone,
                  qualification_mode, collection_id, inbound_connector_id
                ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
                [
                  orgId,
                  workspaceId,
                  leadDomain,
                  JSON.stringify(leadData),
                  this.mode,
                  leadData.person_name,
                  leadData.person_role,
                  leadData.email,
                  leadData.phone,
                  effectiveMode,
                  collection?.id ?? null,
                  connector.id,
                ],
              )
            ).rows[0];
            leadId = inserted.id;
            createdCount++;
          }

          // Optional Auto Campaign Enrollment
          if (connector.auto_enroll_campaign_id && isQualified) {
            const campaignDeliveryTask: CampaignLeadDelivery = {
              schema_version: 1,
              idempotency_key: `inbound:${workspaceId}:${connector.auto_enroll_campaign_id}:${leadId}`,
              workspace_id: workspaceId,
              campaign_id: connector.auto_enroll_campaign_id,
              run_id: "inbound-connector",
              lead_id: leadId,
              lead: leadData,
            };
            await this.task(
              c,
              { orgId, workspaceId, actorId: "inbound-connector", requestId: effectiveIdempotencyKey },
              "delivery",
              campaignDeliveryTask,
              `delivery:${this.mode}:${connector.auto_enroll_campaign_id}:${leadId}`,
            );
          }



          outcomes.push({
            record_index: idx,
            external_id: externalId ?? undefined,
            lead_id: leadId,
            outcome: recordOutcome,
            qualification_status: qualificationStatus,
            reasons: isQualified ? ["Meets qualification requirements"] : rejectReasons,
          });
        } catch (err: any) {
          failedCount++;
          errors.push({ record_index: idx, error: err?.message || "Failed to process record" });
          outcomes.push({
            record_index: idx,
            outcome: "failed",
            qualification_status: "disqualified",
            reasons: [err?.message || "Internal failure"],
            error: err?.message || "Failed to process record",
          });
        }
      }

      // Record batch event
      const batchStatus = failedCount === 0 ? "completed" : createdCount + updatedCount > 0 ? "partial_failure" : "failed";
      await c.query(
        `INSERT INTO lg_inbound_batches(
          org_id, workspace_id, connector_id, collection_id, idempotency_key,
          records_count, created_count, updated_count, failed_count, status, errors, outcomes
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          orgId,
          workspaceId,
          connector.id,
          collection?.id ?? null,
          effectiveIdempotencyKey,
          input.records.length,
          createdCount,
          updatedCount,
          failedCount,
          batchStatus,
          JSON.stringify(errors),
          JSON.stringify(outcomes),
        ],
      );

      // Update connector last used
      await c.query("UPDATE lg_connectors SET last_used_at=now() WHERE id=$1", [connector.id]);
    });

    return {
      id: randomUUID(),
      workspace_id: workspaceId,
      connector_id: connector.id,
      collection_id: collection?.id ?? null,
      idempotency_key: effectiveIdempotencyKey,
      records_count: input.records.length,
      created_count: createdCount,
      updated_count: updatedCount,
      failed_count: failedCount,
      status: failedCount === 0 ? "completed" : createdCount + updatedCount > 0 ? "partial_failure" : "failed",
      errors,
      outcomes,
      created_at: new Date().toISOString(),
    };
  }

  async listInboundBatches(i: Identity, connectorId?: string): Promise<InboundBatchEvent[]> {
    if (connectorId) {
      return (
        await this.pool.query(
          "SELECT * FROM lg_inbound_batches WHERE workspace_id=$1 AND org_id=$2 AND connector_id=$3 ORDER BY created_at DESC LIMIT 50",
          [i.workspaceId, i.orgId, connectorId],
        )
      ).rows;
    }
    return (
      await this.pool.query(
        "SELECT * FROM lg_inbound_batches WHERE workspace_id=$1 AND org_id=$2 ORDER BY created_at DESC LIMIT 50",
        [i.workspaceId, i.orgId],
      )
    ).rows;
  }

  async retryFailed(i: Identity, id: string) {
    return this.tx(async (c) => {
      await this.global(c);
      const task = (
        await c.query(
          "SELECT * FROM lg_tasks WHERE id=$1 AND workspace_id=$2 AND org_id=$3 AND execution_mode=$4 FOR UPDATE",
          [id, i.workspaceId, i.orgId, this.mode],
        )
      ).rows[0];
      if (!task) fail("Task not found", ErrorCode.NOT_FOUND);
      if (task.state !== "failed") fail("Only failed tasks can be replayed", ErrorCode.CONFLICT);
      if (task.kind !== "delivery")
        fail(
          "Start a new research run to retry research; only delivery replay is supported",
          ErrorCode.CONFLICT,
        );
      await c.query(
        "UPDATE lg_tasks SET state='queued',attempts=0,available_at=now(),error_code=NULL WHERE id=$1",
        [id],
      );
      await this.audit(
        c,
        i,
        "delivery.replayed",
        { task_id: id },
        null,
        "User requested failed delivery retry",
      );
      return { queued: true };
    });
  }

  async metrics() {
    const tasks = (
      await this.pool.query(
        "SELECT kind,state,count(*)::int AS count FROM lg_tasks GROUP BY kind,state",
      )
    ).rows;
    const runs = (
      await this.pool.query("SELECT status,count(*)::int AS count FROM lg_runs GROUP BY status")
    ).rows;
    const queue = (
      await this.pool.query(
        "SELECT COALESCE(EXTRACT(EPOCH FROM now()-MIN(created_at)),0)::float AS age FROM lg_tasks WHERE state='queued'",
      )
    ).rows[0].age;
    return { tasks, runs, oldest_queue_seconds: queue };
  }

  async updateLeadSalesStatus(
    i: Identity,
    leadId: string,
    status?: SalesStatus,
    notes?: string,
    userEdits?: Record<string, unknown>,
  ) {
    return this.tx(async (c) => {
      const existing = (
        await c.query("SELECT * FROM lg_leads WHERE id=$1 AND workspace_id=$2 FOR UPDATE", [
          leadId,
          i.workspaceId,
        ])
      ).rows[0];
      if (!existing) fail("Lead not found", ErrorCode.NOT_FOUND);

      const oldStatus = existing.sales_status;
      const effectiveStatus = status ?? oldStatus;
      const mergedUserEdits = { ...(existing.user_edits || {}), ...(userEdits || {}) };
      const mergedData = { ...(existing.data || {}), ...mergedUserEdits };

      const activityHistory = Array.isArray(existing.activity_history) ? existing.activity_history : [];
      activityHistory.push({
        timestamp: new Date().toISOString(),
        actor: i.actorId,
        action: status && status !== oldStatus ? "status_updated" : "lead_updated",
        details: {
          previous_status: oldStatus,
          new_status: effectiveStatus,
          notes_updated: notes !== undefined,
          user_edits_updated: Boolean(userEdits && Object.keys(userEdits).length),
        },
      });

      const updated = (
        await c.query(
          `UPDATE lg_leads SET
            sales_status=$1,
            notes=coalesce($2, notes),
            user_edits=$3,
            data=$4,
            activity_history=$5,
            checked_at=now()
          WHERE id=$6 RETURNING *`,
          [
            effectiveStatus,
            notes !== undefined ? notes : null,
            JSON.stringify(mergedUserEdits),
            JSON.stringify(mergedData),
            JSON.stringify(activityHistory),
            leadId,
          ],
        )
      ).rows[0];

      await this.audit(
        c,
        i,
        "lead.sales_status_updated",
        { status: oldStatus },
        { status, notes },
        `Lead sales status updated from ${oldStatus} to ${status}`,
      );

      return updated;
    });
  }

  async getLeadWithDetails(i: Identity, leadId: string) {
    const lead = (
      await this.pool.query(
        "SELECT * FROM lg_leads WHERE id=$1 AND workspace_id=$2",
        [leadId, i.workspaceId],
      )
    ).rows[0];
    if (!lead) fail("Lead not found", ErrorCode.NOT_FOUND);

    const observations = (
      await this.pool.query(
        "SELECT * FROM lg_observations WHERE lead_id=$1 ORDER BY observed_at DESC",
        [leadId],
      )
    ).rows;

    const crmMappings = (
      await this.pool.query(
        "SELECT * FROM lg_crm_mappings WHERE lead_id=$1",
        [leadId],
      )
    ).rows;

    return {
      ...lead,
      observations,
      crm_mappings: crmMappings,
    };
  }

  async getLeadObservations(i: Identity, leadId: string) {
    return (
      await this.pool.query(
        "SELECT * FROM lg_observations WHERE lead_id=$1 AND workspace_id=$2 ORDER BY observed_at DESC",
        [leadId, i.workspaceId],
      )
    ).rows;
  }

  async recordObservation(i: Identity, obs: LeadObservation) {
    return (
      await this.pool.query(
        `INSERT INTO lg_observations(org_id, workspace_id, lead_id, field, value, quote, source_url, provider, external_record_id, confidence, observed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11, now())) RETURNING *`,
        [
          i.orgId,
          i.workspaceId,
          obs.lead_id ?? null,
          obs.field,
          obs.value,
          obs.quote ?? null,
          obs.source_url ?? null,
          obs.provider ?? null,
          obs.external_record_id ?? null,
          obs.confidence ?? null,
          obs.observed_at ?? null,
        ],
      )
    ).rows[0];
  }

  async createSchedule(
    i: Identity,
    schedule: Omit<LeadSchedule, "id" | "workspace_id" | "created_at" | "updated_at">,
  ) {
    return (
      await this.pool.query(
        `INSERT INTO lg_schedules(
          org_id, workspace_id, name, brief, timezone, cron_expression,
          next_run_at, enabled, overlap_policy, budget_limits, destination_config, execution_mode
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          i.orgId,
          i.workspaceId,
          schedule.name,
          JSON.stringify(schedule.brief),
          schedule.timezone,
          schedule.cron_expression,
          schedule.next_run_at,
          schedule.enabled,
          schedule.overlap_policy,
          JSON.stringify(schedule.budget_limits || {}),
          schedule.destination_config ? JSON.stringify(schedule.destination_config) : null,
          this.mode,
        ],
      )
    ).rows[0];
  }

  async listSchedules(i: Identity) {
    return (
      await this.pool.query(
        "SELECT * FROM lg_schedules WHERE workspace_id=$1 AND execution_mode=$2 ORDER BY created_at DESC",
        [i.workspaceId, this.mode],
      )
    ).rows;
  }

  async getSchedule(i: Identity, scheduleId: string) {
    const s = (
      await this.pool.query(
        "SELECT * FROM lg_schedules WHERE id=$1 AND workspace_id=$2 AND execution_mode=$3",
        [scheduleId, i.workspaceId, this.mode],
      )
    ).rows[0];
    if (!s) fail("Schedule not found", ErrorCode.NOT_FOUND);
    return s;
  }

  async updateSchedule(i: Identity, scheduleId: string, patch: Partial<LeadSchedule>) {
    return this.tx(async (c) => {
      const current = (
        await c.query("SELECT * FROM lg_schedules WHERE id=$1 AND workspace_id=$2 AND execution_mode=$3 FOR UPDATE", [
          scheduleId,
          i.workspaceId,
          this.mode,
        ])
      ).rows[0];
      if (!current) fail("Schedule not found", ErrorCode.NOT_FOUND);

      const name = patch.name ?? current.name;
      const brief = patch.brief ? JSON.stringify(patch.brief) : current.brief;
      const timezone = patch.timezone ?? current.timezone;
      const cron_expression = patch.cron_expression ?? current.cron_expression;
      const next_run_at = patch.next_run_at ?? current.next_run_at;
      const enabled = patch.enabled !== undefined ? patch.enabled : current.enabled;
      const overlap_policy = patch.overlap_policy ?? current.overlap_policy;

      return (
        await c.query(
          `UPDATE lg_schedules SET
            name=$1, brief=$2, timezone=$3, cron_expression=$4,
            next_run_at=$5, enabled=$6, overlap_policy=$7, updated_at=now(),
            budget_limits=$9, destination_config=$10
          WHERE id=$8 RETURNING *`,
          [name, brief, timezone, cron_expression, next_run_at, enabled, overlap_policy, scheduleId,
            JSON.stringify(patch.budget_limits ?? current.budget_limits),
            JSON.stringify(patch.destination_config ?? current.destination_config)],
        )
      ).rows[0];
    });
  }

  async deleteSchedule(i: Identity, scheduleId: string) {
    const res = await this.pool.query(
      "DELETE FROM lg_schedules WHERE id=$1 AND workspace_id=$2 AND execution_mode=$3",
      [scheduleId, i.workspaceId, this.mode],
    );
    if (!res.rowCount) fail("Schedule not found", ErrorCode.NOT_FOUND);
    return { deleted: true };
  }

  async claimDueSchedules(limit = 10) {
    return this.tx(async (c) => {
      return (await c.query(
        `WITH due AS (
          SELECT id FROM lg_schedules
          WHERE enabled = true AND next_run_at <= now() AND execution_mode=$2
            AND (dispatch_lease_until IS NULL OR dispatch_lease_until <= now())
          ORDER BY next_run_at LIMIT $1 FOR UPDATE SKIP LOCKED
        ) UPDATE lg_schedules s SET dispatch_lease_token=gen_random_uuid(),
          dispatch_lease_until=now()+interval '120 seconds'
          FROM due WHERE s.id=due.id RETURNING s.*`,
        [limit, this.mode],
      )).rows;
    });
  }

  async recordScheduleOccurrence(
    scheduleId: string,
    lastOccurrenceKey: string,
    nextRunAt: Date,
    lastRunId?: string | null,
    leaseToken?: string,
  ) {
    return (await this.pool.query(
      `UPDATE lg_schedules SET last_occurrence_key=$1, next_run_at=$2,
        last_run_id=COALESCE($3,last_run_id), dispatch_lease_token=NULL,
        dispatch_lease_until=NULL, updated_at=now()
        WHERE id=$4 AND execution_mode=$5 AND dispatch_lease_token=$6 RETURNING *`,
      [lastOccurrenceKey, nextRunAt.toISOString(), lastRunId ?? null, scheduleId, this.mode, leaseToken ?? null],
    )).rows[0];
  }

  async recordCrmMapping(i: Identity, mapping: Omit<CrmMapping, "id" | "created_at">) {
    return (
      await this.pool.query(
        `INSERT INTO lg_crm_mappings(
          org_id, workspace_id, provider, lead_id, external_object_id,
          external_object_type, last_synced_at, last_synced_payload, field_ownership, status
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(workspace_id, provider, lead_id)
        DO UPDATE SET
          external_object_id=EXCLUDED.external_object_id,
          external_object_type=EXCLUDED.external_object_type,
          last_synced_at=EXCLUDED.last_synced_at,
          last_synced_payload=EXCLUDED.last_synced_payload,
          field_ownership=EXCLUDED.field_ownership,
          status=EXCLUDED.status
        RETURNING *`,
        [
          i.orgId,
          i.workspaceId,
          mapping.provider,
          mapping.lead_id,
          mapping.external_object_id,
          mapping.external_object_type,
          mapping.last_synced_at || new Date().toISOString(),
          JSON.stringify(mapping.last_synced_payload || {}),
          JSON.stringify(mapping.field_ownership || {}),
          mapping.status || "synced",
        ],
      )
    ).rows[0];
  }

  async getCrmMapping(i: Identity, leadId: string, provider: string) {
    return (
      await this.pool.query(
        "SELECT * FROM lg_crm_mappings WHERE workspace_id=$1 AND lead_id=$2 AND provider=$3",
        [i.workspaceId, leadId, provider],
      )
    ).rows[0] ?? null;
  }

  async exportLeadsToCsv(i: Identity, runId?: string): Promise<string> {
    let rows: any[];
    if (runId) {
      rows = (
        await this.pool.query(
          `SELECT l.* FROM lg_leads l
           JOIN lg_run_leads rl ON rl.lead_id = l.id
           WHERE rl.run_id = $1 AND l.workspace_id = $2
           ORDER BY l.created_at ASC`,
          [runId, i.workspaceId],
        )
      ).rows;
    } else {
      rows = (
        await this.pool.query(
          "SELECT * FROM lg_leads WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 5000",
          [i.workspaceId],
        )
      ).rows;
    }

    const headers = [
      "ID",
      "Entity Type",
      "Company Name",
      "Website",
      "Person Name",
      "Person Role",
      "Email",
      "Phone",
      "Location",
      "Sales Status",
      "Notes",
      "Fit Score",
      "Created At",
    ];

    const lines = [headers.join(",")];

    for (const r of rows) {
      const d = r.data || {};
      const line = [
        escapeCsvField(r.id),
        escapeCsvField(r.entity_type || "business"),
        escapeCsvField(d.company_name || ""),
        escapeCsvField(d.website || ""),
        escapeCsvField(r.person_name || d.person_name || ""),
        escapeCsvField(r.person_role || d.person_role || ""),
        escapeCsvField(r.contact_email || d.email || ""),
        escapeCsvField(r.contact_phone || d.phone || ""),
        escapeCsvField(d.location || ""),
        escapeCsvField(r.sales_status || "new"),
        escapeCsvField(r.notes || ""),
        escapeCsvField(d.fit_score ?? ""),
        escapeCsvField(r.created_at ? new Date(r.created_at).toISOString() : ""),
      ];
      lines.push(line.join(","));
    }

    return lines.join("\r\n");
  }
}
