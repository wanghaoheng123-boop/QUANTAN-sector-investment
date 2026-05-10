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


def walk_forward_validate(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[float],
    step_size: int = 20,
) -> dict:
    """
    True rolling walk-forward validation producing OOS metrics.

    Rolls the training window forward through history, makes a prediction
    at each step, and compares against the realized forward return.

    Returns OOS accuracy, precision, recall, and signal counts.
    """
    if len(closes) < TRAIN_WINDOW + TARGET_HORIZON_DAYS + step_size:
        return {"error": "insufficient data", "oos_predictions": 0}

    X_all = compute_features(opens, highs, lows, closes, volumes)
    y_all = build_labels(closes)
    n = len(closes)

    predictions: list[dict] = []
    start = TRAIN_WINDOW

    while start + step_size + TARGET_HORIZON_DAYS < n:
        train_end = start
        train_start = max(0, train_end - TRAIN_WINDOW)
        pred_idx = train_end  # predict for bar at train_end

        X_train = X_all[train_start:train_end]
        y_train = y_all[train_start:train_end]
        mask = ~(np.isnan(X_train).any(axis=1) | np.isnan(y_train))
        X_train = X_train[mask]
        y_train = y_train[mask]

        X_pred = X_all[[pred_idx]]
        actual = y_all[pred_idx]

        if len(X_train) < 100 or len(np.unique(y_train)) < 2 or np.isnan(X_pred).any() or np.isnan(actual):
            start += step_size
            continue

        try:
            rf = RandomForestClassifier(n_estimators=80, max_depth=5, random_state=42)
            rf.fit(X_train, y_train)
            prob_rf = rf.predict_proba(X_pred)[0, 1]

            xgb_model = xgb.XGBClassifier(
                n_estimators=80, max_depth=4, learning_rate=0.05,
                eval_metric='logloss', random_state=42,
            )
            xgb_model.fit(X_train, y_train)
            prob_xgb = xgb_model.predict_proba(X_pred)[0, 1]

            lr_pipe = Pipeline([
                ('scaler', StandardScaler()),
                ('lr', LogisticRegression(max_iter=500, random_state=42, C=0.1)),
            ])
            lr_pipe.fit(X_train, y_train)
            prob_lr = lr_pipe.predict_proba(X_pred)[0, 1]

            prob = float((prob_rf + prob_xgb + prob_lr) / 3)
            predicted = int(prob > 0.5)
            predictions.append({
                "idx": int(pred_idx),
                "probability": prob,
                "predicted": predicted,
                "actual": int(actual),
                "correct": int(predicted == int(actual)),
            })
        except Exception:
            pass

        start += step_size

    if not predictions:
        return {"error": "no valid predictions", "oos_predictions": 0}

    correct = sum(p["correct"] for p in predictions)
    predicted_buys = sum(1 for p in predictions if p["predicted"] == 1)
    actual_buys = sum(1 for p in predictions if p["actual"] == 1)
    tp = sum(1 for p in predictions if p["predicted"] == 1 and p["actual"] == 1)

    accuracy = correct / len(predictions)
    precision = tp / max(1, predicted_buys)
    recall = tp / max(1, actual_buys)
    f1 = 2 * precision * recall / max(1e-9, precision + recall)

    return {
        "oos_predictions": len(predictions),
        "oos_accuracy": round(accuracy, 4),
        "oos_precision": round(precision, 4),
        "oos_recall": round(recall, 4),
        "oos_f1": round(f1, 4),
        "predicted_buys": predicted_buys,
        "actual_buys": actual_buys,
        "signal_rate": round(predicted_buys / len(predictions), 4),
    }
