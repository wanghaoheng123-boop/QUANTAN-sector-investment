"""GARCH(1,1) conditional volatility — uses arch MLE when installed, else EWMA proxy."""

from __future__ import annotations

import numpy as np


def fit_garch11(returns: np.ndarray, horizon: int = 20) -> list[dict]:
    """Fit GARCH(1,1) via arch library when available; EWMA fallback otherwise."""
    if len(returns) < 30:
        return []

    try:
        from arch import arch_model  # type: ignore

        scale = 100.0
        am = arch_model(returns * scale, vol="Garch", p=1, q=1, rescale=False)
        res = am.fit(disp="off")
        forecast = res.forecast(horizon=horizon)
        vol = forecast.variance.values[-1] ** 0.5 / scale
        ann = float(vol) * np.sqrt(252)
        return [{"step": i + 1, "conditionalVol": ann, "method": "garch11_mle"} for i in range(horizon)]
    except Exception:
        pass

    lam = 0.94
    var = float(np.var(returns[:20]))
    for r in returns[20:]:
        var = lam * var + (1 - lam) * float(r) ** 2
    daily = float(np.sqrt(var))
    ann = daily * np.sqrt(252)
    return [{"step": i + 1, "conditionalVol": ann, "method": "ewma_proxy"} for i in range(horizon)]
