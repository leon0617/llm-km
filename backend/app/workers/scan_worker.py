"""Scan: diff raw/ filenames against wiki/* frontmatter `sources` to find
unprocessed source files (and the reverse: pages referencing missing raws).

Synchronous and fast — no Claude needed.
"""
from __future__ import annotations
from pathlib import Path
import frontmatter

from app.config import settings


_RAW_EXTENSIONS = {".pdf", ".txt", ".md", ".html", ".docx"}


def _all_raw_files() -> list[dict]:
    """Walk raw/ recursively (skipping assets/) and return file metadata."""
    raw_dir = settings.raw_dir
    if not raw_dir.exists():
        return []
    files = []
    for p in raw_dir.rglob("*"):
        if not p.is_file():
            continue
        # Skip generated PNGs and the assets folder used by ingest
        try:
            rel = p.relative_to(raw_dir)
        except ValueError:
            continue
        if rel.parts and rel.parts[0] == "assets":
            continue
        if p.suffix.lower() not in _RAW_EXTENSIONS:
            continue
        files.append({
            "name": p.name,
            "path": str(rel),
            "size": p.stat().st_size,
            "mtime": p.stat().st_mtime,
        })
    return files


def _ingested_sources() -> dict[str, list[str]]:
    """Map source filename -> list of wiki pages that reference it.

    Only treats `sources` entries that look like raw filenames (have a known
    extension) as raw refs. analysis_/comparison_ pages may put wiki page
    names in `sources` to indicate derivation; those are ignored here.
    """
    wiki_dir = settings.wiki_dir
    if not wiki_dir.exists():
        return {}
    mapping: dict[str, list[str]] = {}
    for md in wiki_dir.glob("*.md"):
        try:
            post = frontmatter.load(str(md))
            sources = post.get("sources", []) or []
            if isinstance(sources, str):
                sources = [sources]
            for src in sources:
                src_str = str(src)
                # Skip wiki-page references (no file extension or .md without slash → ambiguous)
                ext = Path(src_str).suffix.lower()
                if ext not in _RAW_EXTENSIONS:
                    continue
                # also skip wiki .md references like "concept_xxx.md" (no real path)
                if ext == ".md" and "/" not in src_str and "_" in Path(src_str).stem:
                    continue
                mapping.setdefault(src_str, []).append(md.stem)
        except Exception:
            continue
    return mapping


def scan() -> dict:
    raw_files = _all_raw_files()
    ingested = _ingested_sources()

    raw_by_name = {f["name"]: f for f in raw_files}
    ingested_names = set(ingested.keys())

    unprocessed = [
        f for f in raw_files
        if f["name"] not in ingested_names
    ]
    orphaned_pages = [
        {"page": page, "missing_source": src}
        for src, pages in ingested.items()
        if src not in raw_by_name
        for page in pages
    ]

    return {
        "summary": {
            "raw_total": len(raw_files),
            "ingested_total": len(ingested_names),
            "unprocessed": len(unprocessed),
            "orphaned_pages": len(orphaned_pages),
        },
        "unprocessed": sorted(unprocessed, key=lambda f: -f["mtime"]),
        "orphaned_pages": orphaned_pages,
        "ingested_sources": [
            {
                "source": src,
                "pages": pages,
                "path": raw_by_name[src]["path"] if src in raw_by_name else None,
                "size": raw_by_name[src]["size"] if src in raw_by_name else None,
            }
            for src, pages in sorted(ingested.items())
        ],
    }
