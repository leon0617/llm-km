"""Google Gemini provider via google-genai SDK.

Gemini uses a different concept set:
- `contents` is a list of {role: user|model, parts: [...]}
- Tool calls appear as parts with `function_call`
- Tool results are parts with `function_response`
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


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        try:
            from google import genai
        except ImportError as e:
            raise RuntimeError("google-genai SDK 未安裝") from e
        self._client = genai.Client(api_key=api_key)
        self._genai = genai

    def health_check(self) -> bool:
        return bool(self.api_key and self.model)

    @staticmethod
    def _translate_tools(tools: list[dict]) -> Any:
        """Convert tool schemas to Gemini function declarations.

        Gemini expects: `{"function_declarations": [{"name", "description", "parameters"}]}`
        """
        if not tools:
            return None
        decls = []
        for t in tools:
            params = t.get("input_schema", {"type": "object", "properties": {}})
            decls.append({
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": params,
            })
        return [{"function_declarations": decls}]

    @staticmethod
    def _to_gemini_contents(messages: list[UniversalMessage]) -> list[dict]:
        out: list[dict] = []
        for m in messages:
            role = m["role"]
            if "raw" in m:
                out.append(m["raw"])
                continue
            if "tool_results" in m:
                # Gemini puts function_response into a `user` role content with parts
                parts = [
                    {"function_response": {
                        "name": r.get("name") or r["id"],
                        "response": {"content": r["content"]},
                    }}
                    for r in m["tool_results"]
                ]
                out.append({"role": "user", "parts": parts})
                continue
            # Map our roles to Gemini's (assistant → model)
            gemini_role = "model" if role == "assistant" else "user"
            out.append({"role": gemini_role, "parts": [{"text": m.get("content", "")}]})
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
        contents = self._to_gemini_contents(messages)
        gemini_tools = self._translate_tools(tools or [])

        # Gemini groups system message + tools + generation config together
        config: dict[str, Any] = {
            "system_instruction": system,
            "max_output_tokens": max_tokens,
        }
        if gemini_tools:
            config["tools"] = gemini_tools

        def worker():
            try:
                full_text = ""
                tool_calls: list[ToolCall] = []
                tokens_in = 0
                tokens_out = 0
                stop_reason = "other"
                response_parts: list[dict] = []

                stream = client.models.generate_content_stream(
                    model=model,
                    contents=contents,
                    config=config,
                )
                for chunk in stream:
                    # Each chunk may contain a partial text or one or more function calls.
                    if not getattr(chunk, "candidates", None):
                        continue
                    cand = chunk.candidates[0]
                    if cand.content and cand.content.parts:
                        for part in cand.content.parts:
                            # Gemini 3 / flash-preview requires the thought_signature
                            # from each part to be echoed back on the next turn —
                            # without it the next call fails with 400 INVALID_ARGUMENT
                            # "Function call is missing a thought_signature".
                            sig = getattr(part, "thought_signature", None)
                            if getattr(part, "text", None):
                                full_text += part.text
                                bridge.push(TextDelta(part.text))
                                pd: dict[str, Any] = {"text": part.text}
                                if sig is not None:
                                    pd["thought_signature"] = sig
                                response_parts.append(pd)
                            elif getattr(part, "function_call", None):
                                fc = part.function_call
                                args = dict(fc.args) if fc.args else {}
                                tool_calls.append(ToolCall(
                                    id=fc.name,  # Gemini lacks a per-call id; use name
                                    name=fc.name,
                                    input=args,
                                ))
                                pd = {"function_call": {"name": fc.name, "args": args}}
                                if sig is not None:
                                    pd["thought_signature"] = sig
                                response_parts.append(pd)
                    if getattr(cand, "finish_reason", None):
                        fr = str(cand.finish_reason).upper()
                        stop_reason = "max_tokens" if "MAX" in fr else "other"
                    if getattr(chunk, "usage_metadata", None):
                        meta = chunk.usage_metadata
                        tokens_in = getattr(meta, "prompt_token_count", 0) or tokens_in
                        tokens_out = getattr(meta, "candidates_token_count", 0) or tokens_out

                if tool_calls:
                    stop_reason = "tool_use"
                elif stop_reason == "other":
                    stop_reason = "end_turn"

                raw_assistant = {"role": "model", "parts": response_parts}
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
                log.exception("Gemini stream worker failed")
                signal_done(bridge, e)

        task = asyncio.get_running_loop().run_in_executor(None, worker)
        try:
            async for item in bridge.drain():
                yield item
        finally:
            await task
