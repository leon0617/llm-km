"""Anthropic Claude provider."""
from __future__ import annotations
import asyncio
import logging
from typing import Any, AsyncIterator, Optional

import anthropic

from app.llm.providers.base import (
    LLMProvider, TextDelta, ToolCall, FinalResponse,
    UniversalMessage, StreamBridge, signal_done,
)

log = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str = ""):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        self._client = anthropic.Anthropic(
            api_key=api_key,
            **({"base_url": base_url} if base_url else {}),
        )

    def health_check(self) -> bool:
        return bool(self.api_key and self.model)

    @staticmethod
    def _to_anthropic_messages(messages: list[UniversalMessage]) -> list[dict]:
        """Translate universal messages → Anthropic format.

        Anthropic uses:
          - {"role": "user"|"assistant", "content": "str" | [content_blocks]}
          - tool_use blocks live inside an assistant message
          - tool_result blocks live inside a user message
        """
        out: list[dict] = []
        for m in messages:
            role = m["role"]
            if "raw" in m:
                # Previous Anthropic turn — pass through verbatim
                out.append({"role": role, "content": m["raw"]})
                continue
            if "tool_results" in m:
                # Convert tool_results into Anthropic tool_result blocks
                out.append({
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": r["id"], "content": r["content"]}
                        for r in m["tool_results"]
                    ],
                })
                continue
            # Plain text
            out.append({"role": role, "content": m.get("content", "")})
        return out

    async def stream(
        self,
        system: str,
        messages: list[UniversalMessage],
        tools: Optional[list[dict]] = None,
        max_tokens: int = 4096,
    ) -> AsyncIterator[TextDelta | FinalResponse]:
        bridge = StreamBridge()
        bridge.attach_loop()
        client = self._client
        model = self.model
        ant_msgs = self._to_anthropic_messages(messages)
        sdk_tools = tools or []

        def worker():
            try:
                with client.messages.stream(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    tools=sdk_tools,
                    messages=ant_msgs,
                ) as stream:
                    for event in stream:
                        if event.type == "content_block_delta" and getattr(event.delta, "type", None) == "text_delta":
                            bridge.push(TextDelta(event.delta.text))
                    final = stream.get_final_message()
                    full_text = ""
                    tool_calls: list[ToolCall] = []
                    for block in final.content:
                        if getattr(block, "type", None) == "text":
                            full_text += getattr(block, "text", "") or ""
                        elif getattr(block, "type", None) == "tool_use":
                            tool_calls.append(ToolCall(
                                id=block.id, name=block.name, input=dict(block.input or {}),
                            ))
                    bridge.push(FinalResponse(
                        stop_reason=final.stop_reason or "other",
                        text=full_text,
                        tool_calls=tool_calls,
                        tokens_in=getattr(final.usage, "input_tokens", 0) or 0,
                        tokens_out=getattr(final.usage, "output_tokens", 0) or 0,
                        raw_assistant_message=final.content,
                    ))
                signal_done(bridge)
            except BaseException as e:
                log.exception("Anthropic stream worker failed")
                signal_done(bridge, e)

        task = asyncio.get_running_loop().run_in_executor(None, worker)
        try:
            async for item in bridge.drain():
                yield item
        finally:
            await task
