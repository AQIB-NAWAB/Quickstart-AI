-- First-class agent policies and lifecycle state.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_agents_workspace_archived_updated
  ON agents(workspace_id, archived_at, updated_at DESC);
