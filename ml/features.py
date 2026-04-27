"""
Feature engineering for the ML ensemble model.

Input: OHLCV arrays (oldest → newest).
Output: 14-feature vector per bar:
  [rsi14, macd_hist, bb_pct_b, atr_pct, obv_slope, ret5d, ret10d, ret20d,
   volume_ratio, vol_regime, ema9_slope, ema21_slope, close_to_high52, close_to_low52]
"""

import numpy as np


def _ema(series: np.ndarray, period: int) -> np.ndarray:
    k = 2.0 / (period + 1)
    out = np.full(len(series), np.nan)
    if len(series) < period:
        return out
    out[period - 1] = series[:period].mean()
    for i in range(period, len(series)):
        out[i] = series[i] * k + out[i - 1] * (1 - k)
    return out


def _wilder_smooth(series: np.ndarray, period: int) -> np.ndarray:
    """Wilder smoothing (used for RSI/ATR)."""
    out = np.full(len(series), np.nan)
    if len(series) < period:
        return out
    out[period - 1] = series[:period].mean()
    for i in range(period, len(series)):
        out[i] = (out[i - 1] * (period - 1) + series[i]) / period
    return out


def compute_features(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[float],
) -> np.ndarray:
    """
    Returns a 2D array of shape (n_bars, 14) where n_bars = len(closes).
    Rows before sufficient warmup will contain NaN.
    """
    c = np.array(closes, dtype=float)
    h = np.array(highs, dtype=float)
    lo = np.array(lows, dtype=float)
    v = np.array(volumes, dtype=float)
    n = len(c)
    out = np.full((n, 14), np.nan)

    # ── RSI(14) ──────────────────────────────────────────────────────────
    delta = np.diff(c, prepend=np.nan)
    gains = np.where(delta > 0, delta, 0.0)
    losses = np.where(delta < 0, -delta, 0.0)
    avg_gain = _wilder_smooth(gains[1:], 14)
    avg_loss = _wilder_smooth(losses[1:], 14)
    # Pad back to length n
    avg_gain = np.concatenate([[np.nan], avg_gain])
    avg_loss = np.concatenate([[np.nan], avg_loss])
    rs = np.where(avg_loss > 0, avg_gain / avg_loss, 100.0)
    rsi = 100 - 100 / (1 + rs)
    out[:, 0] = rsi

    # ── MACD histogram (12/26/9) ─────────────────────────────────────────
    ema12 = _ema(c, 12)
    ema26 = _ema(c, 26)
    macd_line = ema12 - ema26
    signal_line = _ema(np.where(np.isnan(macd_line), 0, macd_line), 9)
    out[:, 1] = macd_line - signal_line

    # ── BB %B (20, 2σ) ───────────────────────────────────────────────────
    period = 20
    pct_b = np.full(n, np.nan)
    for i in range(period - 1, n):
        window = c[i - period + 1 : i + 1]
        mid = window.mean()
        std = window.std(ddof=1)
        if std > 0:
            pct_b[i] = (c[i] - (mid - 2 * std)) / (4 * std)
    out[:, 2] = pct_b

    # ── ATR% (14) ────────────────────────────────────────────────────────
    tr = np.maximum(h - lo, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(lo - np.roll(c, 1))))
    tr[:1] = h[:1] - lo[:1]
    atr = _wilder_smooth(tr, 14)
    out[:, 3] = np.where(c > 0, atr / c * 100, np.nan)

    # ── OBV slope (10-bar linear regression slope normalised by price) ───
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            obv[i] = obv[i - 1] + v[i]
        elif c[i] < c[i - 1]:
            obv[i] = obv[i - 1] - v[i]
        else:
            obv[i] = obv[i - 1]
    obv_slope = np.full(n, np.nan)
    window_s = 10
    xs = np.arange(window_s, dtype=float)
    xs -= xs.mean()
    for i in range(window_s - 1, n):
        ys = obv[i - window_s + 1 : i + 1]
        obv_slope[i] = np.dot(xs, ys) / (np.dot(xs, xs) + 1e-12)
    # Normalise by average volume so it is scale-free
    avg_vol = np.where(v > 0, v, 1)
    out[:, 4] = obv_slope / (avg_vol + 1e-12)

    # ── 5/10/20-day returns ───────────────────────────────────────────────
    for col, lag in zip([5, 6, 7], [5, 10, 20]):
        ret = np.full(n, np.nan)
        for i in range(lag, n):
            if c[i - lag] > 0:
                ret[i] = (c[i] - c[i - lag]) / c[i - lag]
        out[:, col] = ret

    # ── Volume ratio (today / 20-day avg) ────────────────────────────────
    vol_ratio = np.full(n, np.nan)
    for i in range(19, n):
        avg = v[i - 19 : i + 1].mean()
        if avg > 0:
            vol_ratio[i] = v[i] / avg
    out[:, 8] = vol_ratio

    # ── Volatility regime (vol20 / vol60 ratio) ───────────────────────────
    log_ret = np.log(c[1:] / c[:-1])
    log_ret = np.concatenate([[np.nan], log_ret])
    vol20 = np.full(n, np.nan)
    vol60 = np.full(n, np.nan)
    for i in range(19, n):
        vol20[i] = np.std(log_ret[i - 19 : i + 1], ddof=1) * np.sqrt(252)
    for i in range(59, n):
        vol60[i] = np.std(log_ret[i - 59 : i + 1], ddof=1) * np.sqrt(252)
    out[:, 9] = np.where(vol60 > 0, vol20 / vol60, np.nan)

    # ── EMA slopes (normalised % change per bar) ──────────────────────────
    ema9 = _ema(c, 9)
    ema21 = _ema(c, 21)
    for col, ema_arr in zip([10, 11], [ema9, ema21]):
        slope = np.full(n, np.nan)
        for i in range(1, n):
            if not np.isnan(ema_arr[i - 1]) and ema_arr[i - 1] > 0:
                slope[i] = (ema_arr[i] - ema_arr[i - 1]) / ema_arr[i - 1]
        out[:, col] = slope

    # ── 52-week high/low proximity ────────────────────────────────────────
    high52 = np.full(n, np.nan)
    low52 = np.full(n, np.nan)
    period252 = 252
    for i in range(period252 - 1, n):
        w = c[i - period252 + 1 : i + 1]
        high52[i] = w.max()
        low52[i] = w.min()
    out[:, 12] = np.where(high52 > 0, (c - high52) / high52, np.nan)
    out[:, 13] = np.where(low52 > 0, (c - low52) / low52, np.nan)

    return out


FEATURE_NAMES = [
    "rsi14",
    "macd_hist",
    "bb_pct_b",
    "atr_pct",
    "obv_slope",
    "ret5d",
    "ret10d",
    "ret20d",
    "volume_ratio",
    "vol_regime",
    "ema9_slope",
    "ema21_slope",
    "close_to_high52",
    "close_to_low52",
]
