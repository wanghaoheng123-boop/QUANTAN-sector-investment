"""
US Options Deep Analyzer.

Focuses on what the TypeScript lib/options/ layer does NOT provide:
  - Vol surface interpolation to 30-day constant maturity
  - Skew regression vs next-day SPY return
  - Directional prediction from skew steepness

Uses yfinance for data, py_vollib + scipy for IV computation.
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
logger = logging.getLogger(__name__)


# ─── BS & IV (shared with options_asia.py) ──────────────────────────────

def _bs_price(S: float, K: float, T: float, r: float, sigma: float, opt_type: str = "call") -> float:
    try:
        from scipy.stats import norm
        if T <= 1e-10 or sigma <= 1e-10:
            return max(0.0, S - K) if opt_type == "call" else max(0.0, K - S)
        d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        if opt_type == "call":
            return float(S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2))
        return float(K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1))
    except ImportError:
        from options_asia import black_scholes_price
        return black_scholes_price(S, K, T, r, sigma, opt_type)


def _implied_vol(
    price: float, S: float, K: float, T: float, r: float = 0.05, opt_type: str = "call"
) -> Optional[float]:
    try:
        from scipy.stats import norm
        intrinsic = max(0.0, S - K) if opt_type == "call" else max(0.0, K - S)
        if price <= intrinsic or T <= 1e-10:
            return None
        sigma = 0.3
        for _ in range(100):
            d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
            p = _bs_price(S, K, T, r, sigma, opt_type)
            diff = p - price
            if abs(diff) < 1e-6:
                return sigma
            vega = S * np.sqrt(T) * norm.pdf(d1)
            if vega < 1e-10:
                return None
            sigma -= diff / vega
            if sigma <= 0:
                return None
        return None
    except ImportError:
        from options_asia import implied_volatility

        return implied_volatility(price, S, K, T, r, opt_type)


# ─── Vol Surface Construction ────────────────────────────────────────────

@dataclass
class VolSurfacePoint:
    strike: float
    expiry_days: float
    iv: float
    moneyness: float  # K / S - 1


def build_vol_surface_from_chains(
    chains: list[dict],
    spot: float,
    r: float = 0.05,
) -> list[VolSurfacePoint]:
    """
    Build a volatility surface from multiple expiration chains.

    Args:
        chains: List of chain dicts, each with {expiry_days, calls[], puts[]}
        spot: Current underlying price
        r: Risk-free rate

    Returns:
        List of VolSurfacePoint
    """
    points: list[VolSurfacePoint] = []

    for chain in chains:
        T = max(chain["expiry_days"], 1) / 365.0

        for contract in chain.get("calls", []):
            iv = contract.get("iv") or contract.get("impliedVolatility")
            if iv is None and contract.get("lastPrice", 0) > 0.05:
                iv = _implied_vol(contract["lastPrice"], spot, contract["strike"], T, r, "call")

            if iv and iv > 0.01 and iv < 2.0:
                points.append(VolSurfacePoint(
                    strike=contract["strike"],
                    expiry_days=float(chain["expiry_days"]),
                    iv=float(iv),
                    moneyness=float(contract["strike"] / spot - 1),
                ))

        for contract in chain.get("puts", []):
            iv = contract.get("iv") or contract.get("impliedVolatility")
            if iv is None and contract.get("lastPrice", 0) > 0.05:
                iv = _implied_vol(contract["lastPrice"], spot, contract["strike"], T, r, "put")

            if iv and iv > 0.01 and iv < 2.0:
                points.append(VolSurfacePoint(
                    strike=contract["strike"],
                    expiry_days=float(chain["expiry_days"]),
                    iv=float(iv),
                    moneyness=float(contract["strike"] / spot - 1),
                ))

    return points


def interpolate_30day_iv_curve(
    surface: list[VolSurfacePoint],
    spot: float,
) -> Optional[dict]:
    """
    Interpolate IV at 30-day constant maturity across strikes.

    Uses linear interpolation in expiry dimension, then smooths
    the resulting IV-vs-strike curve.
    """
    if len(surface) < 5:
        return None

    df = pd.DataFrame([{
        "strike": p.strike,
        "expiry_days": p.expiry_days,
        "iv": p.iv,
        "moneyness": p.moneyness,
    } for p in surface])

    target_days = 30.0
    strikes = np.sort(df["strike"].unique())

    curve: list[dict] = []
    for K in strikes:
        subset = df[df["strike"] == K]
        if len(subset) < 2:
            continue

        # Linear interpolation to 30 days
        d = subset["expiry_days"].values
        v = subset["iv"].values
        if d.min() <= target_days <= d.max():
            iv_30 = float(np.interp(target_days, d, v))
            curve.append({
                "strike": float(K),
                "moneyness": float(K / spot - 1),
                "iv_30d": iv_30,
            })
        elif target_days < d.min():
            curve.append({
                "strike": float(K),
                "moneyness": float(K / spot - 1),
                "iv_30d": float(v[0]),
            })

    return {"spot": spot, "target_days": target_days, "curve": curve} if curve else None


def compute_skew_metrics(iv_curve: dict) -> dict:
    """
    Compute skew metrics from a constant-maturity IV curve.

    Returns:
        skew_slope: Linear regression slope IV vs moneyness
        put_wing_premium: IV_90% - IV_100%
        call_wing_discount: IV_110% - IV_100%
    """
    curve = iv_curve.get("curve", [])
    if len(curve) < 5:
        return {"skew_slope": 0.0, "error": "insufficient data"}

    moneyness = np.array([p["moneyness"] for p in curve])
    ivs = np.array([p["iv_30d"] for p in curve])

    slope, _ = np.polyfit(moneyness, ivs, 1)

    # ATM IV (moneyness near 0)
    atm_idx = np.argmin(np.abs(moneyness))
    atm_iv = ivs[atm_idx]

    # Put wing (90% moneyness)
    put_idx = np.argmin(np.abs(moneyness + 0.10))
    put_iv = ivs[put_idx]

    # Call wing (110% moneyness)
    call_idx = np.argmin(np.abs(moneyness - 0.10))
    call_iv = ivs[call_idx]

    return {
        "skew_slope": float(slope),
        "atm_iv": float(atm_iv),
        "put_wing_premium": float(put_iv - atm_iv),
        "call_wing_discount": float(call_iv - atm_iv),
        "n_curve_points": len(curve),
    }


# ─── Skew → Return Prediction ───────────────────────────────────────────

def predict_from_skew(
    skew_slope: float,
    skew_history: list[float] | None = None,
) -> dict:
    """
    Predict directional bias from skew steepness.

    Logic:
      - Unusually steep put skew (> 1.5σ below mean) → hedging panic → contrarian bullish
      - Unusually flat put skew (> 1.5σ above mean) → complacency → cautious/bearish
      - Normal range → neutral
    """
    if not skew_history or len(skew_history) < 20:
        if skew_slope < -0.10:
            direction, confidence, rationale = "BULLISH", 0.6, "Steep put skew suggests oversold"
        elif skew_slope > 0.02:
            direction, confidence, rationale = "BEARISH", 0.5, "Flat/call skew suggests complacency"
        else:
            direction, confidence, rationale = "NEUTRAL", 0.3, "Skew in normal range"
    else:
        mu = np.mean(skew_history[-60:]) if len(skew_history) >= 60 else np.mean(skew_history)
        sigma = np.std(skew_history[-60:]) if len(skew_history) >= 60 else np.std(skew_history)
        sigma = max(sigma, 0.01)

        z = (skew_slope - mu) / sigma

        if z < -1.5:
            direction, confidence, rationale = "BULLISH", min(0.7, 0.5 + abs(z) * 0.1), f"Skew {abs(z):.1f}σ below mean — hedging panic = contrarian bullish"
        elif z > 1.5:
            direction, confidence, rationale = "BEARISH", min(0.7, 0.5 + z * 0.1), f"Skew {z:.1f}σ above mean — complacency = cautious"
        else:
            direction, confidence, rationale = "NEUTRAL", 0.3, f"Skew within normal range (z={z:.1f})"

    return {"direction": direction, "confidence": confidence, "rationale": rationale, "skew_slope": skew_slope}


# ─── Demo with Simulated Data ───────────────────────────────────────────

def analyze_us_options_demo(symbol: str = "SPY", days: int = 60) -> dict:
    """
    Full US options analysis using simulated data (for demo/testing).

    Simulates realistic SPY option chains with time-varying skew.
    """
    rng = np.random.default_rng(42)
    spot = 520.0

    skew_history: list[float] = []
    atm_iv_history: list[float] = []
    prices: list[float] = []

    for i in range(days):
        spot *= (1 + rng.normal(0.0003, 0.01))

        atm_iv = 0.18 + 0.02 * np.sin(i * 0.1) + rng.normal(0, 0.002)
        atm_iv = max(0.10, atm_iv)
        skew = -0.03 + 0.01 * np.sin(i * 0.07) + rng.normal(0, 0.003)

        prices.append(spot)
        atm_iv_history.append(atm_iv)
        skew_history.append(skew)

    # Latest surface
    latest_skew = skew_history[-1]
    latest_atm_iv = atm_iv_history[-1]

    skew_metrics = {
        "skew_slope": latest_skew,
        "atm_iv": latest_atm_iv,
        "put_wing_premium": abs(latest_skew) * 0.5 if latest_skew < 0 else 0,
        "call_wing_discount": abs(latest_skew) * 0.3 if latest_skew > 0 else 0,
    }

    prediction = predict_from_skew(latest_skew, skew_history)

    return {
        "symbol": symbol,
        "spot": prices[-1],
        "atm_iv": latest_atm_iv,
        "skew_metrics": skew_metrics,
        "prediction": prediction,
        "skew_history": skew_history[-20:],
        "data_source": "simulated",
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = analyze_us_options_demo("SPY")

    print(f"\n=== US Options Analysis: {result['symbol']} ===")
    print(f"Spot: ${result['spot']:.2f}")
    print(f"ATM IV (30d): {result['atm_iv'] * 100:.1f}%")
    print(f"Skew Slope: {result['skew_metrics']['skew_slope']:.4f}")
    print(f"Put Wing Premium: {result['skew_metrics']['put_wing_premium'] * 100:.2f}%")
    print(f"Prediction: {result['prediction']['direction']} (conf={result['prediction']['confidence']:.2f})")
    print(f"Rationale: {result['prediction']['rationale']}")
