"""User accounts for the LexBot web app (standard library only).

* Users and login sessions live in SQLite: a local file, or a hosted Turso database when
  TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set (needed on serverless hosts like Vercel).
* Passwords are hashed with scrypt and a per-user random salt; plain passwords are never stored.
* A login session is a random token sent to the browser in an HttpOnly cookie. Only its
  SHA-256 hash is stored, so a leaked database can't be used to log in.
* Personal API keys ("lxb_...") let a user's own programs call the API. They are shown once
  when created; only their hash and a short prefix (for display) are stored.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

SESSION_DAYS = 7
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60
MIN_PASSWORD = 8
MAX_PASSWORD = 128
MAX_NAME = 60
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
API_KEY_PREFIX = "lxb_"
MAX_API_KEYS = 10
MAX_KEY_NAME = 50

# scrypt cost parameters (about 16 MB of memory and a few tens of ms per hash).
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1


class AuthError(Exception):
    """A problem to report to the user, with the HTTP status to use."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


# ------------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt,
                            n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex),
                                n=int(n), r=int(r), p=int(p), dklen=len(hash_hex) // 2)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


# A real hash to check against when the email doesn't exist, so a failed login
# takes the same time whether or not the account exists.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ------------------------------------------------------------ rate limiting
class LoginLimiter:
    """Allow at most `limit` failed logins per key (client IP) in `window` seconds."""

    def __init__(self, limit: int = 10, window: int = 15 * 60):
        self.limit, self.window = limit, window
        self._fails: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque:
        q = self._fails[key]
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.time())) >= self.limit

    def failed(self, key: str) -> None:
        with self._lock:
            self._prune(key, time.time()).append(time.time())

    def reset(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)


# -------------------------------------------------------------------- store
class AuthStore:
    def __init__(self, path: str | Path):
        turso_url = os.environ.get("TURSO_DATABASE_URL", "").strip()
        if turso_url and str(path) != ":memory:":
            from turso import TursoConnection
            self._db = TursoConnection(turso_url, os.environ.get("TURSO_AUTH_TOKEN", ""))
            self.location = "Turso " + turso_url
        else:
            path = Path(path)
            if str(path) != ":memory:":
                path.parent.mkdir(parents=True, exist_ok=True)
            self._db = sqlite3.connect(str(path), check_same_thread=False)
            self._db.row_factory = sqlite3.Row
            self.location = str(path)
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.executescript("""
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    name          TEXT NOT NULL,
                    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL,
                    created       REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created    REAL NOT NULL,
                    expires    REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS api_keys (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name       TEXT NOT NULL,
                    prefix     TEXT NOT NULL,
                    key_hash   TEXT NOT NULL UNIQUE,
                    created    REAL NOT NULL,
                    last_used  REAL
                );
            """)

    @staticmethod
    def _public(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "name": row["name"], "email": row["email"], "created": row["created"]}

    # ------------------------------------------------------------ accounts
    def signup(self, name: object, email: object, password: object) -> dict:
        if not isinstance(name, str) or not name.strip():
            raise AuthError("Please enter your name.")
        if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
            raise AuthError("Please enter a valid email address.")
        if not isinstance(password, str) or len(password) < MIN_PASSWORD:
            raise AuthError(f"Password must be at least {MIN_PASSWORD} characters.")
        if len(password) > MAX_PASSWORD:
            raise AuthError(f"Password must be at most {MAX_PASSWORD} characters.")
        name, email = name.strip()[:MAX_NAME], email.strip().lower()
        password_hash = hash_password(password)
        try:
            with self._lock, self._db:
                cur = self._db.execute(
                    "INSERT INTO users (name, email, password_hash, created) VALUES (?, ?, ?, ?)",
                    (name, email, password_hash, time.time()))
                row = self._db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
        except sqlite3.IntegrityError:
            raise AuthError("An account with this email already exists. Try signing in.", 409)
        return self._public(row)

    def authenticate(self, email: object, password: object) -> dict:
        if not isinstance(email, str) or not isinstance(password, str) or not email or not password:
            raise AuthError("Please enter your email and password.")
        with self._lock:
            row = self._db.execute("SELECT * FROM users WHERE email = ?",
                                   (email.strip().lower(),)).fetchone()
        ok = verify_password(password, row["password_hash"] if row else _DUMMY_HASH)
        if not row or not ok:
            raise AuthError("Incorrect email or password.", 401)
        return self._public(row)

    # ------------------------------------------------------------ sessions
    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock, self._db:
            self._db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
            self._db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
                             (_token_hash(token), user_id, now, now + SESSION_SECONDS))
        return token

    def user_for_token(self, token: str | None) -> dict | None:
        if not token:
            return None
        with self._lock:
            row = self._db.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires > ?",
                (_token_hash(token), time.time())).fetchone()
        return self._public(row) if row else None

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self._lock, self._db:
            self._db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    # ------------------------------------------------------------ API keys
    @staticmethod
    def _key_public(row: sqlite3.Row) -> dict:
        return {"id": row["id"], "name": row["name"], "prefix": row["prefix"],
                "created": row["created"], "last_used": row["last_used"]}

    def create_api_key(self, user_id: int, name: object) -> tuple[str, dict]:
        """Returns (full_key, record). The full key is never retrievable again."""
        if not isinstance(name, str) or not name.strip():
            raise AuthError("Please give the key a name, e.g. 'My script'.")
        name = name.strip()[:MAX_KEY_NAME]
        key = API_KEY_PREFIX + secrets.token_urlsafe(32)
        with self._lock, self._db:
            count = self._db.execute("SELECT COUNT(*) FROM api_keys WHERE user_id = ?",
                                     (user_id,)).fetchone()[0]
            if count >= MAX_API_KEYS:
                raise AuthError(f"You can have at most {MAX_API_KEYS} API keys. Revoke one first.", 409)
            cur = self._db.execute(
                "INSERT INTO api_keys (user_id, name, prefix, key_hash, created) VALUES (?, ?, ?, ?, ?)",
                (user_id, name, key[:12], _token_hash(key), time.time()))
            row = self._db.execute("SELECT * FROM api_keys WHERE id = ?", (cur.lastrowid,)).fetchone()
        return key, self._key_public(row)

    def list_api_keys(self, user_id: int) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM api_keys WHERE user_id = ? ORDER BY created DESC",
                                    (user_id,)).fetchall()
        return [self._key_public(r) for r in rows]

    def revoke_api_key(self, user_id: int, key_id: int) -> bool:
        with self._lock, self._db:
            cur = self._db.execute("DELETE FROM api_keys WHERE id = ? AND user_id = ?", (key_id, user_id))
        return cur.rowcount > 0

    def user_for_api_key(self, key: str | None) -> dict | None:
        if not key or not key.startswith(API_KEY_PREFIX):
            return None
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT users.*, api_keys.id AS key_id FROM api_keys "
                "JOIN users ON users.id = api_keys.user_id WHERE api_keys.key_hash = ?",
                (_token_hash(key),)).fetchone()
            if row:
                self._db.execute("UPDATE api_keys SET last_used = ? WHERE id = ?", (time.time(), row["key_id"]))
        return self._public(row) if row else None
