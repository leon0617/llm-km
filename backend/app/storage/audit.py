"""Audit log backed by SQLite at /data/audit.db.

Records every meaningful action: login attempts, logout, password changes,
queries, ingest jobs, and all admin write operations. Read-only via
GET /api/admin/audit (admin only).
"""
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any

from app.config import settings

_lock = threading.Lock()
_initialised = False


def _conn() -> sqlite3.Connection:
    db_path = settings.audit_db
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init() -> None:
    global _initialised
    with _lock:
        if _initialised:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    actor TEXT,
                    action TEXT NOT NULL,
                    target TEXT,
                    outcome TEXT NOT NULL DEFAULT 'success',
                    ip TEXT,
                    user_agent TEXT,
                    details TEXT
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts DESC)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action)")
        _initialised = True


def log(
    action: str,
    actor: Optional[str] = None,
    target: Optional[str] = None,
    outcome: str = "success",
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> None:
    """Record an audit entry. Best-effort — exceptions are swallowed.

    `outcome` is "success" | "failure" | "denied".
    """
    init()
    try:
        with _lock, _conn() as c:
            c.execute(
                """INSERT INTO audit (ts, actor, action, target, outcome, ip, user_agent, details)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    datetime.now(timezone.utc).isoformat(),
                    actor,
                    action,
                    target,
                    outcome,
                    ip,
                    user_agent,
                    json.dumps(details, ensure_ascii=False) if details else None,
                ),
            )
    except Exception:
        # Audit must never break the main flow
        pass


def query(
    limit: int = 100,
    offset: int = 0,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    outcome: Optional[str] = None,
    since: Optional[str] = None,
) -> list[dict]:
    init()
    sql = "SELECT * FROM audit WHERE 1=1"
    params: list = []
    if actor:
        sql += " AND actor = ?"; params.append(actor)
    if action:
        sql += " AND action = ?"; params.append(action)
    if outcome:
        sql += " AND outcome = ?"; params.append(outcome)
    if since:
        sql += " AND ts >= ?"; params.append(since)
    sql += " ORDER BY ts DESC LIMIT ? OFFSET ?"
    params.extend([min(limit, 1000), offset])

    with _conn() as c:
        rows = c.execute(sql, params).fetchall()
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        if d.get("details"):
            try:
                d["details"] = json.loads(d["details"])
            except json.JSONDecodeError:
                pass
        out.append(d)
    return out


def count(
    actor: Optional[str] = None,
    action: Optional[str] = None,
    outcome: Optional[str] = None,
    since: Optional[str] = None,
) -> int:
    init()
    sql = "SELECT COUNT(*) AS n FROM audit WHERE 1=1"
    params: list = []
    if actor:
        sql += " AND actor = ?"; params.append(actor)
    if action:
        sql += " AND action = ?"; params.append(action)
    if outcome:
        sql += " AND outcome = ?"; params.append(outcome)
    if since:
        sql += " AND ts >= ?"; params.append(since)
    with _conn() as c:
        return c.execute(sql, params).fetchone()["n"]


def stats_recent(days: int = 7) -> dict:
    """Aggregate stats for dashboard."""
    init()
    from datetime import timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with _conn() as c:
        by_action = {
            r["action"]: r["n"]
            for r in c.execute(
                "SELECT action, COUNT(*) AS n FROM audit WHERE ts >= ? GROUP BY action",
                (since,),
            )
        }
        failures = c.execute(
            "SELECT COUNT(*) AS n FROM audit WHERE ts >= ? AND outcome != 'success'",
            (since,),
        ).fetchone()["n"]
    return {"days": days, "by_action": by_action, "failures": failures}
