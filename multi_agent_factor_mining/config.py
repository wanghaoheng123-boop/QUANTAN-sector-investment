"""
Multi-Agent Factor Mining Framework — Configuration.

Reuses the thread-local API key injection pattern from server_trading_agents.py.
"""

from __future__ import annotations

import os
from contextvars import ContextVar
from dataclasses import dataclass, field

# Thread-local context for per-request API keys (pattern from server_trading_agents.py)
_thread_ctx: ContextVar[dict] = ContextVar("thread_ctx", default={})


@dataclass
class AgentConfig:
    """Configuration for the multi-agent factor mining system."""

    # LLM settings
    llm_provider: str = "deepseek"
    llm_model: str = "deepseek-v4-pro"
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_temperature: float = 0.3
    llm_max_tokens: int = 4096

    # Factor mining settings
    max_iterations: int = 5
    min_ic_threshold: float = 0.03
    max_correlation_threshold: float = 0.70
    min_sharpe_threshold: float = 0.5
    n_top_factors_per_round: int = 10

    # Data settings
    train_window: int = 500
    predict_window: int = 60
    forward_horizon: int = 5
    min_bars_required: int = 252

    # Factor library
    library_path: str = "multi_agent_factor_mining/factor_library.json"

    # Agent prompts
    factor_engineer_system_prompt: str = field(default=(
        "You are an expert quantitative researcher specializing in alpha factor discovery. "
        "Your task is to generate novel factor formulas that predict future stock returns. "
        "You have access to OHLCV data series (open, high, low, close, volume) and "
        "time-series operators (ts_mean, ts_std, ts_rank, ts_delay, ts_corr, ts_min, ts_max). "
        "Generate formulas using these operators combined with arithmetic (+, -, *, /). "
        "Consider these factor families: momentum, mean-reversion, volatility, volume, "
        "price pattern, correlation-based, and cross-sectional relative value. "
        "Each formula should be concise and economically interpretable. "
        "Output ONLY the formula, one per line, no explanations."
    ))

    portfolio_composer_system_prompt: str = field(default=(
        "You are an expert portfolio construction researcher. "
        "Your task is to evaluate a set of candidate alpha factors and select "
        "the optimal combination that maximizes predictive power while minimizing "
        "redundancy. Consider factor correlation, turnover, and economic rationale. "
        "Reject factors that are highly correlated with already-selected factors (ρ > 0.7). "
        "Prefer factors with high IC, high Sharpe, and low turnover. "
        "Output the selected factor IDs as a JSON array."
    ))


class ApiKeyGuard:
    """
    Context manager that temporarily sets an API key as an environment variable
    for the duration of a request. Pattern from server_trading_agents.py.
    """

    def __init__(self, api_key: str | None, env_var: str = "DEEPSEEK_API_KEY") -> None:
        self.api_key = api_key
        self.env_var = env_var
        self._prev = None

    def __enter__(self) -> None:
        self._prev = os.environ.get(self.env_var)
        if self.api_key:
            os.environ[self.env_var] = self.api_key
        _thread_ctx.set({"api_key": self.api_key, "env_var": self.env_var})

    def __exit__(self, *args) -> None:
        if self._prev is not None:
            os.environ[self.env_var] = self._prev
        elif self.env_var in os.environ:
            del os.environ[self.env_var]
        _thread_ctx.set({})


def get_config() -> AgentConfig:
    """Get configuration from environment variables with sensible defaults."""
    return AgentConfig(
        llm_base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        llm_model=os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro"),
        library_path=os.environ.get(
            "FACTOR_LIBRARY_PATH",
            "multi_agent_factor_mining/factor_library.json",
        ),
    )
