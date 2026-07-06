"""
Tests for multi_agent_factor_mining framework.
"""
import numpy as np
import pandas as pd
import pytest


class TestConfig:
    def test_default_config(self):
        from multi_agent_factor_mining.config import AgentConfig

        cfg = AgentConfig()
        assert cfg.max_iterations == 5
        assert cfg.min_ic_threshold == 0.03
        assert cfg.max_correlation_threshold == 0.70

    def test_api_key_guard(self):
        from multi_agent_factor_mining.config import ApiKeyGuard

        with ApiKeyGuard("test-key-123", "TEST_VAR"):
            import os

            assert os.environ.get("TEST_VAR") == "test-key-123"

        # Key should be cleaned up
        assert os.environ.get("TEST_VAR") is None


class TestFactorLibrary:
    def test_add_and_get(self, tmp_path):
        from multi_agent_factor_mining.factor_library import FactorLibrary

        lib = FactorLibrary(str(tmp_path / "test_library.json"))
        f = lib.add(name="alpha_test", formula="close / ts_delay(close, 5) - 1", category="momentum", ic_mean=0.05)

        assert f.name == "alpha_test"
        assert f.category == "momentum"

        retrieved = lib.get(f.id)
        assert retrieved is not None
        assert retrieved.formula == f.formula

    def test_deduplication(self, tmp_path):
        from multi_agent_factor_mining.factor_library import FactorLibrary

        lib = FactorLibrary(str(tmp_path / "test_library2.json"))
        f1 = lib.add(name="alpha_a", formula="close / ts_delay(close, 5) - 1")
        f2 = lib.add(name="alpha_a_v2", formula="close / ts_delay(close, 5) - 1")

        # Same formula hash → should update version, not create new
        assert f1.id == f2.id
        assert f2.version == 2

    def test_delete(self, tmp_path):
        from multi_agent_factor_mining.factor_library import FactorLibrary

        lib = FactorLibrary(str(tmp_path / "test_library3.json"))
        f = lib.add(name="test", formula="volume / ts_mean(volume, 20) - 1")
        assert lib.delete(f.id) is True
        assert lib.get(f.id) is None
        assert lib.delete("nonexistent") is False

    def test_top_by_ic(self, tmp_path):
        from multi_agent_factor_mining.factor_library import FactorLibrary

        lib = FactorLibrary(str(tmp_path / "test_library4.json"))
        lib.add(name="weak", formula="close + open", ic_mean=0.01)
        lib.add(name="strong", formula="(close - ts_mean(close,20)) / ts_std(close,20)", ic_mean=0.08)

        top = lib.top_by_ic(1)
        assert len(top) == 1
        assert top[0].name == "strong"

    def test_classify_factor(self):
        from multi_agent_factor_mining.factor_library import classify_factor

        assert classify_factor("close / ts_delay(close, 5) - 1") == "momentum"
        assert classify_factor("(close - ts_mean(close, 20)) / ts_std(close, 20)") == "mean_reversion"
        assert classify_factor("volume / ts_mean(volume, 20) - 1") == "volume"


class TestAgents:
    @pytest.fixture
    def sample_state(self, tmp_path):
        from multi_agent_factor_mining.factor_library import FactorLibrary
        from multi_agent_factor_mining.config import AgentConfig

        data = pd.DataFrame({
            "open": np.linspace(95, 145, 400),
            "high": np.linspace(98, 150, 400),
            "low": np.linspace(93, 140, 400),
            "close": np.linspace(100, 150, 400),
            "volume": np.ones(400) * 1_000_000,
        }, index=pd.date_range("2021-01-01", periods=400, freq="B"))

        return {
            "ticker": "AAPL",
            "raw_data": data,
            "cleaned_data": pd.DataFrame(),
            "base_series": {},
            "forward_returns": np.array([]),
            "candidate_factors": [],
            "evaluated_factors": [],
            "selected_factors": [],
            "library": FactorLibrary(str(tmp_path / "test_agent_lib.json")),
            "iteration": 0,
            "max_iterations": 3,
            "config": AgentConfig(),
            "messages": [],
            "status": "running",
        }

    def test_data_processor(self, sample_state):
        from multi_agent_factor_mining.agents import DataProcessorAgent
        from multi_agent_factor_mining.config import AgentConfig

        agent = DataProcessorAgent(AgentConfig())
        state = agent.process(sample_state)
        assert "DataProcessor" in state["messages"][0]
        assert "close" in state["base_series"]
        assert len(state["forward_returns"]) == 400

    def test_factor_engineer(self, sample_state):
        from multi_agent_factor_mining.agents import DataProcessorAgent, FactorEngineerAgent
        from multi_agent_factor_mining.config import AgentConfig

        cfg = AgentConfig()
        state = DataProcessorAgent(cfg).process(sample_state)
        state = FactorEngineerAgent(cfg).generate(state)
        assert len(state["candidate_factors"]) > 0
        assert "formula" in state["candidate_factors"][0]

    def test_evaluator(self, sample_state):
        from multi_agent_factor_mining.agents import (
            DataProcessorAgent,
            FactorEngineerAgent,
            EvaluatorAgent,
        )
        from multi_agent_factor_mining.config import AgentConfig

        cfg = AgentConfig()
        state = DataProcessorAgent(cfg).process(sample_state)
        state = FactorEngineerAgent(cfg).generate(state)
        state = EvaluatorAgent(cfg).evaluate(state)
        assert len(state["evaluated_factors"]) > 0
        assert "rank_ic" in state["evaluated_factors"][0]

    def test_portfolio_composer(self, sample_state):
        from multi_agent_factor_mining.agents import (
            DataProcessorAgent,
            FactorEngineerAgent,
            EvaluatorAgent,
            PortfolioComposerAgent,
        )
        from multi_agent_factor_mining.config import AgentConfig

        cfg = AgentConfig()
        state = DataProcessorAgent(cfg).process(sample_state)
        state = FactorEngineerAgent(cfg).generate(state)
        state = EvaluatorAgent(cfg).evaluate(state)
        state = PortfolioComposerAgent(cfg).compose(state)
        assert state["status"] == "completed"
        # Should have selected factors (or 0 if none passed)
        assert isinstance(state["selected_factors"], list)


class TestPipeline:
    def test_pipeline_runs(self, tmp_path):
        from multi_agent_factor_mining.agents import FactorMiningPipeline
        from multi_agent_factor_mining.config import AgentConfig

        cfg = AgentConfig(max_iterations=2, library_path=str(tmp_path / "pipeline_lib.json"))
        pipeline = FactorMiningPipeline(cfg)

        data = pd.DataFrame({
            "open": np.linspace(95, 145, 500),
            "high": np.linspace(98, 150, 500),
            "low": np.linspace(93, 140, 500),
            "close": np.linspace(100, 150, 500),
            "volume": np.ones(500) * 1_000_000,
        }, index=pd.date_range("2021-01-01", periods=500, freq="B"))

        state = pipeline.run("AAPL", data, iterations=2)
        assert state["status"] == "completed"
        assert state["iteration"] >= 1
        assert len(state["messages"]) > 0


class TestFPY04PipelineNoOpRegression:
    """F-PY-04 (2026-07-06): evaluate() must carry factor_values through to the
    composer — dropping it made every factor fail the len<30 guard and the
    pipeline always selected 0 factors."""

    def _state_with_candidates(self, tmp_path):
        from multi_agent_factor_mining.config import AgentConfig
        from multi_agent_factor_mining.factor_library import FactorLibrary

        rng = np.random.default_rng(42)
        n = 200
        fwd = rng.normal(0, 0.01, n)
        # Two candidates: one strongly IC-correlated, one pure noise.
        strong = fwd + rng.normal(0, 0.002, n)
        noise = rng.normal(0, 1, n)
        cfg = AgentConfig(library_path=str(tmp_path / "lib.json"))
        state = {
            "forward_returns": fwd,
            "candidate_factors": [
                {"name": "strong", "formula": "f1", "category": "momentum",
                 "factor_values": strong.tolist()},
                {"name": "noise", "formula": "f2", "category": "volume",
                 "factor_values": noise.tolist()},
            ],
            "evaluated_factors": [],
            "selected_factors": [],
            "library": FactorLibrary(cfg.library_path),
            "messages": [],
            "config": cfg,
        }
        return cfg, state

    def test_evaluate_carries_factor_values(self, tmp_path):
        from multi_agent_factor_mining.agents import EvaluatorAgent

        cfg, state = self._state_with_candidates(tmp_path)
        state = EvaluatorAgent(cfg).evaluate(state)
        assert state["evaluated_factors"], "strong candidate must pass IC threshold"
        for f in state["evaluated_factors"]:
            assert len(f.get("factor_values", [])) >= 30, "factor_values must survive evaluation"

    def test_composer_selects_factors_end_to_end(self, tmp_path):
        from multi_agent_factor_mining.agents import EvaluatorAgent, PortfolioComposerAgent

        cfg, state = self._state_with_candidates(tmp_path)
        state = EvaluatorAgent(cfg).evaluate(state)
        state = PortfolioComposerAgent(cfg).compose(state)
        assert len(state["selected_factors"]) >= 1, (
            "composer must select at least the strong factor (was 0 pre-fix)"
        )


class TestFPY05ServerBoot:
    """F-PY-05 (2026-07-06): the server must boot under BOTH launch paths —
    module (-m, new Procfile form) and direct script (old Procfile form)."""

    @pytest.mark.parametrize("argv", [
        ["python3", "-m", "multi_agent_factor_mining.server", "--help"],
        ["python3", "multi_agent_factor_mining/server.py", "--help"],
    ])
    def test_server_help_exits_zero(self, argv):
        import subprocess
        import pathlib

        pytest.importorskip("fastapi")
        pytest.importorskip("uvicorn")
        repo = pathlib.Path(__file__).resolve().parent.parent
        proc = subprocess.run(argv, cwd=repo, capture_output=True, text=True, timeout=60)
        assert proc.returncode == 0, f"boot failed: {proc.stderr[-500:]}"
