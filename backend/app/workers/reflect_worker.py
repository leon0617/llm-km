"""Reflect: cross-source synthesis. Reads N wiki pages and produces a new
analysis_*.md or comparison_*.md page summarising patterns/contradictions/insights.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone

from app.config import settings
from app.llm import prompts, tools
from app.llm.client import complete as llm_complete
from app.storage import jobs as job_store
from app.storage import audit


async def run_reflect(
    job_id: str,
    actor: str,
    topic: str,
    source_pages: list[str],
    target_type: str,  # "analysis" or "comparison"
    target_name: str | None,
) -> None:
    def log(msg: str) -> None:
        job_store.append_log(job_id, msg)

    try:
        job_store.update_job(job_id, status="running", step="準備中", progress=0.05)
        log(f"主題：{topic}")
        log(f"來源頁面（{len(source_pages)}）：{', '.join(source_pages)}")
        log(f"目標類型：{target_type}")

        suggested_name = target_name or f"{target_type}_{topic.replace(' ', '_')[:40]}"
        today = datetime.now().strftime("%Y-%m-%d")

        user_content = f"""請進行 Reflect 操作，合成新頁面：

**主題**：{topic}
**目標類型**：{target_type}（{'analysis_*' if target_type == 'analysis' else 'comparison_*'}）
**建議檔名**：{suggested_name}
**今日日期**：{today}

請依序讀取以下指定的來源頁面，找出跨案例的模式 / 對比 / 隱性洞察，
然後寫入新的 {target_type}_*.md 頁面：

{chr(10).join(f'- {p}' for p in source_pages)}

完成後呼叫 update_index 把新頁面加進索引、append_log 留痕。"""

        messages = [{"role": "user", "content": user_content}]

        MAX_TURNS = 15
        MAX_TOOL_CALLS = 40
        tool_calls = 0
        pages_created: list[str] = []
        pinned_provider: str | None = None  # pin after turn 1 (provider-specific raw msg)

        job_store.update_job(job_id, step="Claude 分析中", progress=0.20)

        for turn in range(MAX_TURNS):
            final = await llm_complete(
                system=prompts.REFLECT_SYSTEM,
                messages=messages,
                tools=tools.INGEST_TOOLS,
                max_tokens=8192,
                tier=settings.route_reflect,
                force_provider=pinned_provider,
            )
            if pinned_provider is None and final.provider_name:
                pinned_provider = final.provider_name
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
                if tc.name == "write_page":
                    pname = tc.input.get("name") or "<unknown>"
                    pages_created.append(pname)
                    job_store.update_job(job_id, step=f"寫入 {pname}.md", progress=0.70)
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
            output={"pages_created": pages_created, "topic": topic, "source_pages": source_pages},
        )
        log(f"完成。建立頁面：{pages_created}")

        audit.log("reflect.complete", actor=actor, target=topic,
                  details={"job_id": job_id, "pages_created": pages_created,
                           "source_pages": source_pages, "target_type": target_type})

    except Exception as e:
        job_store.update_job(
            job_id,
            status="failed",
            step="失敗",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error=str(e),
        )
        job_store.append_log(job_id, f"ERROR: {e}")
        audit.log("reflect.fail", actor=actor, target=topic, outcome="failure",
                  details={"job_id": job_id, "error": str(e)})
        raise
