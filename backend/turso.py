"""Minimal Turso (libSQL) client over HTTP, standard library only.

Turso is a hosted database that speaks SQLite's SQL, so the account store can use it
unchanged. It is needed on serverless hosts such as Vercel, where each running copy of
the app has its own temporary disk: a local SQLite file there would give every copy a
different set of users and sessions.

`TursoConnection` mimics the small part of `sqlite3.Connection` that auth.py uses:
execute() -> cursor (fetchone, fetchall, lastrowid, rowcount), executescript(),
and use as a context manager. Each statement is sent with Turso's HTTP API
(POST /v2/pipeline) and commits on its own.

Configure with the environment variables Turso's Vercel integration sets:
    TURSO_DATABASE_URL   libsql://<db>-<org>.turso.io
    TURSO_AUTH_TOKEN     a database token
"""

from __future__ import annotations

import json
import sqlite3
import urllib.error
import urllib.request
from typing import Any, Iterable, Sequence

TIMEOUT = 15  # seconds


class Row(tuple):
    """A result row readable by position (row[0]) or column name (row["email"])."""

    _index: dict[str, int]

    def __new__(cls, values: Iterable[Any], index: dict[str, int]) -> "Row":
        row = super().__new__(cls, values)
        row._index = index
        return row

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, str):
            return tuple.__getitem__(self, self._index[key])
        return tuple.__getitem__(self, key)

    def keys(self) -> list[str]:
        return list(self._index)


class Cursor:
    def __init__(self, rows: list[Row], lastrowid: int | None, rowcount: int):
        self._rows = rows
        self.lastrowid = lastrowid
        self.rowcount = rowcount

    def fetchone(self) -> Row | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[Row]:
        return list(self._rows)


def _encode(value: Any) -> dict:
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, str):
        return {"type": "text", "value": value}
    raise TypeError(f"Unsupported SQL parameter type: {type(value).__name__}")


def _decode(cell: dict) -> Any:
    kind = cell.get("type")
    if kind == "null":
        return None
    if kind == "integer":
        return int(cell["value"])
    if kind == "float":
        return float(cell["value"])
    return cell.get("value")


class TursoConnection:
    row_factory = None  # accepted for sqlite3 compatibility; rows are always Row

    def __init__(self, url: str, token: str):
        url = url.strip().rstrip("/")
        if url.startswith("libsql://"):
            url = "https://" + url[len("libsql://"):]
        self._endpoint = url + "/v2/pipeline"
        self._token = token.strip()

    # sqlite3.Connection-style context manager: statements already auto-commit.
    def __enter__(self) -> "TursoConnection":
        return self

    def __exit__(self, *exc) -> bool:
        return False

    def execute(self, sql: str, params: Sequence[Any] = ()) -> Cursor:
        result = self._send(sql, params)
        cols = [c.get("name") or "" for c in result.get("cols", [])]
        index = {name: i for i, name in enumerate(cols)}
        rows = [Row((_decode(c) for c in r), index) for r in result.get("rows", [])]
        last = result.get("last_insert_rowid")
        return Cursor(rows, int(last) if last is not None else None,
                      int(result.get("affected_row_count", 0)))

    def executescript(self, script: str) -> None:
        for statement in (s.strip() for s in script.split(";")):
            if not statement:
                continue
            try:
                self.execute(statement)
            except sqlite3.OperationalError:
                if not statement.upper().startswith("PRAGMA"):
                    raise  # PRAGMAs are optional on a hosted database

    def _send(self, sql: str, params: Sequence[Any]) -> dict:
        payload = {"requests": [
            {"type": "execute", "stmt": {"sql": sql, "args": [_encode(p) for p in params]}},
            {"type": "close"},
        ]}
        req = urllib.request.Request(
            self._endpoint, data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                body = json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise sqlite3.OperationalError(f"Turso HTTP {exc.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise sqlite3.OperationalError(f"Couldn't reach Turso: {exc}") from None

        first = body.get("results", [{}])[0]
        if first.get("type") == "error":
            err = first.get("error", {})
            message = err.get("message", "unknown error")
            if "CONSTRAINT" in (err.get("code", "") + message).upper():
                raise sqlite3.IntegrityError(message)
            raise sqlite3.OperationalError(message)
        return first.get("response", {}).get("result", {})
