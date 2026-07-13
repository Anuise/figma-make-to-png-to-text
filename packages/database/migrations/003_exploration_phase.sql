CREATE TABLE candidate_screens (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  route text NOT NULL,
  ui_fingerprint text NOT NULL,
  visible_state_hash text NOT NULL,
  operation_path text[] NOT NULL DEFAULT '{}',
  screenshot_path text,
  trace_path text,
  incomplete_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exploration_checkpoints (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  exhausted_limit text NOT NULL
    CHECK (exhausted_limit IN ('interactions', 'screens', 'time', 'error')),
  pending_branches jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
