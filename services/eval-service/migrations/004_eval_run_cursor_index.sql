CREATE INDEX IF NOT EXISTS idx_eval_runs_workspace_cursor
  ON eval_runs (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_workspace_agent_cursor
  ON eval_runs (workspace_id, agent_id, created_at DESC, id DESC);
