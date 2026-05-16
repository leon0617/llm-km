"""LLM client facade. Routes through the multi-provider router."""
from __future__ import annotations
from typing import AsyncIterator, Optional

from app.llm.router import get_router
from app.llm.providers.base import TextDelta, FinalResponse, ProviderSelected, UniversalMessage


def get_queue_state() -> dict:
    r = get_router()
    slots = r.queue_state()
    total_max = sum(s["max_concurrent"] for s in slots)
    total_in_use = sum(s["in_use"] for s in slots)
    total_waiting = sum(s["waiting"] for s in slots)
    return {
        "providers": slots,
        "total_max_concurrent": total_max,
        "total_in_use": total_in_use,
        "total_waiting": total_waiting,
        "routing": _routing_label(),
    }


def _routing_label() -> str:
    from app.config import settings
    return settings.llm_routing


async def stream(
    system: str,
    messages: list[UniversalMessage],
    tools: Optional[list[dict]] = None,
    max_tokens: int = 4096,
    actor: Optional[str] = None,
    tier: Optional[str] = None,
    force_provider: Optional[str] = None,
) -> AsyncIterator[ProviderSelected | TextDelta | FinalResponse]:
    """Stream events from a router-selected provider. Acquires a slot first.

    The first event of every stream is a ProviderSelected — read it to find
    out which provider / tier handled the request.

    Pass `force_provider=<name>` on multi-turn continuation to pin the same
    provider and disable failover (raw_assistant_message is provider-specific).
    """
    async for event in get_router().stream(
        system, messages, tools, max_tokens, actor, tier, force_provider
    ):
        yield event


async def complete(
    system: str,
    messages: list[UniversalMessage],
    tools: Optional[list[dict]] = None,
    max_tokens: int = 8192,
    actor: Optional[str] = None,
    tier: Optional[str] = None,
    force_provider: Optional[str] = None,
) -> FinalResponse:
    """Convenience: consume the whole stream and return only the FinalResponse.

    Read `final.provider_name` to pin subsequent turns via force_provider.
    """
    final: Optional[FinalResponse] = None
    async for event in stream(system, messages, tools, max_tokens, actor, tier, force_provider):
        if isinstance(event, FinalResponse):
            final = event
        # ProviderSelected / TextDelta events are ignored by complete()
    if final is None:
        raise RuntimeError("LLM 串流未產生最終回應")
    return final
