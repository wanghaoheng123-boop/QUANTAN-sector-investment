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
