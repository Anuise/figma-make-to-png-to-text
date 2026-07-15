import uuid
from pathlib import Path

import psycopg
from google.antigravity.types import Image
from psycopg.types.json import Jsonb

from . import jobs
from .antigravity_client import generate_workflow_draft_batch
from .evidence import ScreenEvidence, build_screen_evidence
from .schema import WorkflowDraftBatch, validate_workflow_draft_batch


def _error_message(error: Exception) -> str:
    message = str(error) or type(error).__name__
    return message[:1000]


async def _get_snapshot_path(
    conn: psycopg.AsyncConnection, analysis_run_id: str
) -> Path | None:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT sr.snapshot_path
            FROM analysis_runs ar
            JOIN source_revisions sr ON sr.id = ar.source_revision_id
            WHERE ar.id = %s
            """,
            (analysis_run_id,),
        )
        row = await cur.fetchone()
        if row is None or row[0] is None:
            return None
        return Path(row[0])


def _build_prompt(evidences: list[ScreenEvidence]) -> list:
    parts: list = [
        "You are analyzing confirmed screens from a Figma-Make-exported React "
        "prototype to draft workflows for engineering planning. Each workflow "
        "draft must have: user_goal, preconditions, steps, expected_result, "
        "exceptions, and related_screen_ids drawn only from the screen IDs "
        "listed below. A batch of screens may cover more than one user goal "
        "-- return one draft per distinct goal."
    ]
    for evidence in evidences:
        description = f"Screen {evidence.screen_id} at route '{evidence.route}'"
        if evidence.title:
            description += f" titled '{evidence.title}'"
        if evidence.notes:
            description += f". Notes: {evidence.notes}"
        if evidence.code_snippet:
            description += f". Code snippet:\n{evidence.code_snippet}"
        parts.append(description)
        if evidence.screenshot_path and Path(evidence.screenshot_path).is_file():
            parts.append(Image.from_file(evidence.screenshot_path))
    return parts


async def _persist_workflow_drafts(
    conn: psycopg.AsyncConnection,
    analysis_run_id: str,
    job_id: str,
    batch: WorkflowDraftBatch,
) -> None:
    async with conn.transaction():
        async with conn.cursor() as cur:
            for draft in batch.drafts:
                draft_id = str(uuid.uuid4())
                await cur.execute(
                    """
                    INSERT INTO workflow_drafts (
                      id, analysis_run_id, workflow_draft_job_id, user_goal,
                      preconditions, steps, expected_result, exceptions
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        draft_id,
                        analysis_run_id,
                        job_id,
                        draft.user_goal,
                        Jsonb(draft.preconditions),
                        Jsonb(draft.steps),
                        draft.expected_result,
                        Jsonb(draft.exceptions),
                    ),
                )
                for screen_id in draft.related_screen_ids:
                    await cur.execute(
                        """
                        INSERT INTO workflow_draft_screens (workflow_draft_id, candidate_screen_id)
                        VALUES (%s, %s)
                        """,
                        (draft_id, screen_id),
                    )


async def process_next_job(conn: psycopg.AsyncConnection) -> bool:
    """Claims and fully processes one workflow-draft job, mirroring
    process-next-job.ts's per-job try/except shape: any failure marks the
    job failed with a message rather than crashing the poll loop."""
    job = await jobs.claim_next_workflow_draft_job(conn)
    if job is None:
        return False

    try:
        screen_ids = await jobs.get_job_screen_ids(conn, job.id)
        snapshot_path = await _get_snapshot_path(conn, job.analysis_run_id)
        evidences = [
            await build_screen_evidence(conn, screen_id, snapshot_path)
            for screen_id in screen_ids
        ]
        prompt = _build_prompt(evidences)
        raw_output = await generate_workflow_draft_batch(prompt)
        batch = validate_workflow_draft_batch(raw_output, set(screen_ids))
        await _persist_workflow_drafts(conn, job.analysis_run_id, job.id, batch)

        completed = await jobs.complete_workflow_draft_job(conn, job)
        if not completed:
            raise RuntimeError("Workflow draft job claim is no longer current")
    except Exception as error:  # noqa: BLE001 - job-level failure boundary
        await jobs.fail_workflow_draft_job(conn, job, _error_message(error))

    return True
