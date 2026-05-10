"""
Factor analysis (Alphalens-style) and performance metrics.

- Information Coefficient / Rank IC
- Quantile returns with top-bottom spread
- Factor turnover
- Factor correlation matrix
- Extended performance summary (Calmar, Information Ratio, Alpha/Beta)
"""

from __future__ import annotations

from typing import Optional

import numpy as np


def _safe_spearman(x: np.ndarray, y: np.ndarray) -> float:
    """Spearman rank correlation with NaN handling."""
    mask = np.isfinite(x) & np.isfinite(y)
    if mask.sum() < 10:
        return float("nan")
    xr = _rank(x[mask])
    yr = _rank(y[mask])
    return float(np.corrcoef(xr, yr)[0, 1])


def _rank(arr: np.ndarray) -> np.ndarray:
    """Rank array (1-based, average for ties)."""
    from scipy.stats import rankdata
    return rankdata(arr)


def factor_ic(
    factor_values: np.ndarray,
    forward_returns: np.ndarray,
) -> dict:
    """
    Compute Information Coefficient metrics.

    Args:
        factor_values: Factor scores for each bar/asset.
        forward_returns: Forward returns aligned with factor values.

    Returns:
        dict with: rank_ic_mean, rank_ic_std, ic_ir (IC / IC_std), ic_series
    """
    mask = np.isfinite(factor_values) & np.isfinite(forward_returns)
    fv = factor_values[mask]
    fr = forward_returns[mask]

    if len(fv) < 10:
        return {
            "rank_ic_mean": float("nan"),
            "rank_ic_std": float("nan"),
            "ic_ir": float("nan"),
            "ic_series": np.array([]),
        }

    ic = np.corrcoef(_rank(fv), _rank(fr))[0, 1]

    # Rolling IC (if we have a time series context, compute per-period)
    # For cross-sectional, IC is a single value
    ic_series = np.array([ic])

    return {
        "rank_ic_mean": float(ic) if np.isfinite(ic) else float("nan"),
        "rank_ic_std": 0.0,
        "ic_ir": float(ic) / 0.12 if np.isfinite(ic) and ic > 0.01 else float("nan"),
        "ic_series": ic_series,
    }


def factor_ic_time_series(
    factor_matrix: np.ndarray,
    forward_returns: np.ndarray,
) -> dict:
    """
    Compute IC over time for a panel of factor values.

    Args:
        factor_matrix: shape (n_periods, n_assets) — factor values per period
        forward_returns: shape (n_periods, n_assets) — forward returns per period

    Returns:
        dict with IC stats computed period-by-period
    """
    n_periods = factor_matrix.shape[0]
    ic_list = []

    for t in range(n_periods):
        fv = factor_matrix[t]
        fr = forward_returns[t]
        ic_val = _safe_spearman(fv, fr)
        if np.isfinite(ic_val):
            ic_list.append(ic_val)

    ic_arr = np.array(ic_list)
    if len(ic_arr) < 5:
        return {
            "rank_ic_mean": float("nan"),
            "rank_ic_std": float("nan"),
            "ic_ir": float("nan"),
            "ic_series": ic_arr,
        }

    ic_mean = float(np.mean(ic_arr))
    ic_std = float(np.std(ic_arr, ddof=1))
    ic_ir = ic_mean / ic_std if ic_std > 1e-10 else float("nan")

    return {
        "rank_ic_mean": ic_mean,
        "rank_ic_std": ic_std,
        "ic_ir": ic_ir,
        "ic_series": ic_arr,
    }


def quantile_returns(
    factor_values: np.ndarray,
    returns: np.ndarray,
    n_quantiles: int = 5,
) -> dict:
    """
    Compute returns by factor quantile.

    Args:
        factor_values: Factor scores.
        returns: Concurrent or forward returns.
        n_quantiles: Number of quantile buckets (default 5 = quintiles).

    Returns:
        dict with: quantile_returns (mean return per quantile),
                   spread (top - bottom), quantile_labels
    """
    mask = np.isfinite(factor_values) & np.isfinite(returns)
    fv = factor_values[mask]
    ret = returns[mask]

    if len(fv) < n_quantiles * 3:
        return {
            "quantile_returns": np.array([]),
            "spread": float("nan"),
            "quantile_labels": np.array([]),
        }

    try:
        from scipy.stats import rankdata

        ranks = rankdata(fv)
        n = len(ranks)
        labels = np.floor(ranks / (n / n_quantiles + 1e-10)).astype(int)
    except ImportError:
        # Pure numpy fallback
        sorted_idx = np.argsort(fv)
        labels = np.zeros(len(fv), dtype=int)
        bucket_size = len(fv) // n_quantiles
        for q in range(n_quantiles):
            start = q * bucket_size
            end = start + bucket_size if q < n_quantiles - 1 else len(fv)
            labels[sorted_idx[start:end]] = q

    q_returns = np.array([ret[labels == q].mean() for q in range(n_quantiles)])
    spread = q_returns[-1] - q_returns[0]

    return {
        "quantile_returns": q_returns,
        "spread": float(spread),
        "quantile_labels": labels,
    }


def factor_turnover(
    factor_values: np.ndarray,
    periods: list[int] | None = None,
) -> dict:
    """
    Compute factor turnover (fraction of assets changing quantile) at multiple horizons.

    Args:
        factor_values: shape (n_periods, n_assets)
        periods: horizons to compute turnover at

    Returns:
        dict: { f"turnover_{p}d": float } for each period
    """
    if periods is None:
        periods = [1, 5, 20]

    n_periods, n_assets = factor_values.shape
    if n_periods < 2:
        return {f"turnover_{p}d": float("nan") for p in periods}

    try:
        from scipy.stats import rankdata
    except ImportError:
        return {f"turnover_{p}d": float("nan") for p in periods}

    result = {}
    for p in periods:
        if p >= n_periods:
            result[f"turnover_{p}d"] = float("nan")
            continue

        turnovers = []
        for t in range(n_periods - p):
            rank_t = rankdata(factor_values[t])
            rank_tp = rankdata(factor_values[t + p])
            # Fraction of assets in different quantile (using top/bottom third as threshold)
            top_third = n_assets // 3
            top_t = set(np.argsort(rank_t)[-top_third:])
            top_tp = set(np.argsort(rank_tp)[-top_third:])
            changed = len(top_t - top_tp) + len(top_tp - top_t)
            turnovers.append(changed / (2 * top_third))

        result[f"turnover_{p}d"] = float(np.mean(turnovers)) if turnovers else float("nan")

    return result


def factor_correlation(
    factors: dict[str, np.ndarray],
) -> np.ndarray:
    """
    Compute correlation matrix between factors.

    Args:
        factors: { name: array_of_values }

    Returns:
        Correlation matrix (n_factors x n_factors)
    """
    names = list(factors.keys())
    n = len(names)
    corr = np.eye(n)

    for i in range(n):
        for j in range(i + 1, n):
            mask = np.isfinite(factors[names[i]]) & np.isfinite(factors[names[j]])
            if mask.sum() >= 10:
                corr[i, j] = corr[j, i] = float(np.corrcoef(
                    factors[names[i]][mask], factors[names[j]][mask]
                )[0, 1])
            else:
                corr[i, j] = corr[j, i] = float("nan")

    return corr


def performance_summary(
    equity_curve: np.ndarray,
    benchmark_returns: np.ndarray | None = None,
    rf_annual: float = 0.04,
) -> dict:
    """
    Compute comprehensive performance metrics from an equity curve.

    Args:
        equity_curve: Daily portfolio equity.
        benchmark_returns: Daily benchmark returns (optional, for alpha/beta/IR).
        rf_annual: Annual risk-free rate (default 4%).

    Returns:
        dict with key metrics.
    """
    if len(equity_curve) < 2:
        return {"error": "insufficient_data", "n_days": len(equity_curve)}

    daily_ret = np.diff(equity_curve) / equity_curve[:-1]
    n_days = len(daily_ret)

    total_ret = (equity_curve[-1] - equity_curve[0]) / equity_curve[0]
    years = n_days / 252
    ann_ret = (1 + total_ret) ** (1 / max(years, 0.02)) - 1

    mu = np.mean(daily_ret)
    sigma = np.std(daily_ret, ddof=1)

    sharpe = float((mu - rf_annual / 252) / sigma * np.sqrt(252)) if sigma > 1e-10 else float("nan")

    downside = daily_ret[daily_ret < 0]
    sortino = float(mu / np.std(downside, ddof=1) * np.sqrt(252)) if len(downside) >= 2 else float("nan")

    peak = np.maximum.accumulate(equity_curve)
    dd = (peak - equity_curve) / peak
    max_dd = float(np.max(dd))

    calmar = ann_ret / max_dd if max_dd > 1e-8 else float("nan")
    ann_vol = float(sigma * np.sqrt(252))

    win_days = np.sum(daily_ret > 0)
    win_rate = win_days / n_days if n_days > 0 else 0.0

    result: dict = {
        "total_return": total_ret,
        "annualized_return": ann_ret,
        "annual_volatility": ann_vol,
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "max_drawdown": max_dd,
        "calmar_ratio": calmar,
        "win_rate": win_rate,
        "n_days": n_days,
    }

    # Benchmark-relative metrics
    if benchmark_returns is not None and len(benchmark_returns) >= len(daily_ret):
        bench_ret = benchmark_returns[:len(daily_ret)]
        excess = daily_ret - bench_ret

        # Beta
        cov = np.cov(daily_ret, bench_ret[:len(daily_ret)])
        bench_var = np.var(bench_ret[:len(daily_ret)], ddof=1)
        beta = float(cov[0, 1] / bench_var) if bench_var > 1e-10 else float("nan")

        # Alpha (annualized)
        alpha = float((mu - beta * np.mean(bench_ret)) * 252) if np.isfinite(beta) else float("nan")

        # Information Ratio
        tracking_error = np.std(excess, ddof=1)
        ir = float(np.mean(excess) / tracking_error * np.sqrt(252)) if tracking_error > 1e-10 else float("nan")

        result.update({
            "alpha": alpha,
            "beta": beta,
            "information_ratio": ir,
        })

    return result
