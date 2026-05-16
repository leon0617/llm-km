"""Lint: read-only quality check across the wiki. Produces a Markdown report
in the job output. Does NOT modify any wiki page (uses LINT_TOOLS, which lacks
write_page / update_index)."""
from __future__ import annotations
import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path

import frontmatter

from app.config import settings
from app.llm import prompts, tools
from app.llm.client import complete as llm_complete
from app.storage import jobs as job_store
from app.storage import audit
from app.storage import wiki_fs


def _static_lint() -> dict:
    """Cheap static checks done in Python before invoking Claude.

    Provides Claude with a first-pass machine-checkable summary so it can focus
    on semantic checks instead of rediscovering broken links.
    """
    wiki_dir = settings.wiki_dir
    pages: dict[str, dict] = {}  # name -> {meta, body, links}
    if not wiki_dir.exists():
        return {"pages": [], "broken_links": [], "missing_frontmatter": [], "all_links": {}}

    link_pat = re.compile(r"\[\[([^\[\]\|]+?)(?:\|[^\]]+)?\]\]")

    for md in wiki_dir.glob("*.md"):
        try:
            post = frontmatter.load(str(md))
        except Exception:
            pages[md.stem] = {"meta": {}, "body": "", "links": []}
            continue
        body = post.content
        links = list({m.group(1).strip() for m in link_pat.finditer(body)})
        pages[md.stem] = {"meta": dict(post.metadata), "body": body, "links": links}

    page_names = set(pages.keys())
    broken_links = []
    missing_fm = []
    untyped = []

    REQUIRED_FM = ("title", "type", "created", "updated")
    for name, p in pages.items():
        meta = p["meta"]
        # broken links
        for link in p["links"]:
            if link not in page_names:
                broken_links.append({"page": name, "broken_link": link})
        # frontmatter completeness
        missing = [k for k in REQUIRED_FM if not meta.get(k)]
        if name not in {"index", "log", "questions"} and missing:
            missing_fm.append({"page": name, "missing": missing})
        # naming vs type mismatch
        if "_" in name and meta.get("type"):
            prefix = name.split("_", 1)[0]
            if prefix in {"source", "entity", "concept", "comparison", "analysis"} and meta["type"] != prefix:
                untyped.append({"page": name, "name_prefix": prefix, "frontmatter_type": meta["type"]})

    # orphan check: pages nobody links to (excluding special pages)
    referenced = set()
    for p in pages.values():
        referenced.update(p["links"])
    orphans = [
        name for name in page_names
        if name not in referenced and name not in {"index", "log", "questions"}
    ]

    return {
        "page_count": len(pages),
        "broken_links": broken_links,
        "missing_frontmatter": missing_fm,
        "type_mismatches": untyped,
        "orphans": orphans,
    }


async def run_lint(job_id: str, actor: str, scope: str = "all") -> None:
    def log(msg: str) -> None:
        job_store.append_log(job_id, msg)

    try:
        job_store.update_job(job_id, status="running", step="靜態檢查", progress=0.10)
        log("執行靜態檢查（broken links / frontmatter / 命名）")

        static = _static_lint()
        log(f"靜態檢查完成：頁數={static['page_count']}, 壞連結={len(static['broken_links'])}, "
            f"缺 frontmatter={len(static['missing_frontmatter'])}, 類型不符={len(static['type_mismatches'])}, "
            f"孤兒={len(static['orphans'])}")

        # Hand the static report to Claude, ask it to add semantic checks
        user_content = f"""請對以下 wiki 進行 Lint 檢查並產出報告。

我已先做了靜態檢查，結果如下（你不需要重做）：

```json
{static}
```

請根據此結果：
1. 抽樣讀 3~5 個頁面（用 read_page），檢查內容矛盾、術語不一致、過時資訊
2. 評估靜態檢查找出的問題嚴重程度（哪些必須立刻修、哪些可暫緩）
3. 產出結構化的 Lint 報告（依 LINT_SYSTEM 指定的格式）
4. 用 append_log 把這次 lint 操作的摘要記錄到 wiki/log.md

**只回報，不要修改任何頁面。**"""

        messages = [{"role": "user", "content": user_content}]

        MAX_TURNS = 12
        MAX_TOOL_CALLS = 30
        tool_calls = 0
        report_text = ""
        pinned_provider: str | None = None  # pin after turn 1 (provider-specific raw msg)

        job_store.update_job(job_id, step="Claude 語意檢查", progress=0.30)

        for turn in range(MAX_TURNS):
            final = await llm_complete(
                system=prompts.LINT_SYSTEM,
                messages=messages,
                tools=tools.LINT_TOOLS,
                max_tokens=8192,
                tier=settings.route_lint,
                force_provider=pinned_provider,
            )
            if pinned_provider is None and final.provider_name:
                pinned_provider = final.provider_name
            if final.text:
                report_text += final.text + "\n"
            messages.append({"role": "assistant", "raw": final.raw_assistant_message})

            if final.stop_reason == "end_turn":
                break
            if final.stop_reason != "tool_use":
                break

            tool_results = []
            for tc in final.tool_calls:
                tool_calls += 1
                if tool_calls > MAX_TOOL_CALLS:
                    raise RuntimeError(f"超過工具呼叫上限（{MAX_TOOL_CALLS}）")

                log(f"工具呼叫：{tc.name}({list(tc.input.keys())})")
                result = await tools.execute_tool(tc.name, tc.input)
                tool_results.append({"id": tc.id, "name": tc.name, "content": result})

            messages.append({"role": "user", "tool_results": tool_results})
        else:
            raise RuntimeError(f"超過回合上限（{MAX_TURNS}）")

        job_store.update_job(
            job_id,
            status="completed",
            step="完成",
            progress=1.0,
            completed_at=datetime.now(timezone.utc).isoformat(),
            output={
                "static": static,
                "report_markdown": report_text.strip(),
            },
        )
        log(f"完成。報告長度：{len(report_text)} 字")

        audit.log("lint.complete", actor=actor, target=scope,
                  details={"job_id": job_id, "page_count": static["page_count"],
                           "issues": {
                               "broken_links": len(static["broken_links"]),
                               "missing_fm": len(static["missing_frontmatter"]),
                               "orphans": len(static["orphans"]),
                           }})

    except Exception as e:
        job_store.update_job(
            job_id,
            status="failed",
            step="失敗",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error=str(e),
        )
        job_store.append_log(job_id, f"ERROR: {e}")
        audit.log("lint.fail", actor=actor, target=scope, outcome="failure",
                  details={"job_id": job_id, "error": str(e)})
        raise
