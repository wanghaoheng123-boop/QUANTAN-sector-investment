"""
Tests for alpha_miner.py
"""
import numpy as np
import pandas as pd
import pytest

from alpha_miner import (
    safe_div,
    safe_sqrt,
    safe_log,
    ts_mean,
    ts_std,
    ts_rank,
    ts_delay,
    ts_min,
    ts_max,
    ts_corr,
    generate_simulated_data,
    compute_forward_returns,
    evaluate_factor,
    search_factors,
    _build_expression_tree,
    FORMULA_CANDIDATES,
)


class TestSafeOperators:
    def test_safe_div_normal(self):
        a = np.array([10.0, 20.0, 30.0])
        b = np.array([2.0, 4.0, 6.0])
        result = safe_div(a, b)
        np.testing.assert_array_almost_equal(result, [5.0, 5.0, 5.0])

    def test_safe_div_by_zero(self):
        a = np.array([10.0, 20.0])
        b = np.array([0.0, 0.0])
        result = safe_div(a, b)
        # safe_div clips near-zero denominators → result is finite (≈0 or small)
        assert np.all(np.isfinite(result))

    def test_safe_div_near_zero(self):
        a = np.array([10.0])
        b = np.array([1e-9])
        result = safe_div(a, b)
        assert np.isfinite(result[0])

    def test_safe_sqrt_positive(self):
        result = safe_sqrt(np.array([4.0, 9.0, 16.0]))
        np.testing.assert_array_almost_equal(result, [2.0, 3.0, 4.0])

    def test_safe_sqrt_negative(self):
        result = safe_sqrt(np.array([-4.0, -9.0]))
        assert np.all(np.isfinite(result))
        assert result[0] == 2.0

    def test_safe_log(self):
        result = safe_log(np.array([1.0, np.e, 0.0, -1.0]))
        assert np.all(np.isfinite(result))


class TestTimeSeriesOperators:
    def setup_method(self):
        self.data = np.linspace(10, 20, 100)

    def test_ts_mean(self):
        result = ts_mean(self.data, 10)
        assert np.isnan(result[8])
        assert np.isfinite(result[9])
        assert len(result) == len(self.data)

    def test_ts_std(self):
        result = ts_std(self.data, 10)
        assert len(result) == len(self.data)

    def test_ts_rank(self):
        result = ts_rank(self.data, 20)
        assert np.isnan(result[18])
        assert 0.0 <= result[-1] <= 1.0

    def test_ts_delay(self):
        result = ts_delay(self.data, 5)
        assert np.isnan(result[4])
        assert result[5] == self.data[0]

    def test_ts_min_max(self):
        result_min = ts_min(self.data, 10)
        result_max = ts_max(self.data, 10)
        for i in range(9, 100):
            w = self.data[i - 9:i + 1]
            assert abs(result_min[i] - np.min(w)) < 1e-10
            assert abs(result_max[i] - np.max(w)) < 1e-10

    def test_ts_corr(self):
        a = np.sin(np.linspace(0, 4 * np.pi, 100))
        b = np.cos(np.linspace(0, 4 * np.pi, 100))
        result = ts_corr(a, b, 20)
        assert len(result) == 100
        # Rolling corr of sin/cos should be near 0 at most points
        valid = result[~np.isnan(result)]
        assert np.abs(np.mean(valid)) < 0.5


class TestDataGeneration:
    def test_generate_simulated_data(self):
        df = generate_simulated_data(500)
        assert len(df) == 500
        assert all(c in df.columns for c in ["open", "high", "low", "close", "volume"])
        assert df["close"].iloc[0] > 0

    def test_forward_returns(self):
        closes = np.linspace(100, 200, 100)
        fwd = compute_forward_returns(closes, 5)
        assert len(fwd) == 100
        assert np.isnan(fwd[-1])
        assert fwd[0] > 0  # Prices going up


class TestFactorEvaluation:
    def test_evaluate_known_factor(self):
        closes = np.linspace(100, 200, 500)
        fwd = compute_forward_returns(closes, 5)
        # Perfect rank factor: just use forward returns (cheating but tests the function)
        result = evaluate_factor(closes, fwd)
        assert result.get("valid") is True
        assert np.isfinite(result.get("rank_ic_mean", float("nan")))

    def test_insufficient_data(self):
        result = evaluate_factor(np.array([1.0, 2.0]), np.array([0.01, 0.02]))
        assert result.get("valid") is False


class TestExpressionEvaluation:
    def test_build_expression_tree(self):
        closes = np.linspace(100, 200, 200)
        base = {"close": closes}
        result = _build_expression_tree("close / ts_delay(close, 5) - 1", base)
        assert len(result) == 200

    def test_invalid_formula_returns_nan(self):
        base = {"close": np.arange(100, dtype=float)}
        result = _build_expression_tree("invalid_func(close)", base)
        assert np.all(np.isnan(result)) or len(result) < 5


class TestSearchFactors:
    def test_returns_factors(self):
        df = generate_simulated_data(500)
        factors = search_factors(df, n_top=5)
        assert len(factors) > 0
        assert all(hasattr(f, "rank_ic") for f in factors)

    def test_sorts_by_ic(self):
        df = generate_simulated_data(500)
        factors = search_factors(df, n_top=10)
        for i in range(len(factors) - 1):
            assert abs(factors[i].rank_ic) >= abs(factors[i + 1].rank_ic)


class TestFormulaCandidates:
    def test_all_candidates_have_names(self):
        formulas = [f[0] for f in FORMULA_CANDIDATES]
        names = [f[1] for f in FORMULA_CANDIDATES]
        assert len(formulas) == len(names)
        assert all(n for n in names)
