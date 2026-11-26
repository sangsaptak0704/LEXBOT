"""Vercel entry point: runs the LexBot backend as a serverless function.

Vercel's Python runtime looks for a BaseHTTPRequestHandler subclass named `handler`,
so this file reuses backend/server.py's Handler unchanged. Locally, keep using
`python3 backend/server.py`.

If the backend fails to start, every request gets a plain-text 500 with the Python
traceback (also written to the Vercel function logs) instead of Vercel's generic
FUNCTION_INVOCATION_FAILED page.
"""
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

# Vercel's file system is read-only except /tmp, and the site is served over HTTPS.
os.environ.setdefault("LEXBOT_DB", "/tmp/lexbot.db")
os.environ.setdefault("LEXBOT_SECURE_COOKIE", "1")

if not os.environ.get("TURSO_DATABASE_URL"):
    sys.stderr.write("WARNING: TURSO_DATABASE_URL is not set. Accounts are kept in /tmp on each "
                     "Vercel instance, so sign-ins will fail or log out at random. "
                     "Connect a Turso database (see README).\n")

try:
    from server import Handler as _Base
    STARTUP_ERROR = None
except Exception:  # noqa: BLE001  (show any startup failure instead of crashing)
    _Base = BaseHTTPRequestHandler
    STARTUP_ERROR = traceback.format_exc()
    sys.stderr.write("LexBot failed to start:\n" + STARTUP_ERROR)


class handler(_Base):  # noqa: N801  (Vercel requires this exact name)
    def _startup_failed(self) -> None:
        try:
            files = sorted(str(p.relative_to(ROOT)) for p in ROOT.rglob("*")
                           if p.is_file() and "__pycache__" not in p.parts)[:200]
        except Exception:  # noqa: BLE001
            files = ["(could not list files)"]
        body = ("LexBot failed to start on Vercel.\n\n" + STARTUP_ERROR
                + f"\nPython {sys.version}\nProject root: {ROOT}\n\nFiles deployed:\n  "
                + "\n  ".join(files)).encode("utf-8")
        self.send_response(500)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    if STARTUP_ERROR:
        do_GET = do_POST = do_DELETE = _startup_failed
