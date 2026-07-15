CREATE TABLE ai_export_policies (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL UNIQUE
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  data_export_allowed boolean NOT NULL DEFAULT true,
  ai_notice_acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_draft_jobs (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'awaiting-manual')
  ),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Batch membership is frozen at enqueue time; the ai-worker only ever reads
-- this list and never recomputes "confirmed and unlinked" itself.
CREATE TABLE workflow_draft_job_screens (
  workflow_draft_job_id uuid NOT NULL
    REFERENCES workflow_draft_jobs(id) ON DELETE CASCADE,
  candidate_screen_id uuid NOT NULL
    REFERENCES candidate_screens(id) ON DELETE CASCADE,
  PRIMARY KEY (workflow_draft_job_id, candidate_screen_id)
);

CREATE TABLE workflow_drafts (
  id uuid PRIMARY KEY,
  analysis_run_id uuid NOT NULL
    REFERENCES analysis_runs(id) ON DELETE CASCADE,
  workflow_draft_job_id uuid NOT NULL
    REFERENCES workflow_draft_jobs(id) ON DELETE CASCADE,
  user_goal text NOT NULL,
  preconditions jsonb NOT NULL DEFAULT '[]',
  steps jsonb NOT NULL DEFAULT '[]',
  expected_result text NOT NULL,
  exceptions jsonb NOT NULL DEFAULT '[]',
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'excluded', 'merged')),
  draft_title text,
  draft_notes text,
  merged_into_id uuid REFERENCES workflow_drafts(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_draft_screens (
  workflow_draft_id uuid NOT NULL
    REFERENCES workflow_drafts(id) ON DELETE CASCADE,
  candidate_screen_id uuid NOT NULL
    REFERENCES candidate_screens(id) ON DELETE CASCADE,
  PRIMARY KEY (workflow_draft_id, candidate_screen_id)
);
