"""SQLite-backed wiki metadata index.

Replaces O(N) filesystem scans (every page load → opens all .md files for
backlinks / search) with indexed lookups. Source of truth is still the .md
files on disk; this index is rebuilt from them.

Tables:
  - wiki_pages: name, title, type, frontmatter fields
  - wiki_links: source → target relations (for backlinks)
  - wiki_fts:   FTS5 trigram index for substring search (handles CJK)

Sync strategy:
  - init() rebuilds index from disk on startup if file count differs
  - reindex_page(name) called after write_page / delete_page
  - rebuild() can be called manually (admin endpoint optional)
"""
from __future__ import annotations
import json
import re
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any

import frontmatter

from app.config import settings

PAGE_TYPES = {"source", "entity", "concept", "comparison", "analysis"}
SPECIAL_PAGES = {"index", "log", "questions"}

_LINK_PATTERN = re.compile(r"\[\[([^\[\]\|]+?)(?:\|[^\]]+)?\]\]")

_lock = threading.Lock()
_initialised = False
# Cache the build_tree() result; invalidated on any write.
_tree_cache: dict | None = None


def _db_path() -> Path:
    return settings.wiki_data_dir / "wiki_index.db"


def _conn() -> sqlite3.Connection:
    db = _db_path()
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db), timeout=10.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _schema(c: sqlite3.Connection) -> None:
    c.execute("""
        CREATE TABLE IF NOT EXISTS wiki_pages (
            name TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            type TEXT NOT NULL,
            updated TEXT,
            created TEXT,
            tags_json TEXT,
            sources_json TEXT,
            body_size INTEGER,
            mtime REAL,
            indexed_at TEXT NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_wiki_type ON wiki_pages(type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_wiki_updated ON wiki_pages(updated DESC)")

    c.execute("""
        CREATE TABLE IF NOT EXISTS wiki_links (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            PRIMARY KEY (source, target),
            FOREIGN KEY (source) REFERENCES wiki_pages(name) ON DELETE CASCADE
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_wiki_links_target ON wiki_links(target)")

    # FTS5 with trigram tokenizer handles CJK substring search natively.
    # Stored externally (content='') keeps the FTS table from duplicating data.
    c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
            name UNINDEXED,
            title,
            body,
            tags,
            tokenize='trigram'
        )
    """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _page_type(name: str, fm_type: str | None) -> str:
    if fm_type:
        return fm_type
    for prefix in PAGE_TYPES:
        if name.startswith(f"{prefix}_"):
            return prefix
    if name in SPECIAL_PAGES:
        return "special"
    return "other"


def _extract_links(body: str, page_name: str) -> set[str]:
    """Find all [[wiki link]] targets in body. Strips |alias and skips self-refs."""
    targets: set[str] = set()
    for m in _LINK_PATTERN.finditer(body):
        target = m.group(1).strip()
        if not target or target == page_name:
            continue
        targets.add(target)
    return targets


def _parse_md(path: Path) -> dict | None:
    """Parse a single .md file into the record we store."""
    try:
        post = frontmatter.load(str(path))
    except Exception:
        return None
    name = path.stem
    body = post.content or ""
    fm = post.metadata
    return {
        "name": name,
        "title": str(fm.get("title", name)),
        "type": _page_type(name, fm.get("type")),
        "updated": str(fm.get("updated", "")) if fm.get("updated") else None,
        "created": str(fm.get("created", "")) if fm.get("created") else None,
        "tags": fm.get("tags") if isinstance(fm.get("tags"), list) else [],
        "sources": fm.get("sources") if isinstance(fm.get("sources"), list) else [],
        "body": body,
        "links": list(_extract_links(body, name)),
        "body_size": len(body),
        "mtime": path.stat().st_mtime,
    }


def _upsert(c: sqlite3.Connection, rec: dict) -> None:
    """Insert/replace one page record + its links + its FTS entry."""
    c.execute("DELETE FROM wiki_pages WHERE name = ?", (rec["name"],))
    c.execute("DELETE FROM wiki_links WHERE source = ?", (rec["name"],))
    c.execute("DELETE FROM wiki_fts WHERE name = ?", (rec["name"],))

    c.execute(
        """INSERT INTO wiki_pages
           (name, title, type, updated, created, tags_json, sources_json,
            body_size, mtime, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            rec["name"], rec["title"], rec["type"],
            rec["updated"], rec["created"],
            json.dumps(rec["tags"], ensure_ascii=False),
            json.dumps(rec["sources"], ensure_ascii=False),
            rec["body_size"], rec["mtime"], _now(),
        ),
    )
    for target in rec["links"]:
        c.execute(
            "INSERT OR IGNORE INTO wiki_links (source, target) VALUES (?, ?)",
            (rec["name"], target),
        )
    c.execute(
        "INSERT INTO wiki_fts (name, title, body, tags) VALUES (?, ?, ?, ?)",
        (rec["name"], rec["title"], rec["body"], " ".join(str(t) for t in rec["tags"])),
    )


# ─────────── Public API ───────────

def init() -> None:
    """Set up schema, rebuild if disk and index look out-of-sync."""
    global _initialised
    with _lock:
        if _initialised:
            return
        with _conn() as c:
            _schema(c)
            # Quick sanity check: if # of pages on disk ≠ # in index, rebuild.
            disk_count = len(list(settings.wiki_dir.glob("*.md"))) if settings.wiki_dir.exists() else 0
            idx_count = c.execute("SELECT COUNT(*) FROM wiki_pages").fetchone()[0]
            if disk_count != idx_count:
                _rebuild_locked(c)
        _initialised = True


def _rebuild_locked(c: sqlite3.Connection) -> int:
    """Wipe and rebuild from disk. Caller holds _lock + connection."""
    c.execute("DELETE FROM wiki_pages")
    c.execute("DELETE FROM wiki_links")
    c.execute("DELETE FROM wiki_fts")
    if not settings.wiki_dir.exists():
        return 0
    n = 0
    for md in settings.wiki_dir.glob("*.md"):
        rec = _parse_md(md)
        if rec is None:
            continue
        _upsert(c, rec)
        n += 1
    return n


def rebuild() -> int:
    """Manually force a full rebuild. Returns page count indexed."""
    global _tree_cache
    with _lock, _conn() as c:
        _schema(c)
        n = _rebuild_locked(c)
        _tree_cache = None
    return n


def reindex_page(name: str) -> None:
    """Update one page after write_page / delete_page."""
    global _tree_cache
    path = settings.wiki_dir / f"{name}.md"
    with _lock, _conn() as c:
        _schema(c)
        if path.exists():
            rec = _parse_md(path)
            if rec:
                _upsert(c, rec)
        else:
            c.execute("DELETE FROM wiki_pages WHERE name = ?", (name,))
            c.execute("DELETE FROM wiki_links WHERE source = ?", (name,))
            c.execute("DELETE FROM wiki_fts WHERE name = ?", (name,))
        _tree_cache = None


def list_pages() -> list[dict]:
    init()
    with _conn() as c:
        rows = c.execute(
            "SELECT name, title, type, updated, tags_json FROM wiki_pages ORDER BY name"
        ).fetchall()
    out: list[dict] = []
    for r in rows:
        d = dict(r)
        try:
            d["tags"] = json.loads(d.pop("tags_json") or "[]")
        except json.JSONDecodeError:
            d["tags"] = []
        d["updated"] = d.get("updated") or ""
        out.append(d)
    return out


def build_tree() -> dict:
    """Same shape as wiki_fs.build_tree, but in O(1) cached call."""
    global _tree_cache
    if _tree_cache is not None:
        return _tree_cache
    init()
    pages = list_pages()
    groups: dict[str, list] = {k: [] for k in PAGE_TYPES}
    specials: list = []
    others: list = []
    for p in pages:
        t = p["type"]
        if t in groups:
            groups[t].append(p)
        elif p["name"] in SPECIAL_PAGES:
            specials.append(p)
        else:
            others.append(p)
    type_labels = {
        "source": "來源摘要", "entity": "實體", "concept": "概念",
        "comparison": "比較", "analysis": "分析",
    }
    result = {
        "groups": [
            {"type": k, "label": type_labels[k], "pages": groups[k]}
            for k in PAGE_TYPES
        ],
        "special": specials,
        "other": others,
    }
    _tree_cache = result
    return result


def get_backlinks(name: str) -> list[dict]:
    """All pages that contain `[[name]]`, with their titles."""
    init()
    with _conn() as c:
        rows = c.execute(
            """SELECT p.name, p.title
               FROM wiki_links l
               JOIN wiki_pages p ON p.name = l.source
               WHERE l.target = ?
               ORDER BY p.name""",
            (name,),
        ).fetchall()
    return [{"name": r["name"], "title": r["title"]} for r in rows]


def _like_search(c: sqlite3.Connection, kw: str, limit: int) -> list[dict]:
    """Fallback substring search across title + body. Used when the FTS
    trigram tokenizer can't handle the query (e.g. 1- or 2-char CJK)."""
    like = f"%{kw}%"
    rows = c.execute(
        """SELECT p.name AS name, p.title AS title, p.body_size AS bs
           FROM wiki_pages p
           WHERE p.title LIKE ? COLLATE NOCASE
              OR EXISTS (
                  SELECT 1 FROM wiki_fts
                  WHERE wiki_fts.name = p.name AND wiki_fts.body LIKE ?
              )
           ORDER BY (CASE WHEN p.title LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END), p.name
           LIMIT ?""",
        (like, like, like, min(limit, 200)),
    ).fetchall()
    # Build snippet from body
    out: list[dict] = []
    for r in rows:
        # fetch body snippet
        body_row = c.execute(
            "SELECT body FROM wiki_fts WHERE name = ?", (r["name"],),
        ).fetchone()
        snip = ""
        if body_row and body_row["body"]:
            body = body_row["body"]
            idx = body.lower().find(kw.lower())
            if idx >= 0:
                start = max(0, idx - 30)
                end = min(len(body), idx + len(kw) + 60)
                snip = body[start:end].replace("\n", " ").strip()
        out.append({"name": r["name"], "title": r["title"], "snippet": snip or r["title"]})
    return out


def search(keyword: str, limit: int = 50) -> list[dict]:
    """Full-text search. FTS5 trigram for ≥3-char queries; LIKE fallback
    for shorter queries (so 1-2 char CJK still works)."""
    init()
    if not keyword or not keyword.strip():
        return []
    kw = keyword.strip()

    with _conn() as c:
        # Trigram FTS requires ≥3 characters in the query to produce a token.
        # For shorter queries, go straight to LIKE.
        if len(kw) < 3:
            return _like_search(c, kw, limit)

        fts_query = f'"{kw.replace(chr(34), "")}"'
        try:
            rows = c.execute(
                """SELECT fts.name AS name, p.title AS title,
                          snippet(wiki_fts, 2, '<<<', '>>>', '…', 12) AS snip
                   FROM wiki_fts fts
                   JOIN wiki_pages p ON p.name = fts.name
                   WHERE wiki_fts MATCH ?
                   ORDER BY bm25(wiki_fts)
                   LIMIT ?""",
                (fts_query, min(limit, 200)),
            ).fetchall()
        except sqlite3.OperationalError:
            return _like_search(c, kw, limit)

        if not rows:
            # FTS may miss when the phrase isn't a clean trigram match;
            # fall back to LIKE before giving up.
            return _like_search(c, kw, limit)

    out: list[dict] = []
    for r in rows:
        d = dict(r)
        d["snippet"] = (d.pop("snip", "") or "").replace("<<<", "").replace(">>>", "")
        out.append(d)
    return out


def stats() -> dict:
    """Diagnostic: index size & freshness."""
    init()
    with _conn() as c:
        pages = c.execute("SELECT COUNT(*) FROM wiki_pages").fetchone()[0]
        links = c.execute("SELECT COUNT(*) FROM wiki_links").fetchone()[0]
        fts = c.execute("SELECT COUNT(*) FROM wiki_fts").fetchone()[0]
        last = c.execute("SELECT MAX(indexed_at) FROM wiki_pages").fetchone()[0]
    return {
        "pages": pages,
        "links": links,
        "fts_rows": fts,
        "last_indexed": last,
        "db_size_bytes": _db_path().stat().st_size if _db_path().exists() else 0,
    }
