"""Heuristic to decide whether a query needs the cheap or premium tier.

Cost is the dominant concern: route 70-80% of typical queries to cheap
provider; reserve premium for complex / analytical asks.

Rules (in order — first match wins):
1. Long question (≥ 200 chars) → premium (likely complex / multi-part)
2. Contains complexity keywords (compare / analyse / why / how) → premium
3. Active session with prior turns (≥ 2) → premium (likely deep dive)
4. Otherwise → cheap
"""
from __future__ import annotations

# Traditional Chinese keywords that indicate analytical / comparative intent.
# Conservative list — false positives just mean a query goes to premium (safe).
_COMPLEX_KEYWORDS = (
    "比較", "分析", "為什麼", "為何", "差異", "差別", "原因", "原理",
    "建議", "策略", "規劃", "評估", "說明", "解釋", "推論",
    "綜合", "整合", "對比", "歸納", "影響", "風險",
    "compare", "analyse", "analyze", "why", "explain",
    "recommend", "trade-off", "tradeoff",
)

# Length threshold above which we always escalate (longer questions tend
# to ask multiple things or contain rich context).
_LONG_QUERY_CHARS = 200

# Even short questions get escalated mid-conversation, on the assumption
# that follow-ups in an ongoing chat usually drill deeper.
_TURNS_FOR_ESCALATION = 2


def auto_tier_for_query(question: str, prior_message_count: int = 0) -> str:
    """Return 'cheap' or 'premium'."""
    q = (question or "").strip()
    if not q:
        return "cheap"
    if len(q) >= _LONG_QUERY_CHARS:
        return "premium"
    q_lower = q.lower()
    if any(kw in q_lower for kw in _COMPLEX_KEYWORDS):
        return "premium"
    if any(kw in q for kw in _COMPLEX_KEYWORDS):  # CJK case-insensitive is identity
        return "premium"
    if prior_message_count >= _TURNS_FOR_ESCALATION * 2:  # user+assistant pairs
        return "premium"
    return "cheap"


def resolve_tier(setting: str, question: str = "", prior_message_count: int = 0) -> str:
    """Translate a route_* setting into a concrete tier.

    setting: "cheap" | "premium" | "auto"
    """
    s = (setting or "auto").lower()
    if s == "cheap" or s == "premium":
        return s
    return auto_tier_for_query(question, prior_message_count)
