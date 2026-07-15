import os

import psycopg


async def connect() -> psycopg.AsyncConnection:
    """Opens a single autocommit connection for one worker loop iteration.

    Autocommit keeps ad-hoc statements from leaving a dangling implicit
    transaction; the atomic multi-statement operations in jobs.py and
    migrate.py use `async with conn.transaction()` blocks, which wrap a real
    transaction regardless of the autocommit setting.
    """
    conn = await psycopg.AsyncConnection.connect(os.environ["DATABASE_URL"])
    await conn.set_autocommit(True)
    return conn
