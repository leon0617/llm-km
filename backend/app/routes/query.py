import json
import asyncio
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.auth.deps import get_current_user

from app.llm import prompts, tools
from app.llm.client import stream as llm_stream
from app.llm.providers.base import TextDelta, FinalResponse, ProviderSelected
from app.llm.auto_tier import resolve_tier
from app.config import settings
from app.storage import wiki_fs
from app.storage import audit
from app.storage import sessions as session_store

router = APIRouter(prefix="/query", tags=["query"])

# Safety caps for the agentic loop
MAX_TURNS = 12
MAX_TOOL_CALLS = 24
HISTORY_TURN_LIMIT = 10


class QueryRequest(BaseModel):
    question: str
    session_id: Optional[str] = None


def _build_history_messages(session_id: str) -> list[dict]:
    history = session_store.list_messages(session_id)
    msgs: list[dict] = []
    turns = history[-(HISTORY_TURN_LIMIT * 2):]
    for m in turns:
        if m["role"] not in ("user", "assistant"):
            continue
        if not m["text"].strip():
            continue
        msgs.append({"role": m["role"], "content": m["text"]})
    return msgs


def _auto_title(question: str) -> str:
    title = question.strip().replace("\n", " ")
    if len(title) > 36:
        title = title[:36] + "…"
    return title


async def _stream_query(
    question: str,
    session_id: str,
    actor: str,
    ip: str | None = None,
    ua: str | None = None,
):
    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    pages_read_for_audit: list[str] = []
    error_for_audit: str | None = None
    assistant_text_full = ""
    total_tokens_in = 0
    total_tokens_out = 0
    tool_events_for_session: list[dict] = []
    provider_name = ""
    chosen_tier = ""

    try:
        yield sse("session", {"id": session_id})

        index_page = await wiki_fs.read_page("index")
        index_content = index_page["body_markdown"] if index_page else ""

        history = _build_history_messages(session_id)
        is_first_turn = len(history) == 0

        # Pick tier based on query characteristics + history depth
        chosen_tier = resolve_tier(settings.route_query, question, len(history))

        if is_first_turn:
            messages: list[dict[str, Any]] = [{
                "role": "user",
                "content": f"wiki/index.md 內容供參考：\n{index_content}\n\n---\n\n問題：{question}"
            }]
        else:
            messages = history + [{"role": "user", "content": question}]

        pages_read: list[str] = []
        tool_calls_count = 0
        pinned_provider: str | None = None  # set after turn 1 — raw_assistant_message
                                              # is provider-specific, so cross-provider
                                              # continuation corrupts the conversation.

        for turn in range(MAX_TURNS):
            final: FinalResponse | None = None
            async for event in llm_stream(
                system=prompts.QUERY_SYSTEM,
                messages=messages,
                tools=tools.QUERY_TOOLS,
                max_tokens=4096,
                actor=actor,
                tier=chosen_tier,
                force_provider=pinned_provider,
            ):
                if isinstance(event, ProviderSelected):
                    # Always send — on failover the provider changes mid-turn
                    # and the frontend badge should reflect what actually ran.
                    provider_name = event.name
                    chosen_tier = event.tier or chosen_tier
                    yield sse("provider", {"name": provider_name, "tier": chosen_tier})
                elif isinstance(event, TextDelta):
                    assistant_text_full += event.text
                    yield sse("text", {"delta": event.text})
                elif isinstance(event, FinalResponse):
                    final = event
                    break

            if final is None:
                yield sse("error", {"message": "串流意外結束"})
                return

            total_tokens_in += final.tokens_in
            total_tokens_out += final.tokens_out

            # Pin this provider for subsequent turns — raw_assistant_message below
            # is in this provider's native format; handing it to another provider
            # next turn would corrupt the message history.
            if pinned_provider is None and final.provider_name:
                pinned_provider = final.provider_name

            # Push the assistant turn into history
            messages.append({"role": "assistant", "raw": final.raw_assistant_message})

            if final.stop_reason == "end_turn":
                break
            if final.stop_reason != "tool_use":
                break

            # Execute tool calls
            tool_results = []
            for tc in final.tool_calls:
                tool_calls_count += 1
                if tool_calls_count > MAX_TOOL_CALLS:
                    yield sse("error", {"message": f"超過工具呼叫上限（{MAX_TOOL_CALLS}）"})
                    return

                if tc.name == "read_page":
                    page_name = tc.input.get("name", "")
                    pages_read.append(page_name)
                    ev = {"tool": "read_page", "page": page_name}
                elif tc.name == "search_pages":
                    ev = {"tool": "search_pages", "keyword": tc.input.get("keyword", "")}
                elif tc.name == "list_pages":
                    ev = {"tool": "list_pages"}
                else:
                    ev = {"tool": tc.name}
                tool_events_for_session.append(ev)
                yield sse("tool_use", ev)

                result_text = await tools.execute_tool(tc.name, tc.input)
                tool_results.append({"id": tc.id, "name": tc.name, "content": result_text})

            messages.append({"role": "user", "tool_results": tool_results})
        else:
            yield sse("error", {"message": f"超過回合上限（{MAX_TURNS}）"})
            return

        pages_read_for_audit[:] = pages_read

        from app.storage.sessions import estimate_cost
        cost = estimate_cost(total_tokens_in, total_tokens_out)
        yield sse("usage", {
            "tokens_in": total_tokens_in,
            "tokens_out": total_tokens_out,
            "cost_usd": round(cost, 6),
            "provider": provider_name,
            "tier": chosen_tier,
        })
        yield sse("citations", {"pages": pages_read})
        yield sse("done", {})

    except Exception as e:
        error_for_audit = f"{type(e).__name__}: {e}"
        yield sse("error", {"message": error_for_audit})
    finally:
        try:
            session_store.add_message(
                session_id, "user", question[:8000], tool_events=None, citations=None,
            )
            session_store.add_message(
                session_id, "assistant", assistant_text_full,
                tool_events=tool_events_for_session or None,
                citations=pages_read_for_audit or None,
                tokens_in=total_tokens_in, tokens_out=total_tokens_out,
            )
            existing = session_store.get_session(session_id, actor)
            if existing and not existing.get("title"):
                session_store.update_session_title(session_id, _auto_title(question))
        except Exception:
            pass

        audit.log(
            "query.ask",
            actor=actor,
            outcome="failure" if error_for_audit else "success",
            ip=ip, user_agent=ua,
            details={
                "question": (question or "")[:200],
                "pages_read": pages_read_for_audit,
                "tokens_in": total_tokens_in,
                "tokens_out": total_tokens_out,
                "provider": provider_name,
                "tier": chosen_tier,
                "session_id": session_id,
                "error": error_for_audit,
            },
        )


def _meta(request: Request) -> tuple[str, str]:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "")
    if "," in ip:
        ip = ip.split(",")[0].strip()
    return ip, request.headers.get("user-agent", "")


@router.post("")
async def query(req: QueryRequest, request: Request, current: dict = Depends(get_current_user)):
    ip, ua = _meta(request)

    session_id = req.session_id
    if session_id:
        existing = session_store.get_session(session_id, current["username"])
        if existing is None:
            raise HTTPException(status_code=404, detail="對話不存在或不屬於你")
    else:
        session_id = session_store.create_session(current["username"])

    return StreamingResponse(
        _stream_query(req.question, session_id, current["username"], ip, ua),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────── Sessions API ───────────

@router.get("/sessions")
async def list_my_sessions(current: dict = Depends(get_current_user)):
    return {"sessions": session_store.list_sessions(current["username"])}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, current: dict = Depends(get_current_user)):
    s = session_store.get_session(session_id, current["username"])
    if not s:
        raise HTTPException(status_code=404, detail="對話不存在")
    s["messages"] = session_store.list_messages(session_id)
    return s


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request,
                         current: dict = Depends(get_current_user)):
    ip, ua = _meta(request)
    ok = session_store.delete_session(session_id, current["username"])
    if not ok:
        raise HTTPException(status_code=404, detail="對話不存在")
    audit.log("query.session_delete", actor=current["username"], target=session_id,
              ip=ip, user_agent=ua)
    return {"ok": True}


@router.get("/usage/today")
async def my_usage_today(current: dict = Depends(get_current_user)):
    return session_store.user_usage_today(current["username"])
