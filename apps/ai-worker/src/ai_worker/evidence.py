from dataclasses import dataclass
from pathlib import Path

import psycopg

from .code_lookup import find_code_snippet
from .redaction import scrub_secrets


@dataclass
class ScreenEvidence:
    screen_id: str
    route: str
    title: str | None
    notes: str | None
    screenshot_path: str | None
    trace_path: str | None
    code_snippet: str | None


async def _fetch_screen(conn: psycopg.AsyncConnection, screen_id: str) -> dict:
    async with conn.cursor() as cur:
        await cur.execute(
            """
            SELECT route, screenshot_path, trace_path, screen_title, screen_notes
            FROM candidate_screens
            WHERE id = %s
            """,
            (screen_id,),
        )
        row = await cur.fetchone()
        if row is None:
            raise ValueError(f"Candidate screen {screen_id} not found")
        route, screenshot_path, trace_path, screen_title, screen_notes = row
        return {
            "route": route,
            "screenshot_path": screenshot_path,
            "trace_path": trace_path,
            "screen_title": screen_title,
            "screen_notes": screen_notes,
        }


async def build_screen_evidence(
    conn: psycopg.AsyncConnection,
    screen_id: str,
    snapshot_path: Path | None,
) -> ScreenEvidence:
    """Assembles one confirmed screen's evidence bundle for the AI payload.

    Code-snippet lookup is best-effort against the immutable source
    snapshot (never the mutable working copy -- see
    packages/source-projects/src/copy.ts) and is simply omitted, not an
    error, when no snapshot path is available or nothing matches.
    """
    screen = await _fetch_screen(conn, screen_id)

    code_snippet = None
    if snapshot_path is not None:
        raw_snippet = find_code_snippet(snapshot_path, screen["route"])
        if raw_snippet is not None:
            code_snippet = scrub_secrets(raw_snippet)

    title = scrub_secrets(screen["screen_title"]) if screen["screen_title"] else None
    notes = scrub_secrets(screen["screen_notes"]) if screen["screen_notes"] else None

    return ScreenEvidence(
        screen_id=screen_id,
        route=screen["route"],
        title=title,
        notes=notes,
        screenshot_path=screen["screenshot_path"],
        trace_path=screen["trace_path"],
        code_snippet=code_snippet,
    )
