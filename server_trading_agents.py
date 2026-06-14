"""
FastAPI server wrapping TradingAgents LangGraph multi-agent analysis.
Runs alongside Next.js (default: port 3001).

Start:
    python server_trading_agents.py
    # or with custom host/port (Railway/Render set PORT automatically):
    python server_trading_agents.py --host 0.0.0.0 --port 3001

Endpoints:
    GET  /health                          → { "status": "ok" }
    POST /analyze/{ticker}                → AnalysisResult
    GET  /analyze/{ticker}/latest         → AnalysisResult | null (cached last result)

POST /analyze body (all fields optional):
{
    "trade_date":       "2024-05-10",   ← date for analysis (default: today)
    "llm_provider":     "openai",        ← openai | google | anthropic | xai | openrouter | ollama
    "deep_think_llm":   "gpt-4o",       ← model for deep reasoning
    "quick_think_llm":  "gpt-4o-mini",  ← model for quick tasks
    "max_debate_rounds": 1,             ← bull/bear debate rounds
    "max_risk_discuss_rounds": 1,       ← risk debate rounds
    "data_vendor":      "yfinance",      ← yfinance | alpha_vantage (needs API key)
    "api_key":         "sk-..."         ← USER'S OWN API KEY (required for user-supplied mode)
}

Privacy design:
    The api_key travels from the user's browser → Next.js → here.
    It is set as a thread-local environment variable only for the duration
    of this request's analysis, then cleared. It is never logged, never
    stored in the result cache, and never written to disk.
"""

from __future__ import annotations

import argparse
import asyncio
import concurrent.futures
import contextlib
import os
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# TradingAgents imports
from tradingagents.graph.trading_graph import TradingAgentsGraph
from tradingagents.default_config import DEFAULT_CONFIG

# F-PY-12: leak-safe per-request API-key env guard. Extracted to a dependency-free
# module so its restore logic is unit-testable without the tradingagents package.
from trading_agents_env_guard import ApiKeyEnvGuard as _ApiKeyEnvGuard

# Dependency-free runtime helpers (bounded cache + per-provider locks), extracted
# so their concurrency/eviction logic is unit-testable without tradingagents.
from trading_agents_runtime import BoundedResultCache, ProviderLockRegistry


# ─────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    trade_date:             Optional[str] = None
    llm_provider:           Optional[str] = None
    deep_think_llm:         Optional[str] = None
    quick_think_llm:        Optional[str] = None
    max_debate_rounds:      Optional[int] = None
    max_risk_discuss_rounds: Optional[int] = None
    data_vendor:            Optional[str] = None
    api_key:               Optional[str] = None  # User-supplied key

    model_config = {"extra": "forbid"}


class AnalysisResult(BaseModel):
    job_id:             str
    ticker:             str
    trade_date:         str
    decision:           str
    decision_grade:     str
    confidence_label:   str
    llm_provider:       str
    model_used:         str
    analysis_timestamp: str
    elapsed_seconds:    float
    market_report:      str = ""
    sentiment_report:   str = ""
    news_report:        str = ""
    fundamentals_report: str = ""
    investment_plan:    str = ""
    risk_debate_summary: str = ""
    final_trade_decision: str = ""
    state_keys:         list[str] = field(default_factory=list)
    error:              Optional[str] = None


# ─────────────────────────────────────────────
# Result cache (thread-safe, never stores api_key)
# ─────────────────────────────────────────────

# Bounded so the sidecar can't grow memory without limit (F-PY-16). Per-provider
# locks serialize concurrent same-provider key injection (F-PY-13).
_results: BoundedResultCache[AnalysisResult] = BoundedResultCache()
_provider_locks = ProviderLockRegistry()


def grade_to_confidence(decision: str) -> str:
    d = decision.upper()
    if d in ("BUY", "SELL", "OVERWEIGHT", "UNDERWEIGHT"):
        return "High"
    if d in ("HOLD",):
        return "Medium"
    return "Low"


def build_result(
    ticker:          str,
    trade_date_str:  str,
    job_id:          str,
    final_state:     dict[str, Any] | None,
    decision:        str,
    elapsed:         float,
    llm_provider:    str,
    model:           str,
    error:           str | None = None,
) -> AnalysisResult:
    if error or not final_state:
        return AnalysisResult(
            job_id=job_id, ticker=ticker, trade_date=trade_date_str,
            decision=decision or "ERROR",
            decision_grade=(decision or "ERROR").split()[0] if decision else "ERROR",
            confidence_label="Low", llm_provider=llm_provider, model_used=model,
            analysis_timestamp=datetime.utcnow().isoformat() + "Z",
            elapsed_seconds=round(elapsed, 1), state_keys=[], error=error,
        )

    def cut(s: Any, max_len: int = 1800) -> str:
        if not isinstance(s, str):
            s = str(s)
        return s[:max_len] + ("..." if len(s) > max_len else "")

    return AnalysisResult(
        job_id=job_id, ticker=ticker, trade_date=trade_date_str,
        decision=decision,
        decision_grade=decision.split()[0] if decision else "HOLD",
        confidence_label=grade_to_confidence(decision),
        llm_provider=llm_provider, model_used=model,
        analysis_timestamp=datetime.utcnow().isoformat() + "Z",
        elapsed_seconds=round(elapsed, 1),
        market_report=cut(final_state.get("market_report", "")),
        sentiment_report=cut(final_state.get("sentiment_report", "")),
        news_report=cut(final_state.get("news_report", "")),
        fundamentals_report=cut(final_state.get("fundamentals_report", "")),
        investment_plan=cut(final_state.get("trader_investment_plan", "")),
        risk_debate_summary=cut(final_state.get("final_trade_decision", "")),
        final_trade_decision=cut(final_state.get("final_trade_decision", "")),
        state_keys=[k for k in final_state.keys() if not k.startswith("_")],
    )


# ─────────────────────────────────────────────
# Core analysis runner (runs in thread pool)
# ─────────────────────────────────────────────

def _run_analysis(
    ticker:         str,
    trade_date_str: str,
    job_id:         str,
    req:            AnalyzeRequest,
) -> AnalysisResult:
    config = DEFAULT_CONFIG.copy()

    provider    = req.llm_provider        or os.environ.get("TA_LLM_PROVIDER", "openai")
    deep_model  = req.deep_think_llm      or os.environ.get("TA_DEEP_MODEL", "gpt-4o")
    quick_model = req.quick_think_llm     or os.environ.get("TA_QUICK_MODEL", "gpt-4o-mini")

    config.update({
        "llm_provider":   provider,
        "deep_think_llm": deep_model,
        "quick_think_llm": quick_model,
        "max_debate_rounds": req.max_debate_rounds if req.max_debate_rounds is not None else 1,
        "max_risk_discuss_rounds": req.max_risk_discuss_rounds if req.max_risk_discuss_rounds is not None else 1,
        "data_vendors": {
            k: (req.data_vendor or "yfinance")
            for k in ("core_stock_apis", "technical_indicators", "fundamental_data", "news_data")
        },
    })

    # ── Per-request API key injection ────────────────────────────────
    # Inject the user's own API key into this thread's environment
    # only for the duration of this analysis call. It never touches
    # disk, logs, or the result cache.
    # Serialize same-provider requests that inject a per-request key: the guard
    # mutates the process-global os.environ, so concurrent same-provider calls
    # would otherwise race on the key (F-PY-13). Keyless / server-default-key
    # requests don't mutate env and need no lock.
    provider_lock = _provider_locks.get(provider) if req.api_key else contextlib.nullcontext()
    with provider_lock, _ApiKeyEnvGuard(provider, req.api_key):
        start = datetime.utcnow()
        try:
            ta = TradingAgentsGraph(debug=False, config=config)
            # Bound the LLM call with a 120s timeout. Don't use the executor as a
            # context manager — its __exit__ joins the worker (wait=True), which
            # would block forever on a hung propagate() and defeat the timeout.
            # Shut down without waiting and cancel anything still queued (F-PY-15);
            # a running thread can't be force-killed in CPython, but the request
            # no longer blocks on it.
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            try:
                future = executor.submit(ta.propagate, ticker, trade_date_str)
                _, decision = future.result(timeout=120)
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
            elapsed = (datetime.utcnow() - start).total_seconds()
            result = build_result(
                ticker=ticker, trade_date_str=trade_date_str,
                job_id=job_id, final_state=_,
                decision=decision or "HOLD",
                elapsed=elapsed, llm_provider=provider, model=deep_model,
            )
        except Exception as e:
            elapsed = (datetime.utcnow() - start).total_seconds()
            traceback.print_exc()
            result = build_result(
                ticker=ticker, trade_date_str=trade_date_str,
                job_id=job_id, final_state=None, decision="ERROR",
                elapsed=elapsed, llm_provider=provider, model=deep_model,
                error=f"{type(e).__name__}: {e}",
            )

    # Cache result (no api_key in result object — safe)
    _results.put(job_id, ticker, result)

    return result


# ─────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────

app = FastAPI(
    title="TradingAgents API",
    description="Multi-agent LLM financial trading analysis powered by TradingAgents.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # Browsers forbid credentials with wildcard origin; Next.js calls this server-side too.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "TradingAgents", "version": "0.3.0"}


@app.post("/analyze/{ticker}", response_model=AnalysisResult)
async def analyze(ticker: str, req: AnalyzeRequest = AnalyzeRequest()):
    """
    Run a full multi-agent analysis for `ticker`.

    Returns a structured result with decision, all analyst reports,
    and risk debate summary.

    Privacy: if `api_key` is provided in the body it is injected into the
    current thread's environment for the LLM call only, then cleared.
    It is never logged, cached, or stored anywhere.
    """
    ticker = ticker.strip().upper()
    if not ticker:
        raise HTTPException(400, "ticker is required")

    today_str = date.today().isoformat()
    trade_date_str = req.trade_date or today_str

    try:
        datetime.strptime(trade_date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, f"trade_date must be YYYY-MM-DD, got: {trade_date_str}")

    # Validate provider
    supported = ("openai", "google", "anthropic", "xai", "openrouter", "ollama")
    if req.llm_provider and req.llm_provider not in supported:
        raise HTTPException(400, f"llm_provider must be one of: {', '.join(supported)}")

    # If user supplies an API key, require that a provider is also specified
    if req.api_key and not req.llm_provider:
        raise HTTPException(400, "llm_provider is required when supplying api_key")

    job_id = str(uuid.uuid4())[:8]

    # _run_analysis receives `req` directly, so the user's key flows through the
    # call argument, not process- or async-global state.
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        _run_analysis,
        ticker,
        trade_date_str,
        job_id,
        req,
    )


@app.get("/analyze/{ticker}/latest", response_model=Optional[AnalysisResult])
async def latest_analysis(ticker: str):
    """Return the most recent analysis result for this ticker (in-memory cache)."""
    ticker = ticker.strip().upper()
    result = _results.latest(ticker)
    if not result:
        raise HTTPException(404, f"No cached analysis found for {ticker}")
    return result


# ─────────────────────────────────────────────
# CLI entrypoint
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="TradingAgents FastAPI server")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind (0.0.0.0 for external access on Railway/Render)")
    default_port = int(os.environ.get("PORT") or "3001")
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help="Port to bind (defaults to $PORT on Railway/Render, else 3001)",
    )
    args = parser.parse_args()

    import uvicorn
    print(f"\n{'='*60}")
    print(f"TradingAgents API -> http://{args.host}:{args.port}")
    print(f"  POST /analyze/{{ticker}}    run analysis (include api_key in body)")
    print(f"  GET  /analyze/{{ticker}}/latest  cached result")
    print(f"  GET  /health")
    print(f"{'='*60}\n")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
