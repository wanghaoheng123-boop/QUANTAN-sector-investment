"""Tests for the dependency-free trading-agents sidecar runtime helpers.

Covers the bounded result cache (F-PY-16) and the per-provider lock registry
(F-PY-13) — logic extracted from server_trading_agents.py so it can be exercised
without importing the heavy ``tradingagents`` package.
"""

import threading

from trading_agents_runtime import BoundedResultCache, ProviderLockRegistry


# ── BoundedResultCache (F-PY-16) ──────────────────────────────────────────────

def test_cache_roundtrip_job_and_latest():
    c = BoundedResultCache()
    c.put("job1", "AAPL", "r1")
    assert c.job("job1") == "r1"
    assert c.latest("AAPL") == "r1"
    assert c.latest("MSFT") is None
    assert c.job("missing") is None


def test_cache_latest_overwrites_per_ticker():
    c = BoundedResultCache()
    c.put("job1", "AAPL", "old")
    c.put("job2", "AAPL", "new")
    assert c.latest("AAPL") == "new"
    # both job entries are still individually addressable
    assert c.job("job1") == "old"
    assert c.job("job2") == "new"


def test_cache_evicts_oldest_jobs_past_bound():
    c = BoundedResultCache(max_jobs=3, max_tickers=100)
    for i in range(5):
        c.put(f"job{i}", f"T{i}", f"r{i}")
    # job0 and job1 evicted (FIFO); the last 3 survive
    assert c.job("job0") is None
    assert c.job("job1") is None
    assert c.job("job2") == "r2"
    assert c.job("job4") == "r4"


def test_cache_evicts_oldest_latest_past_bound():
    c = BoundedResultCache(max_jobs=100, max_tickers=2)
    c.put("j1", "AAPL", "a")
    c.put("j2", "MSFT", "m")
    c.put("j3", "NVDA", "n")
    # AAPL (oldest ticker) evicted from the latest map
    assert c.latest("AAPL") is None
    assert c.latest("MSFT") == "m"
    assert c.latest("NVDA") == "n"


def test_cache_repeated_put_does_not_grow_jobs_unbounded():
    c = BoundedResultCache(max_jobs=10, max_tickers=10)
    for i in range(1000):
        c.put(f"job{i}", "AAPL", i)
    assert len(c) <= 10 + 10  # jobs + latest both capped
    assert c.latest("AAPL") == 999


def test_cache_concurrent_puts_are_safe():
    c = BoundedResultCache(max_jobs=64, max_tickers=64)

    def worker(n):
        for i in range(200):
            c.put(f"j{n}-{i}", f"T{n}", i)

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(c) <= 64 + 64  # never exceeded the bounds despite the race


# ── ProviderLockRegistry (F-PY-13) ────────────────────────────────────────────

def test_same_provider_returns_same_lock():
    reg = ProviderLockRegistry()
    assert reg.get("openai") is reg.get("openai")


def test_different_providers_get_different_locks():
    reg = ProviderLockRegistry()
    assert reg.get("openai") is not reg.get("anthropic")


def test_provider_lock_serializes_critical_section():
    reg = ProviderLockRegistry()
    lock = reg.get("openai")
    order = []

    lock.acquire()  # main thread holds the openai lock

    def contender():
        with reg.get("openai"):
            order.append("contender-entered")

    t = threading.Thread(target=contender)
    t.start()
    t.join(timeout=0.3)
    # contender is blocked while we hold the lock
    assert order == []
    assert t.is_alive()

    lock.release()
    t.join(timeout=1.0)
    assert order == ["contender-entered"]
    assert not t.is_alive()
