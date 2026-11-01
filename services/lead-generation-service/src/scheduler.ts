import * as crypto from "node:crypto";
import type { Identity, Store } from "./store.js";
import { runInput } from "./domain.js";

import { computeNextRunAt } from "./schedule-time.js";
export { computeNextRunAt } from "./schedule-time.js";

/**
 * Claims and executes all schedules currently due for dispatch across the database.
 * Uses Postgres FOR UPDATE SKIP LOCKED to ensure atomic, non-conflicting distribution
 * across concurrent worker replicas.
 */
export async function runDueSchedules(
  store: Store,
  defaultActor = "system-scheduler",
): Promise<{
  claimed: number;
  dispatched: number;
  skipped: number;
  errors: Array<{ schedule_id: string; error: string }>;
}> {
  const claimedSchedules = await store.claimDueSchedules(20);
  let dispatched = 0;
  let skipped = 0;
  const errors: Array<{ schedule_id: string; error: string }> = [];

  for (const schedule of claimedSchedules) {
    try {
      const occurrenceKey = `${schedule.id}:${new Date(schedule.next_run_at).toISOString()}`;
      const nextRunAt = computeNextRunAt(schedule.cron_expression, new Date(), schedule.timezone);

      // Prevent redundant run execution if already dispatched in this minute window
      if (schedule.last_occurrence_key === occurrenceKey) {
        await store.recordScheduleOccurrence(schedule.id, occurrenceKey, nextRunAt, null, schedule.dispatch_lease_token);
        skipped++;
        continue;
      }

      const identity: Identity = {
        orgId: schedule.org_id,
        workspaceId: schedule.workspace_id,
        actorId: defaultActor,
        requestId: crypto.randomUUID(),
      };

      const idempotencyKey = `schedule-run:${occurrenceKey}`;
      if (schedule.last_run_id && schedule.overlap_policy !== "allow") {
        const previous = await store.run(identity, schedule.last_run_id);
        if (previous.status === "queued" || previous.status === "running") {
          if (schedule.overlap_policy === "skip") {
            await store.recordScheduleOccurrence(schedule.id, occurrenceKey, nextRunAt, null, schedule.dispatch_lease_token);
          }
          // queue retains the due occurrence; the durable lease expires before another attempt.
          skipped++;
          continue;
        }
      }
      const rawBrief = typeof schedule.brief === "string" ? JSON.parse(schedule.brief) : schedule.brief;
      const brief = runInput({ ...rawBrief, budget_limits: { ...rawBrief.budget_limits, ...schedule.budget_limits } });
      const created = await store.createRun(identity, brief, idempotencyKey);
      await store.recordScheduleOccurrence(schedule.id, occurrenceKey, nextRunAt, created.run.id, schedule.dispatch_lease_token);

      dispatched++;
    } catch (err: any) {
      errors.push({
        schedule_id: schedule.id,
        error: err?.message || String(err),
      });
    }
  }

  return {
    claimed: claimedSchedules.length,
    dispatched,
    skipped,
    errors,
  };
}
