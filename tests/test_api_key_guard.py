"""
Regression tests for ApiKeyEnvGuard (F-PY-12).

The per-request guard injects a user's API key into os.environ for the duration
of a request and must restore the previous state on exit — crucially, it must
NOT leak the user's key into the process environment when the server had no
pre-existing key for that provider.
"""

import os

import pytest

from trading_agents_env_guard import ApiKeyEnvGuard, PROVIDER_API_KEY_ENV

ENV_VAR = PROVIDER_API_KEY_ENV["openai"]  # "OPENAI_API_KEY"


@pytest.fixture(autouse=True)
def _isolate_env():
    """Snapshot + restore ENV_VAR around every test so a real key in the dev's
    environment is neither relied upon nor clobbered."""
    had = ENV_VAR in os.environ
    orig = os.environ.get(ENV_VAR)
    os.environ.pop(ENV_VAR, None)
    try:
        yield
    finally:
        os.environ.pop(ENV_VAR, None)
        if had and orig is not None:
            os.environ[ENV_VAR] = orig


def test_no_prior_value_key_is_removed_after_exit():
    # F-PY-12 regression: with NO prior key, the injected user key must be removed
    # on exit. Before the fix the restore block was skipped and the key leaked.
    assert ENV_VAR not in os.environ
    with ApiKeyEnvGuard("openai", "user-secret-123"):
        assert os.environ[ENV_VAR] == "user-secret-123"
    assert ENV_VAR not in os.environ


def test_prior_value_is_restored_after_exit():
    os.environ[ENV_VAR] = "server-original"
    with ApiKeyEnvGuard("openai", "user-secret-123"):
        assert os.environ[ENV_VAR] == "user-secret-123"
    assert os.environ[ENV_VAR] == "server-original"


def test_none_api_key_is_a_noop_with_no_prior_value():
    assert ENV_VAR not in os.environ
    with ApiKeyEnvGuard("openai", None):
        assert ENV_VAR not in os.environ
    assert ENV_VAR not in os.environ


def test_empty_api_key_does_not_disturb_existing_value():
    os.environ[ENV_VAR] = "server-original"
    with ApiKeyEnvGuard("openai", ""):  # empty key is falsy → no injection
        assert os.environ[ENV_VAR] == "server-original"
    assert os.environ[ENV_VAR] == "server-original"


def test_unknown_provider_is_a_noop():
    # A provider with no mapped env var must not touch the environment at all.
    before = dict(os.environ)
    with ApiKeyEnvGuard("ollama", "irrelevant"):
        pass
    assert dict(os.environ) == before


def test_guard_instance_is_reusable():
    g = ApiKeyEnvGuard("openai", "k1")
    with g:
        assert os.environ[ENV_VAR] == "k1"
    assert ENV_VAR not in os.environ
    # Reuse the same instance — it must inject and clean up again, not leak.
    with g:
        assert os.environ[ENV_VAR] == "k1"
    assert ENV_VAR not in os.environ
