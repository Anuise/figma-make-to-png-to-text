CREATE TABLE analysis_runs (
  id uuid PRIMARY KEY,
  source_relative_path text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('queued', 'preparing', 'ready', 'failed')
  ),
  source_revision_id uuid,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_revisions (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  fingerprint char(64) NOT NULL,
  snapshot_path text NOT NULL UNIQUE,
  working_copy_path text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_runs
  ADD CONSTRAINT analysis_runs_source_revision_fk
  FOREIGN KEY (source_revision_id) REFERENCES source_revisions(id);

CREATE TABLE jobs (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (
    status IN ('queued', 'processing', 'completed', 'failed')
  ),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
