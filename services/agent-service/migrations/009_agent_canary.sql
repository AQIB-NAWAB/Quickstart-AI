ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS canary_version_id UUID NULL REFERENCES agent_versions(id),
  ADD COLUMN IF NOT EXISTS canary_percentage INT NOT NULL DEFAULT 0;

ALTER TABLE agents
  DROP CONSTRAINT IF EXISTS agents_canary_percentage_check;

ALTER TABLE agents
  ADD CONSTRAINT agents_canary_percentage_check
  CHECK (canary_percentage >= 0 AND canary_percentage <= 100);
