import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export type WorkflowDraftReviewStatus = "pending" | "confirmed" | "excluded" | "merged";

export type WorkflowDraft = {
  id: string;
  analysisRunId: string;
  workflowDraftJobId: string;
  userGoal: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  exceptions: string[];
  relatedScreenIds: string[];
  reviewStatus: WorkflowDraftReviewStatus;
  draftTitle: string | null;
  draftNotes: string | null;
  mergedIntoId: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type WorkflowDraftRow = {
  id: string;
  analysis_run_id: string;
  workflow_draft_job_id: string;
  user_goal: string;
  preconditions: string[];
  steps: string[];
  expected_result: string;
  exceptions: string[];
  related_screen_ids: string[];
  review_status: WorkflowDraftReviewStatus;
  draft_title: string | null;
  draft_notes: string | null;
  merged_into_id: string | null;
  reviewed_at: Date | null;
  created_at: Date;
};

function mapWorkflowDraft(row: WorkflowDraftRow): WorkflowDraft {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    workflowDraftJobId: row.workflow_draft_job_id,
    userGoal: row.user_goal,
    preconditions: row.preconditions,
    steps: row.steps,
    expectedResult: row.expected_result,
    exceptions: row.exceptions,
    relatedScreenIds: row.related_screen_ids ?? [],
    reviewStatus: row.review_status,
    draftTitle: row.draft_title,
    draftNotes: row.draft_notes,
    mergedIntoId: row.merged_into_id,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const workflowDraftSelect = `
  SELECT
    d.id,
    d.analysis_run_id,
    d.workflow_draft_job_id,
    d.user_goal,
    d.preconditions,
    d.steps,
    d.expected_result,
    d.exceptions,
    d.review_status,
    d.draft_title,
    d.draft_notes,
    d.merged_into_id,
    d.reviewed_at,
    d.created_at,
    COALESCE(
      array_agg(s.candidate_screen_id) FILTER (WHERE s.candidate_screen_id IS NOT NULL),
      '{}'
    ) AS related_screen_ids
  FROM workflow_drafts d
  LEFT JOIN workflow_draft_screens s ON s.workflow_draft_id = d.id
`;

export type NewWorkflowDraft = {
  analysisRunId: string;
  workflowDraftJobId: string;
  userGoal: string;
  preconditions: string[];
  steps: string[];
  expectedResult: string;
  exceptions: string[];
  relatedScreenIds: string[];
};

export async function insertWorkflowDraft(
  pool: Pool,
  data: NewWorkflowDraft,
): Promise<WorkflowDraft> {
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO workflow_drafts (
          id, analysis_run_id, workflow_draft_job_id, user_goal,
          preconditions, steps, expected_result, exceptions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        id,
        data.analysisRunId,
        data.workflowDraftJobId,
        data.userGoal,
        JSON.stringify(data.preconditions),
        JSON.stringify(data.steps),
        data.expectedResult,
        JSON.stringify(data.exceptions),
      ],
    );
    for (const screenId of data.relatedScreenIds) {
      await client.query(
        `
          INSERT INTO workflow_draft_screens (workflow_draft_id, candidate_screen_id)
          VALUES ($1, $2)
        `,
        [id, screenId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const created = await getWorkflowDraft(pool, id);
  if (!created) {
    throw new Error("Workflow draft was not found immediately after insert");
  }
  return created;
}

export async function listWorkflowDrafts(
  pool: Pool,
  analysisRunId: string,
): Promise<WorkflowDraft[]> {
  const result = await pool.query<WorkflowDraftRow>(
    `${workflowDraftSelect} WHERE d.analysis_run_id = $1 GROUP BY d.id ORDER BY d.created_at`,
    [analysisRunId],
  );
  return result.rows.map(mapWorkflowDraft);
}

export async function getWorkflowDraft(
  pool: Pool,
  id: string,
): Promise<WorkflowDraft | null> {
  const result = await pool.query<WorkflowDraftRow>(
    `${workflowDraftSelect} WHERE d.id = $1 GROUP BY d.id`,
    [id],
  );
  return result.rows[0] ? mapWorkflowDraft(result.rows[0]) : null;
}

export type WorkflowDraftReviewUpdate = {
  reviewStatus: WorkflowDraftReviewStatus;
  draftTitle?: string | null;
  draftNotes?: string | null;
  mergedIntoId?: string | null;
};

export async function updateWorkflowDraftReview(
  pool: Pool,
  id: string,
  update: WorkflowDraftReviewUpdate,
): Promise<WorkflowDraft | null> {
  const result = await pool.query(
    `
      UPDATE workflow_drafts
      SET
        review_status = $2,
        draft_title = COALESCE($3, draft_title),
        draft_notes = COALESCE($4, draft_notes),
        merged_into_id = $5,
        reviewed_at = now()
      WHERE id = $1
      RETURNING id
    `,
    [
      id,
      update.reviewStatus,
      update.draftTitle ?? null,
      update.draftNotes ?? null,
      update.mergedIntoId ?? null,
    ],
  );
  if (result.rowCount !== 1) return null;
  return getWorkflowDraft(pool, id);
}

export async function batchUpdateWorkflowDraftReview(
  pool: Pool,
  analysisRunId: string,
  ids: string[],
  reviewStatus: WorkflowDraftReviewStatus,
): Promise<WorkflowDraft[]> {
  if (ids.length === 0) return [];
  const updated = await pool.query<{ id: string }>(
    `
      UPDATE workflow_drafts
      SET review_status = $3, reviewed_at = now()
      WHERE id = ANY($1::uuid[]) AND analysis_run_id = $2
      RETURNING id
    `,
    [ids, analysisRunId, reviewStatus],
  );
  const updatedIds = updated.rows.map((row) => row.id);
  if (updatedIds.length === 0) return [];
  const result = await pool.query<WorkflowDraftRow>(
    `${workflowDraftSelect} WHERE d.id = ANY($1::uuid[]) GROUP BY d.id ORDER BY d.created_at`,
    [updatedIds],
  );
  return result.rows.map(mapWorkflowDraft);
}

/**
 * Screens confirmed by human review but not yet covered by any workflow
 * draft for this run. Only the enqueue route should call this — the
 * ai-worker itself must only ever read the frozen `workflow_draft_job_screens`
 * snapshot for a job, never recompute this set.
 */
export async function listConfirmedAndUnlinkedScreenIds(
  pool: Pool,
  analysisRunId: string,
): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `
      SELECT cs.id
      FROM candidate_screens cs
      WHERE cs.analysis_run_id = $1
        AND cs.review_status = 'confirmed'
        AND NOT EXISTS (
          SELECT 1
          FROM workflow_draft_screens wds
          JOIN workflow_drafts wd ON wd.id = wds.workflow_draft_id
          WHERE wds.candidate_screen_id = cs.id
            AND wd.analysis_run_id = $1
        )
      ORDER BY cs.created_at
    `,
    [analysisRunId],
  );
  return result.rows.map((row) => row.id);
}

export type WorkflowDraftJobStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "awaiting-manual";

export type WorkflowDraftJob = {
  id: string;
  analysisRunId: string;
  status: WorkflowDraftJobStatus;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type WorkflowDraftJobRow = {
  id: string;
  analysis_run_id: string;
  status: WorkflowDraftJobStatus;
  attempts: number;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapWorkflowDraftJob(row: WorkflowDraftJobRow): WorkflowDraftJob {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Enqueues a workflow-draft generation job with its screen batch frozen at
 * call time. `status` must be `awaiting-manual` (never `queued`) when the
 * caller has already determined AI export is prohibited, so the ai-worker
 * never sees the job.
 */
export async function enqueueWorkflowDraftJob(
  pool: Pool,
  analysisRunId: string,
  screenIds: string[],
  status: "queued" | "awaiting-manual",
): Promise<WorkflowDraftJob> {
  const client: PoolClient = await pool.connect();
  const id = randomUUID();
  try {
    await client.query("BEGIN");
    const result = await client.query<WorkflowDraftJobRow>(
      `
        INSERT INTO workflow_draft_jobs (id, analysis_run_id, status)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [id, analysisRunId, status],
    );
    for (const screenId of screenIds) {
      await client.query(
        `
          INSERT INTO workflow_draft_job_screens (workflow_draft_job_id, candidate_screen_id)
          VALUES ($1, $2)
        `,
        [id, screenId],
      );
    }
    await client.query("COMMIT");
    return mapWorkflowDraftJob(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorkflowDraftJobs(
  pool: Pool,
  analysisRunId: string,
): Promise<WorkflowDraftJob[]> {
  const result = await pool.query<WorkflowDraftJobRow>(
    `SELECT * FROM workflow_draft_jobs WHERE analysis_run_id = $1 ORDER BY created_at DESC`,
    [analysisRunId],
  );
  return result.rows.map(mapWorkflowDraftJob);
}
