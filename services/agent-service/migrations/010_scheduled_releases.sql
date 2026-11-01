ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS scheduled_version_id UUID NULL REFERENCES agent_versions(id),
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ NULL;
