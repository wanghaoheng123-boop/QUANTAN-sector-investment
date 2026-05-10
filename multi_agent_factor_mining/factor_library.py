"""
Factor Library — Persistent storage with versioning and deduplication.

Stores discovered alpha factors as JSON with SHA-256 identity hashing.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class StoredFactor:
    """A factor stored in the library."""

    id: str
    name: str
    formula: str
    formula_hash: str
    category: str
    ic_mean: float
    ic_std: float
    sharpe: float
    turnover_5d: float
    created_at: str
    updated_at: str
    version: int
    status: str  # 'active', 'deprecated', 'experimental'
    ts_expression: str = ""
    metadata: dict | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "formula": self.formula,
            "formula_hash": self.formula_hash,
            "category": self.category,
            "ic_mean": self.ic_mean,
            "ic_std": self.ic_std,
            "sharpe": self.sharpe,
            "turnover_5d": self.turnover_5d,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "version": self.version,
            "status": self.status,
            "ts_expression": self.ts_expression,
            "metadata": self.metadata or {},
        }

    @classmethod
    def from_dict(cls, data: dict) -> "StoredFactor":
        return cls(
            id=data["id"],
            name=data["name"],
            formula=data["formula"],
            formula_hash=data.get("formula_hash", ""),
            category=data.get("category", "unknown"),
            ic_mean=data.get("ic_mean", float("nan")),
            ic_std=data.get("ic_std", float("nan")),
            sharpe=data.get("sharpe", float("nan")),
            turnover_5d=data.get("turnover_5d", float("nan")),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            version=data.get("version", 1),
            status=data.get("status", "active"),
            ts_expression=data.get("ts_expression", ""),
            metadata=data.get("metadata"),
        )


def normalize_formula(formula: str) -> str:
    """Normalize a formula string for comparison: strip whitespace, standardize naming."""
    f = formula.strip()
    f = re.sub(r"\s+", " ", f)
    return f


def hash_formula(formula: str) -> str:
    """SHA-256 hash of normalized formula for identity."""
    return hashlib.sha256(normalize_formula(formula).encode()).hexdigest()[:16]


def classify_factor(formula: str) -> str:
    """Classify factor into a category based on operators used."""
    f = formula.lower()
    if "ts_delay" in f or "momentum" in f or "/ ts_delay" in f:
        return "momentum"
    if "ts_std" in f and "ts_mean" in f and "close -" in f:
        return "mean_reversion"
    if "volume" in f and ("/ ts_mean(volume" in f or "vol_ratio" in f):
        return "volume"
    if "ts_std" in f and "ts_mean" in f and "close" in f:
        return "volatility"
    if "ts_corr" in f:
        return "correlation"
    if "high" in f and "low" in f:
        return "price_pattern"
    if "ts_rank" in f:
        return "rank"
    return "composite"


class FactorLibrary:
    """
    Persistent JSON-backed factor store with deduplication and versioning.

    Usage::

        lib = FactorLibrary("factor_library.json")
        lib.add(factor)
        matches = lib.search_by_correlation(reference_factors, threshold=0.7)
    """

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self._factors: dict[str, StoredFactor] = {}
        self._hash_index: dict[str, str] = {}  # hash → id
        self._load()

    def _load(self) -> None:
        """Load factors from JSON file."""
        if not self.path.exists():
            logger.info("Factor library not found at %s, starting empty.", self.path)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._save()
            return

        try:
            with open(self.path) as f:
                data = json.load(f)

            factors_list = data.get("factors", [])
            for item in factors_list:
                factor = StoredFactor.from_dict(item)
                self._factors[factor.id] = factor
                self._hash_index[factor.formula_hash] = factor.id

            logger.info("Loaded %d factors from library.", len(self._factors))
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to load factor library: %s. Starting fresh.", e)
            self._factors = {}
            self._hash_index = {}

    def _save(self) -> None:
        """Persist factors to JSON file."""
        data = {
            "version": "1.0",
            "updated_at": datetime.now().isoformat(),
            "total_factors": len(self._factors),
            "factors": [f.to_dict() for f in self._factors.values()],
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(data, f, indent=2)

    def exists(self, formula: str) -> bool:
        """Check if a formula (by hash) already exists in the library."""
        h = hash_formula(formula)
        return h in self._hash_index

    def add(
        self,
        name: str,
        formula: str,
        category: str | None = None,
        ic_mean: float = float("nan"),
        ic_std: float = float("nan"),
        sharpe: float = float("nan"),
        turnover_5d: float = float("nan"),
        ts_expression: str = "",
        metadata: dict | None = None,
    ) -> StoredFactor:
        """
        Add a factor to the library. Updates existing factor if formula matches.

        Returns the StoredFactor.
        """
        import math

        norm = normalize_formula(formula)
        h = hash_formula(formula)

        if h in self._hash_index:
            # Update existing
            existing_id = self._hash_index[h]
            existing = self._factors[existing_id]
            existing.version += 1
            existing.ic_mean = ic_mean if math.isfinite(ic_mean) else existing.ic_mean
            existing.sharpe = sharpe if math.isfinite(sharpe) else existing.sharpe
            existing.updated_at = datetime.now().isoformat()
            self._save()
            logger.info("Updated existing factor %s (v%d)", existing.name, existing.version)
            return existing

        factor = StoredFactor(
            id=str(uuid.uuid4())[:8],
            name=name,
            formula=norm,
            formula_hash=h,
            category=category or classify_factor(norm),
            ic_mean=ic_mean if math.isfinite(ic_mean) else float("nan"),
            ic_std=ic_std if math.isfinite(ic_std) else float("nan"),
            sharpe=sharpe if math.isfinite(sharpe) else float("nan"),
            turnover_5d=turnover_5d if math.isfinite(turnover_5d) else float("nan"),
            created_at=datetime.now().isoformat(),
            updated_at=datetime.now().isoformat(),
            version=1,
            status="active",
            ts_expression=ts_expression,
            metadata=metadata,
        )

        self._factors[factor.id] = factor
        self._hash_index[h] = factor.id
        self._save()
        logger.info("Added factor %s (id=%s, category=%s)", name, factor.id, factor.category)
        return factor

    def get(self, factor_id: str) -> StoredFactor | None:
        """Get a factor by ID."""
        return self._factors.get(factor_id)

    def get_by_hash(self, formula: str) -> StoredFactor | None:
        """Get a factor by formula hash."""
        h = hash_formula(formula)
        fid = self._hash_index.get(h)
        if fid:
            return self._factors.get(fid)
        return None

    def delete(self, factor_id: str) -> bool:
        """Delete a factor. Returns True if found and deleted."""
        factor = self._factors.pop(factor_id, None)
        if factor:
            self._hash_index.pop(factor.formula_hash, None)
            self._save()
            return True
        return False

    def list_active(self) -> list[StoredFactor]:
        """List all active factors."""
        return [f for f in self._factors.values() if f.status == "active"]

    def list_all(self) -> list[StoredFactor]:
        """List all factors."""
        return list(self._factors.values())

    def list_by_category(self, category: str) -> list[StoredFactor]:
        """List factors by category."""
        return [f for f in self._factors.values() if f.category == category and f.status == "active"]

    def top_by_ic(self, n: int = 10) -> list[StoredFactor]:
        """Return top N factors by absolute IC."""
        active = self.list_active()
        active.sort(key=lambda f: abs(f.ic_mean) if np.isfinite(f.ic_mean) else 0, reverse=True)
        return active[:n]


import numpy as np
