"""GARCH(1,1) conditional volatility — uses arch MLE when installed, else EWMA proxy."""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)


def fit_garch11(returns: np.ndarray, horizon: int = 20) -> list[dict]:
    """Fit GARCH(1,1) via the ``arch`` library when available; EWMA fallback otherwise.

    Returns a list of exactly ``horizon`` dicts (or ``[]`` when fewer than 30 returns
    are supplied), each ``{"step", "conditionalVol", "method"}`` where ``conditionalVol``
    is the **annualized** daily volatility forecast for that step.

    The MLE branch emits the full GARCH(1,1) term structure — one volatility per step,
    decaying toward the unconditional level — which is the whole point of the model over
    a flat EWMA proxy. ``conditionalVol`` is a plain Python ``float`` (not ``np.float64``)
    so the value serializes cleanly to JSON.
    """
    if len(returns) < 30:
        return []

    try:
        from arch import arch_model  # type: ignore
    except ImportError:
        # arch is an optional MLE extra; its absence is the expected EWMA-proxy path.
        pass
    else:
        try:
            scale = 100.0
            am = arch_model(returns * scale, vol="Garch", p=1, q=1, rescale=False)
            res = am.fit(disp="off")
            forecast = res.forecast(horizon=horizon, reindex=False)
            # variance.values[-1] is the forecast row from the last observation:
            # shape (horizon,), one variance per step — NOT a scalar. The prior
            # `float(...)` on this array raised TypeError, which the bare except
            # swallowed, so the MLE branch never returned. Vectorize instead.
            var_row = np.atleast_1d(np.asarray(forecast.variance.values[-1], dtype=float))
            daily_vol = np.sqrt(var_row) / scale          # de-scale back from the ×100 fit
            ann_vol = daily_vol * np.sqrt(252.0)          # annualize per step
            if ann_vol.shape[0] == horizon and np.all(np.isfinite(ann_vol)) and np.all(ann_vol > 0):
                return [
                    {"step": i + 1, "conditionalVol": float(ann_vol[i]), "method": "garch11_mle"}
                    for i in range(horizon)
                ]
            logger.warning("GARCH(1,1) MLE produced an invalid forecast; using EWMA proxy")
        except Exception as exc:  # convergence / numerical failure — log, then fall back
            logger.warning("GARCH(1,1) MLE fit failed (%s); using EWMA proxy", exc)

    lam = 0.94
    var = float(np.var(returns[:20]))
    for r in returns[20:]:
        var = lam * var + (1 - lam) * float(r) ** 2
    daily = float(np.sqrt(var))
    ann = daily * np.sqrt(252)
    return [{"step": i + 1, "conditionalVol": ann, "method": "ewma_proxy"} for i in range(horizon)]
