from dataclasses import dataclass

import psycopg


@dataclass
class ClaimedWorkflowDraftJob:
    id: str
    analysis_run_id: str
    attempt: int


async def claim_next_workflow_draft_job(
    conn: psycopg.AsyncConnection,
) -> ClaimedWorkflowDraftJob | None:
    """Claims one queued (or lease-expired) job.

    Mirrors packages/database/src/jobs.ts's claimNextAnalysisRunJob exactly:
    same FOR UPDATE SKIP LOCKED candidate selection, same 30-second lease.
    """
    async with conn.transaction():
        async with conn.cursor() as cur:
            await cur.execute(
                """
                WITH candidate AS (
                  SELECT id
                  FROM workflow_draft_jobs
                  WHERE
                    status = 'queued'
                    OR (
                      status = 'processing'
                      AND locked_at < now() - interval '30 seconds'
                    )
                  ORDER BY created_at, id
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE workflow_draft_jobs AS job
                SET
                  status = 'processing',
                  attempts = attempts + 1,
                  locked_at = now(),
                  error_message = NULL,
                  updated_at = now()
                FROM candidate
                WHERE job.id = candidate.id
                RETURNING job.id, job.analysis_run_id, job.attempts
                """
            )
            row = await cur.fetchone()
            if row is None:
                return None
            job_id, analysis_run_id, attempts = row
            return ClaimedWorkflowDraftJob(
                id=str(job_id), analysis_run_id=str(analysis_run_id), attempt=attempts
            )


async def get_job_screen_ids(conn: psycopg.AsyncConnection, job_id: str) -> list[str]:
    """Reads the batch frozen at enqueue time. Never recompute the
    "confirmed and unlinked" set here — see workflow-drafts.ts."""
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT candidate_screen_id
            FROM workflow_draft_job_screens
            WHERE workflow_draft_job_id = %s
            ORDER BY candidate_screen_id
            """,
            (job_id,),
        )
        rows = await cur.fetchall()
        return [str(row[0]) for row in rows]


async def complete_workflow_draft_job(
    conn: psycopg.AsyncConnection, job: ClaimedWorkflowDraftJob
) -> bool:
    async with conn.transaction():
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE workflow_draft_jobs
                SET status = 'completed', locked_at = NULL, error_message = NULL, updated_at = now()
                WHERE id = %s AND status = 'processing' AND attempts = %s
                """,
                (job.id, job.attempt),
            )
            return cur.rowcount == 1


async def fail_workflow_draft_job(
    conn: psycopg.AsyncConnection, job: ClaimedWorkflowDraftJob, message: str
) -> bool:
    async with conn.transaction():
        async with conn.cursor() as cur:
            await cur.execute(
                """
                UPDATE workflow_draft_jobs
                SET status = 'failed', locked_at = NULL, error_message = %s, updated_at = now()
                WHERE id = %s AND status = 'processing' AND attempts = %s
                """,
                (message[:1000], job.id, job.attempt),
            )
            return cur.rowcount == 1
