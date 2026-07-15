import asyncio
import sys

from . import db
from .migrate import migrate
from .process_next_job import process_next_job

POLL_INTERVAL_SECONDS = 1


async def _run(once: bool) -> None:
    conn = await db.connect()
    try:
        await migrate(conn)
        while True:
            processed = await process_next_job(conn)
            if once:
                return
            if not processed:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
    finally:
        await conn.close()


def main() -> None:
    if sys.platform == "win32":
        # psycopg's async mode cannot run on Windows' default ProactorEventLoop.
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    once = "--once" in sys.argv[1:]
    asyncio.run(_run(once))


if __name__ == "__main__":
    main()
