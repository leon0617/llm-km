"""LLM router: selects a provider per request, enforces per-provider concurrency.

Routing strategies:
- "round-robin": rotate across enabled providers (simple, default)
- "pinned-by-user": same user → same provider (consistent style per user)
- "weighted": pick by weight ratio (e.g. prefer cheaper providers for bulk)

Failover: if the chosen provider raises within the first 2 seconds, the router
retries on the next available provider. Once the stream has produced output we
stop retrying (otherwise the user would see duplicate text).
"""
from __future__ import annotations
import asyncio
import logging
import threading
import time
from typing import AsyncIterator, Optional

from app.config import settings
from app.llm.providers.base import (
    LLMProvider, TextDelta, FinalResponse, ProviderSelected, UniversalMessage,
)

log = logging.getLogger(__name__)

# Failover window: if a provider raises within this many seconds of starting
# its stream (after acquiring the semaphore) AND before producing any output,
# we transparently retry on the next candidate.
FAILOVER_WINDOW_SECONDS = 2.0


class _ProviderSlot:
    """A registered provider + its concurrency semaphore + state."""
    def __init__(self, provider: LLMProvider, max_concurrent: int, weight: int = 1, tier: str = "premium"):
        self.provider = provider
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.max_concurrent = max_concurrent
        self.weight = weight
        self.tier = tier        # "cheap" | "premium"
        self.fail_count = 0


class LLMRouter:
    def __init__(self):
        self._slots: list[_ProviderSlot] = []
        self._lock = threading.Lock()
        self._tier_rr: dict[str, int] = {}      # per-tier round-robin index
        self._user_pins: dict[str, int] = {}    # username → slot index

    def register(self, provider: LLMProvider, max_concurrent: int = 6, weight: int = 1, tier: str = "premium"):
        with self._lock:
            self._slots.append(_ProviderSlot(provider, max_concurrent, weight, tier))

    def providers(self) -> list[_ProviderSlot]:
        return list(self._slots)

    def is_empty(self) -> bool:
        return len(self._slots) == 0

    def pick(self, actor: Optional[str] = None, tier: Optional[str] = None) -> _ProviderSlot:
        """Pick a provider matching the requested tier, then routing strategy.

        If `tier` is specified and no provider matches, fall back to any
        provider (so a misconfigured tier doesn't break the app).
        """
        with self._lock:
            if not self._slots:
                raise RuntimeError("沒有可用的 LLM provider")

            # Filter by tier
            candidates = self._slots
            if tier:
                tier_match = [s for s in self._slots if s.tier == tier]
                if tier_match:
                    candidates = tier_match
                # else: no matching tier → silently fall back to all

            strategy = (settings.llm_routing or "round-robin").lower()

            if strategy == "pinned-by-user" and actor is not None:
                pinned = self._user_pins.get(actor)
                if pinned is not None and pinned < len(self._slots) and self._slots[pinned] in candidates:
                    return self._slots[pinned]
                # Assign least-loaded slot from candidates
                idx_in_all = min(
                    range(len(self._slots)),
                    key=lambda i: (
                        self._slots[i] not in candidates,  # candidates first
                        self._slots[i].max_concurrent - self._slots[i].semaphore._value,  # then least-loaded  # noqa: SLF001
                    ),
                )
                self._user_pins[actor] = idx_in_all
                return self._slots[idx_in_all]

            if strategy == "weighted":
                total_w = sum(s.weight for s in candidates)
                tier_key = tier or "_all"
                rr = self._tier_rr.get(tier_key, 0)
                pick = rr % max(1, total_w)
                self._tier_rr[tier_key] = rr + 1
                cum = 0
                for s in candidates:
                    cum += s.weight
                    if pick < cum:
                        return s
                return candidates[0]

            # default: round-robin within candidates
            tier_key = tier or "_all"
            rr = self._tier_rr.get(tier_key, 0)
            slot = candidates[rr % len(candidates)]
            self._tier_rr[tier_key] = rr + 1
            return slot

    def _find_slot_by_name(self, name: str) -> Optional[_ProviderSlot]:
        with self._lock:
            for s in self._slots:
                if s.provider.name == name:
                    return s
        return None

    def _failover_order(
        self, actor: Optional[str], tier: Optional[str]
    ) -> list[_ProviderSlot]:
        """Primary pick first, then remaining tier-matched providers as backups."""
        primary = self.pick(actor, tier)
        with self._lock:
            if tier:
                others = [s for s in self._slots if s.tier == tier and s is not primary]
                if not others:  # tier had only one slot — fall back to all others
                    others = [s for s in self._slots if s is not primary]
            else:
                others = [s for s in self._slots if s is not primary]
        return [primary] + others

    async def stream(
        self,
        system: str,
        messages: list[UniversalMessage],
        tools: Optional[list[dict]] = None,
        max_tokens: int = 4096,
        actor: Optional[str] = None,
        tier: Optional[str] = None,
        force_provider: Optional[str] = None,
    ) -> AsyncIterator[ProviderSelected | TextDelta | FinalResponse]:
        """Stream through the router.

        The first event is always a ProviderSelected — that's how callers learn
        which provider/tier was chosen, instead of reading shared singleton state.

        Failover: if the chosen provider raises within FAILOVER_WINDOW_SECONDS
        AND before producing any TextDelta / FinalResponse, the router silently
        retries the next candidate. Once output has been produced we propagate
        the error so the caller doesn't see duplicate or interleaved text.

        force_provider: when set (e.g. on multi-turn continuation), use this
        specific provider with NO failover. Required after the first tool-use
        turn because raw_assistant_message is provider-specific — handing a
        Gemini turn to Anthropic corrupts the next call.
        """
        if force_provider:
            slot = self._find_slot_by_name(force_provider)
            if slot is None:
                raise RuntimeError(f"指定 provider 不存在或已下線：{force_provider}")
            candidates: list[_ProviderSlot] = [slot]
        else:
            candidates = self._failover_order(actor, tier)
        last_exc: Optional[Exception] = None

        for slot in candidates:
            yield ProviderSelected(name=slot.provider.name, tier=slot.tier)
            produced_output = False
            started = 0.0  # set after semaphore acquire so queue wait doesn't burn the window
            try:
                async with slot.semaphore:
                    started = time.monotonic()
                    async for event in slot.provider.stream(system, messages, tools, max_tokens):
                        produced_output = True
                        if isinstance(event, FinalResponse):
                            event.provider_name = slot.provider.name
                        yield event
                slot.fail_count = 0
                return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                slot.fail_count += 1
                elapsed = (time.monotonic() - started) if started else 0.0
                last_exc = e
                if produced_output:
                    log.exception(
                        "Provider %s failed mid-stream (%.2fs); not retrying",
                        slot.provider.name, elapsed,
                    )
                    raise
                if elapsed > FAILOVER_WINDOW_SECONDS:
                    log.exception(
                        "Provider %s failed after %.2fs (> %.1fs window); not retrying",
                        slot.provider.name, elapsed, FAILOVER_WINDOW_SECONDS,
                    )
                    raise
                log.warning(
                    "Provider %s failed in %.2fs before producing output: %s — failing over",
                    slot.provider.name, elapsed, e,
                )
                # try next candidate

        # All candidates exhausted within the failover window
        if last_exc:
            raise last_exc
        raise RuntimeError("沒有可用的 LLM provider")

    def queue_state(self) -> list[dict]:
        out: list[dict] = []
        for s in self._slots:
            in_use = s.max_concurrent - s.semaphore._value  # noqa: SLF001
            waiting = len(s.semaphore._waiters) if s.semaphore._waiters else 0  # noqa: SLF001
            out.append({
                "name": s.provider.name,
                "model": s.provider.model,
                "tier": s.tier,
                "weight": s.weight,
                "max_concurrent": s.max_concurrent,
                "in_use": max(0, in_use),
                "waiting": waiting,
                "fail_count": s.fail_count,
                "healthy": s.provider.health_check(),
            })
        return out


# ─────────── Singleton ───────────

_router: Optional[LLMRouter] = None


def get_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = _build_from_settings()
    return _router


def reset_router():
    """For tests / config reload."""
    global _router
    _router = None


def _build_from_settings() -> LLMRouter:
    """Construct the router from the current Settings."""
    r = LLMRouter()
    s = settings

    if s.anthropic_enabled and s.anthropic_api_key:
        from app.llm.providers.anthropic_provider import AnthropicProvider
        try:
            r.register(
                AnthropicProvider(s.anthropic_api_key, s.anthropic_model, s.anthropic_base_url),
                max_concurrent=s.anthropic_max_concurrent,
                weight=s.anthropic_weight,
                tier=s.anthropic_tier,
            )
        except Exception as e:
            log.warning("Anthropic provider init failed: %s", e)

    if s.openai_enabled and s.openai_api_key:
        from app.llm.providers.openai_provider import OpenAIProvider
        try:
            r.register(
                OpenAIProvider(s.openai_api_key, s.openai_model, s.openai_base_url),
                max_concurrent=s.openai_max_concurrent,
                weight=s.openai_weight,
                tier=s.openai_tier,
            )
        except Exception as e:
            log.warning("OpenAI provider init failed: %s", e)

    if s.gemini_enabled and s.gemini_api_key:
        from app.llm.providers.gemini_provider import GeminiProvider
        try:
            r.register(
                GeminiProvider(s.gemini_api_key, s.gemini_model),
                max_concurrent=s.gemini_max_concurrent,
                weight=s.gemini_weight,
                tier=s.gemini_tier,
            )
        except Exception as e:
            log.warning("Gemini provider init failed: %s", e)

    return r
