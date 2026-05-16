"""In-memory rate limiting for login attempts.

Tracks failed attempts per (IP, username) bucket. After N failures in a window,
the bucket is locked for a cool-down period. Successful login clears the bucket.

This is intentionally simple — no Redis dependency, fits the 60-user internal
deployment. State is per-process, so if you scale to multiple replicas you'll
want to swap this for something shared.
"""
from __future__ import annotations
import time
import threading
from dataclasses import dataclass, field

# Tunables
MAX_FAILS = 5              # allowed failures before lock-out
WINDOW_SEC = 300           # 5-minute rolling window
LOCKOUT_SEC = 900          # 15-minute lock-out
CLEANUP_INTERVAL_SEC = 600 # purge stale buckets every 10 min


@dataclass
class _Bucket:
    failures: list[float] = field(default_factory=list)
    locked_until: float = 0.0


_buckets: dict[str, _Bucket] = {}
_lock = threading.Lock()
_last_cleanup = 0.0


def _key(ip: str, username: str) -> str:
    return f"{ip}|{username.lower()}"


def _cleanup_if_due(now: float) -> None:
    global _last_cleanup
    if now - _last_cleanup < CLEANUP_INTERVAL_SEC:
        return
    _last_cleanup = now
    stale: list[str] = []
    for k, b in _buckets.items():
        b.failures = [t for t in b.failures if now - t < WINDOW_SEC]
        if not b.failures and b.locked_until < now:
            stale.append(k)
    for k in stale:
        _buckets.pop(k, None)


def check(ip: str, username: str) -> tuple[bool, int]:
    """Return (is_locked, seconds_remaining)."""
    now = time.time()
    with _lock:
        _cleanup_if_due(now)
        b = _buckets.get(_key(ip, username))
        if b is None:
            return False, 0
        if b.locked_until > now:
            return True, int(b.locked_until - now)
        return False, 0


def record_failure(ip: str, username: str) -> tuple[bool, int]:
    """Record one failure. Returns (now_locked, fails_remaining_before_lock).

    fails_remaining_before_lock is -1 when already locked.
    """
    now = time.time()
    with _lock:
        b = _buckets.setdefault(_key(ip, username), _Bucket())
        # Drop failures outside the rolling window
        b.failures = [t for t in b.failures if now - t < WINDOW_SEC]
        b.failures.append(now)
        if len(b.failures) >= MAX_FAILS:
            b.locked_until = now + LOCKOUT_SEC
            return True, -1
        return False, MAX_FAILS - len(b.failures)


def record_success(ip: str, username: str) -> None:
    with _lock:
        _buckets.pop(_key(ip, username), None)
