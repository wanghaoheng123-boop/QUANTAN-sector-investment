"""
Multi-Agent Factor Mining Framework.
"""

from .agents import FactorMiningPipeline
from .config import AgentConfig, ApiKeyGuard, get_config
from .factor_library import FactorLibrary, classify_factor, hash_formula

__all__ = [
    "FactorMiningPipeline",
    "AgentConfig",
    "ApiKeyGuard",
    "get_config",
    "FactorLibrary",
    "classify_factor",
    "hash_formula",
]

# Server is imported separately to avoid forcing FastAPI dependency
try:
    from .server import app
    __all__.append("app")
except ImportError:
    pass
