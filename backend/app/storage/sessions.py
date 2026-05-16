"""Conversation history backed by SQLite.

Two tables:
- sessions: one row per conversation, user-scoped.
- messages: ordered list of turns belonging to a session.

Sessions are scoped per username — users can only see their own. Token usage
is tracked at message level so admins can aggregate.
"""
from __future__ import annotations
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from app.config import settings

# Anthropic Sonnet pricing (USD per million tokens) — used for cost estimates.
# Update when pricing changes; not authoritative.
PRICE_PER_M_INPUT = 3.0
PRICE_PER_M_OUTPUT = 15.0


_lock = threading.Lock()
_initialised = False


def _conn() -> sqlite3.Connection:
    db_path = settings.wiki_data_dir / "sessions.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init() -> None:
    global _initialised
    with _lock:
        if _initialised:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    message_count INTEGER NOT NULL DEFAULT 0
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username, updated_at DESC)")
            c.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    text TEXT NOT NULL,
                    tool_events TEXT,
                    citations TEXT,
                    tokens_in INTEGER NOT NULL DEFAULT 0,
                    tokens_out INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)")
        _initialised = True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────── Sessions ───────────

def create_session(username: str, title: str = "") -> str:
    init()
    sid = uuid.uuid4().hex[:16]
    now = _now()
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO sessions (id, username, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (sid, username, title, now, now),
        )
    return sid


def get_session(session_id: str, username: str) -> Optional[dict]:
    """Get a session if it belongs to the given user."""
    init()
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM sessions WHERE id = ? AND username = ?",
            (session_id, username),
        ).fetchone()
    return dict(row) if row else None


def list_sessions(username: str, limit: int = 50) -> list[dict]:
    init()
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM sessions WHERE username = ? ORDER BY updated_at DESC LIMIT ?",
            (username, min(limit, 200)),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_session(session_id: str, username: str) -> bool:
    init()
    with _lock, _conn() as c:
        cur = c.execute(
            "DELETE FROM sessions WHERE id = ? AND username = ?",
            (session_id, username),
        )
        return cur.rowcount > 0


def update_session_title(session_id: str, title: str) -> None:
    init()
    with _lock, _conn() as c:
        c.execute("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))


# ─────────── Messages ───────────

def add_message(
    session_id: str,
    role: str,
    text: str,
    tool_events: Optional[list[dict]] = None,
    citations: Optional[list[str]] = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
) -> int:
    init()
    now = _now()
    with _lock, _conn() as c:
        cur = c.execute(
            """INSERT INTO messages (session_id, role, text, tool_events, citations,
                                      tokens_in, tokens_out, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                role,
                text,
                json.dumps(tool_events, ensure_ascii=False) if tool_events else None,
                json.dumps(citations, ensure_ascii=False) if citations else None,
                tokens_in,
                tokens_out,
                now,
            ),
        )
        msg_id = cur.lastrowid
        # bump session
        c.execute(
            """UPDATE sessions
               SET updated_at = ?,
                   message_count = message_count + 1
               WHERE id = ?""",
            (now, session_id),
        )
    return msg_id


def list_messages(session_id: str) -> list[dict]:
    init()
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        if d.get("tool_events"):
            try:
                d["tool_events"] = json.loads(d["tool_events"])
            except json.JSONDecodeError:
                d["tool_events"] = []
        else:
            d["tool_events"] = []
        if d.get("citations"):
            try:
                d["citations"] = json.loads(d["citations"])
            except json.JSONDecodeError:
                d["citations"] = []
        else:
            d["citations"] = []
        out.append(d)
    return out


# ─────────── Usage aggregation ───────────

def estimate_cost(tokens_in: int, tokens_out: int) -> float:
    return (tokens_in / 1_000_000) * PRICE_PER_M_INPUT + (tokens_out / 1_000_000) * PRICE_PER_M_OUTPUT


def usage_summary(days: int = 30) -> dict:
    init()
    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with _conn() as c:
        # Totals
        total = c.execute(
            """SELECT
                 COALESCE(SUM(tokens_in), 0) AS tin,
                 COALESCE(SUM(tokens_out), 0) AS tout,
                 COUNT(*) AS msgs
               FROM messages
               WHERE role = 'assistant' AND created_at >= ?""",
            (since,),
        ).fetchone()
        # By user (via sessions join)
        by_user_rows = c.execute(
            """SELECT s.username AS username,
                       COALESCE(SUM(m.tokens_in), 0) AS tin,
                       COALESCE(SUM(m.tokens_out), 0) AS tout,
                       COUNT(m.id) AS msgs
               FROM messages m
               JOIN sessions s ON s.id = m.session_id
               WHERE m.role = 'assistant' AND m.created_at >= ?
               GROUP BY s.username
               ORDER BY (tin + tout) DESC""",
            (since,),
        ).fetchall()
        # By day
        by_day_rows = c.execute(
            """SELECT substr(m.created_at, 1, 10) AS day,
                       COALESCE(SUM(m.tokens_in), 0) AS tin,
                       COALESCE(SUM(m.tokens_out), 0) AS tout,
                       COUNT(m.id) AS msgs
               FROM messages m
               WHERE m.role = 'assistant' AND m.created_at >= ?
               GROUP BY day
               ORDER BY day""",
            (since,),
        ).fetchall()

    tin = total["tin"]
    tout = total["tout"]
    return {
        "days": days,
        "total": {
            "tokens_in": tin,
            "tokens_out": tout,
            "messages": total["msgs"],
            "cost_usd": round(estimate_cost(tin, tout), 4),
        },
        "by_user": [
            {
                "username": r["username"],
                "tokens_in": r["tin"],
                "tokens_out": r["tout"],
                "messages": r["msgs"],
                "cost_usd": round(estimate_cost(r["tin"], r["tout"]), 4),
            }
            for r in by_user_rows
        ],
        "by_day": [
            {
                "day": r["day"],
                "tokens_in": r["tin"],
                "tokens_out": r["tout"],
                "messages": r["msgs"],
                "cost_usd": round(estimate_cost(r["tin"], r["tout"]), 4),
            }
            for r in by_day_rows
        ],
        "pricing": {
            "input_per_m_usd": PRICE_PER_M_INPUT,
            "output_per_m_usd": PRICE_PER_M_OUTPUT,
        },
    }


def user_usage_today(username: str) -> dict:
    """Per-user usage so users can see their own quota."""
    init()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with _conn() as c:
        row = c.execute(
            """SELECT COALESCE(SUM(m.tokens_in), 0) AS tin,
                      COALESCE(SUM(m.tokens_out), 0) AS tout,
                      COUNT(m.id) AS msgs
               FROM messages m
               JOIN sessions s ON s.id = m.session_id
               WHERE s.username = ?
                 AND m.role = 'assistant'
                 AND substr(m.created_at, 1, 10) = ?""",
            (username, today),
        ).fetchone()
    tin, tout = row["tin"], row["tout"]
    return {
        "username": username,
        "date": today,
        "tokens_in": tin,
        "tokens_out": tout,
        "messages": row["msgs"],
        "cost_usd": round(estimate_cost(tin, tout), 4),
    }
