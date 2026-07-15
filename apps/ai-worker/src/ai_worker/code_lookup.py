import os
from pathlib import Path

from .redaction import DENYLISTED_DIRECTORY_NAMES, is_sensitive_path

# Common source locations in a Figma-Make-exported React project where a
# route's page/component is likely to live. Checked in order; "src" is
# listed last since it's a broad fallback that also covers the more
# specific entries above it.
_CANDIDATE_ROOTS = ["src/pages", "src/app", "src/routes", "pages", "app", "routes", "src"]
_MAX_FILES_SCANNED = 500


def _route_segments(route: str) -> list[str]:
    return [segment for segment in route.strip("/").lower().split("/") if segment]


def find_code_snippet(snapshot_path: Path, route: str, max_lines: int = 40) -> str | None:
    """Best-effort filename match between a screen's route and a source file
    under the immutable source snapshot (never the mutable working copy).

    Returns up to `max_lines` lines of the first match, or None if nothing
    matches -- a miss never blocks workflow-draft generation, it just omits
    the code snippet for that screen.
    """
    segments = _route_segments(route)
    if not segments:
        return None

    scanned = 0
    for root_name in _CANDIDATE_ROOTS:
        root = snapshot_path / root_name
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in DENYLISTED_DIRECTORY_NAMES]
            for filename in filenames:
                if scanned >= _MAX_FILES_SCANNED:
                    return None
                scanned += 1
                path = Path(dirpath) / filename
                relative = path.relative_to(snapshot_path)
                if is_sensitive_path(relative):
                    continue
                relative_lower = str(relative).lower()
                if any(segment in relative_lower for segment in segments):
                    try:
                        lines = path.read_text(
                            encoding="utf-8", errors="ignore"
                        ).splitlines()
                    except OSError:
                        continue
                    return "\n".join(lines[:max_lines])
    return None
