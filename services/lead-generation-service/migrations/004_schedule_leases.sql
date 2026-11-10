-- Durable dispatch leases: row locks alone end before an external dispatcher runs.
ALTER TABLE lg_schedules ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'live';
ALTER TABLE lg_schedules ADD COLUMN IF NOT EXISTS dispatch_lease_token uuid;
ALTER TABLE lg_schedules ADD COLUMN IF NOT EXISTS dispatch_lease_until timestamptz;
UPDATE lg_schedules s SET execution_mode = r.execution_mode
FROM lg_runs r WHERE s.last_run_id = r.id;
CREATE INDEX IF NOT EXISTS lg_schedules_mode_due
  ON lg_schedules(execution_mode, next_run_at) WHERE enabled = true;

-- Direct searches may omit a business profile; historical references remain intact.
ALTER TABLE lg_runs ALTER COLUMN profile_id DROP NOT NULL;
