"""Abstract LLM provider interface.

All providers expose the same agentic loop primitives:
- streaming text deltas
- tool calls (function calling)
- final usage / stop reason

The rest of the app talks to the LLM router in terms of these events and
provider-agnostic messages. Each provider implements its own translation.
"""
from __future__ import annotations
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional


# ─────────── Universal event types ───────────

@dataclass
class ProviderSelected:
    """Emitted by the router as the first event of every stream, so the
    caller knows which provider / tier handled the request without reading
    shared mutable state (which races under concurrency)."""
    name: str
    tier: str


@dataclass
class TextDelta:
    """A chunk of streamed assistant text."""
    text: str


@dataclass
class ToolCall:
    """A single tool/function invocation requested by the model."""
    id: str              # provider-specific tool-use id (used to pair with result)
    name: str            # tool name
    input: dict          # tool arguments


@dataclass
class FinalResponse:
    """Emitted at the end of a turn."""
    stop_reason: str     # "end_turn" | "tool_use" | "max_tokens" | "other"
    text: str            # full concatenated text of this turn
    tool_calls: list[ToolCall] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    raw_assistant_message: Any = None  # provider-specific; passed back to next call
    provider_name: str = ""            # injected by router, not by the provider itself
                                        # callers use this to pin subsequent turns to
                                        # the same provider (raw_assistant_message is
                                        # provider-specific — cross-provider continuation
                                        # corrupts the message history)


# ─────────── Universal message format ───────────
# Used by the rest of the app. Each provider converts to its native format.
#
# A message is one of:
#   {"role": "user",      "content": "..."}                      ← plain text
#   {"role": "assistant", "content": "..."}                      ← plain text (history)
#   {"role": "assistant", "raw": <provider-specific>}            ← previous turn from this provider
#   {"role": "user",      "tool_results": [{"id": ..., "content": "..."}]}
#       ↑ tool results coming back for an assistant tool_use turn

UniversalMessage = dict[str, Any]


# ─────────── Provider base ───────────

class LLMProvider(ABC):
    """Abstract LLM provider. Implementations should be safe to use concurrently."""

    name: str = "base"
    model: str = ""

    @abstractmethod
    async def stream(
        self,
        system: str,
        messages: list[UniversalMessage],
        tools: Optional[list[dict]] = None,
        max_tokens: int = 4096,
    ) -> AsyncIterator[TextDelta | FinalResponse]:
        """Yield TextDelta events as text streams, then exactly one FinalResponse."""
        if False:  # pragma: no cover — for type checkers
            yield  # type: ignore

    @abstractmethod
    def health_check(self) -> bool:
        """Return True if the provider looks usable (api key + model set)."""
        ...


# ─────────── Stream-bridge helper ───────────
# Most provider SDKs are sync. We bridge sync iterators into async generators
# via a queue, the same pattern we use today.

class StreamBridge:
    """Bridge a worker thread that pushes events into an async iterator."""

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def attach_loop(self):
        self._loop = asyncio.get_running_loop()

    def push(self, item: Any):
        if self._loop is None:
            raise RuntimeError("loop not attached")
        asyncio.run_coroutine_threadsafe(self.queue.put(item), self._loop)

    async def drain(self) -> AsyncIterator[Any]:
        while True:
            item = await self.queue.get()
            if isinstance(item, _StreamDone):
                if item.exc:
                    raise item.exc
                return
            yield item


class _StreamDone:
    def __init__(self, exc: Optional[BaseException] = None):
        self.exc = exc


def signal_done(bridge: StreamBridge, exc: Optional[BaseException] = None):
    asyncio.run_coroutine_threadsafe(bridge.queue.put(_StreamDone(exc)), bridge._loop)
