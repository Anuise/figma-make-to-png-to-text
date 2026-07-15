import asyncio
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import psycopg
import pytest_asyncio

from ai_worker.migrate import migrate

if sys.platform == "win32":
    # psycopg's async mode cannot run on Windows' default ProactorEventLoop.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

PORT = 54329
REPO_ROOT = Path(__file__).resolve().parents[3]


def _run_compose(project: str, args: list[str]) -> None:
    subprocess.run(
        ["docker", "compose", "--project-name", project, *args],
        cwd=REPO_ROOT,
        env={**os.environ, "POSTGRES_PORT": str(PORT)},
        check=True,
        timeout=30,
    )


async def _wait_for_postgres(database_url: str) -> None:
    deadline = time.monotonic() + 30
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            conn = await psycopg.AsyncConnection.connect(database_url, connect_timeout=2)
            await conn.close()
            return
        except Exception as error:  # noqa: BLE001 - retry until deadline
            last_error = error
            await asyncio.sleep(0.25)
    raise RuntimeError("PostgreSQL did not become ready within 30 seconds") from last_error


@pytest_asyncio.fixture
async def postgres_url():
    project = f"ai-worker-test-{uuid.uuid4().hex[:8]}"
    database_url = (
        f"postgresql://analysis_tool:analysis_tool@127.0.0.1:{PORT}/analysis_tool"
    )
    _run_compose(project, ["up", "--detach", "postgres"])
    try:
        await _wait_for_postgres(database_url)
        conn = await psycopg.AsyncConnection.connect(database_url)
        await conn.set_autocommit(True)
        try:
            await migrate(conn)
        finally:
            await conn.close()
        yield database_url
    finally:
        _run_compose(project, ["down", "--volumes", "--remove-orphans"])
