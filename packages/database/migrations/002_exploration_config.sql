ALTER TABLE analysis_runs DROP CONSTRAINT analysis_runs_status_check;
ALTER TABLE analysis_runs ADD CONSTRAINT analysis_runs_status_check
  CHECK (status IN ('queued', 'preparing', 'ready', 'failed', 'awaiting-config'));

ALTER TABLE analysis_runs ADD COLUMN startup_contract_reason text;

CREATE TABLE exploration_configurations (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  startup_package_manager text CHECK (
    startup_package_manager IN ('npm', 'yarn', 'pnpm', 'bun')
  ),
  startup_script text,
  env_var_refs text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE startup_contract_snapshots (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  package_manager text NOT NULL,
  install_args text[] NOT NULL,
  start_script text NOT NULL,
  detection_source text NOT NULL CHECK (detection_source IN ('auto', 'override')),
  created_at timestamptz NOT NULL DEFAULT now()
);
