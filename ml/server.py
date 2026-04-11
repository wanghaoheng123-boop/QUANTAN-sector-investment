"""
ML Ensemble FastAPI sidecar server.

Start with:  uvicorn server:app --host 0.0.0.0 --port 8001

Endpoints:
  GET /health          → { "status": "ok" }
  GET /predict/{ticker} → MlPrediction
"""

import logging
from datetime import datetime, timezone

import yfinance as yf  # lightweight alternative to yahoo-finance2 in Python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ensemble import walk_forward_predict

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="QUANTAN ML Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

MODEL_VERSION = "1.0.0"


class MlPrediction(BaseModel):
    ticker: str
    probability: float | None
    signal: str
    confidence: float
    modelVersion: str
    trainedAt: str
    nTrainSamples: int
    featureImportance: dict[str, float]


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": MODEL_VERSION}


@app.get("/predict/{ticker}", response_model=MlPrediction)
def predict(ticker: str):
    ticker = ticker.upper()
    logger.info("Predicting %s", ticker)

    try:
        hist = yf.download(ticker, period="3y", interval="1d", progress=False, auto_adjust=True)
        if hist is None or len(hist) < 100:
            return MlPrediction(
                ticker=ticker, probability=None, signal="HOLD", confidence=0.0,
                modelVersion=MODEL_VERSION, trainedAt=datetime.now(timezone.utc).isoformat(),
                nTrainSamples=0, featureImportance={},
            )

        opens   = hist["Open"].tolist()
        highs   = hist["High"].tolist()
        lows    = hist["Low"].tolist()
        closes  = hist["Close"].tolist()
        volumes = hist["Volume"].tolist()

    except Exception as exc:
        logger.exception("Data fetch failed for %s: %s", ticker, exc)
        raise HTTPException(status_code=502, detail=f"Data fetch failed: {exc}") from exc

    result = walk_forward_predict(opens, highs, lows, closes, volumes)

    return MlPrediction(
        ticker=ticker,
        probability=result["probability"],
        signal=result["signal"],
        confidence=result["confidence"],
        modelVersion=MODEL_VERSION,
        trainedAt=datetime.now(timezone.utc).isoformat(),
        nTrainSamples=result["n_train_samples"],
        featureImportance=result["feature_importance"],
    )
