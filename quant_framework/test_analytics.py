import importlib.util

import numpy as np
import pytest

from quant_framework.garch import fit_garch11
from quant_framework.regime_hmm import detect_regime

_HAS_ARCH = importlib.util.find_spec("arch") is not None


def test_garch_returns_forecast():
    rng = np.random.default_rng(42)
    rets = rng.normal(0, 0.01, 100)
    fc = fit_garch11(rets, horizon=5)
    assert len(fc) == 5
    assert all(f["conditionalVol"] > 0 for f in fc)
    # Contract: clean JSON-serializable floats and a 1-based step sequence.
    assert all(isinstance(f["conditionalVol"], float) for f in fc)
    assert [f["step"] for f in fc] == [1, 2, 3, 4, 5]


def test_garch_short_series_returns_empty():
    assert fit_garch11(np.zeros(10), horizon=20) == []


@pytest.mark.skipif(not _HAS_ARCH, reason="arch (GARCH MLE) not installed")
def test_garch_mle_branch_is_live_and_finite():
    # Regression for the dead-code bug (2026-06-04 inspection): the MLE branch
    # used to throw `float(ndarray)` TypeError after a successful fit, get
    # swallowed by a bare except, and always fall back to the EWMA proxy.
    rng = np.random.default_rng(7)
    vol, rets = 0.01, []
    for _ in range(400):
        vol = np.sqrt(2e-6 + 0.08 * (rets[-1] if rets else 0.0) ** 2 + 0.90 * vol**2)
        rets.append(rng.normal(0, vol))
    fc = fit_garch11(np.array(rets), horizon=20)
    assert len(fc) == 20
    assert fc[0]["method"] == "garch11_mle"  # MLE actually used, not EWMA fallback
    assert all(np.isfinite(f["conditionalVol"]) and f["conditionalVol"] > 0 for f in fc)


def test_regime_labels():
    closes = np.linspace(100, 120, 100)
    out = detect_regime(closes)
    assert out["currentState"] in ("Bull", "Normal", "Bear")
    assert abs(sum(out["probabilities"].values()) - 1.0) < 0.01
