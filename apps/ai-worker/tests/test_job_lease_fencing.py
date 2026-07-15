import uuid

import psycopg
import pytest

from ai_worker import jobs


async def _create_analysis_run(conn: psycopg.AsyncConnection) -> str:
    run_id = str(uuid.uuid4())
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO analysis_runs (id, source_relative_path, status) VALUES (%s, %s, 'ready')",
            (run_id, "project-alpha"),
        )
    return run_id


async def _enqueue_workflow_draft_job(conn: psycopg.AsyncConnection, run_id: str) -> str:
    job_id = str(uuid.uuid4())
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO workflow_draft_jobs (id, analysis_run_id, status) VALUES (%s, %s, 'queued')",
            (job_id, run_id),
        )
    return job_id


@pytest.mark.asyncio
async def test_stale_claim_cannot_complete_or_fail_a_reclaimed_job(postgres_url):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        run_id = await _create_analysis_run(conn)
        await _enqueue_workflow_draft_job(conn, run_id)

        first_claim = await jobs.claim_next_workflow_draft_job(conn)
        assert first_claim is not None
        assert first_claim.attempt == 1

        async with conn.cursor() as cur:
            await cur.execute(
                "UPDATE workflow_draft_jobs SET locked_at = now() - interval '31 seconds' WHERE id = %s",
                (first_claim.id,),
            )

        second_claim = await jobs.claim_next_workflow_draft_job(conn)
        assert second_claim is not None
        assert second_claim.attempt == 2

        assert (
            await jobs.fail_workflow_draft_job(conn, first_claim, "stale worker failure")
            is False
        )
        assert await jobs.complete_workflow_draft_job(conn, second_claim) is True

        assert await jobs.claim_next_workflow_draft_job(conn) is None
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_claim_returns_none_when_no_jobs_are_queued(postgres_url):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        assert await jobs.claim_next_workflow_draft_job(conn) is None
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_get_job_screen_ids_returns_the_frozen_batch(postgres_url):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        run_id = await _create_analysis_run(conn)
        job_id = await _enqueue_workflow_draft_job(conn, run_id)

        screen_id = str(uuid.uuid4())
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO candidate_screens (
                  id, analysis_run_id, route, ui_fingerprint, visible_state_hash,
                  operation_path, review_status
                )
                VALUES (%s, %s, '/checkout', 'fp', 'hash', '{}', 'confirmed')
                """,
                (screen_id, run_id),
            )
            await cur.execute(
                "INSERT INTO workflow_draft_job_screens (workflow_draft_job_id, candidate_screen_id) VALUES (%s, %s)",
                (job_id, screen_id),
            )

        screen_ids = await jobs.get_job_screen_ids(conn, job_id)
        assert screen_ids == [screen_id]
    finally:
        await conn.close()
