#!/usr/bin/env python3
"""HTTP API for LexBot (standard library only). Also serves the web frontend.

    python3 server.py                 # http://localhost:8000
    python3 server.py --port 9000

Accounts (sign-in uses an HttpOnly cookie)
    POST /api/auth/signup  {"name", "email", "password"}  -> {"user": {...}}  (also signs in)
    POST /api/auth/login   {"email", "password"}          -> {"user": {...}}
    POST /api/auth/logout                                 -> {"ok": true}
    GET  /api/auth/me                                     -> {"user": {...}} or 401

Personal API keys (manage while signed in to the web app)
    GET    /api/keys              -> {"keys": [...]}
    POST   /api/keys  {"name"}    -> {"key": "lxb_...", "record": {...}}   (key shown once)
    DELETE /api/keys/<id>         -> {"ok": true}
    Programs send the key as:  Authorization: Bearer lxb_...

Endpoints (all except /api/health, /api/greeting and /api/auth/* need a signed-in user
or an API key)
    GET  /api/config              -> {"ai_available": bool, "ai_provider", "ai_model", "ai_reason"}
    POST /api/chat     {"message": "...", "session_id": "..."?, "ai": bool?, "lang": "hi"?}
                       -> {"session_id", "reply", "finished", "trace", "suggestions", "urgent",
                           "ai": bool, "rule_reply"?, "ai_source"?, "ai_error"?}
                       "lang" (en, hi, bn, ta, te, mr) sets the language of AI answers.
                       With "ai" (default true) and a Gemini API key configured, "reply" is
                       Gemini's answer and "rule_reply" the rule-based one. "ai_source" is
                       "knowledge_base" when LexBot recognised the topic, else "general".
    POST /api/explain  {"session_id": "..."}  -> {"session_id": "...", "reply": "..."}
    GET  /api/greeting                        -> {"reply": "..."}
    GET  /api/health                          -> {"status": "ok"}
    GET  /api/stats                           -> knowledge-base counts
    GET  /api/quiz                            -> {"questions": [5 multiple-choice questions]}
    GET  /api/law-of-the-day                  -> one legal term, different each day
    GET  /api/selftest                        -> accuracy of the engine on data/selftest.json
    GET  /api/concepts                        -> all concepts (semantic net nodes)
    GET  /api/concepts/<id>                   -> one concept with its relations
    GET  /api/rules                           -> all production rules

/api/chat and /api/explain also return "trace": the structured reasoning for the
last answer (null when the message was a command or small talk).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import threading
import time
import uuid
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from backend/.env into the environment (real env vars win)."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(Path(__file__).resolve().parent / ".env")

from ai import AIWriter  # noqa: E402  (after .env is loaded)
from auth import SESSION_SECONDS, AuthError, AuthStore, LoginLimiter  # noqa: E402
from legal_bot import KnowledgeBase, LegalChatbot, api  # noqa: E402

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
MAX_BODY = 16 * 1024            # bytes
MAX_MESSAGE = 1000              # characters
SESSION_TTL = 60 * 60           # seconds of inactivity before a session is dropped
MAX_SESSIONS = 1000
AUTH_COOKIE = "lexbot_auth"
DB_PATH = os.environ.get("LEXBOT_DB", str(Path(__file__).resolve().parent / "instance" / "lexbot.db"))
# Set LEXBOT_SECURE_COOKIE=1 when the site is served over HTTPS (e.g. on Vercel).
SECURE_COOKIE = os.environ.get("LEXBOT_SECURE_COOKIE", "").lower() in ("1", "true", "yes")
PUBLIC_API = {"/api/health", "/api/greeting", "/api/auth/me", "/api/auth/signup",
              "/api/auth/login", "/api/auth/logout"}

# The knowledge base is read-only after loading, so all sessions share it.
KB = KnowledgeBase.load()
SELFTEST_CASES = json.loads((Path(__file__).resolve().parent / "data" / "selftest.json")
                            .read_text(encoding="utf-8"))["cases"]
AUTH = AuthStore(DB_PATH)
LOGIN_LIMITER = LoginLimiter()
AI = AIWriter()


class SessionStore:
    """One LegalChatbot per chat, so follow-ups and 'why' keep their context.

    Each conversation belongs to the user who started it; another user can't reach it
    even if they learn its id.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, tuple[LegalChatbot, float, int]] = {}

    def get(self, session_id: str | None, owner: int,
            create: bool = True) -> tuple[str, LegalChatbot | None]:
        now = time.time()
        with self._lock:
            self._evict(now)
            entry = self._sessions.get(session_id) if session_id else None
            if entry and entry[2] == owner:
                self._sessions[session_id] = (entry[0], now, owner)
                return session_id, entry[0]
            if not create:
                return "", None
            new_id = uuid.uuid4().hex
            self._sessions[new_id] = (LegalChatbot(KB), now, owner)
            return new_id, self._sessions[new_id][0]

    def _evict(self, now: float) -> None:
        expired = [sid for sid, (_, seen, _) in self._sessions.items() if now - seen > SESSION_TTL]
        for sid in expired:
            del self._sessions[sid]
        if len(self._sessions) >= MAX_SESSIONS:   # drop the least recently used
            oldest = min(self._sessions, key=lambda sid: self._sessions[sid][1])
            del self._sessions[oldest]


SESSIONS = SessionStore()


class Handler(BaseHTTPRequestHandler):
    server_version = "LexBot/1.0"

    # ------------------------------------------------------------- helpers
    def _send_json(self, status: int, payload: dict, cookie: str | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    # ---------------------------------------------------------------- auth
    def _auth_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = SimpleCookie(raw)
        except CookieError:
            return None
        morsel = jar.get(AUTH_COOKIE)
        return morsel.value if morsel else None

    def _bearer_key(self) -> str | None:
        header = self.headers.get("Authorization", "")
        return header[7:].strip() if header.lower().startswith("bearer ") else None

    def _current_user(self) -> dict | None:
        """User from an API key (Authorization: Bearer) or from the sign-in cookie."""
        if not hasattr(self, "_user_cache"):
            key = self._bearer_key()
            self._via_api_key = key is not None
            self._user_cache = (AUTH.user_for_api_key(key) if key is not None
                                else AUTH.user_for_token(self._auth_token()))
        return self._user_cache

    def _require_browser_user(self) -> dict | None:
        """Key management needs the signed-in web app; an API key can't create more keys."""
        user = self._require_user("/api/keys")
        if user is not None and self._via_api_key:
            self._send_json(403, {"error": "Manage API keys from the LexBot web app, not with an API key."})
            return None
        return user

    @staticmethod
    def _session_cookie(token: str, max_age: int = SESSION_SECONDS) -> str:
        secure = "; Secure" if SECURE_COOKIE else ""
        return f"{AUTH_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}{secure}"

    def _require_user(self, path: str) -> dict | None:
        """The signed-in user, or None after sending a 401 for protected endpoints."""
        if path in PUBLIC_API or not path.startswith("/api/"):
            return self._current_user()
        user = self._current_user()
        if user is None:
            self._send_json(401, {"error": "Invalid API key." if self._bearer_key() is not None
                                  else "Please sign in to continue."})
        return user

    def _handle_auth(self, path: str, data: dict) -> None:
        ip = self.client_address[0]
        if path == "/api/auth/logout":
            AUTH.delete_session(self._auth_token())
            self._send_json(200, {"ok": True}, cookie=self._session_cookie("", max_age=0))
            return
        try:
            if path == "/api/auth/signup":
                user = AUTH.signup(data.get("name"), data.get("email"), data.get("password"))
            else:
                if LOGIN_LIMITER.blocked(ip):
                    self._send_json(429, {"error": "Too many failed sign-in attempts. "
                                                   "Please wait 15 minutes and try again."})
                    return
                try:
                    user = AUTH.authenticate(data.get("email"), data.get("password"))
                except AuthError:
                    LOGIN_LIMITER.failed(ip)
                    raise
                LOGIN_LIMITER.reset(ip)
        except AuthError as err:
            self._send_json(err.status, {"error": err.message})
            return
        token = AUTH.create_session(user["id"])
        self._send_json(200, {"user": user}, cookie=self._session_cookie(token))

    def _read_json(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if length <= 0 or length > MAX_BODY:
            return None
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def _serve_static(self, path: str) -> None:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (FRONTEND_DIR / rel).resolve()
        if FRONTEND_DIR.resolve() not in target.parents or not target.is_file():
            self._send_json(404, {"error": "not found"})
            return
        body = target.read_bytes()
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -------------------------------------------------------------- routes
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith("/api/") and path not in PUBLIC_API and self._require_user(path) is None:
            return
        if path == "/api/auth/me":
            user = self._current_user()
            if user is None:
                self._send_json(401, {"error": "Not signed in."})
            else:
                self._send_json(200, {"user": user})
        elif path == "/api/config":
            self._send_json(200, {"ai_available": AI.available, "ai_provider": AI.provider,
                                  "ai_model": AI.model if AI.available else None,
                                  "ai_reason": AI.reason or None})
        elif path == "/api/keys":
            user = self._require_browser_user()
            if user is not None:
                self._send_json(200, {"keys": AUTH.list_api_keys(user["id"])})
        elif path == "/api/health":
            self._send_json(200, {"status": "ok"})
        elif path == "/api/greeting":
            self._send_json(200, {"reply": LegalChatbot(KB).greeting()})
        elif path == "/api/stats":
            self._send_json(200, api.stats(KB))
        elif path == "/api/concepts":
            self._send_json(200, {"concepts": api.concept_list(KB)})
        elif path.startswith("/api/concepts/"):
            detail = api.concept_detail(KB, path[len("/api/concepts/"):])
            if detail is None:
                self._send_json(404, {"error": "unknown concept"})
            else:
                self._send_json(200, detail)
        elif path == "/api/rules":
            self._send_json(200, {"rules": api.rule_list(KB)})
        elif path == "/api/quiz":
            self._send_json(200, {"questions": api.quiz(KB, 5)})
        elif path == "/api/law-of-the-day":
            self._send_json(200, api.law_of_the_day(KB, int(time.time() // 86400)))
        elif path == "/api/selftest":
            self._send_json(200, api.self_test(KB, SELFTEST_CASES))
        elif path.startswith("/api/"):
            self._send_json(404, {"error": "unknown endpoint"})
        else:
            self._serve_static(path)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        auth_paths = ("/api/auth/signup", "/api/auth/login", "/api/auth/logout")
        if path not in ("/api/chat", "/api/explain", "/api/keys", *auth_paths):
            self._send_json(404, {"error": "unknown endpoint"})
            return
        if path == "/api/auth/logout":
            self._handle_auth(path, {})
            return
        data = self._read_json()
        if data is None:
            self._send_json(400, {"error": "expected a JSON object body"})
            return
        if path in auth_paths:
            self._handle_auth(path, data)
            return
        if path == "/api/keys":
            user = self._require_browser_user()
            if user is None:
                return
            try:
                key, record = AUTH.create_api_key(user["id"], data.get("name"))
            except AuthError as err:
                self._send_json(err.status, {"error": err.message})
                return
            self._send_json(201, {"key": key, "record": record})
            return
        user = self._require_user(path)
        if user is None:
            return
        session_id = data.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            self._send_json(400, {"error": "'session_id' must be a string"})
            return

        if path == "/api/explain":
            sid, bot = SESSIONS.get(session_id, owner=user["id"], create=False)
            if bot is None:
                self._send_json(200, {"session_id": sid, "trace": None, "reply":
                                      "Ask me a question first, then I can show my reasoning."})
            else:
                self._send_json(200, {"session_id": sid, "reply": bot.explain(),
                                      "trace": api.trace(KB, bot.last_turn)})
            return

        message = data.get("message")
        if not isinstance(message, str) or not message.strip():
            self._send_json(400, {"error": "'message' must be a non-empty string"})
            return
        if len(message) > MAX_MESSAGE:
            self._send_json(400, {"error": f"'message' is longer than {MAX_MESSAGE} characters"})
            return
        sid, bot = SESSIONS.get(session_id, owner=user["id"])
        before = bot.last_turn
        reply = bot.respond(message)
        new_turn = bot.last_turn if bot.last_turn is not before else None
        trace = api.trace(KB, new_turn)
        result = {"session_id": sid, "reply": reply, "finished": bot.finished, "trace": trace, "ai": False,
                  "suggestions": api.follow_ups(KB, new_turn), "urgent": api.is_urgent(new_turn)}
        lang = data.get("lang") if isinstance(data.get("lang"), str) else "en"
        # Gemini answers real questions only (not commands like "why"/"topics" or small talk).
        if data.get("ai", True) is not False and new_turn is not None and AI.available:
            kb_matched = bool(new_turn.concepts)
            ai_reply, ai_error = AI.enhance(user["id"], message, reply, trace,
                                           kb_matched=kb_matched, lang=lang)
            if ai_reply:
                result.update(reply=ai_reply, rule_reply=reply, ai=True,
                              ai_source="knowledge_base" if kb_matched else "general")
            elif ai_error:
                result["ai_error"] = ai_error
        self._send_json(200, result)

    def do_DELETE(self) -> None:
        path = self.path.split("?", 1)[0]
        prefix = "/api/keys/"
        if not path.startswith(prefix) or not path[len(prefix):].isdigit():
            self._send_json(404, {"error": "unknown endpoint"})
            return
        user = self._require_browser_user()
        if user is None:
            return
        if AUTH.revoke_api_key(user["id"], int(path[len(prefix):])):
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "No such API key."})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the LexBot web API and frontend.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"LexBot running at http://{args.host}:{args.port}  (Ctrl+C to stop)")
    print(f"User database: {AUTH.location}")
    print(f"AI answers: {'on (' + AI.model + ')' if AI.available else 'off - ' + AI.reason}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
