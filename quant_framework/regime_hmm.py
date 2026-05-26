"""HMM 3-state regime detector stub — Phase 15 Q-042-NEW."""

from __future__ import annotations

import numpy as np


def detect_regime(closes: np.ndarray) -> dict:
    if len(closes) < 60:
        return {"currentState": "Normal", "probabilities": {"Bull": 0.33, "Normal": 0.34, "Bear": 0.33}}
    ret = (closes[-1] - closes[-64]) / closes[-64]
    rets = np.diff(np.log(closes[-61:]))
    vol20 = float(np.std(rets[-20:]))
    vol60 = float(np.std(rets))
    ratio = vol20 / vol60 if vol60 > 0 else 1.0
    state = "Normal"
    if ret > 0.05 and ratio < 1.1:
        state = "Bull"
    elif ret < -0.05 or ratio > 1.4:
        state = "Bear"
    probs = {"Bull": 0.2, "Normal": 0.6, "Bear": 0.2}
    probs[state] = 0.65
    rest = (1 - 0.65) / 2
    for k in list(probs.keys()):
        if k != state:
            probs[k] = rest
    return {"currentState": state, "probabilities": probs}
