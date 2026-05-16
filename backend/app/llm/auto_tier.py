from __future__ import annotations

_SMALLTALK_KEYWORDS = (
    "你好", "您好", "早安", "午安", "晚安", "哈囉", "嗨", "hi", "hello",
    "謝謝", "感謝", "thank", "thanks",
    "哈哈", "呵呵", "笑死", "哈",
    "再見", "掰掰", "bye",
    "好的", "沒問題", "ok", "okay",
)


def auto_tier_for_query(question: str, prior_message_count: int = 0) -> str:
    q = (question or "").strip()
    if not q:
        return "cheap"
    q_lower = q.lower()
    if any(kw in q_lower for kw in _SMALLTALK_KEYWORDS):
        return "cheap"
    return "premium"


def resolve_tier(setting: str, question: str = "", prior_message_count: int = 0) -> str:
    """Translate a route_* setting into a concrete tier.

    setting: "cheap" | "premium" | "auto"
    """
    s = (setting or "auto").lower()
    if s == "cheap" or s == "premium":
        return s
    return auto_tier_for_query(question, prior_message_count)
