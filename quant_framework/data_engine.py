"""
Unified data acquisition from yfinance (US), akshare (A-shares), and tushare (fallback).

Returns standardised pandas DataFrames with columns: date, open, high, low, close, volume.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

TICKER_US_PATTERN = r"^[A-Z]{1,5}(\.[A-Z]{1,3})?$"
TICKER_A_PATTERN = r"^\d{6}$"


def _is_a_share(ticker: str) -> bool:
    """Detect A-share ticker (6 digits)."""
    import re

    return bool(re.match(r"^\d{6}$", ticker.strip()))


def _is_us_ticker(ticker: str) -> bool:
    """Detect US ticker (1-5 letters, optional exchange suffix)."""
    import re

    t = ticker.strip().upper()
    return bool(re.match(r"^[A-Z]{1,5}(\.[A-Z]{1,3})?$", t)) and not _is_a_share(ticker)


def _fetch_yfinance(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Fetch daily OHLCV from Yahoo Finance."""
    try:
        import yfinance as yf

        t = yf.Ticker(ticker)
        df = t.history(start=start, end=end)

        if df.empty:
            return pd.DataFrame()

        df = df.rename(columns={
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        })
        df.index = pd.to_datetime(df.index).tz_localize(None)
        df.index.name = "date"
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        logger.warning("yfinance fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def _fetch_akshare(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Fetch daily OHLCV from AKShare (A-shares)."""
    try:
        import akshare as ak

        df = ak.stock_zh_a_hist(
            symbol=ticker,
            period="daily",
            start_date=start.replace("-", ""),
            end_date=end.replace("-", ""),
            adjust="qfq",
        )

        if df is None or df.empty:
            return pd.DataFrame()

        col_map = {
            "日期": "date",
            "开盘": "open",
            "最高": "high",
            "最低": "low",
            "收盘": "close",
            "成交量": "volume",
        }
        df = df.rename(columns=col_map)
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        logger.warning("akshare fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def _fetch_tushare(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Fetch daily OHLCV from Tushare (requires token in env TU_SHARE_TOKEN)."""
    try:
        import os

        import tushare as ts

        token = os.environ.get("TU_SHARE_TOKEN", "")
        if not token:
            logger.debug("TU_SHARE_TOKEN not set, skipping tushare")
            return pd.DataFrame()

        ts.set_token(token)
        pro = ts.pro_api()

        ts_code = f"{ticker}.SH" if ticker.startswith(("6", "9")) else f"{ticker}.SZ"
        df = pro.daily(ts_code=ts_code, start_date=start.replace("-", ""), end_date=end.replace("-", ""))

        if df is None or df.empty:
            return pd.DataFrame()

        df = df.rename(columns={
            "trade_date": "date",
            "open": "open",
            "high": "high",
            "low": "low",
            "close": "close",
            "vol": "volume",
        })
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date")
        df = df.sort_index()
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        logger.warning("tushare fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def get_daily(
    ticker: str,
    start: str | None = None,
    end: str | None = None,
    source: str = "auto",
) -> pd.DataFrame:
    """
    Fetch daily OHLCV data.

    Args:
        ticker: Stock symbol. US: 'AAPL', A-share: '600519'
        start: Start date 'YYYY-MM-DD'. Default: 2 years ago.
        end: End date 'YYYY-MM-DD'. Default: today.
        source: 'auto', 'yfinance', 'akshare', or 'tushare'

    Returns:
        DataFrame with date index and columns: open, high, low, close, volume
    """
    if end is None:
        end = datetime.now().strftime("%Y-%m-%d")
    if start is None:
        start = f"{datetime.now().year - 2}-{datetime.now().month:02d}-{datetime.now().day:02d}"

    ticker = ticker.strip().upper()

    if source == "auto":
        if _is_a_share(ticker):
            sources = ["akshare", "tushare"]
        else:
            sources = ["yfinance"]
    else:
        sources = [source]

    for s in sources:
        if s == "yfinance":
            df = _fetch_yfinance(ticker, start, end)
        elif s == "akshare":
            df = _fetch_akshare(ticker, start, end)
        elif s == "tushare":
            df = _fetch_tushare(ticker, start, end)
        else:
            raise ValueError(f"Unknown source: {s}")

        if not df.empty and len(df) >= 5:
            return df.sort_index()

    logger.warning("No data for %s from sources %s", ticker, sources)
    return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])


def get_minute(
    ticker: str,
    days: int = 5,
    source: str = "auto",
) -> pd.DataFrame:
    """
    Fetch minute-level OHLCV data.

    Args:
        ticker: Stock symbol.
        days: Number of trading days to fetch.
        source: 'auto' or 'yfinance'

    Returns:
        DataFrame with date index and columns: open, high, low, close, volume
    """
    ticker = ticker.strip().upper()

    try:
        import yfinance as yf

        t = yf.Ticker(ticker)
        period = f"{min(days, 7)}d"
        df = t.history(period=period, interval="1m")

        if df.empty:
            return pd.DataFrame()

        df = df.rename(columns={
            "Open": "open", "High": "high",
            "Low": "low", "Close": "close", "Volume": "volume",
        })
        df.index = pd.to_datetime(df.index).tz_localize(None)
        df.index.name = "date"
        return df[["open", "high", "low", "close", "volume"]]
    except Exception as e:
        logger.warning("Minute data fetch failed for %s: %s", ticker, e)
        return pd.DataFrame()


def available_sources(ticker: str) -> list[str]:
    """Return list of data sources usable for this ticker."""
    ticker = ticker.strip().upper()
    if _is_a_share(ticker):
        return ["akshare", "tushare"]
    return ["yfinance"]
