import uuid

import psycopg
import pytest

from ai_worker import process_next_job as process_next_job_module


async def _create_analysis_run_with_snapshot(conn: psycopg.AsyncConnection, tmp_path) -> str:
    run_id = str(uuid.uuid4())
    revision_id = str(uuid.uuid4())
    snapshot_path = tmp_path / "snapshot"
    snapshot_path.mkdir()
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO analysis_runs (id, source_relative_path, status) VALUES (%s, %s, 'ready')",
            (run_id, "project-alpha"),
        )
        await cur.execute(
            """
            INSERT INTO source_revisions (
              id, analysis_run_id, fingerprint, snapshot_path, working_copy_path
            )
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                revision_id,
                run_id,
                "f" * 64,
                str(snapshot_path),
                str(tmp_path / "working-copy"),
            ),
        )
        await cur.execute(
            "UPDATE analysis_runs SET source_revision_id = %s WHERE id = %s",
            (revision_id, run_id),
        )
    return run_id


async def _insert_confirmed_screen(conn: psycopg.AsyncConnection, run_id: str) -> str:
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
    return screen_id


async def _enqueue_job(conn: psycopg.AsyncConnection, run_id: str, screen_ids: list[str]) -> str:
    job_id = str(uuid.uuid4())
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO workflow_draft_jobs (id, analysis_run_id, status) VALUES (%s, %s, 'queued')",
            (job_id, run_id),
        )
        for screen_id in screen_ids:
            await cur.execute(
                """
                INSERT INTO workflow_draft_job_screens (workflow_draft_job_id, candidate_screen_id)
                VALUES (%s, %s)
                """,
                (job_id, screen_id),
            )
    return job_id


@pytest.mark.asyncio
async def test_processes_a_job_end_to_end_with_a_fake_client(postgres_url, tmp_path, monkeypatch):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        run_id = await _create_analysis_run_with_snapshot(conn, tmp_path)
        screen_id = await _insert_confirmed_screen(conn, run_id)
        job_id = await _enqueue_job(conn, run_id, [screen_id])

        async def fake_generate(prompt, model=None):
            return {
                "drafts": [
                    {
                        "user_goal": "Complete checkout",
                        "preconditions": ["Cart has an item"],
                        "steps": ["Open checkout", "Submit payment"],
                        "expected_result": "Order confirmed",
                        "exceptions": ["Payment declined"],
                        "related_screen_ids": [screen_id],
                    }
                ]
            }

        monkeypatch.setattr(
            process_next_job_module, "generate_workflow_draft_batch", fake_generate
        )

        processed = await process_next_job_module.process_next_job(conn)
        assert processed is True

        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT status FROM workflow_draft_jobs WHERE id = %s", (job_id,)
            )
            (status,) = await cur.fetchone()
            assert status == "completed"

            await cur.execute(
                "SELECT id, user_goal FROM workflow_drafts WHERE workflow_draft_job_id = %s",
                (job_id,),
            )
            drafts = await cur.fetchall()
            assert [goal for _id, goal in drafts] == ["Complete checkout"]
            draft_id = drafts[0][0]

            await cur.execute(
                "SELECT candidate_screen_id FROM workflow_draft_screens WHERE workflow_draft_id = %s",
                (draft_id,),
            )
            linked = await cur.fetchall()
            assert [str(row[0]) for row in linked] == [screen_id]
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_marks_job_failed_when_ai_call_raises(postgres_url, tmp_path, monkeypatch):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        run_id = await _create_analysis_run_with_snapshot(conn, tmp_path)
        screen_id = await _insert_confirmed_screen(conn, run_id)
        job_id = await _enqueue_job(conn, run_id, [screen_id])

        async def failing_generate(prompt, model=None):
            raise RuntimeError("simulated SDK failure")

        monkeypatch.setattr(
            process_next_job_module, "generate_workflow_draft_batch", failing_generate
        )

        processed = await process_next_job_module.process_next_job(conn)
        assert processed is True

        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT status, error_message FROM workflow_draft_jobs WHERE id = %s",
                (job_id,),
            )
            status, error_message = await cur.fetchone()
            assert status == "failed"
            assert "simulated SDK failure" in error_message

            await cur.execute(
                "SELECT count(*) FROM workflow_drafts WHERE workflow_draft_job_id = %s",
                (job_id,),
            )
            (count,) = await cur.fetchone()
            assert count == 0
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_returns_false_when_no_jobs_are_queued(postgres_url):
    conn = await psycopg.AsyncConnection.connect(postgres_url)
    await conn.set_autocommit(True)
    try:
        assert await process_next_job_module.process_next_job(conn) is False
    finally:
        await conn.close()
