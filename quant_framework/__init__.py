"""
QUANTAN Quantitative Trading Framework.

A lightweight, self-contained Python library for:
- Data acquisition (yfinance, akshare, tushare)
- Strategy definition (abstract base class with lifecycle)
- Backtesting (walk-forward engine with institutional metrics)
- Factor analysis (Alphalens-style IC, quantile returns, turnover)
- Deployment stubs (CTP, GoldMiner exchange connectivity)
"""

from quant_framework.data_engine import get_daily, get_minute, available_sources
from quant_framework.strategy import Strategy, Portfolio, Trade
from quant_framework.backtest import BacktestEngine, BacktestResult
from quant_framework.analysis import (
    factor_ic,
    quantile_returns,
    factor_turnover,
    factor_correlation,
    performance_summary,
)
from quant_framework.deploy import ExchangeConnection, CTPConnection, GoldMinerConnection

__all__ = [
    "get_daily",
    "get_minute",
    "available_sources",
    "Strategy",
    "Portfolio",
    "Trade",
    "BacktestEngine",
    "BacktestResult",
    "factor_ic",
    "quantile_returns",
    "factor_turnover",
    "factor_correlation",
    "performance_summary",
    "ExchangeConnection",
    "CTPConnection",
    "GoldMinerConnection",
]

__version__ = "0.1.0"
