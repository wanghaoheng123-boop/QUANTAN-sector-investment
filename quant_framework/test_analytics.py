import numpy as np
from quant_framework.garch import fit_garch11
from quant_framework.regime_hmm import detect_regime


def test_garch_returns_forecast():
    rng = np.random.default_rng(42)
    rets = rng.normal(0, 0.01, 100)
    fc = fit_garch11(rets, horizon=5)
    assert len(fc) == 5
    assert all(f["conditionalVol"] > 0 for f in fc)


def test_regime_labels():
    closes = np.linspace(100, 120, 100)
    out = detect_regime(closes)
    assert out["currentState"] in ("Bull", "Normal", "Bear")
    assert abs(sum(out["probabilities"].values()) - 1.0) < 0.01
