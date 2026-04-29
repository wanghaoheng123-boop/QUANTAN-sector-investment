"""
Abstract strategy base class and portfolio model.

Strategy lifecycle:
  1. __init__(params) — configure
  2. init() — compute indicators once before backtest starts
  3. handle_data(i) — called per bar, returns signal: 1=buy, -1=sell, 0=hold
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class Trade:
    """A completed round-trip trade."""

    ticker: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    shares: int
    direction: str  # 'long' | 'short'
    pnl: float
    pnl_pct: float
    reason: str = ""


@dataclass
class Portfolio:
    """Current portfolio state during backtest."""

    cash: float = 100_000.0
    position: int = 0
    entry_price: float = 0.0
    trades: list[Trade] = field(default_factory=list)
    _highest_equity: float = field(default=100_000.0, repr=False)

    @property
    def equity(self) -> float:
        """Total portfolio value (cash + position * current_price)."""
        return self.cash + self.position * self._current_price

    @property
    def invested(self) -> bool:
        return self.position != 0

    # Internal — set by backtest engine each bar
    _current_price: float = 0.0

    def _update_price(self, price: float) -> None:
        self._current_price = price
        if self.equity > self._highest_equity:
            self._highest_equity = self.equity

    @property
    def drawdown_pct(self) -> float:
        if self._highest_equity <= 0:
            return 0.0
        return (self._highest_equity - self.equity) / self._highest_equity


class Strategy(ABC):
    """
    Abstract base class for trading strategies.

    Usage::

        class SmaCross(Strategy):
            def init(self):
                self.sma_fast = self.sma(10)
                self.sma_slow = self.sma(30)

            def handle_data(self, i: int) -> int:
                if self.sma_fast[i] > self.sma_slow[i]:
                    return 1   # buy
                return -1       # sell
    """

    def __init__(self, params: dict[str, Any] | None = None) -> None:
        self.params = params or {}
        self.data: "pd.DataFrame | None" = None
        self.portfolio = Portfolio()

    @abstractmethod
    def init(self) -> None:
        """Called once before backtest. Compute indicators here."""
        ...

    @abstractmethod
    def handle_data(self, i: int) -> int:
        """
        Called for each bar. Return signal: 1=buy, -1=sell, 0=hold.

        Access current bar via self.data.iloc[i], indicators via self.<indicator>[i].
        """
        ...

    def sma(self, period: int, col: str = "close") -> "np.ndarray":
        """Simple Moving Average helper."""
        import numpy as np

        vals = self.data[col].values
        out = np.full(len(vals), np.nan)
        if len(vals) >= period:
            kernel = np.ones(period) / period
            out[period - 1:] = np.convolve(vals, kernel, mode="valid")
        return out

    def ema(self, period: int, col: str = "close") -> "np.ndarray":
        """Exponential Moving Average helper (SMA-seeded)."""
        import numpy as np

        vals = self.data[col].values
        out = np.full(len(vals), np.nan)
        if len(vals) < period:
            return out
        alpha = 2 / (period + 1)
        out[period - 1] = np.mean(vals[:period])
        for i in range(period, len(vals)):
            out[i] = alpha * vals[i] + (1 - alpha) * out[i - 1]
        return out

    def rsi(self, period: int = 14) -> "np.ndarray":
        """RSI helper (Wilder smoothing)."""
        import numpy as np

        closes = self.data["close"].values
        deltas = np.diff(closes, prepend=closes[0])
        gains = np.where(deltas > 0, deltas, 0.0)
        losses = np.where(deltas < 0, -deltas, 0.0)

        out = np.full(len(closes), np.nan)
        if len(closes) < period + 1:
            return out

        avg_gain = np.mean(gains[1:period + 1])
        avg_loss = np.mean(losses[1:period + 1])

        for i in range(period, len(closes)):
            if avg_loss < 1e-10:
                out[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                out[i] = 100.0 - 100.0 / (1.0 + rs)

            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        return out
