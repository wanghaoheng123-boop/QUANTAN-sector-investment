"""
Per-request API-key environment guard for the trading-agents sidecar.

Extracted from ``server_trading_agents.py`` so the leak-safe restore logic can be
unit-tested without importing the heavy ``tradingagents`` package (F-PY-12).
"""

from __future__ import annotations

import os
from typing import Any

# Provider → environment-variable name the underlying SDK reads its key from.
PROVIDER_API_KEY_ENV: dict[str, str] = {
    "openai":     "OPENAI_API_KEY",
    "google":     "GOOGLE_API_KEY",
    "anthropic":  "ANTHROPIC_API_KEY",
    "xai":        "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    # ollama has no API key
}


class ApiKeyEnvGuard:
    """
    Temporarily inject the user's API key into ``os.environ`` for the duration of
    a request, then restore the previous state on exit.

    Usage::

        with ApiKeyEnvGuard(provider, api_key):
            # os.environ has the user's key here
            ta = TradingAgentsGraph(...)

    F-PY-12: the previous ``__exit__`` guarded on ``self._orig_value is not None``,
    so when the server had NO pre-existing value the restore block was skipped and
    the injected user key LEAKED into ``os.environ`` past the request (and the
    inner pop-branch was unreachable, since the outer guard already required the
    value to be non-None). We now track whether ``__enter__`` actually injected and
    always undo exactly what we did: restore a prior value, or remove the key when
    there was none.
    """

    def __init__(self, provider: str, api_key: str | None):
        self.provider = provider
        self.api_key = api_key
        self.env_var = PROVIDER_API_KEY_ENV.get(provider)
        self._orig_value: str | None = None
        self._injected = False

    def __enter__(self) -> ApiKeyEnvGuard:
        if self.env_var and self.api_key:
            # Save original (may be None) so we can restore it after this request.
            self._orig_value = os.environ.get(self.env_var)
            os.environ[self.env_var] = self.api_key
            self._injected = True
        return self

    def __exit__(self, *_: Any) -> None:
        if not self._injected or not self.env_var:
            return
        if self._orig_value is None:
            # No pre-existing value — remove the key we injected (do NOT leak it).
            os.environ.pop(self.env_var, None)
        else:
            # Restore the server's original key.
            os.environ[self.env_var] = self._orig_value
        # Reset so the guard instance can be safely reused.
        self._injected = False
        self._orig_value = None
