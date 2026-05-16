"""OpenAI provider (GPT-4 / GPT-4o family).

Translates the universal message + tool format to OpenAI's chat.completions
API, including streaming of text and tool_calls.
"""
from __future__ import annotations
import asyncio
import json
import logging
from typing import Any, AsyncIterator, Optional

from app.llm.providers.base import (
    LLMProvider, TextDelta, ToolCall, FinalResponse,
    UniversalMessage, StreamBridge, signal_done,
)

log = logging.getLogger(__name__)


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str = ""):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url
        try:
            from openai import OpenAI
        except ImportError as e:
            raise RuntimeError("openai SDK 未安裝") from e
        self._client = OpenAI(
            api_key=api_key,
            **({"base_url": base_url} if base_url else {}),
        )

    def health_check(self) -> bool:
        return bool(self.api_key and self.model)

    @staticmethod
    def _translate_tools(tools: list[dict]) -> list[dict]:
        """Convert our tool schemas (Anthropic-shaped) to OpenAI function format."""
        out: list[dict] = []
        for t in tools or []:
            out.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
                },
            })
        return out

    @staticmethod
    def _to_openai_messages(system: str, messages: list[UniversalMessage]) -> list[dict]:
        out: list[dict] = [{"role": "system", "content": system}]
        for m in messages:
            role = m["role"]
            if "raw" in m:
                # Previous assistant turn produced by this provider — already in OpenAI shape
                out.append(m["raw"])
                continue
            if "tool_results" in m:
                # OpenAI: one tool result = one separate message with role="tool"
                for r in m["tool_results"]:
                    out.append({
                        "role": "tool",
                        "tool_call_id": r["id"],
                        "content": r["content"],
                    })
                continue
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
        oai_msgs = self._to_openai_messages(system, messages)
        oai_tools = self._translate_tools(tools or [])

        def worker():
            try:
                kwargs: dict[str, Any] = {
                    "model": model,
                    "messages": oai_msgs,
                    "max_tokens": max_tokens,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                }
                if oai_tools:
                    kwargs["tools"] = oai_tools

                # Accumulated state across stream chunks
                full_text = ""
                # Map index → partial tool call data
                tool_partials: dict[int, dict] = {}
                stop_reason = "other"
                tokens_in = 0
                tokens_out = 0

                for chunk in client.chat.completions.create(**kwargs):
                    # usage arrives in the last chunk (stream_options=include_usage)
                    if getattr(chunk, "usage", None):
                        tokens_in = getattr(chunk.usage, "prompt_tokens", 0) or 0
                        tokens_out = getattr(chunk.usage, "completion_tokens", 0) or 0

                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    delta = choice.delta

                    if delta.content:
                        full_text += delta.content
                        bridge.push(TextDelta(delta.content))

                    # Tool call deltas
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = tc_delta.index
                            part = tool_partials.setdefault(idx, {"id": "", "name": "", "args": ""})
                            if tc_delta.id:
                                part["id"] = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    part["name"] = tc_delta.function.name
                                if tc_delta.function.arguments:
                                    part["args"] += tc_delta.function.arguments

                    if choice.finish_reason:
                        # Translate OpenAI finish_reason to our universal vocabulary
                        fr = choice.finish_reason
                        stop_reason = {
                            "stop": "end_turn",
                            "tool_calls": "tool_use",
                            "length": "max_tokens",
                            "content_filter": "other",
                        }.get(fr, "other")

                # Compose tool calls
                tool_calls: list[ToolCall] = []
                for idx in sorted(tool_partials.keys()):
                    p = tool_partials[idx]
                    try:
                        args = json.loads(p["args"]) if p["args"] else {}
                    except json.JSONDecodeError:
                        args = {"_raw": p["args"]}
                    tool_calls.append(ToolCall(id=p["id"], name=p["name"], input=args))

                # Build the raw assistant message to feed back on next turn
                raw_assistant: dict[str, Any] = {"role": "assistant", "content": full_text or None}
                if tool_calls:
                    raw_assistant["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.name, "arguments": json.dumps(tc.input, ensure_ascii=False)},
                        }
                        for tc in tool_calls
                    ]

                bridge.push(FinalResponse(
                    stop_reason=stop_reason,
                    text=full_text,
                    tool_calls=tool_calls,
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    raw_assistant_message=raw_assistant,
                ))
                signal_done(bridge)
            except BaseException as e:
                log.exception("OpenAI stream worker failed")
                signal_done(bridge, e)

        task = asyncio.get_running_loop().run_in_executor(None, worker)
        try:
            async for item in bridge.drain():
                yield item
        finally:
            await task
