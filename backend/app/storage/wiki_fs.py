"""Wiki page storage.

Source of truth = .md files on disk. SQLite index in wiki_index.py is kept in
sync via reindex_page() on every write/delete, and rebuilt at startup if it
looks stale.
"""
from pathlib import Path
from typing import Optional
import frontmatter
import aiofiles

from app.config import settings
from app.storage import wiki_index

PAGE_TYPES = {
    "source": "來源摘要",
    "entity": "實體",
    "concept": "概念",
    "comparison": "比較",
    "analysis": "分析",
}
SPECIAL_PAGES = {"index", "log", "questions"}


def _page_type(name: str) -> str:
    for prefix in PAGE_TYPES:
        if name.startswith(f"{prefix}_"):
            return prefix
    if name in SPECIAL_PAGES:
        return "special"
    return "other"


def list_pages() -> list[dict]:
    """O(1) — served from SQLite index."""
    return wiki_index.list_pages()


def build_tree() -> dict:
    """O(1) — served from SQLite index (with in-memory tree cache)."""
    return wiki_index.build_tree()


def _safe_page_path(name: str) -> Optional[Path]:
    """Resolve a page name to an absolute path inside wiki_dir, or None if invalid."""
    if not name or "/" in name or "\\" in name or name.startswith(".") or "\x00" in name:
        return None
    wiki_dir = settings.wiki_dir.resolve()
    candidate = (wiki_dir / f"{name}.md").resolve()
    try:
        candidate.relative_to(wiki_dir)
    except ValueError:
        return None
    return candidate


async def read_page(name: str) -> Optional[dict]:
    """Read .md from disk for content; pull backlinks from SQL index (fast)."""
    path = _safe_page_path(name)
    if path is None or not path.exists():
        return None

    async with aiofiles.open(path, encoding="utf-8") as f:
        raw = await f.read()

    post = frontmatter.loads(raw)
    body = post.content
    raw_markdown = raw

    # Backlinks from the index (O(log N) instead of O(N) file scan)
    backlinks = wiki_index.get_backlinks(name)

    # raw source files
    raw_files = []
    sources = post.get("sources", [])
    if isinstance(sources, str):
        sources = [sources]
    for src in sources:
        direct = settings.raw_dir / src
        if direct.exists():
            raw_files.append({"name": src, "url": f"/api/raw/{src}"})
        else:
            matches = list(settings.raw_dir.rglob(src))
            if matches:
                rel = matches[0].relative_to(settings.raw_dir)
                raw_files.append({"name": src, "url": f"/api/raw/{rel.as_posix()}"})

    return {
        "name": name,
        "frontmatter": dict(post.metadata),
        "body_markdown": body,
        "raw_markdown": raw_markdown,
        "backlinks": backlinks,
        "raw_files": raw_files,
    }


async def write_page(name: str, content: str) -> None:
    path = _safe_page_path(name)
    if path is None:
        raise ValueError(f"無效的頁面名稱：{name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(path, "w", encoding="utf-8") as f:
        await f.write(content)
    # Keep index in sync
    wiki_index.reindex_page(name)


def delete_page(name: str) -> bool:
    """Delete a wiki page and remove it from the index."""
    path = _safe_page_path(name)
    if path is None or not path.exists():
        return False
    path.unlink()
    wiki_index.reindex_page(name)
    return True


def search_pages(keyword: str) -> list[dict]:
    """FTS5 trigram search via SQL index — fast for CJK substring queries."""
    return wiki_index.search(keyword)
