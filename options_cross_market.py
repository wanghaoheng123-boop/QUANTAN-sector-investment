"""
Cross-Market Options Volatility Factor.

Compares A-shares (SSE 50 ETF) and US (SPY) options markets to build
a global volatility regime tracking factor.

Key metric: OTM put premium spread between markets proxies for
relative tail risk pricing.
"""

from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def compute_cross_market_spread(
    asia_atm_iv: float,
    us_atm_iv: float,
    asia_skew_slope: float,
    us_skew_slope: float,
    asia_iv_history: list[float] | None = None,
    us_iv_history: list[float] | None = None,
) -> dict:
    """
    Compute the cross-market volatility spread and regime.

    Args:
        asia_atm_iv: A-shares ATM implied volatility (e.g. 0.22 = 22%)
        us_atm_iv: US SPY ATM implied volatility
        asia_skew_slope: A-shares IV skew slope
        us_skew_slope: US IV skew slope
        asia_iv_history: Historical A-shares ATM IV values
        us_iv_history: Historical US ATM IV values

    Returns:
        dict with spread, regime score, and interpretation
    """
    # Raw spread: A-shares IV minus US IV
    iv_spread = asia_atm_iv - us_atm_iv
    skew_spread = asia_skew_slope - us_skew_slope

    # Historical z-score of IV spread
    iv_spread_z = 0.0
    if asia_iv_history and us_iv_history and len(asia_iv_history) >= 20:
        spreads = np.array([a - u for a, u in zip(asia_iv_history[-20:], us_iv_history[-20:])])
        mu, sigma = np.mean(spreads), max(np.std(spreads), 0.01)
        iv_spread_z = (iv_spread - mu) / sigma

    # OTM put premium proxy: skew * ATM IV (higher = more tail risk priced)
    asia_tail_premium = abs(asia_skew_slope) * asia_atm_iv if asia_skew_slope < 0 else 0
    us_tail_premium = abs(us_skew_slope) * us_atm_iv if us_skew_slope < 0 else 0
    tail_premium_spread = asia_tail_premium - us_tail_premium

    # Global vol regime score (-1 to +1)
    # Positive = A-shares more fearful than US (relative fear in China)
    # Negative = US more fearful than A-shares (relative fear in US)
    regime_score = float(np.tanh(iv_spread_z * 0.5 + skew_spread * 20))

    if regime_score > 0.3:
        regime_label = "ASIA_FEAR_PREMIUM"
        interpretation = "A-shares options pricing higher tail risk than US — potential China opportunity"
    elif regime_score < -0.3:
        regime_label = "US_FEAR_PREMIUM"
        interpretation = "US options pricing higher tail risk than A-shares — potential US opportunity"
    else:
        regime_label = "BALANCED"
        interpretation = "Cross-market fear pricing is balanced"

    return {
        "iv_spread": iv_spread,
        "iv_spread_z": iv_spread_z,
        "skew_spread": skew_spread,
        "asia_tail_premium": asia_tail_premium,
        "us_tail_premium": us_tail_premium,
        "tail_premium_spread": tail_premium_spread,
        "regime_score": float(regime_score),
        "regime_label": regime_label,
        "interpretation": interpretation,
    }


def build_global_vol_trend_factor(
    asia_iv_series: list[float],
    us_iv_series: list[float],
    lookback: int = 20,
) -> dict:
    """
    Build a time-series global volatility trend tracking factor.

    This factor can be used as input to the TypeScript signal engine
    (as an additional WeightedConfirm entry) or as a standalone regime indicator.

    Returns:
        dict with factor values, summary stats, and integration guidance
    """
    if len(asia_iv_series) < lookback or len(us_iv_series) < lookback:
        return {"error": "insufficient_data"}

    n = min(len(asia_iv_series), len(us_iv_series))
    asia_arr = np.array(asia_iv_series[-n:])
    us_arr = np.array(us_iv_series[-n:])

    # Spread time series
    spread_series = asia_arr - us_arr

    # Rolling z-score of spread
    spread_z = np.full(n, np.nan)
    for i in range(lookback, n):
        w = spread_series[i - lookback:i]
        spread_z[i] = (spread_series[i] - np.mean(w)) / max(np.std(w), 0.01)

    # Factor: -spread_z (when A-shares IV spikes relative to US → negative factor → potential buy)
    factor_values = -spread_z

    # Summary
    valid = factor_values[np.isfinite(factor_values)]
    return {
        "factor_name": "global_vol_regime",
        "factor_values": factor_values.tolist(),
        "latest_value": float(factor_values[-1]) if np.isfinite(factor_values[-1]) else None,
        "mean": float(np.mean(valid)) if len(valid) > 0 else None,
        "std": float(np.std(valid)) if len(valid) > 1 else None,
        "current_regime": "asia_stress" if factor_values[-1] < -1 else ("us_stress" if factor_values[-1] > 1 else "balanced"),
        "ts_integration": {
            "factor_name": "GlobalVolRegime",
            "score_type": "vol_regime_score",
            "integration_point": "enhancedCombinedSignal weightedConfirms array",
            "ts_file": "lib/backtest/signals.ts",
            "suggested_weight": 0.05,
            "description": "Negative when A-shares IV spikes vs US (potential China oversold opportunity)",
        },
    }


# ─── Demo ────────────────────────────────────────────────────────────────

def demo_cross_market() -> dict:
    """Run cross-market analysis with simulated data."""
    rng = np.random.default_rng(42)
    n = 120

    # Simulated IV paths with occasional divergence
    asia_iv = 0.22 + np.cumsum(rng.normal(0, 0.002, n)) + 0.01 * np.sin(np.linspace(0, 4 * np.pi, n))
    us_iv = 0.18 + np.cumsum(rng.normal(0, 0.002, n)) + 0.005 * np.sin(np.linspace(0, 3 * np.pi, n))
    asia_iv = np.clip(asia_iv, 0.10, 0.45)
    us_iv = np.clip(us_iv, 0.08, 0.40)

    # Latest values
    latest_asia_iv = float(asia_iv[-1])
    latest_us_iv = float(us_iv[-1])

    spread_result = compute_cross_market_spread(
        asia_atm_iv=latest_asia_iv,
        us_atm_iv=latest_us_iv,
        asia_skew_slope=-0.04,
        us_skew_slope=-0.02,
        asia_iv_history=asia_iv.tolist(),
        us_iv_history=us_iv.tolist(),
    )

    trend_factor = build_global_vol_trend_factor(
        asia_iv.tolist(),
        us_iv.tolist(),
    )

    return {
        "cross_market_spread": spread_result,
        "trend_factor": trend_factor,
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = demo_cross_market()

    spread = result["cross_market_spread"]
    print(f"\n=== Cross-Market Options Analysis ===")
    print(f"IV Spread (Asia - US): {spread['iv_spread'] * 100:.1f}%")
    print(f"IV Spread Z-Score: {spread['iv_spread_z']:.2f}")
    print(f"Regime: {spread['regime_label']} (score={spread['regime_score']:.2f})")
    print(f"Interpretation: {spread['interpretation']}")

    tf = result["trend_factor"]
    print(f"\nFactor Value: {tf.get('latest_value', 'N/A')}")
    print(f"Current Regime: {tf.get('current_regime', 'N/A')}")
    print(f"\nTS Integration: {tf['ts_integration']['description']}")
