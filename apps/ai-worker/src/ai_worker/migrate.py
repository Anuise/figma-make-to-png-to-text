import os
from pathlib import Path

import psycopg

# apps/ai-worker/src/ai_worker/migrate.py -> parents[4] is the repo root, both
# locally and inside the Docker image (the Dockerfile mirrors this exact
# relative layout so the default needs no override there).
DEFAULT_MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "database" / "migrations"
)


def _migrations_dir() -> Path:
    override = os.environ.get("DATABASE_MIGRATIONS_DIR")
    return Path(override) if override else DEFAULT_MIGRATIONS_DIR


async def migrate(conn: psycopg.AsyncConnection) -> None:
    """Python port of packages/database/src/migrate.ts's algorithm.

    Uses the same advisory-lock name and `schema_migrations` bookkeeping so
    this can safely run concurrently with the TypeScript worker's own
    migrate() call at container startup — whichever wins applies pending
    migrations, the other blocks briefly on the lock and then no-ops.
    """
    migrations_dir = _migrations_dir()
    names = sorted(
        entry.name
        for entry in migrations_dir.iterdir()
        if entry.is_file() and entry.name.endswith(".sql")
    )

    async with conn.transaction():
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT pg_advisory_xact_lock(hashtext('analysis-tool-schema-migrations'))"
            )
            await cur.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                  name text PRIMARY KEY,
                  applied_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            for name in names:
                await cur.execute(
                    "SELECT 1 FROM schema_migrations WHERE name = %s", (name,)
                )
                if await cur.fetchone() is None:
                    sql = (migrations_dir / name).read_text(encoding="utf-8")
                    await cur.execute(sql)
                    await cur.execute(
                        "INSERT INTO schema_migrations (name) VALUES (%s)", (name,)
                    )
