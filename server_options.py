"""
Unified Options Analysis — FastAPI Server.

Runs on port 3003. Exposes A-shares, US, and cross-market options analysis.

Endpoints:
    GET  /health
    GET  /options/asia/{symbol}     — A-shares options analysis
    GET  /options/us/{symbol}       — US options analysis
    GET  /options/cross-market      — Cross-market comparison
    GET  /options/chart/asia/{symbol} — A-shares chart (PNG)
    GET  /options/chart/us/{symbol}   — US chart (PNG)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logger = logging.getLogger(__name__)

app = FastAPI(
    title="QUANTAN Options Analysis API",
    description="A-shares & US options deep analysis, cross-market volatility tracking",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Models ─────────────────────────────────────────────────────────────

class OptionsAnalysisResponse(BaseModel):
    symbol: str
    spot: float
    atm_iv: Optional[float] = None
    pcr_volume: Optional[float] = None
    pcr_oi: Optional[float] = None
    skew_slope: Optional[float] = None
    signal_direction: str = "NEUTRAL"
    signal_score: float = 0.0
    signal_reasons: list[str] = []
    data_source: str = "simulated"
    analyzed_at: str = ""


class CrossMarketResponse(BaseModel):
    iv_spread: float
    iv_spread_z: float
    skew_spread: float
    regime_label: str
    regime_score: float
    interpretation: str
    factor_latest: Optional[float] = None
    factor_regime: str = "balanced"


class FactorLibraryResponse(BaseModel):
    factor_name: str
    latest_value: Optional[float] = None
    current_regime: str = "balanced"
    ts_integration: dict = {}


# ─── Endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "QUANTAN Options Analysis",
        "version": "1.0.0",
        "modules": ["asia", "us", "cross_market"],
    }


@app.get("/options/asia/{symbol}", response_model=OptionsAnalysisResponse)
async def analyze_asia_options(
    symbol: str,
    spot: float = Query(default=2.80, description="Underlying spot price"),
    days: int = Query(default=60, description="Days of historical data"),
    simulated: bool = Query(default=True, description="Use simulated data"),
):
    """A-shares options analysis for SSE 50 ETF."""
    try:
        from options_asia import analyze_asia_options

        result = analyze_asia_options(
            symbol=symbol,
            spot=spot,
            days=days,
            use_simulated=simulated,
        )

        return OptionsAnalysisResponse(
            symbol=result["symbol"],
            spot=result["spot"],
            pcr_volume=result["pcr"].get("volume_ratio"),
            pcr_oi=result["pcr"].get("oi_ratio"),
            skew_slope=result["skew"].get("skew_slope"),
            atm_iv=result["skew"].get("atm_iv"),
            signal_direction=result["signal"]["direction"],
            signal_score=result["signal"]["score"],
            signal_reasons=result["signal"].get("reasons", []),
            data_source=result["data_source"],
            analyzed_at=datetime.now().isoformat(),
        )
    except Exception as e:
        logger.error("Asia options analysis failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/us/{symbol}", response_model=OptionsAnalysisResponse)
async def analyze_us_options(
    symbol: str,
    days: int = Query(default=60, description="Days of simulated data"),
):
    """US options deep analysis (vol surface, skew prediction)."""
    try:
        from options_us import analyze_us_options_demo

        result = analyze_us_options_demo(symbol=symbol, days=days)

        return OptionsAnalysisResponse(
            symbol=result["symbol"],
            spot=result["spot"],
            atm_iv=result["atm_iv"],
            skew_slope=result["skew_metrics"].get("skew_slope"),
            signal_direction=result["prediction"]["direction"],
            signal_score=result["prediction"]["confidence"],
            signal_reasons=[result["prediction"]["rationale"]],
            data_source=result["data_source"],
            analyzed_at=datetime.now().isoformat(),
        )
    except Exception as e:
        logger.error("US options analysis failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/cross-market", response_model=CrossMarketResponse)
async def cross_market_analysis():
    """Cross-market volatility comparison (A-shares vs US)."""
    try:
        from options_cross_market import demo_cross_market

        result = demo_cross_market()
        spread = result["cross_market_spread"]
        trend = result["trend_factor"]

        return CrossMarketResponse(
            iv_spread=spread["iv_spread"],
            iv_spread_z=spread["iv_spread_z"],
            skew_spread=spread["skew_spread"],
            regime_label=spread["regime_label"],
            regime_score=spread["regime_score"],
            interpretation=spread["interpretation"],
            factor_latest=trend.get("latest_value"),
            factor_regime=trend.get("current_regime", "balanced"),
        )
    except Exception as e:
        logger.error("Cross-market analysis failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/factor/global-vol", response_model=FactorLibraryResponse)
async def global_vol_factor():
    """Get the global volatility regime tracking factor values."""
    try:
        from options_cross_market import build_global_vol_trend_factor
        import numpy as np

        rng = np.random.default_rng(42)
        n = 120
        asia_iv = 0.22 + np.cumsum(rng.normal(0, 0.002, n))
        us_iv = 0.18 + np.cumsum(rng.normal(0, 0.002, n))

        result = build_global_vol_trend_factor(
            asia_iv.tolist(),
            us_iv.tolist(),
        )

        return FactorLibraryResponse(
            factor_name=result.get("factor_name", "global_vol_regime"),
            latest_value=result.get("latest_value"),
            current_regime=result.get("current_regime", "balanced"),
            ts_integration=result.get("ts_integration", {}),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/options/chart/asia/{symbol}")
async def asia_chart(
    symbol: str,
    spot: float = Query(default=2.80),
):
    """Return A-shares options chart as PNG."""
    try:
        from fastapi.responses import FileResponse
        from options_asia import analyze_asia_options

        result = analyze_asia_options(symbol, spot=spot, use_simulated=True)
        return FileResponse(result["chart_path"], media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="QUANTAN Options Analysis Server")
    parser.add_argument("--host", type=str, default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("OPTIONS_PORT", "3003")))
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    logger.info("Starting Options Analysis server on %s:%d", args.host, args.port)
    uvicorn.run(app, host=args.host, port=args.port)
