import fnmatch
import re
from pathlib import Path

# Directory names that are never traversed at all -- their contents must be
# skipped before any file is read, not filtered after the fact.
DENYLISTED_DIRECTORY_NAMES = {"node_modules", ".git", ".venv", "__pycache__"}

# Filename patterns checked (case-insensitive) against the basename. A match
# means the file is never opened, never read.
DENYLISTED_FILENAME_PATTERNS = [
    ".env",
    ".env.*",
    "*.env",
    "*.pem",
    "*.key",
    "id_rsa",
    "id_rsa.*",
    "id_dsa",
    "id_dsa.*",
    "id_ecdsa",
    "id_ecdsa.*",
    "id_ed25519",
    "id_ed25519.*",
    ".npmrc",
    ".pypirc",
    "credentials",
    "credentials.json",
]


def is_sensitive_path(path: Path) -> bool:
    """True if any path segment is a denylisted directory, or the filename
    itself matches a denylisted pattern.

    Callers must check this BEFORE reading a file's contents -- file-list
    filtering is the primary defense here, not content post-processing.
    """
    if any(part in DENYLISTED_DIRECTORY_NAMES for part in path.parts):
        return True
    name_lower = path.name.lower()
    return any(
        fnmatch.fnmatch(name_lower, pattern.lower())
        for pattern in DENYLISTED_FILENAME_PATTERNS
    )


_SECRET_PATTERNS = [
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"(?i)bearer\s+[a-z0-9\-_.=]+"),
    re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"
    ),
    re.compile(
        r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9+/=_\-]{8,}['\"]?"
    ),
]


def scrub_secrets(text: str) -> str:
    """Best-effort regex net over free text (notes, titles, matched code
    snippets) that might otherwise carry an embedded secret.

    This is a secondary safety net, not a completeness guarantee -- the
    primary defense is never reading a denylisted file in the first place.
    """
    scrubbed = text
    for pattern in _SECRET_PATTERNS:
        scrubbed = pattern.sub("[REDACTED]", scrubbed)
    return scrubbed
