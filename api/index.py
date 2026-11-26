"""Vercel entry point: runs the LexBot backend as a serverless function.

Vercel's Python runtime looks for a BaseHTTPRequestHandler subclass named `handler`,
so this file reuses backend/server.py's Handler unchanged. Locally, keep using
`python3 backend/server.py`.
"""
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

# Vercel's file system is read-only except /tmp, and the site is served over HTTPS.
os.environ.setdefault("LEXBOT_DB", "/tmp/lexbot.db")
os.environ.setdefault("LEXBOT_SECURE_COOKIE", "1")

from server import Handler  # noqa: E402


class handler(Handler):  # noqa: N801  (Vercel requires this exact name)
    pass
