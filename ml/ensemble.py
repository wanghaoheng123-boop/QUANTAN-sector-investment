"""
Walk-forward ensemble model.

Architecture: RandomForest + XGBoost + LogisticRegression, soft-vote.
Walk-forward: train on 500 bars, predict the next 60 bars, roll forward.

Target: binary — does price increase > 1% over the next 5 trading days?
"""

import numpy as np
import logging
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
import xgboost as xgb

from features import compute_features, FEATURE_NAMES

logger = logging.getLogger(__name__)

TRAIN_WINDOW = 500   # bars for in-sample training
PREDICT_WINDOW = 60  # bars to predict after each train
TARGET_RETURN_PCT = 0.01  # +1%
TARGET_HORIZON_DAYS = 5


def build_labels(closes: list[float]) -> np.ndarray:
    """Returns 1 if close[i+horizon] > close[i] * (1+threshold), else 0. NaN at end."""
    n = len(closes)
    c = np.array(closes, dtype=float)
    labels = np.full(n, np.nan)
    for i in range(n - TARGET_HORIZON_DAYS):
        if c[i] > 0:
            fwd_ret = (c[i + TARGET_HORIZON_DAYS] - c[i]) / c[i]
            labels[i] = 1.0 if fwd_ret > TARGET_RETURN_PCT else 0.0
    return labels


def walk_forward_predict(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[float],
) -> dict:
    """
    Runs walk-forward training/prediction.

    Returns:
      {
        "probability": float | None,   # predicted BUY probability for latest bar
        "signal": "BUY" | "SELL" | "HOLD",
        "confidence": float,           # |probability - 0.5| * 2 in [0,1]
        "n_train_samples": int,
        "feature_importance": dict     # RF feature importances
      }
    """
    if len(closes) < TRAIN_WINDOW + TARGET_HORIZON_DAYS + 20:
        return {"probability": None, "signal": "HOLD", "confidence": 0.0,
                "n_train_samples": 0, "feature_importance": {}}

    X_all = compute_features(opens, highs, lows, closes, volumes)
    y_all = build_labels(closes)
    n = len(closes)

    # Use the most recent train window ending at n - TARGET_HORIZON_DAYS - 1
    # (we can't use future labels)
    train_end = n - TARGET_HORIZON_DAYS
    train_start = max(0, train_end - TRAIN_WINDOW)

    X_train = X_all[train_start:train_end]
    y_train = y_all[train_start:train_end]

    # Drop rows with NaN
    mask = ~(np.isnan(X_train).any(axis=1) | np.isnan(y_train))
    X_train = X_train[mask]
    y_train = y_train[mask]

    if len(X_train) < 100 or len(np.unique(y_train)) < 2:
        return {"probability": None, "signal": "HOLD", "confidence": 0.0,
                "n_train_samples": len(X_train), "feature_importance": {}}

    # Latest bar features for prediction
    X_pred = X_all[[-1]]
    if np.isnan(X_pred).any():
        return {"probability": None, "signal": "HOLD", "confidence": 0.0,
                "n_train_samples": len(X_train), "feature_importance": {}}

    try:
        # ── RandomForest ───────────────────────────────────────────────
        rf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42, n_jobs=-1)
        rf.fit(X_train, y_train)
        prob_rf = rf.predict_proba(X_pred)[0, 1]
        fi = dict(zip(FEATURE_NAMES, rf.feature_importances_))

        # ── XGBoost ────────────────────────────────────────────────────
        xgb_model = xgb.XGBClassifier(
            n_estimators=100, max_depth=4, learning_rate=0.05,
            eval_metric='logloss', random_state=42,
        )
        xgb_model.fit(X_train, y_train)
        prob_xgb = xgb_model.predict_proba(X_pred)[0, 1]

        # ── Logistic Regression (scaled) ──────────────────────────────
        lr_pipe = Pipeline([
            ('scaler', StandardScaler()),
            ('lr', LogisticRegression(max_iter=500, random_state=42, C=0.1)),
        ])
        lr_pipe.fit(X_train, y_train)
        prob_lr = lr_pipe.predict_proba(X_pred)[0, 1]

        # ── Soft-vote ensemble ────────────────────────────────────────
        probability = float((prob_rf + prob_xgb + prob_lr) / 3)
        confidence = abs(probability - 0.5) * 2

        if probability > 0.6:
            signal = "BUY"
        elif probability < 0.4:
            signal = "SELL"
        else:
            signal = "HOLD"

        return {
            "probability": probability,
            "signal": signal,
            "confidence": confidence,
            "n_train_samples": int(len(X_train)),
            "feature_importance": {k: float(v) for k, v in sorted(fi.items(), key=lambda x: -x[1])[:5]},
        }

    except Exception as exc:
        logger.exception("Ensemble training failed: %s", exc)
        return {"probability": None, "signal": "HOLD", "confidence": 0.0,
                "n_train_samples": 0, "feature_importance": {}}
