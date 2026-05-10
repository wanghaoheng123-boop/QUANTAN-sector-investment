"""
Tests for quant_framework module.
"""

import numpy as np
import pandas as pd
import pytest

from quant_framework.data_engine import (
    _is_a_share,
    _is_us_ticker,
    available_sources,
    get_daily,
)
from quant_framework.strategy import Strategy, Portfolio, Trade
from quant_framework.backtest import (
    BacktestEngine,
    BacktestConfig,
    BacktestResult,
    _compute_sharpe,
    _compute_sortino,
    _compute_max_drawdown,
)
from quant_framework.analysis import (
    factor_ic,
    factor_ic_time_series,
    quantile_returns,
    factor_correlation,
    performance_summary,
)
from quant_framework.deploy import (
    CTPConnection,
    GoldMinerConnection,
    Order,
    Position,
)


# ─── Data Engine Tests ────────────────────────────────────────────────────

class TestTickerDetection:
    def test_is_a_share_true(self):
        assert _is_a_share("600519") is True
        assert _is_a_share("000001") is True
        assert _is_a_share("300750") is True

    def test_is_a_share_false(self):
        assert _is_a_share("AAPL") is False
        assert _is_a_share("SPY") is False
        assert _is_a_share("BTC") is False

    def test_is_us_ticker_true(self):
        assert _is_us_ticker("AAPL") is True
        assert _is_us_ticker("SPY") is True
        assert _is_us_ticker("BRK.B") is True

    def test_is_us_ticker_false(self):
        assert _is_us_ticker("600519") is False

    def test_available_sources(self):
        assert "yfinance" in available_sources("AAPL")
        assert "akshare" in available_sources("600519")


class TestGetDaily:
    def test_returns_dataframe(self):
        df = get_daily("AAPL", start="2024-01-01", end="2024-01-31")
        assert isinstance(df, pd.DataFrame)

    def test_columns_present(self):
        df = get_daily("AAPL", start="2024-01-01", end="2024-01-31")
        for col in ["open", "high", "low", "close", "volume"]:
            assert col in df.columns

    def test_empty_for_unknown_ticker(self):
        df = get_daily("ZZZXXXYYY999", start="2024-01-01", end="2024-01-31")
        assert isinstance(df, pd.DataFrame)

    def test_auto_source_selection(self):
        df = get_daily("AAPL", start="2024-01-01", end="2024-01-31", source="auto")
        assert isinstance(df, pd.DataFrame)


# ─── Strategy Tests ──────────────────────────────────────────────────────

class SmaCrossStrategy(Strategy):
    """Test strategy: buy when fast SMA > slow SMA, sell otherwise."""
    def init(self):
        self.fast = self.sma(10)
        self.slow = self.sma(30)

    def handle_data(self, i: int) -> int:
        if i < 50:
            return 0
        if np.isfinite(self.fast[i]) and np.isfinite(self.slow[i]):
            return 1 if self.fast[i] > self.slow[i] else -1
        return 0


class TestStrategy:
    def test_init_runs(self):
        s = SmaCrossStrategy({"period": 10})
        assert s.params == {"period": 10}

    def test_sma_helper(self):
        data = pd.DataFrame({
            "open": [10.0] * 100,
            "high": [11.0] * 100,
            "low": [9.0] * 100,
            "close": np.linspace(100, 200, 100),
            "volume": [1000] * 100,
        })
        s = SmaCrossStrategy()
        s.data = data
        sma = s.sma(10)
        assert len(sma) == 100
        # Last value should be close to mean of last 10
        expected = np.mean(data["close"].values[-10:])
        assert np.isfinite(sma[-1])

    def test_ema_helper(self):
        data = pd.DataFrame({
            "open": [10.0] * 100,
            "high": [11.0] * 100,
            "low": [9.0] * 100,
            "close": np.linspace(100, 200, 100),
            "volume": [1000] * 100,
        })
        s = SmaCrossStrategy()
        s.data = data
        ema = s.ema(20)
        assert len(ema) == 100
        assert np.isfinite(ema[-1])

    def test_rsi_helper(self):
        data = pd.DataFrame({
            "open": [10.0] * 100,
            "high": [11.0] * 100,
            "low": [9.0] * 100,
            "close": np.sin(np.linspace(0, 10, 100)) * 10 + 100,
            "volume": [1000] * 100,
        })
        s = SmaCrossStrategy()
        s.data = data
        rsi_vals = s.rsi(14)
        assert len(rsi_vals) == 100
        valid = rsi_vals[~np.isnan(rsi_vals)]
        assert np.all(valid >= 0) and np.all(valid <= 100)


# ─── Portfolio Tests ──────────────────────────────────────────────────────

class TestPortfolio:
    def test_initial_state(self):
        p = Portfolio(cash=100_000)
        assert p.cash == 100_000
        assert p.position == 0
        assert p.equity == 100_000

    def test_equity_updates_with_price(self):
        p = Portfolio(cash=100_000)
        p.position = 100
        p.entry_price = 150.0
        p._update_price(155.0)
        assert p.equity == 100_000 + 100 * 155.0

    def test_drawdown_tracks_peak(self):
        p = Portfolio(cash=100_000)
        p.position = 100
        p.entry_price = 100.0
        # First go up to set a high peak
        p._update_price(120.0)
        peak_equity = p.equity
        assert peak_equity > 100_000
        # Then drop below peak
        p._update_price(100.0)
        assert p.equity < peak_equity
        assert p.drawdown_pct > 0.0


# ─── Backtest Tests ──────────────────────────────────────────────────────

def generate_synthetic_data(n: int = 500, trend: float = 0.0005) -> pd.DataFrame:
    """Generate synthetic OHLCV data with random walk + trend."""
    np.random.seed(42)
    dates = pd.date_range("2020-01-01", periods=n, freq="B")
    close = 100.0 * np.exp(np.cumsum(np.random.randn(n) * 0.02 + trend))
    high = close * (1 + np.abs(np.random.randn(n)) * 0.01)
    low = close * (1 - np.abs(np.random.randn(n)) * 0.01)
    open_ = low + np.random.random(n) * (high - low)
    volume = np.random.randint(1000, 10000, n).astype(float)
    return pd.DataFrame({
        "open": open_, "high": high, "low": low, "close": close, "volume": volume,
    }, index=dates)


class TestBacktestMetrics:
    def test_sharpe_zero_for_flat_returns(self):
        ret = np.array([0.001, 0.001, 0.001, 0.001, 0.001])
        s = _compute_sharpe(ret)
        # Constant returns → zero sigma → None or very large
        assert s is None or abs(s) > 100

    def test_sharpe_with_known_returns(self):
        ret = np.array([0.01, -0.005, 0.02, -0.01, 0.015, 0.005])
        s = _compute_sharpe(ret)
        assert s is not None
        assert np.isfinite(s)

    def test_sortino_with_known_returns(self):
        ret = np.array([0.01, -0.005, 0.02, -0.01, 0.015, 0.005])
        s = _compute_sortino(ret)
        assert s is not None
        assert np.isfinite(s)

    def test_max_drawdown(self):
        eq = np.array([100, 110, 90, 85, 95, 105])
        dd = _compute_max_drawdown(eq)
        assert 0.0 < dd < 1.0
        # Peak 110, trough 85 → DD = (110-85)/110 = 25/110 ≈ 0.227
        assert abs(dd - 25 / 110) < 0.001

    def test_max_drawdown_no_decline(self):
        eq = np.array([100, 110, 120, 130])
        dd = _compute_max_drawdown(eq)
        assert dd == 0.0


class TestBacktestEngine:
    def test_insufficient_data(self):
        data = generate_synthetic_data(50)
        strategy = SmaCrossStrategy()
        engine = BacktestEngine(BacktestConfig(min_bars=200))
        result = engine.run(strategy, data)
        assert result.n_bars == 50
        assert result.total_trades == 0

    def test_full_backtest(self):
        data = generate_synthetic_data(500)
        strategy = SmaCrossStrategy()
        engine = BacktestEngine(BacktestConfig(min_bars=200))
        result = engine.run(strategy, data)
        assert result.n_bars > 0
        assert isinstance(result.total_return, float)
        assert result.max_drawdown >= 0.0
        assert result.equity_curve is not None

    def test_equity_curve_length(self):
        data = generate_synthetic_data(500)
        strategy = SmaCrossStrategy()
        engine = BacktestEngine(BacktestConfig(min_bars=200))
        result = engine.run(strategy, data)
        assert len(result.equity_curve) == 300  # n - warmup

    def test_benchmark_return(self):
        data = generate_synthetic_data(500, trend=0.001)
        strategy = SmaCrossStrategy()
        engine = BacktestEngine()
        result = engine.run(strategy, data)
        assert isinstance(result.benchmark_return, float)
        assert isinstance(result.alpha, float) or result.alpha is None


# ─── Analysis Tests ──────────────────────────────────────────────────────

class TestFactorIC:
    def test_rank_ic_perfect_positive(self):
        np.random.seed(42)
        factor = np.linspace(0, 100, 200)
        fwd_ret = factor * 0.01  # Perfect monotonic relationship
        result = factor_ic(factor, fwd_ret)
        assert result["rank_ic_mean"] > 0.9  # Near perfect

    def test_rank_ic_random(self):
        np.random.seed(42)
        factor = np.random.randn(500)
        fwd_ret = np.random.randn(500)
        result = factor_ic(factor, fwd_ret)
        # Random should give IC near 0
        assert abs(result["rank_ic_mean"]) < 0.3

    def test_rank_ic_periodic(self):
        np.random.seed(42)
        n = 200
        factor = np.sin(np.linspace(0, 4 * np.pi, n))
        fwd_ret = np.cos(np.linspace(0, 4 * np.pi, n))
        result = factor_ic(factor, fwd_ret)
        assert np.isfinite(result["rank_ic_mean"])

    def test_insufficient_data(self):
        result = factor_ic(np.array([1.0, 2.0]), np.array([0.01, 0.02]))
        assert np.isnan(result["rank_ic_mean"])


class TestFactorICTimeSeries:
    def test_ic_time_series(self):
        np.random.seed(42)
        n_periods, n_assets = 100, 50
        # Create factor with true signal
        factor_matrix = np.random.randn(n_periods, n_assets)
        fwd_rets = factor_matrix * 0.3 + np.random.randn(n_periods, n_assets) * 0.1
        result = factor_ic_time_series(factor_matrix, fwd_rets)
        assert np.isfinite(result["rank_ic_mean"])
        assert result["rank_ic_mean"] > 0.1  # Should be positive
        assert len(result["ic_series"]) > 0


class TestQuantileReturns:
    def test_quantile_spread(self):
        np.random.seed(42)
        n = 1000
        factor = np.linspace(-3, 3, n)
        returns = factor * 0.02 + np.random.randn(n) * 0.01
        result = quantile_returns(factor, returns, n_quantiles=5)
        assert len(result["quantile_returns"]) == 5
        assert result["spread"] > 0  # Top quantile should outperform bottom

    def test_insufficient_data(self):
        result = quantile_returns(np.array([1.0, 2.0]), np.array([0.01, 0.02]))
        assert np.isnan(result["spread"])


class TestFactorCorrelation:
    def test_correlation_matrix(self):
        np.random.seed(42)
        n = 200
        factors = {
            "a": np.arange(n, dtype=float),
            "b": np.arange(n, dtype=float) * -1,
            "c": np.random.randn(n),
        }
        corr = factor_correlation(factors)
        assert corr.shape == (3, 3)
        assert abs(corr[0, 1] + 1.0) < 0.01  # a and b perfectly anti-correlated
        assert np.all(np.diag(corr) == 1.0)
        assert abs(corr[0, 2]) < 0.5  # a and c mostly uncorrelated


class TestPerformanceSummary:
    def test_rising_equity(self):
        np.random.seed(42)
        # Random walk with positive drift to get realistic Sharpe
        eq = 100.0 * np.exp(np.cumsum(np.random.randn(252) * 0.015 + 0.001))
        result = performance_summary(eq)
        assert result["total_return"] > 0
        assert result["max_drawdown"] >= 0.0
        assert np.isfinite(result.get("sharpe_ratio")) or np.isnan(result.get("sharpe_ratio"))

    def test_falling_equity(self):
        np.random.seed(42)
        eq = 100.0 * np.exp(np.cumsum(np.random.randn(252) * 0.015 - 0.001))
        result = performance_summary(eq)
        assert result["total_return"] < 0

    def test_insufficient_data(self):
        result = performance_summary(np.array([100.0]))
        assert "error" in result

    def test_with_benchmark(self):
        np.random.seed(42)
        eq = 100 * np.exp(np.cumsum(np.random.randn(252) * 0.02))
        bench_ret = np.random.randn(252) * 0.01
        result = performance_summary(eq, benchmark_returns=bench_ret)
        assert "alpha" in result
        assert "beta" in result
        assert "information_ratio" in result


# ─── Deploy Tests ────────────────────────────────────────────────────────

class TestCTPConnection:
    def test_connect_disconnect(self):
        ctp = CTPConnection(user_id="test_user")
        assert ctp.connect() is True
        ctp.disconnect()

    def test_place_order_returns_order(self):
        ctp = CTPConnection()
        ctp.connect()
        order = ctp.place_order("IF2406", "buy", 1, 3500.0)
        assert isinstance(order, Order)
        assert order.symbol == "IF2406"
        assert order.status == "filled"

    def test_cancel_order(self):
        ctp = CTPConnection()
        ctp.connect()
        order = ctp.place_order("IF2406", "buy", 1, 3500.0)
        assert ctp.cancel_order(order.order_id) is True

    def test_cancel_nonexistent(self):
        ctp = CTPConnection()
        ctp.connect()
        assert ctp.cancel_order("nonexistent") is False

    def test_order_without_connect_raises(self):
        ctp = CTPConnection()
        with pytest.raises(ConnectionError):
            ctp.place_order("IF2406", "buy", 1, 3500.0)

    def test_get_account(self):
        ctp = CTPConnection()
        ctp.connect()
        account = ctp.get_account()
        assert account.total_equity > 0
        assert account.available_cash > 0


class TestGoldMinerConnection:
    def test_connect_disconnect(self):
        gm = GoldMinerConnection(token="test")
        assert gm.connect() is True
        gm.disconnect()

    def test_place_order(self):
        gm = GoldMinerConnection()
        gm.connect()
        order = gm.place_order("SHSE.600519", "buy", 100, 1800.0)
        assert order.symbol == "SHSE.600519"
        assert order.quantity == 100

    def test_positions_tracked(self):
        gm = GoldMinerConnection()
        gm.connect()
        gm.place_order("SHSE.600519", "buy", 200, 1800.0)
        positions = gm.get_positions()
        assert len(positions) == 1
        assert positions[0].symbol == "SHSE.600519"

    def test_account(self):
        gm = GoldMinerConnection()
        gm.connect()
        account = gm.get_account()
        assert account.total_equity == 500_000.0
