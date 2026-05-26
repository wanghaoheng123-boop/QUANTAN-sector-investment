"""GARCH(1,1) conditional volatility — Phase 15 Q-041-NEW sidecar stub."""

from __future__ import annotations

import numpy as np


def fit_garch11(returns: np.ndarray, horizon: int = 20) -> list[dict]:
    """EWMA proxy when arch package not installed."""
    if len(returns) < 30:
        return []
    lam = 0.94
    var = float(np.var(returns[:20]))
    for r in returns[20:]:
        var = lam * var + (1 - lam) * float(r) ** 2
    daily = float(np.sqrt(var))
    ann = daily * np.sqrt(252)
    return [{"step": i + 1, "conditionalVol": ann} for i in range(horizon)]
