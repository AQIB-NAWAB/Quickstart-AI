CREATE TABLE IF NOT EXISTS lg_source_runs (
  task_id uuid PRIMARY KEY REFERENCES lg_tasks(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  actor_id text NOT NULL,
  status text NOT NULL DEFAULT 'starting',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lg_source_runs_workspace ON lg_source_runs(workspace_id);
