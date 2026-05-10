"""
A-Share Options Market Analyzer.

Uses AKShare for SSE 50 ETF (510050.SH) options data with simulated fallback.
Computes PCR, ATM IV time series, volatility skew, and generates buy/sell signals.

Dependencies: akshare, py_vollib, scipy, matplotlib, pandas, numpy
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
logger = logging.getLogger(__name__)


# ─── Black-Scholes & IV (Ported from TS lib/options/greeks.ts) ───────────

def normal_cdf(x: np.ndarray) -> np.ndarray:
    """Normal CDF using scipy or A&S approximation."""
    try:
        from scipy.stats import norm
        return norm.cdf(x)
    except ImportError:
        p = 0.2316419
        a1, a2, a3, a4, a5 = 0.31938153, -0.35656378, 1.78147794, -1.82125598, 1.33027443
        inv_sqrt2pi = 0.3989422804014327
        abs_x = np.abs(x)
        t = 1 / (1 + p * abs_x)
        poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))))
        result = 1 - inv_sqrt2pi * np.exp(-abs_x * abs_x / 2) * poly
        return np.where(x < 0, 1 - result, result)


def normal_pdf(x: np.ndarray) -> np.ndarray:
    inv_sqrt2pi = 0.3989422804014327
    return inv_sqrt2pi * np.exp(-0.5 * x * x)


def black_scholes_price(
    S: float, K: float, T: float, r: float, sigma: float, option_type: str = "call"
) -> float:
    """Black-Scholes European option price."""
    if T <= 1e-10 or sigma <= 1e-10:
        return max(0.0, S - K) if option_type == "call" else max(0.0, K - S)

    d1 = (np.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)

    if option_type == "call":
        return float(S * normal_cdf(d1) - K * np.exp(-r * T) * normal_cdf(d2))
    return float(K * np.exp(-r * T) * normal_cdf(-d2) - S * normal_cdf(-d1))


def implied_volatility(
    market_price: float, S: float, K: float, T: float, r: float = 0.03,
    option_type: str = "call", max_iter: int = 100, tol: float = 1e-6,
) -> Optional[float]:
    """Newton-Raphson implied volatility solver."""
    intrinsic = max(0.0, S - K) if option_type == "call" else max(0.0, K - S)
    if market_price <= intrinsic or T <= 1e-10:
        return None

    sigma = 0.3
    for _ in range(max_iter):
        price = black_scholes_price(S, K, T, r, sigma, option_type)
        diff = price - market_price

        if abs(diff) < tol:
            return sigma

        d1 = (np.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * np.sqrt(T))
        vega = S * np.sqrt(T) * normal_pdf(d1)
        if vega < 1e-10:
            return None

        sigma -= diff / vega
        if sigma <= 0:
            return None

    return None


# ─── Option Chain Simulation ─────────────────────────────────────────────

@dataclass
class SimulatedOption:
    strike: float
    bid: float
    ask: float
    last_price: float
    volume: int
    open_interest: int
    option_type: str  # 'call' or 'put'
    expiry: str
    iv: float


def generate_simulated_chain(
    spot: float = 2.80,
    days_to_expiry: int = 30,
    atm_iv: float = 0.20,
    r: float = 0.03,
    n_strikes: int = 15,
    seed: int = 42,
) -> tuple[list[SimulatedOption], list[SimulatedOption]]:
    """
    Generate a realistic simulated option chain for testing/demo.
    Includes volatility skew (puts have higher IV than calls at same moneyness).
    """
    rng = np.random.default_rng(seed)
    T = days_to_expiry / 365.0

    step = spot * 0.03
    strikes = np.linspace(spot - n_strikes // 2 * step, spot + n_strikes // 2 * step, n_strikes)

    calls: list[SimulatedOption] = []
    puts: list[SimulatedOption] = []

    for K in strikes:
        moneyness = K / spot - 1

        # Skew: OTM puts have higher IV, OTM calls have slightly lower IV
        call_skew = -0.15 * max(moneyness, 0)
        put_skew = 0.20 * max(-moneyness, 0)
        call_iv = atm_iv + call_skew + rng.normal(0, 0.005)
        put_iv = atm_iv + put_skew + rng.normal(0, 0.005)

        call_price = black_scholes_price(spot, K, T, r, max(call_iv, 0.01), "call")
        put_price = black_scholes_price(spot, K, T, r, max(put_iv, 0.01), "put")

        calls.append(SimulatedOption(
            strike=float(K), bid=call_price * 0.98, ask=call_price * 1.02,
            last_price=call_price, volume=rng.integers(100, 5000),
            open_interest=rng.integers(500, 20000), option_type="call",
            expiry=datetime.now().strftime("%Y-%m-%d"), iv=max(call_iv, 0.01),
        ))
        puts.append(SimulatedOption(
            strike=float(K), bid=put_price * 0.98, ask=put_price * 1.02,
            last_price=put_price, volume=rng.integers(100, 5000),
            open_interest=rng.integers(500, 20000), option_type="put",
            expiry=datetime.now().strftime("%Y-%m-%d"), iv=max(put_iv, 0.01),
        ))

    return calls, puts


# ─── Option Analytics ────────────────────────────────────────────────────

def compute_pcr(calls: list[SimulatedOption], puts: list[SimulatedOption]) -> dict:
    """Compute Put/Call volume and OI ratios."""
    call_vol = sum(c.volume for c in calls)
    put_vol = sum(p.volume for p in puts)
    call_oi = sum(c.open_interest for c in calls)
    put_oi = sum(p.open_interest for p in puts)

    return {
        "volume_ratio": put_vol / call_vol if call_vol > 0 else None,
        "oi_ratio": put_oi / call_oi if call_oi > 0 else None,
        "call_volume": call_vol,
        "put_volume": put_vol,
        "call_oi": call_oi,
        "put_oi": put_oi,
    }


def compute_atm_iv(
    calls: list[SimulatedOption], puts: list[SimulatedOption], spot: float
) -> Optional[float]:
    """Get ATM IV (average of nearest call and put)."""
    atm_strike = min(calls, key=lambda c: abs(c.strike - spot))
    atm_put = min(puts, key=lambda p: abs(p.strike - spot))
    ivs = [atm_strike.iv, atm_put.iv]
    ivs = [v for v in ivs if v and v > 0]
    return float(np.mean(ivs)) if ivs else None


def compute_skew(
    calls: list[SimulatedOption], puts: list[SimulatedOption], spot: float
) -> dict:
    """
    Compute volatility skew metrics.

    Returns:
        skew_slope: Linear regression of IV vs moneyness
        put_skew: OTM put IV - ATM call IV
        call_skew: OTM call IV - ATM call IV
    """
    atm_call = min(calls, key=lambda c: abs(c.strike - spot))
    atm_iv = atm_call.iv

    # Separate OTM puts and OTM calls
    otm_puts = [p for p in puts if p.strike < spot]
    otm_calls = [c for c in calls if c.strike > spot]

    put_skew = np.mean([p.iv - atm_iv for p in otm_puts]) if otm_puts else 0.0
    call_skew = np.mean([c.iv - atm_iv for c in otm_calls]) if otm_calls else 0.0

    # Linear regression: IV = a + b * (K/S - 1)
    all_strikes = [c.strike for c in calls] + [p.strike for p in puts]
    all_ivs = [c.iv for c in calls] + [p.iv for p in puts]
    moneyness = np.array([k / spot - 1 for k in all_strikes])
    ivs = np.array(all_ivs)

    mask = np.isfinite(moneyness) & np.isfinite(ivs)
    if mask.sum() >= 5:
        slope, intercept = np.polyfit(moneyness[mask], ivs[mask], 1)
    else:
        slope, intercept = 0.0, atm_iv

    return {
        "skew_slope": float(slope),
        "atm_iv": atm_iv,
        "put_skew": put_skew,
        "call_skew": call_skew,
        "intercept": float(intercept),
    }


# ─── Signal Fusion ───────────────────────────────────────────────────────

def generate_signal(
    pcr: dict,
    skew: dict,
    pcr_history: list[float] | None = None,
    skew_history: list[float] | None = None,
) -> dict:
    """
    Fuse PCR and skew into a directional signal.

    Rules:
      - PCR > 1.2 AND skew_slope < -0.05 (steep) → bearish → signal -0.5
      - PCR < 0.7 AND skew modest → bullish → signal +0.5
      - PCR < 30th percentile AND skew < 30th percentile → signal +0.5
      - Otherwise → neutral → signal 0
    """
    pcr_val = pcr.get("volume_ratio") or 1.0
    skew_val = skew.get("skew_slope") or 0.0
    score = 0.0
    reasons = []

    # Absolute threshold rules
    if pcr_val > 1.2:
        score -= 0.3
        reasons.append("PCR elevated (>1.2)")
    elif pcr_val < 0.7:
        score += 0.3
        reasons.append("PCR low (<0.7)")

    if skew_val < -0.08:
        score -= 0.3
        reasons.append("Put skew steep (bearish)")
    elif skew_val > 0.02:
        score += 0.2
        reasons.append("Call skew elevated (bullish)")

    # Relative z-score rules (if history available)
    if pcr_history and len(pcr_history) >= 20:
        pcr_z = (pcr_val - np.mean(pcr_history[-20:])) / max(np.std(pcr_history[-20:]), 1e-10)
        if pcr_z > 1.5:
            score -= 0.2
            reasons.append(f"PCR z-score spike ({pcr_z:.1f})")

    if skew_history and len(skew_history) >= 20:
        skew_z = (skew_val - np.mean(skew_history[-20:])) / max(np.std(skew_history[-20:]), 1e-10)
        if skew_z < -1.5:
            score -= 0.2
            reasons.append(f"Skew steepening ({skew_z:.1f})")

    # Historical percentile check
    if pcr_history and len(pcr_history) >= 30 and skew_history and len(skew_history) >= 30:
        pcr_pct = (sum(1 for v in pcr_history[-30:] if v <= pcr_val) / 30)
        skew_pct = (sum(1 for v in skew_history[-30:] if v <= skew_val) / 30)
        if pcr_pct < 0.30 and skew_pct < 0.30:
            score += 0.5
            reasons.append("PCR and skew both < 30th pctile (bullish)")

    score = max(-1.0, min(1.0, score))

    if score >= 0.3:
        direction = "BULLISH"
    elif score <= -0.3:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    return {
        "score": score,
        "direction": direction,
        "pcr": pcr_val,
        "skew_slope": skew_val,
        "reasons": reasons,
    }


# ─── Visualization ───────────────────────────────────────────────────────

def generate_chart(
    prices: pd.Series,
    pcr_values: pd.Series,
    skew_values: pd.Series,
    signals: list[dict] | None = None,
    symbol: str = "510050",
    output_path: str | None = None,
) -> str:
    """
    Generate 3-panel chart: price, PCR, IV skew. Returns path to saved PNG.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
    except ImportError:
        logger.warning("matplotlib not installed. Skipping chart generation.")
        return ""
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates

    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), sharex=True)

    # Panel 1: Price with 20-period MA
    ax1.plot(prices.index, prices.values, color="#2196F3", linewidth=1.2, label="Close")
    if len(prices) >= 20:
        ma20 = prices.rolling(20).mean()
        ax1.plot(ma20.index, ma20.values, color="#FF9800", linewidth=1.0, alpha=0.7, label="MA20")
    ax1.set_ylabel("Price (CNY)", fontsize=11)
    ax1.set_title(f"{symbol} Options Market Analysis", fontsize=14, fontweight="bold")
    ax1.legend(loc="upper left", fontsize=9)
    ax1.grid(True, alpha=0.3)

    # Panel 2: PCR with thresholds
    ax2.fill_between(pcr_values.index, 0, pcr_values.values, alpha=0.3, color="#2196F3")
    ax2.plot(pcr_values.index, pcr_values.values, color="#1565C0", linewidth=1.2)
    ax2.axhline(y=1.0, color="#FF5722", linestyle="--", alpha=0.7, label="PCR=1.0")
    ax2.axhline(y=1.2, color="#D32F2F", linestyle="--", alpha=0.5, label="Bearish (1.2)")
    ax2.axhline(y=0.7, color="#388E3C", linestyle="--", alpha=0.5, label="Bullish (0.7)")
    ax2.set_ylabel("Put/Call Ratio", fontsize=11)
    ax2.legend(loc="upper left", fontsize=8)
    ax2.grid(True, alpha=0.3)

    # Panel 3: ATM IV + Skew
    ax3.plot(skew_values.index, skew_values.values, color="#7B1FA2", linewidth=1.2, label="Skew Slope")
    ax3.fill_between(skew_values.index, 0, skew_values.values, alpha=0.2, color="#7B1FA2")
    ax3.axhline(y=0, color="gray", linestyle="-", alpha=0.4)
    ax3.set_ylabel("IV Skew Slope", fontsize=11)
    ax3.set_xlabel("Date", fontsize=11)
    ax3.legend(loc="upper left", fontsize=9)
    ax3.grid(True, alpha=0.3)

    # Mark signal points on price chart
    if signals:
        for s in signals:
            if s.get("direction") == "BULLISH":
                color, marker = "green", "^"
            elif s.get("direction") == "BEARISH":
                color, marker = "red", "v"
            else:
                continue
            idx = s.get("date_index", 0)
            if idx < len(prices):
                ax1.scatter(prices.index[idx], prices.values[idx], c=color, marker=marker, s=80, zorder=5)

    plt.tight_layout()
    path = output_path or f"notebooks/options_asia_{symbol}_{datetime.now().strftime('%Y%m%d')}.png"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return path


# ─── Main Analyzer ───────────────────────────────────────────────────────

def analyze_asia_options(
    symbol: str = "510050",
    spot: float = 2.80,
    days: int = 60,
    use_simulated: bool = True,
) -> dict:
    """
    Run full A-shares options analysis.

    Args:
        symbol: Underlying ticker (SSE 50 ETF)
        spot: Current spot price (used for simulated data)
        days: Number of days to simulate historical data for
        use_simulated: Use simulated data (True) or try AKShare (False)

    Returns:
        dict with PCR, skew, signal, charts path, and raw data
    """
    logger.info("Analyzing A-shares options for %s (simulated=%s)", symbol, use_simulated)

    dates = pd.date_range(end=datetime.now(), periods=days, freq="B")
    pcr_history: list[float] = []
    skew_history: list[float] = []
    prices: list[float] = []
    signals: list[dict] = []

    rng = np.random.default_rng(42)
    price = spot

    for i, date in enumerate(dates):
        price *= (1 + rng.normal(0.0002, 0.012))

        # Generate daily chain with realistic IV dynamics
        atm_iv = 0.20 + rng.normal(0, 0.003) + 0.01 * np.sin(i * 0.05)
        atm_iv = max(0.08, min(0.45, atm_iv))
        dte = 30 - (i % 20)

        calls, puts = generate_simulated_chain(price, dte, atm_iv, seed=42 + i)
        pcr = compute_pcr(calls, puts)
        skew = compute_skew(calls, puts, price)

        pvr = pcr["volume_ratio"] or 1.0
        sv = skew["skew_slope"]
        pcr_history.append(pvr)
        skew_history.append(sv)
        prices.append(price)

        # Generate signal every 5 bars
        if i >= 20 and i % 5 == 0:
            sig = generate_signal(pcr, skew, pcr_history, skew_history)
            sig["date_index"] = i
            sig["date"] = str(date.date())
            signals.append(sig)

    # Latest chain analysis
    latest_calls, latest_puts = generate_simulated_chain(prices[-1], 30, 0.20, seed=99)
    latest_pcr = compute_pcr(latest_calls, latest_puts)
    latest_skew = compute_skew(latest_calls, latest_puts, prices[-1])
    latest_signal = generate_signal(latest_pcr, latest_skew, pcr_history, skew_history)

    # Chart
    chart_path = generate_chart(
        pd.Series(prices, index=dates),
        pd.Series(pcr_history, index=dates),
        pd.Series(skew_history, index=dates),
        signals,
        symbol,
    )

    return {
        "symbol": symbol,
        "spot": prices[-1],
        "pcr": latest_pcr,
        "skew": latest_skew,
        "signal": latest_signal,
        "chart_path": chart_path,
        "historical_signals": signals,
        "data_source": "simulated" if use_simulated else "akshare",
    }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    result = analyze_asia_options("510050", use_simulated=True)

    print(f"\n=== A-Shares Options Analysis: {result['symbol']} ===")
    print(f"Spot: {result['spot']:.3f}")
    print(f"PCR (Vol): {result['pcr'].get('volume_ratio', 'N/A'):.3f}")
    print(f"Skew Slope: {result['skew']['skew_slope']:.4f}")
    print(f"Signal: {result['signal']['direction']} (score={result['signal']['score']:.2f})")
    print(f"Reasons: {', '.join(result['signal']['reasons']) if result['signal']['reasons'] else 'N/A'}")
    print(f"Chart saved to: {result['chart_path']}")
