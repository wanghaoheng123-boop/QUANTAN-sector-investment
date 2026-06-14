"""
Dependency-free runtime helpers for the trading-agents sidecar.

Extracted from ``server_trading_agents.py`` (which imports the heavy
``tradingagents`` package) so the concurrency-control and cache-bounding logic
can be unit-tested in isolation. See ``tests/test_trading_agents_runtime.py``.

- ``ProviderLockRegistry`` (F-PY-13): hands out a stable per-provider lock so
  concurrent same-provider requests serialize their ``os.environ`` key mutation
  and LLM call. Different providers still run concurrently.
- ``BoundedResultCache`` (F-PY-16): FIFO-bounded result cache so the in-memory
  store cannot grow without limit. Each new ``job_id`` is unique per request, so
  the unbounded path was the job map; both maps are now capped.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Generic, Optional, TypeVar

T = TypeVar("T")


class ProviderLockRegistry:
    """Lazily-created, stable per-provider ``threading.Lock`` registry.

    ``get(provider)`` always returns the *same* lock object for a given provider
    name, so callers across threads serialize on it. The registry itself is
    guarded by a meta-lock so concurrent first-time lookups can't create two
    locks for one provider.
    """

    def __init__(self) -> None:
        self._meta = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}

    def get(self, provider: str) -> threading.Lock:
        with self._meta:
            lock = self._locks.get(provider)
            if lock is None:
                lock = threading.Lock()
                self._locks[provider] = lock
            return lock


class BoundedResultCache(Generic[T]):
    """Thread-safe result cache with independent FIFO bounds on the per-job and
    per-ticker-latest maps.

    The previous plain ``dict`` accumulated one entry per ``job_id`` forever
    (job ids are unique per request and never read back), so memory grew without
    limit. We keep the same two access patterns — by job id and "latest for
    ticker" — but evict the oldest entry once either map exceeds its cap.
    """

    def __init__(self, max_jobs: int = 256, max_tickers: int = 512) -> None:
        if max_jobs < 1 or max_tickers < 1:
            raise ValueError("cache bounds must be >= 1")
        self._lock = threading.Lock()
        self._jobs: "OrderedDict[str, T]" = OrderedDict()
        self._latest: "OrderedDict[str, T]" = OrderedDict()
        self._max_jobs = max_jobs
        self._max_tickers = max_tickers

    def put(self, job_id: str, ticker: str, result: T) -> None:
        with self._lock:
            self._jobs[job_id] = result
            self._jobs.move_to_end(job_id)
            while len(self._jobs) > self._max_jobs:
                self._jobs.popitem(last=False)

            self._latest[ticker] = result
            self._latest.move_to_end(ticker)
            while len(self._latest) > self._max_tickers:
                self._latest.popitem(last=False)

    def latest(self, ticker: str) -> Optional[T]:
        with self._lock:
            return self._latest.get(ticker)

    def job(self, job_id: str) -> Optional[T]:
        with self._lock:
            return self._jobs.get(job_id)

    def __len__(self) -> int:
        with self._lock:
            return len(self._jobs) + len(self._latest)
