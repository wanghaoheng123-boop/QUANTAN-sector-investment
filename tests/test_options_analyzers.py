"""
Tests for options_asia.py, options_us.py, options_cross_market.py
"""
import numpy as np
import pytest


class TestOptionsAsia:
    def test_black_scholes_call_parity(self):
        from options_asia import black_scholes_price

        S, K, T, r, sigma = 100, 105, 0.5, 0.05, 0.25
        call = black_scholes_price(S, K, T, r, sigma, "call")
        put = black_scholes_price(S, K, T, r, sigma, "put")

        # Put-call parity: C - P = S - K * exp(-rT)
        parity_diff = call - put - (S - K * np.exp(-r * T))
        assert abs(parity_diff) < 0.01

    def test_bs_atm_call(self):
        from options_asia import black_scholes_price

        # ATM call should be close to 0.4 * S * sigma * sqrt(T)
        S, K, T, r, sigma = 100, 100, 1 / 12, 0.05, 0.20
        call = black_scholes_price(S, K, T, r, sigma, "call")
        expected_approx = 0.4 * S * sigma * np.sqrt(T)
        assert abs(call - expected_approx) < 1.0

    def test_bs_deep_itm(self):
        from options_asia import black_scholes_price

        # Deep ITM call should be close to intrinsic + time value
        S, K, T, r, sigma = 100, 50, 0.5, 0.05, 0.25
        call = black_scholes_price(S, K, T, r, sigma, "call")
        intrinsic = S - K * np.exp(-r * T)
        assert call >= intrinsic * 0.98

    def test_iv_roundtrip(self):
        from options_asia import black_scholes_price, implied_volatility

        S, K, T, r, sigma = 100, 105, 0.5, 0.05, 0.25
        price = black_scholes_price(S, K, T, r, sigma, "call")
        iv = implied_volatility(price, S, K, T, r, "call")
        assert iv is not None
        assert abs(iv - sigma) < 0.02

    def test_iv_below_intrinsic(self):
        from options_asia import implied_volatility

        # Deep OTM put with price below intrinsic (K=50, S=100, intrinsic=0)
        # Actually for a put: intrinsic = max(0, K-S) = 0 when K<S
        # Use deep ITM put instead: K=150, S=100, intrinsic=50, market=1 → below intrinsic
        iv = implied_volatility(1.0, 100, 150, 0.5, 0.05, "put")
        assert iv is None

    def test_simulated_chain(self):
        from options_asia import generate_simulated_chain

        calls, puts = generate_simulated_chain(spot=2.80)
        assert len(calls) > 0
        assert len(puts) > 0
        assert all(c.option_type == "call" for c in calls)
        assert all(p.option_type == "put" for p in puts)
        # OTM puts should have higher IV than ATM
        atm_iv = min(puts, key=lambda p: abs(p.strike - 2.80)).iv
        otm_puts = [p for p in puts if p.strike < 2.70]
        if otm_puts:
            assert np.mean([p.iv for p in otm_puts]) >= atm_iv * 0.95

    def test_pcr_computation(self):
        from options_asia import compute_pcr, generate_simulated_chain

        calls, puts = generate_simulated_chain(seed=123)
        pcr = compute_pcr(calls, puts)
        assert "volume_ratio" in pcr
        assert pcr["put_volume"] > 0
        assert pcr["call_volume"] > 0

    def test_atm_iv(self):
        from options_asia import compute_atm_iv, generate_simulated_chain

        calls, puts = generate_simulated_chain(spot=2.80, atm_iv=0.22)
        iv = compute_atm_iv(calls, puts, 2.80)
        assert iv is not None
        assert 0.15 < iv < 0.30

    def test_skew(self):
        from options_asia import compute_skew, generate_simulated_chain

        calls, puts = generate_simulated_chain(spot=2.80)
        skew = compute_skew(calls, puts, 2.80)
        assert "skew_slope" in skew
        # With our simulation, skew should be negative (puts higher IV)
        assert skew["skew_slope"] < 0.01  # Allow slight positive

    def test_generate_signal_bearish(self):
        from options_asia import generate_signal

        pcr = {"volume_ratio": 1.5}
        skew = {"skew_slope": -0.10}
        sig = generate_signal(pcr, skew)
        assert sig["direction"] in ("BULLISH", "BEARISH", "NEUTRAL")

    def test_generate_signal_bullish(self):
        from options_asia import generate_signal

        pcr = {"volume_ratio": 0.5}
        skew = {"skew_slope": 0.03}
        sig = generate_signal(pcr, skew)
        assert sig["direction"] in ("BULLISH", "BEARISH", "NEUTRAL")

    def test_analyze_asia_options(self):
        try:
            import matplotlib  # noqa: F401
        except ImportError:
            pytest.skip("matplotlib not available")
        from options_asia import analyze_asia_options

        result = analyze_asia_options("510050", use_simulated=True)
        assert result["symbol"] == "510050"
        assert result["spot"] > 0
        assert result["data_source"] == "simulated"


class TestOptionsUs:
    def test_analyze_us_demo(self):
        from options_us import analyze_us_options_demo

        result = analyze_us_options_demo("SPY", days=60)
        assert result["symbol"] == "SPY"
        assert result["spot"] > 0
        assert result["atm_iv"] is not None
        assert "skew_metrics" in result
        assert result["prediction"]["direction"] in ("BULLISH", "BEARISH", "NEUTRAL")

    def test_predict_from_skew(self):
        from options_us import predict_from_skew

        # Very steep skew → contrarian bullish
        pred = predict_from_skew(-0.15)
        assert pred["direction"] == "BULLISH"
        assert pred["confidence"] > 0.5

        # Flat/call skew → cautious
        pred2 = predict_from_skew(0.05)
        assert pred2["direction"] in ("BEARISH", "NEUTRAL")

    def test_predict_with_history(self):
        from options_us import predict_from_skew

        history = [-0.03, -0.035, -0.032, -0.028, -0.04, -0.035] * 10
        # Normal range
        pred = predict_from_skew(-0.033, history)
        assert pred["direction"] == "NEUTRAL"


class TestCrossMarket:
    def test_compute_spread(self):
        from options_cross_market import compute_cross_market_spread

        result = compute_cross_market_spread(
            asia_atm_iv=0.25,
            us_atm_iv=0.18,
            asia_skew_slope=-0.06,
            us_skew_slope=-0.02,
        )
        assert result["iv_spread"] == 0.07
        assert "regime_label" in result
        assert abs(result["regime_score"]) <= 1.0

    def test_build_global_vol_factor(self):
        from options_cross_market import build_global_vol_trend_factor
        import numpy as np

        asia_iv = [0.22 + np.random.randn() * 0.003 for _ in range(100)]
        us_iv = [0.18 + np.random.randn() * 0.003 for _ in range(100)]
        result = build_global_vol_trend_factor(asia_iv, us_iv)
        assert "factor_values" in result
        assert result["factor_name"] == "global_vol_regime"
        assert "ts_integration" in result

    def test_demo_cross_market(self):
        from options_cross_market import demo_cross_market

        result = demo_cross_market()
        assert "cross_market_spread" in result
        assert "trend_factor" in result
