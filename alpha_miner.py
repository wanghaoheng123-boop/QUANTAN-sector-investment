"""
Automated Alpha Formula Miner using Genetic Programming.

Uses gplearn's SymbolicTransformer to explore factor formulas from OHLCV data.
Fitness: Rank IC (Spearman) between factor values and forward 5-day returns.

Output: Top N alpha formulas with IC, Sharpe ratio, and formula strings.

Usage:
    python alpha_miner.py --ticker AAPL --generations 20 --population 500
    python alpha_miner.py --demo  # Run on simulated demo data
"""

from __future__ import annotations

import argparse
import functools
import hashlib
import json
import logging
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=FutureWarning)
logger = logging.getLogger(__name__)


# ─── Safe Time-Series Operators ──────────────────────────────────────────

def safe_div(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Safe division: a / b with clipping for near-zero denominators."""
    denom = np.where(np.abs(b) < 1e-8, np.sign(b) * 1e-8, b)
    result = a / denom
    return np.clip(result, -1e10, 1e10)


def safe_sqrt(x: np.ndarray) -> np.ndarray:
    """Safe sqrt: sqrt(abs(x))."""
    return np.sqrt(np.abs(x))


def safe_log(x: np.ndarray) -> np.ndarray:
    """Safe log: log(abs(x) + 1e-8)."""
    return np.log(np.abs(x) + 1e-8)


def ts_mean(series: np.ndarray, window: int) -> np.ndarray:
    """Rolling mean over window periods."""
    if window < 1:
        window = 1
    out = np.full(len(series), np.nan)
    if len(series) >= window:
        kernel = np.ones(window) / window
        out[window - 1:] = np.convolve(series, kernel, mode="valid")
    return out


def ts_std(series: np.ndarray, window: int) -> np.ndarray:
    """Rolling standard deviation over window periods."""
    if window < 2:
        window = 2
    out = np.full(len(series), np.nan)
    for i in range(window - 1, len(series)):
        out[i] = float(np.std(series[i - window + 1:i + 1], ddof=0))
    return out


def ts_rank(series: np.ndarray, window: int) -> np.ndarray:
    """Rolling rank (percentile 0-1) over window periods."""
    if window < 2:
        window = 2
    from scipy.stats import rankdata

    out = np.full(len(series), np.nan)
    for i in range(window - 1, len(series)):
        w = series[i - window + 1:i + 1]
        out[i] = (rankdata(w)[-1] - 1) / (window - 1)
    return out


def ts_delay(series: np.ndarray, lag: int) -> np.ndarray:
    """Lag series by `lag` periods."""
    if lag < 1:
        lag = 1
    out = np.full(len(series), np.nan)
    out[lag:] = series[:-lag]
    return out


def ts_min(series: np.ndarray, window: int) -> np.ndarray:
    """Rolling minimum."""
    if window < 1:
        window = 1
    out = np.full(len(series), np.nan)
    for i in range(window - 1, len(series)):
        out[i] = float(np.min(series[i - window + 1:i + 1]))
    return out


def ts_max(series: np.ndarray, window: int) -> np.ndarray:
    """Rolling maximum."""
    if window < 1:
        window = 1
    out = np.full(len(series), np.nan)
    for i in range(window - 1, len(series)):
        out[i] = float(np.max(series[i - window + 1:i + 1]))
    return out


def ts_corr(a: np.ndarray, b: np.ndarray, window: int) -> np.ndarray:
    """Rolling Pearson correlation between two series."""
    if window < 5:
        window = 5
    out = np.full(len(a), np.nan)
    for i in range(window - 1, len(a)):
        corr = np.corrcoef(a[i - window + 1:i + 1], b[i - window + 1:i + 1])[0, 1]
        out[i] = corr if np.isfinite(corr) else 0.0
    return out


# ─── Factor Representation ────────────────────────────────────────────────

@dataclass
class AlphaFactor:
    """A discovered alpha factor formula with performance metrics."""

    name: str
    formula: str
    ic_mean: float
    ic_std: float
    sharpe: float
    rank_ic: float = 0.0
    rank_ic_series: np.ndarray = field(default_factory=lambda: np.array([]))
    ts_expression: str = ""
    turnover_5d: float = float("nan")
    created_at: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "formula": self.formula,
            "ic_mean": self.ic_mean,
            "ic_std": self.ic_std,
            "sharpe": self.sharpe,
            "rank_ic": self.rank_ic,
            "turnover_5d": self.turnover_5d,
            "ts_expression": self.ts_expression,
            "created_at": self.created_at,
        }


# ─── Simulated Data Generator ─────────────────────────────────────────────

def generate_simulated_data(
    n_bars: int = 1000,
    seed: int = 42,
) -> pd.DataFrame:
    """
    Generate realistic simulated OHLCV data with known factor patterns.
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2021-01-01", periods=n_bars, freq="B")

    # Random walk with drift
    log_returns = rng.normal(0.0003, 0.015, n_bars)
    close = 100.0 * np.exp(np.cumsum(log_returns))

    # OHLC from close with realistic patterns
    daily_range_pct = rng.exponential(0.015, n_bars) + 0.003
    open_ = close * (1 + rng.normal(0, 0.003, n_bars))
    high = np.maximum(open_, close) * (1 + daily_range_pct * 0.5)
    low = np.minimum(open_, close) * (1 - daily_range_pct * 0.5)
    volume = rng.integers(500_000, 10_000_000, n_bars).astype(float)

    df = pd.DataFrame({
        "open": open_,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }, index=dates)

    return df


def compute_forward_returns(closes: np.ndarray, horizon: int = 5) -> np.ndarray:
    """Compute forward returns for target labeling."""
    fwd = np.full(len(closes), np.nan)
    fwd[:-horizon] = (closes[horizon:] - closes[:-horizon]) / closes[:-horizon]
    return fwd


# ─── Factor Evaluation ────────────────────────────────────────────────────

def evaluate_factor(
    factor_values: np.ndarray,
    forward_returns: np.ndarray,
) -> dict:
    """
    Compute IC and Sharpe for a factor.

    Returns:
        dict with rank_ic_mean, rank_ic_std, sharpe, valid
    """
    mask = np.isfinite(factor_values) & np.isfinite(forward_returns)
    fv = factor_values[mask]
    fr = forward_returns[mask]

    if len(fv) < 30:
        return {"rank_ic_mean": float("nan"), "rank_ic_std": float("nan"), "sharpe": float("nan"), "valid": False}

    # Rank IC (Spearman)
    from scipy.stats import rankdata, spearmanr

    ic, _ = spearmanr(fv, fr)
    ic = float(ic) if np.isfinite(ic) else float("nan")

    # Factor long/short Sharpe
    top_quintile = np.percentile(fv, 80)
    bot_quintile = np.percentile(fv, 20)
    long_mask = fv >= top_quintile
    short_mask = fv <= bot_quintile
    spread_returns = (fr[long_mask].mean() - fr[short_mask].mean()) if long_mask.any() and short_mask.any() else 0.0

    # Daily spread Sharpe
    # Approximate by using the mean spread return and cross-sectional std
    spread_mean = float(np.mean(fr[long_mask])) - float(np.mean(fr[short_mask]))
    spread_std = float(np.std(fr))

    sharpe = (spread_mean / spread_std * np.sqrt(252)) if spread_std > 1e-10 else float("nan")

    return {"rank_ic_mean": ic, "rank_ic_std": 0.0, "sharpe": sharpe, "valid": True}


# ─── Manual Formula Search (No gplearn dependency required) ───────────────

FUNCTION_SET: dict[str, Callable] = {
    "add": lambda a, b: a + b,
    "sub": lambda a, b: a - b,
    "mul": lambda a, b: a * b,
    "div": safe_div,
    "sqrt": safe_sqrt,
    "log": safe_log,
    "neg": lambda x: -x,
    "inv": lambda x: np.where(np.abs(x) > 1e-8, 1.0 / x, 0.0),
}


def _build_expression_tree(
    formula_template: str,
    base_series: dict[str, np.ndarray],
) -> np.ndarray:
    """
    Evaluate a formula string using base series and function set.

    Example: "div(volume, ts_mean(volume, 20))" → np.ndarray
    """
    # Simple expression evaluator for testable formulas
    namespace = {**FUNCTION_SET, **base_series}
    namespace.update({
        "ts_mean": ts_mean,
        "ts_std": ts_std,
        "ts_rank": ts_rank,
        "ts_delay": ts_delay,
        "ts_min": ts_min,
        "ts_max": ts_max,
        "ts_corr": ts_corr,
    })
    try:
        result = eval(formula_template, {"__builtins__": {}}, namespace)
        return np.asarray(result, dtype=float)
    except Exception as e:
        logger.debug("Formula evaluation failed: %s — %s", formula_template, e)
        return np.full(1, np.nan)


# Built-in formula candidates for demonstration
FORMULA_CANDIDATES = [
    # Momentum
    ("close / ts_delay(close, 5) - 1", "mom_5d"),
    ("close / ts_delay(close, 20) - 1", "mom_20d"),
    ("close / ts_mean(close, 50) - 1", "mom_50d_dev"),
    # Mean-reversion
    ("(close - ts_mean(close, 20)) / ts_std(close, 20)", "zscore_20d"),
    ("(close - ts_mean(close, 50)) / ts_std(close, 50)", "zscore_50d"),
    ("ts_rank(close, 20)", "rank_20d"),
    # Volume-price
    ("volume / ts_mean(volume, 20) - 1", "vol_ratio_20d"),
    ("safe_div(close - open, high - low + 1e-8)", "intraday_sentiment"),
    # Volatility
    ("ts_std(close, 20) / ts_mean(close, 20)", "volatility_20d"),
    ("ts_std(close, 10) / ts_std(close, 50) - 1", "vol_ratio_10v50"),
    # Combination
    ("mul(close / ts_delay(close, 5) - 1, volume / ts_mean(volume, 20) - 1)", "mom_x_vol"),
    ("sub(ts_rank(close, 20), ts_rank(volume, 20))", "close_vs_vol_divergence"),
    # Cross-sectional (uses ts_mean on returns)
    ("safe_div(high - low, close) * volume / ts_mean(volume, 20)", "range_vol_weighted"),
]


def search_factors(
    data: pd.DataFrame,
    n_top: int = 10,
    forward_horizon: int = 5,
) -> list[AlphaFactor]:
    """
    Search through predefined formula candidates and evaluate each.

    Args:
        data: OHLCV DataFrame
        n_top: Number of top factors to return
        forward_horizon: Days ahead for return prediction

    Returns:
        List of AlphaFactor sorted by Rank IC descending
    """
    closes = data["close"].values
    volumes = data["volume"].values
    highs = data["high"].values
    lows = data["low"].values
    opens = data["open"].values

    base_series = {
        "close": closes,
        "open": opens,
        "high": highs,
        "low": lows,
        "volume": volumes,
    }

    fwd_returns = compute_forward_returns(closes, forward_horizon)

    results: list[AlphaFactor] = []
    for formula, name in FORMULA_CANDIDATES:
        factor_vals = _build_expression_tree(formula, base_series)
        if len(factor_vals) < 30 or np.all(np.isnan(factor_vals)):
            continue

        metrics = evaluate_factor(factor_vals, fwd_returns)
        if not metrics["valid"] or not np.isfinite(metrics["rank_ic_mean"]):
            continue

        results.append(AlphaFactor(
            name=f"alpha_{name}",
            formula=formula,
            ic_mean=metrics["rank_ic_mean"],
            ic_std=metrics["rank_ic_std"],
            sharpe=metrics["sharpe"],
            rank_ic=metrics["rank_ic_mean"],
            created_at=datetime.now().isoformat(),
            ts_expression=_to_ts_expression(formula),
        ))

    # Sort by absolute rank IC
    results.sort(key=lambda f: abs(f.rank_ic), reverse=True)
    return results[:n_top]


def _to_ts_expression(formula: str) -> str:
    """Convert Python formula to TypeScript-compatible expression."""
    mapping = {
        "close / ts_delay(close, 5) - 1": "closes[i] / closes[i-5] - 1",
        "close / ts_delay(close, 20) - 1": "closes[i] / closes[i-20] - 1",
        "close / ts_mean(close, 50) - 1": "closes[i] / sma(closes, 50)[i] - 1",
        "(close - ts_mean(close, 20)) / ts_std(close, 20)": "(closes[i] - sma(closes, 20)[i]) / stdDev(closes, 20)",
        "(close - ts_mean(close, 50)) / ts_std(close, 50)": "(closes[i] - sma(closes, 50)[i]) / stdDev(closes, 50)",
        "ts_rank(close, 20)": "percentileRank(closes, 20, i)",
        "volume / ts_mean(volume, 20) - 1": "volumes[i] / sma(volumes, 20)[i] - 1",
        "safe_div(close - open, high - low + 1e-8)": "(closes[i] - opens[i]) / (highs[i] - lows[i] + 1e-8)",
        "ts_std(close, 20) / ts_mean(close, 20)": "stdDev(closes, 20) / sma(closes, 20)[i]",
        "ts_std(close, 10) / ts_std(close, 50) - 1": "stdDev(closes, 10) / stdDev(closes, 50) - 1",
        "mul(close / ts_delay(close, 5) - 1, volume / ts_mean(volume, 20) - 1)": "(closes[i]/closes[i-5]-1) * (volumes[i]/sma(volumes,20)[i]-1)",
        "sub(ts_rank(close, 20), ts_rank(volume, 20))": "percentileRank(closes,20,i) - percentileRank(volumes,20,i)",
        "safe_div(high - low, close) * volume / ts_mean(volume, 20)": "(highs[i]-lows[i])/closes[i] * volumes[i]/sma(volumes,20)[i]",
    }
    return mapping.get(formula, formula)


# ─── Genetic Programming Integration (gplearn) ────────────────────────────

def search_with_gplearn(
    data: pd.DataFrame,
    generations: int = 10,
    population_size: int = 300,
    n_top: int = 10,
    forward_horizon: int = 5,
) -> list[AlphaFactor]:
    """
    Use gplearn SymbolicTransformer for genetic programming factor discovery.

    Args:
        data: OHLCV DataFrame
        generations: Number of generations to evolve
        population_size: Population size
        n_top: Number of top factors to return
        forward_horizon: Days ahead for return prediction

    Returns:
        List of AlphaFactor with evolved formulas
    """
    try:
        from gplearn.genetic import SymbolicTransformer
        from gplearn.functions import make_function
    except ImportError:
        logger.warning("gplearn not installed. Install with: pip install gplearn")
        logger.info("Falling back to formula candidate search...")
        return search_factors(data, n_top, forward_horizon)

    closes = data["close"].values
    volumes = data["volume"].values
    highs = data["high"].values
    lows = data["low"].values
    opens = data["open"].values

    fwd_returns = compute_forward_returns(closes, forward_horizon)

    # Create time-series features for gplearn
    n = len(closes)
    features = np.column_stack([
        closes,
        opens,
        highs,
        lows,
        volumes,
        ts_mean(closes, 5),
        ts_mean(closes, 10),
        ts_mean(closes, 20),
        ts_mean(closes, 50),
        ts_std(closes, 10),
        ts_std(closes, 20),
        ts_mean(volumes, 20),
        ts_delay(closes, 5),
        ts_delay(closes, 20),
    ])

    feature_names = [
        "close", "open", "high", "low", "volume",
        "sma5", "sma10", "sma20", "sma50",
        "std10", "std20",
        "vol_sma20", "close_lag5", "close_lag20",
    ]

    # Remove NaN rows
    valid_mask = np.all(np.isfinite(features), axis=1) & np.isfinite(fwd_returns)
    X = features[valid_mask]
    y = fwd_returns[valid_mask]

    if len(X) < 100:
        logger.warning("Insufficient valid data for gplearn. Falling back to candidate search.")
        return search_factors(data, n_top, forward_horizon)

    logger.info("Running gplearn SymbolicTransformer with %d samples, %d features", len(X), X.shape[1])

    # Define custom functions for gplearn
    safe_div_fn = make_function(
        function=lambda a, b: np.where(np.abs(b) > 1e-8, np.clip(a / b, -1e6, 1e6), 0.0),
        name="safe_div",
        arity=2,
    )
    safe_sqrt_fn = make_function(
        function=lambda x: np.sqrt(np.abs(x)),
        name="safe_sqrt",
        arity=1,
    )

    function_set = ["add", "sub", "mul", safe_div_fn, safe_sqrt_fn, "neg", "max", "min"]

    gp = SymbolicTransformer(
        population_size=min(population_size, len(X) // 2),
        generations=generations,
        stopping_criteria=0.01,
        function_set=function_set,
        hall_of_fame=n_top,
        n_components=n_top,
        metric="spearman",
        random_state=42,
        n_jobs=1,
        verbose=1,
    )

    try:
        gp.fit(X, y)
    except Exception as e:
        logger.error("gplearn fit failed: %s", e)
        return search_factors(data, n_top, forward_horizon)

    # Extract discovered formulas
    results: list[AlphaFactor] = []
    for i, program in enumerate(gp._best_programs[:n_top]):
        formula = str(program)
        factor_vals = program.execute(X)
        metrics = evaluate_factor(np.asarray(factor_vals, dtype=float), y)

        if metrics["valid"] and np.isfinite(metrics["rank_ic_mean"]):
            results.append(AlphaFactor(
                name=f"alpha_gp_{i + 1:03d}",
                formula=formula,
                ic_mean=metrics["rank_ic_mean"],
                ic_std=metrics["rank_ic_std"],
                sharpe=metrics["sharpe"],
                rank_ic=metrics["rank_ic_mean"],
                created_at=datetime.now().isoformat(),
                ts_expression=formula,
            ))

    results.sort(key=lambda f: abs(f.rank_ic), reverse=True)
    return results[:n_top]


# ─── CLI ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="QUANTAN Alpha Factor Miner")
    parser.add_argument("--ticker", type=str, default=None, help="Stock ticker to mine")
    parser.add_argument("--demo", action="store_true", help="Run on simulated demo data")
    parser.add_argument("--generations", type=int, default=10, help="GP generations")
    parser.add_argument("--population", type=int, default=300, help="GP population size")
    parser.add_argument("--n-top", type=int, default=10, help="Number of top factors")
    parser.add_argument("--output", type=str, default=None, help="Output JSON file")
    parser.add_argument("--use-gplearn", action="store_true", help="Use gplearn GP (requires pip install gplearn)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    # Load data
    if args.demo or args.ticker is None:
        logger.info("Generating simulated demo data (1000 bars)")
        data = generate_simulated_data(1000)
    else:
        logger.info("Fetching data for %s", args.ticker)
        try:
            from quant_framework.data_engine import get_daily

            data = get_daily(args.ticker, start="2021-01-01")
            if data.empty:
                logger.error("No data for %s. Using demo data.", args.ticker)
                data = generate_simulated_data(1000)
        except ImportError:
            logger.warning("quant_framework not available. Using simulated data.")
            data = generate_simulated_data(1000)

    logger.info("Data loaded: %d bars from %s to %s", len(data), data.index[0], data.index[-1])

    # Mine factors
    if args.use_gplearn:
        logger.info("Running genetic programming search (gen=%d, pop=%d)", args.generations, args.population)
        factors = search_with_gplearn(data, args.generations, args.population, args.n_top)
    else:
        logger.info("Running formula candidate search")
        factors = search_factors(data, args.n_top)

    # Display results
    print("\n" + "=" * 90)
    print(f"  TOP {len(factors)} ALPHA FACTORS")
    print("=" * 90)
    for i, f in enumerate(factors, 1):
        print(f"\n  [{i}] {f.name}")
        print(f"      Formula:        {f.formula}")
        print(f"      Rank IC:        {f.rank_ic:.4f}")
        print(f"      Sharpe (spread): {f.sharpe:.2f}" if np.isfinite(f.sharpe) else f"      Sharpe (spread): N/A")
        if f.ts_expression and f.ts_expression != f.formula:
            print(f"      TS Expression:   {f.ts_expression}")
    print("\n" + "=" * 90)

    # Save to JSON if requested
    if args.output:
        output_data = [f.to_dict() for f in factors]
        with open(args.output, "w") as f:
            json.dump(output_data, f, indent=2)
        logger.info("Saved %d factors to %s", len(factors), args.output)


if __name__ == "__main__":
    main()
