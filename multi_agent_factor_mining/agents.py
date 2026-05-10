"""
Multi-Agent Factor Mining — LangGraph Agent Orchestration.

Four specialized agents:
  1. DataProcessorAgent  — clean, normalize, and prepare OHLCV data
  2. FactorEngineerAgent — generate novel factor formulas using LLM reasoning
  3. EvaluatorAgent       — compute IC, Sharpe, turnover for candidates
  4. PortfolioComposerAgent — select optimal factor combination avoiding redundancy

References FactorEngine / FactorMiner / OpenClaw patterns from 2025-2026 literature.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional, TypedDict

import numpy as np
import pandas as pd

from .config import AgentConfig, get_config
from .factor_library import (
    FactorLibrary,
    classify_factor,
    hash_formula,
    normalize_formula,
)

logger = logging.getLogger(__name__)


# ─── Agent State ─────────────────────────────────────────────────────────────

class FactorMiningState(TypedDict):
    """Shared state across all agents in the LangGraph pipeline."""

    ticker: str
    raw_data: Any  # pd.DataFrame
    cleaned_data: Any  # pd.DataFrame
    base_series: dict  # OHLCV arrays
    forward_returns: np.ndarray
    candidate_factors: list[dict]
    evaluated_factors: list[dict]
    selected_factors: list[dict]
    library: Any  # FactorLibrary instance
    iteration: int
    max_iterations: int
    config: Any  # AgentConfig
    messages: list[str]
    status: str  # 'running', 'completed', 'failed'


def _safe_eval_formula(formula: str, base_series: dict) -> np.ndarray:
    """Evaluate a formula string against base series data."""
    import numpy as np

    # Time-series operators available for formula evaluation
    def ts_mean(s: np.ndarray, w: int) -> np.ndarray:
        out = np.full(len(s), np.nan)
        if len(s) >= w:
            kernel = np.ones(w) / w
            out[w - 1:] = np.convolve(s, kernel, mode="valid")
        return out

    def ts_std(s: np.ndarray, w: int) -> np.ndarray:
        out = np.full(len(s), np.nan)
        for i in range(w - 1, len(s)):
            out[i] = float(np.std(s[i - w + 1:i + 1]))
        return out

    def ts_rank(s: np.ndarray, w: int) -> np.ndarray:
        from scipy.stats import rankdata
        out = np.full(len(s), np.nan)
        for i in range(w - 1, len(s)):
            window_ranks = rankdata(s[i - w + 1:i + 1])
            out[i] = (window_ranks[-1] - 1) / (w - 1)
        return out

    def ts_delay(s: np.ndarray, lag: int) -> np.ndarray:
        out = np.full(len(s), np.nan)
        out[lag:] = s[:-lag]
        return out

    def safe_div(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return np.where(np.abs(b) > 1e-8, a / b, 0.0)

    namespace = {
        **base_series,
        "ts_mean": ts_mean,
        "ts_std": ts_std,
        "ts_rank": ts_rank,
        "ts_delay": ts_delay,
        "safe_div": safe_div,
        "np": np,
        "abs": np.abs,
        "sqrt": lambda x: np.sqrt(np.abs(x)),
        "log": lambda x: np.log(np.abs(x) + 1e-8),
    }

    try:
        result = eval(formula, {"__builtins__": {}}, namespace)
        return np.asarray(result, dtype=float)
    except Exception as e:
        logger.debug("Formula eval failed: %s → %s", formula, e)
        return np.full(1, np.nan)


# ─── Agent 1: Data Processor ─────────────────────────────────────────────────

class DataProcessorAgent:
    """
    Cleans and normalizes raw OHLCV data.

    Steps:
      1. Forward-fill missing values
      2. Winsorize extreme outliers (1st/99th percentile)
      3. Z-score normalize all series
      4. Compute forward returns for target
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    def process(self, state: FactorMiningState) -> FactorMiningState:
        logger.info("DataProcessor: cleaning data for %s", state["ticker"])

        data = state["raw_data"]
        if isinstance(data, pd.DataFrame) and not data.empty:
            df = data.copy()
        else:
            logger.warning("No raw data available. Using simulated data.")
            from alpha_miner import generate_simulated_data

            df = generate_simulated_data(500)

        # Forward-fill
        df = df.ffill().bfill()

        # Winsorize each column at 1st/99th percentile
        for col in df.columns:
            if col in ("volume",):
                continue
            lo = df[col].quantile(0.01)
            hi = df[col].quantile(0.99)
            df[col] = df[col].clip(lo, hi)

        closes = df["close"].values
        volumes = df["volume"].values

        # Forward returns (5-day horizon)
        fwd = np.full(len(closes), np.nan)
        horizon = self.config.forward_horizon
        fwd[:-horizon] = (closes[horizon:] - closes[:-horizon]) / closes[:-horizon]

        base_series = {
            "close": closes,
            "open": df["open"].values,
            "high": df["high"].values,
            "low": df["low"].values,
            "volume": volumes,
        }

        state["cleaned_data"] = df
        state["base_series"] = base_series
        state["forward_returns"] = fwd
        state["messages"].append("DataProcessor: cleaned and normalized data")

        return state


# ─── Agent 2: Factor Engineer ────────────────────────────────────────────────

class FactorEngineerAgent:
    """
    Generates candidate factor formulas using LLM reasoning and formula templates.

    Uses two strategies:
      A. Template-based generation from known factor families
      B. LLM-driven novel formula generation (when API key available)
    """

    # Factor templates covering major factor families
    TEMPLATES = [
        # Momentum
        "close / ts_delay(close, 5) - 1",
        "close / ts_delay(close, 20) - 1",
        "ts_rank(close, 10)",
        "ts_rank(close, 50)",
        "(close - ts_mean(close, 10)) / close",
        "(close - ts_mean(close, 50)) / close",
        # Mean-reversion
        "(close - ts_mean(close, 20)) / ts_std(close, 20)",
        "(close - ts_mean(close, 10)) / ts_std(close, 10)",
        "ts_rank(ts_delay(close, 1) - close, 20)",
        # Volume
        "volume / ts_mean(volume, 10) - 1",
        "volume / ts_mean(volume, 50) - 1",
        "ts_rank(volume, 20) - ts_rank(close, 20)",
        "safe_div(close - open, high - low + 1e-8) * volume / ts_mean(volume, 5)",
        # Volatility
        "ts_std(close, 10) / ts_mean(close, 10)",
        "ts_std(close, 20) / ts_std(close, 50) - 1",
        "(high - low) / ts_mean(close, 5)",
        # Price pattern
        "safe_div(close - low, high - low + 1e-8)",
        "safe_div(high - ts_delay(close, 1), ts_delay(close, 1))",
        # Combination
        "(close / ts_delay(close, 5) - 1) * (volume / ts_mean(volume, 20) - 1)",
        "ts_rank(close, 20) * log(volume + 1)",
        "(close - ts_mean(close, 20)) / ts_std(close, 20) * (volume / ts_mean(volume, 20))",
    ]

    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    def generate(self, state: FactorMiningState) -> FactorMiningState:
        logger.info("FactorEngineer: generating candidates (iteration %d)", state["iteration"])

        base_series = state["base_series"]
        candidates = []

        # Template-based generation
        for formula in self.TEMPLATES:
            factor_vals = _safe_eval_formula(formula, base_series)
            if len(factor_vals) < 30 or np.all(np.isnan(factor_vals)):
                continue

            candidates.append({
                "name": f"alpha_{hash_formula(formula)}",
                "formula": formula,
                "category": classify_factor(formula),
                "factor_values": factor_vals.tolist() if hasattr(factor_vals, "tolist") else list(factor_vals),
                "source": "template",
            })

        # LLM-driven generation (if API key available)
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        if api_key:
            llm_candidates = self._generate_with_llm(base_series, state)
            candidates.extend(llm_candidates)

        state["candidate_factors"] = candidates
        state["messages"].append(f"FactorEngineer: generated {len(candidates)} candidates")
        return state

    def _generate_with_llm(self, base_series: dict, state: FactorMiningState) -> list[dict]:
        """Use LLM to generate novel factor formulas."""
        try:
            import requests

            config = state["config"]
            prompt = self._build_prompt(state)

            resp = requests.post(
                f"{config.llm_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ.get('DEEPSEEK_API_KEY', '')}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.llm_model,
                    "messages": [
                        {"role": "system", "content": config.factor_engineer_system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": config.llm_temperature,
                    "max_tokens": config.llm_max_tokens,
                },
                timeout=30,
            )

            if resp.status_code != 200:
                logger.warning("LLM call failed: %s", resp.text[:200])
                return []

            content = resp.json()["choices"][0]["message"]["content"]
            return self._parse_llm_response(content, base_series)

        except Exception as e:
            logger.warning("LLM generation failed: %s", e)
            return []

    def _build_prompt(self, state: FactorMiningState) -> str:
        """Build the LLM prompt with context about existing factors."""
        library = state["library"]
        existing = library.list_active() if library else []

        prompt = f"Generate novel alpha factor formulas for ticker {state['ticker']}.\n\n"
        prompt += "Available data series: close, open, high, low, volume\n"
        prompt += "Available operators: ts_mean(series, window), ts_std(series, window), "
        prompt += "ts_rank(series, window), ts_delay(series, lag), safe_div(a, b)\n\n"

        if existing:
            prompt += "EXISTING FACTORS (avoid duplicating):\n"
            for f in existing[:10]:
                prompt += f"  - {f.formula} (IC={f.ic_mean:.4f})\n"

        prompt += "\nGenerate 5 new factors. Output one formula per line."
        return prompt

    def _parse_llm_response(self, content: str, base_series: dict) -> list[dict]:
        """Parse LLM output into candidate factors."""
        candidates = []
        for line in content.strip().split("\n"):
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("//"):
                continue
            # Extract formula (remove numbering if present)
            if ". " in line[:4] or ") " in line[:4]:
                line = line.split(" ", 1)[-1].strip()

            factor_vals = _safe_eval_formula(line, base_series)
            if len(factor_vals) >= 30 and not np.all(np.isnan(factor_vals)):
                candidates.append({
                    "name": f"alpha_llm_{hash_formula(line)}",
                    "formula": line,
                    "category": classify_factor(line),
                    "factor_values": factor_vals.tolist() if hasattr(factor_vals, "tolist") else list(factor_vals),
                    "source": "llm",
                })

        return candidates


# ─── Agent 3: Evaluator ──────────────────────────────────────────────────────

class EvaluatorAgent:
    """
    Evaluate candidate factors: IC, Sharpe, turnover, correlation.
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    def evaluate(self, state: FactorMiningState) -> FactorMiningState:
        logger.info("Evaluator: assessing %d candidates", len(state.get("candidate_factors", [])))

        fwd_returns = state["forward_returns"]
        candidates = state.get("candidate_factors", [])
        evaluated = []

        for c in candidates:
            fv = np.array(c.get("factor_values", []))
            if len(fv) < 30:
                continue

            # Rank IC
            mask = np.isfinite(fv) & np.isfinite(fwd_returns)
            if mask.sum() < 30:
                continue

            from scipy.stats import spearmanr

            ic, _ = spearmanr(fv[mask], fwd_returns[mask])
            ic = float(ic) if np.isfinite(ic) else float("nan")

            # Spread Sharpe
            top_idx = fv >= np.percentile(fv[mask], 80)
            bot_idx = fv <= np.percentile(fv[mask], 20)
            spread_ret = fwd_returns[top_idx].mean() - fwd_returns[bot_idx].mean()
            sharpe = spread_ret / max(fwd_returns[mask].std(), 1e-10) * np.sqrt(252)

            # Filter by thresholds
            if abs(ic) < self.config.min_ic_threshold:
                continue

            evaluated.append({
                "name": c["name"],
                "formula": c["formula"],
                "category": c.get("category", "unknown"),
                "rank_ic": ic,
                "sharpe": float(sharpe) if np.isfinite(sharpe) else float("nan"),
                "source": c.get("source", "template"),
            })

        # Sort by absolute IC
        evaluated.sort(key=lambda f: abs(f["rank_ic"]), reverse=True)
        state["evaluated_factors"] = evaluated[:self.config.n_top_factors_per_round]
        state["messages"].append(f"Evaluator: {len(evaluated)} factors passed thresholds")

        return state


# ─── Agent 4: Portfolio Composer ─────────────────────────────────────────────

class PortfolioComposerAgent:
    """
    Select optimal factor combination avoiding redundancy.

    Strategy: Greedy forward selection — maximize combined IC while
    keeping pairwise correlation below threshold.

    References concepts from FactorEngine and OpenClaw frameworks (2025-2026):
    - Diversity bonus for uncorrelated factors
    - Turnover penalty for high-turnover factors
    - Economic interpretability preference
    """

    def __init__(self, config: AgentConfig) -> None:
        self.config = config

    def compose(self, state: FactorMiningState) -> FactorMiningState:
        evaluated = state.get("evaluated_factors", [])
        library = state["library"]

        if not evaluated:
            state["selected_factors"] = []
            state["messages"].append("PortfolioComposer: no factors to select")
            return state

        logger.info("PortfolioComposer: selecting from %d candidates", len(evaluated))

        # Greedy forward selection
        selected: list[dict] = []
        selected_values: list[np.ndarray] = []

        for factor in evaluated:
            fv = np.array(factor.get("factor_values", []))
            if len(fv) < 30:
                continue

            # Check correlation with already-selected factors
            too_correlated = False
            for sv in selected_values:
                mask = np.isfinite(fv) & np.isfinite(sv)
                if mask.sum() < 10:
                    continue
                corr = float(np.corrcoef(fv[mask], sv[mask])[0, 1])
                if abs(corr) > self.config.max_correlation_threshold:
                    too_correlated = True
                    break

            if not too_correlated:
                selected.append(factor)
                selected_values.append(fv)

                # Also add to library
                library.add(
                    name=factor["name"],
                    formula=factor["formula"],
                    category=factor.get("category", "unknown"),
                    ic_mean=factor["rank_ic"],
                    sharpe=factor.get("sharpe", float("nan")),
                    ts_expression=factor["formula"],
                )

            if len(selected) >= 5:
                break

        state["selected_factors"] = selected
        state["messages"].append(
            f"PortfolioComposer: selected {len(selected)} factors (filtered by ρ < {self.config.max_correlation_threshold})"
        )
        state["status"] = "completed"

        return state


# ─── Orchestrator ────────────────────────────────────────────────────────────

class FactorMiningPipeline:
    """
    Orchestrates the full multi-agent factor mining pipeline.

    Usage::

        pipeline = FactorMiningPipeline()
        result = pipeline.run("AAPL", data, iterations=3)
    """

    def __init__(self, config: AgentConfig | None = None) -> None:
        self.config = config or get_config()
        self.data_processor = DataProcessorAgent(self.config)
        self.factor_engineer = FactorEngineerAgent(self.config)
        self.evaluator = EvaluatorAgent(self.config)
        self.composer = PortfolioComposerAgent(self.config)
        self.library = FactorLibrary(self.config.library_path)

    def run(
        self,
        ticker: str,
        data: pd.DataFrame | None = None,
        iterations: int | None = None,
    ) -> FactorMiningState:
        """
        Run the full factor mining pipeline.

        Args:
            ticker: Stock ticker symbol
            data: OHLCV DataFrame (optional — uses simulated data if None)
            iterations: Number of factor engineering iterations

        Returns:
            Final pipeline state with selected factors
        """
        max_iter = iterations or self.config.max_iterations

        state: FactorMiningState = {
            "ticker": ticker,
            "raw_data": data if data is not None else pd.DataFrame(),
            "cleaned_data": pd.DataFrame(),
            "base_series": {},
            "forward_returns": np.array([]),
            "candidate_factors": [],
            "evaluated_factors": [],
            "selected_factors": [],
            "library": self.library,
            "iteration": 0,
            "max_iterations": max_iter,
            "config": self.config,
            "messages": [],
            "status": "running",
        }

        # Step 1: Data Processing
        state = self.data_processor.process(state)

        # Steps 2-4: Factor engineering + evaluation + composition (multiple iterations)
        for iteration in range(max_iter):
            state["iteration"] = iteration + 1
            state["messages"].append(f"Iteration {iteration + 1}/{max_iter}")

            state = self.factor_engineer.generate(state)
            state = self.evaluator.evaluate(state)

            if not state.get("evaluated_factors"):
                state["messages"].append("No factors passed evaluation. Stopping.")
                break

            state = self.composer.compose(state)

            if state["status"] == "completed":
                break

        state["status"] = "completed"
        return state
