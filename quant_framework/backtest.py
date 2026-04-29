"""
Walk-forward backtest engine.

Signals → trades → equity curve → institutional metrics.

Metrics formulas are ported from lib/quant/indicators.ts for cross-language consistency:
  - Sharpe: sample mean(excess_returns) / sample_std(excess_returns) * sqrt(252), N-1 denominator
  - Sortino: sample mean(excess_returns) / downside_std(excess_returns) * sqrt(252), N-1 denominator
  - Max Drawdown: max peak-to-trough decline as percentage
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from quant_framework.strategy import Portfolio, Strategy, Trade


@dataclass
class BacktestResult:
    """Complete backtest output."""

    ticker: str = ""
    initial_capital: float = 100_000.0
    final_equity: float = 0.0
    total_return: float = 0.0
    annualized_return: float = 0.0
    sharpe_ratio: Optional[float] = None
    sortino_ratio: Optional[float] = None
    max_drawdown: float = 0.0
    calmar_ratio: Optional[float] = None
    win_rate: float = 0.0
    profit_factor: float = 0.0
    avg_trade_return: float = 0.0
    total_trades: int = 0
    equity_curve: np.ndarray = field(default_factory=lambda: np.array([]))
    trades: list[Trade] = field(default_factory=list)
    annual_volatility: float = 0.0
    n_bars: int = 0
    benchmark_return: float = 0.0
    alpha: Optional[float] = None


@dataclass
class BacktestConfig:
    initial_capital: float = 100_000.0
    commission_pct: float = 0.001    # 0.1% per side
    slippage_pct: float = 0.0005     # 0.05%
    allow_short: bool = False
    position_size_pct: float = 1.0   # 100% of capital per position
    min_bars: int = 200              # minimum bars before trading


def _compute_sharpe(returns: np.ndarray, rf_annual: float = 0.04) -> Optional[float]:
    """Annualized Sharpe ratio. Sample mean / sample std * sqrt(252)."""
    excess = returns - rf_annual / 252
    if len(excess) < 2:
        return None
    mu = np.mean(excess)
    sigma = np.std(excess, ddof=1)
    if sigma < 1e-10:
        return None
    return float(mu / sigma * np.sqrt(252))


def _compute_sortino(returns: np.ndarray, mar_daily: float = 0.0) -> Optional[float]:
    """Annualized Sortino ratio. Downside deviation uses N-1 denominator."""
    excess = returns - mar_daily
    downside = excess[excess < 0]
    if len(downside) < 2 or len(returns) < 2:
        return None
    mu = np.mean(returns)
    dd_std = np.std(downside, ddof=1)
    if dd_std < 1e-10:
        return None
    return float(mu / dd_std * np.sqrt(252))


def _compute_max_drawdown(equity: np.ndarray) -> float:
    """Maximum peak-to-trough decline as a positive fraction."""
    if len(equity) < 2:
        return 0.0
    peak = np.maximum.accumulate(equity)
    dd = (peak - equity) / peak
    return float(np.max(dd))


class BacktestEngine:
    """
    Sequential walk-forward backtest engine.

    Usage::

        engine = BacktestEngine(config)
        result = engine.run(strategy, data)
    """

    def __init__(self, config: BacktestConfig | None = None) -> None:
        self.config = config or BacktestConfig()

    def run(self, strategy: Strategy, data: "pd.DataFrame") -> BacktestResult:
        """
        Run backtest on historical data.

        Args:
            strategy: Strategy instance with init() and handle_data(i).
            data: DataFrame with open/high/low/close/volume columns and date index.

        Returns:
            BacktestResult with full metrics, equity curve, and trade log.
        """
        import pandas as pd

        cfg = self.config
        strategy.data = data
        strategy.portfolio = Portfolio(cash=cfg.initial_capital)

        # Ensure data is sorted
        data = data.sort_index()
        closes = data["close"].values
        opens = data["open"].values
        n = len(closes)

        if n < cfg.min_bars:
            return BacktestResult(
                ticker=getattr(strategy, "params", {}).get("ticker", ""),
                initial_capital=cfg.initial_capital,
                n_bars=n,
            )

        # Let strategy compute indicators
        strategy.init()

        equity_curve = np.full(n, cfg.initial_capital)
        in_position = False
        entry_price = 0.0
        entry_bar = 0
        shares = 0
        trade_log: list[Trade] = []

        warmup = cfg.min_bars

        for i in range(warmup, n):
            portfolio = strategy.portfolio
            portfolio._update_price(closes[i])

            signal = strategy.handle_data(i)

            # Execute trades
            if signal == 1 and not in_position:
                # Buy
                price = opens[min(i + 1, n - 1)] * (1 + cfg.slippage_pct)
                shares = int(portfolio.cash * cfg.position_size_pct / price)
                if shares > 0:
                    cost = shares * price * (1 + cfg.commission_pct)
                    portfolio.cash -= cost
                    portfolio.position = shares
                    portfolio.entry_price = price
                    in_position = True
                    entry_price = price
                    entry_bar = i

            elif signal == -1 and in_position:
                # Sell
                price = opens[min(i + 1, n - 1)] * (1 - cfg.slippage_pct)
                proceeds = shares * price * (1 - cfg.commission_pct)
                pnl = proceeds - (shares * entry_price * (1 + cfg.commission_pct))
                pnl_pct = pnl / (shares * entry_price * (1 + cfg.commission_pct))

                trade_log.append(Trade(
                    ticker=getattr(strategy, "params", {}).get("ticker", ""),
                    entry_date=str(data.index[entry_bar]),
                    exit_date=str(data.index[i]),
                    entry_price=entry_price,
                    exit_price=price,
                    shares=shares,
                    direction="long",
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    reason="signal",
                ))

                portfolio.cash += proceeds
                portfolio.position = 0
                portfolio.entry_price = 0.0
                in_position = False

            equity_curve[i] = portfolio.equity

        # Close any open position at final close
        if in_position:
            final_price = closes[-1]
            proceeds = shares * final_price * (1 - cfg.commission_pct)
            pnl = proceeds - (shares * entry_price * (1 + cfg.commission_pct))
            pnl_pct = pnl / (shares * entry_price * (1 + cfg.commission_pct))

            trade_log.append(Trade(
                ticker=getattr(strategy, "params", {}).get("ticker", ""),
                entry_date=str(data.index[entry_bar]),
                exit_date=str(data.index[-1]),
                entry_price=entry_price,
                exit_price=final_price,
                shares=shares,
                direction="long",
                pnl=pnl,
                pnl_pct=pnl_pct,
                reason="forced_close",
            ))

            strategy.portfolio.cash += proceeds
            strategy.portfolio.position = 0
            equity_curve[-1] = strategy.portfolio.equity

        # Compute metrics
        final_eq = equity_curve[-1]
        total_ret = (final_eq - cfg.initial_capital) / cfg.initial_capital
        years = (data.index[-1] - data.index[0]).days / 365.25 if len(data.index) > 1 else 1
        ann_ret = (final_eq / cfg.initial_capital) ** (1 / max(years, 0.02)) - 1

        daily_ret = np.diff(equity_curve[warmup:]) / equity_curve[warmup:-1] if n > warmup + 1 else np.array([0.0])
        sharpe = _compute_sharpe(daily_ret)
        sortino = _compute_sortino(daily_ret)
        max_dd = _compute_max_drawdown(equity_curve)
        calmar = ann_ret / max_dd if max_dd > 1e-8 else None
        ann_vol = float(np.std(daily_ret, ddof=1) * np.sqrt(252)) if len(daily_ret) >= 2 else 0.0

        winners = [t for t in trade_log if t.pnl > 0]
        losers = [t for t in trade_log if t.pnl <= 0]
        win_rate = len(winners) / len(trade_log) if trade_log else 0.0
        total_wins = sum(t.pnl for t in winners) if winners else 0.0
        total_losses = abs(sum(t.pnl for t in losers)) if losers else 0.0
        profit_factor = total_wins / total_losses if total_losses > 0 else float("inf")
        avg_trade = float(np.mean([t.pnl_pct for t in trade_log])) if trade_log else 0.0

        # Benchmark: buy-and-hold from warmup to end
        bnh_ret = (closes[-1] - closes[warmup]) / closes[warmup] if closes[warmup] > 0 else 0.0
        alpha = ann_ret - bnh_ret / max(years, 0.02)

        return BacktestResult(
            ticker=getattr(strategy, "params", {}).get("ticker", ""),
            initial_capital=cfg.initial_capital,
            final_equity=final_eq,
            total_return=total_ret,
            annualized_return=ann_ret,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            max_drawdown=max_dd,
            calmar_ratio=calmar,
            win_rate=win_rate,
            profit_factor=profit_factor,
            avg_trade_return=avg_trade,
            total_trades=len(trade_log),
            equity_curve=equity_curve[warmup:],
            trades=trade_log,
            annual_volatility=ann_vol,
            n_bars=n - warmup,
            benchmark_return=bnh_ret,
            alpha=alpha,
        )
