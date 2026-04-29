"""
Multi-Agent Factor Mining — FastAPI Server.

Runs on port 3002. Provides API for automated alpha factor discovery.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .agents import FactorMiningPipeline
from .config import ApiKeyGuard, get_config
from .factor_library import FactorLibrary

logger = logging.getLogger(__name__)

app = FastAPI(
    title="QUANTAN Factor Mining API",
    description="Multi-agent automated alpha factor discovery",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

config = get_config()
library = FactorLibrary(config.library_path)
pipeline = FactorMiningPipeline(config)


# ─── Request/Response Models ─────────────────────────────────────────────────

class MineFactorsRequest(BaseModel):
    tickers: list[str] = ["SPY"]
    iterations: int = 3
    api_key: Optional[str] = None
    use_simulated_data: bool = False


class FactorResponse(BaseModel):
    id: str
    name: str
    formula: str
    category: str
    ic_mean: float
    sharpe: float
    status: str
    version: int
    created_at: str


class MineFactorsResponse(BaseModel):
    run_id: str
    status: str
    new_factors: list[FactorResponse]
    total_in_library: int
    messages: list[str]
    elapsed_seconds: float


class LibrarySummary(BaseModel):
    total_factors: int
    active_factors: int
    categories: dict[str, int]
    top_factors: list[FactorResponse]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _factor_to_response(f) -> FactorResponse:
    return FactorResponse(
        id=f.id if hasattr(f, "id") else f.get("id", ""),
        name=f.name if hasattr(f, "name") else f.get("name", ""),
        formula=f.formula if hasattr(f, "formula") else f.get("formula", ""),
        category=f.category if hasattr(f, "category") else f.get("category", "unknown"),
        ic_mean=f.ic_mean if hasattr(f, "ic_mean") else f.get("rank_ic", float("nan")),
        sharpe=f.sharpe if hasattr(f, "sharpe") else f.get("sharpe", float("nan")),
        status=f.status if hasattr(f, "status") else "active",
        version=f.version if hasattr(f, "version") else 1,
        created_at=f.created_at if hasattr(f, "created_at") else "",
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "QUANTAN Factor Mining",
        "version": "1.0.0",
        "library_size": len(library.list_all()),
    }


@app.post("/mine-factors", response_model=MineFactorsResponse)
async def mine_factors(req: MineFactorsRequest):
    """
    Run the full multi-agent factor mining pipeline.

    Discovers new alpha factors for the given tickers using template + LLM generation
    with IC-based evaluation and correlation-aware portfolio composition.
    """
    run_id = str(uuid.uuid4())[:8]
    start = datetime.now()

    new_factors = []
    all_messages = []

    for ticker in req.tickers:
        ticker = ticker.strip().upper()

        # Load data
        if req.use_simulated_data:
            from alpha_miner import generate_simulated_data

            data = generate_simulated_data(500)
        else:
            try:
                from quant_framework.data_engine import get_daily

                data = get_daily(ticker, start="2021-01-01")
            except ImportError:
                from alpha_miner import generate_simulated_data

                data = generate_simulated_data(500)

        with ApiKeyGuard(req.api_key):
            state = pipeline.run(ticker, data, iterations=req.iterations)

        for f in state.get("selected_factors", []):
            new_factors.append(FactorResponse(
                id=f.get("name", ""),
                name=f.get("name", ""),
                formula=f.get("formula", ""),
                category=f.get("category", "unknown"),
                ic_mean=f.get("rank_ic", float("nan")),
                sharpe=f.get("sharpe", float("nan")),
                status="active",
                version=1,
                created_at=datetime.now().isoformat(),
            ))

        all_messages.extend(state.get("messages", []))

    elapsed = (datetime.now() - start).total_seconds()

    return MineFactorsResponse(
        run_id=run_id,
        status="completed",
        new_factors=new_factors,
        total_in_library=len(library.list_all()),
        messages=all_messages,
        elapsed_seconds=elapsed,
    )


@app.get("/library", response_model=LibrarySummary)
async def get_library():
    """Get factor library summary."""
    all_factors = library.list_all()
    active = library.list_active()

    categories: dict[str, int] = {}
    for f in active:
        categories[f.category] = categories.get(f.category, 0) + 1

    top = library.top_by_ic(10)
    top_responses = [_factor_to_response(f) for f in top]

    return LibrarySummary(
        total_factors=len(all_factors),
        active_factors=len(active),
        categories=categories,
        top_factors=top_responses,
    )


@app.get("/library/{factor_id}", response_model=FactorResponse)
async def get_factor(factor_id: str):
    """Get a specific factor by ID."""
    factor = library.get(factor_id)
    if factor is None:
        raise HTTPException(status_code=404, detail=f"Factor {factor_id} not found")
    return _factor_to_response(factor)


@app.delete("/library/{factor_id}")
async def delete_factor(factor_id: str):
    """Delete a factor from the library."""
    if library.delete(factor_id):
        return {"status": "deleted", "factor_id": factor_id}
    raise HTTPException(status_code=404, detail=f"Factor {factor_id} not found")


if __name__ == "__main__":
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="QUANTAN Factor Mining Server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("ALPHA_PORT", "3002")))
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    logger.info("Starting Factor Mining server on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port)
