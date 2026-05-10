"""
Unit tests for src/example.py — demonstrates expected testing patterns.
Run with: python -m pytest tests/test_example.py -v
"""

import pytest
from src.example import greet, compute_score


class TestGreet:
    def test_default_greeting(self) -> None:
        assert greet("world") == "Hello, world!"

    def test_custom_greeting(self) -> None:
        assert greet("QUANTAN", greeting="Welcome") == "Welcome, QUANTAN!"

    def test_empty_name_raises(self) -> None:
        with pytest.raises(ValueError, match="name must not be empty"):
            greet("")

    def test_whitespace_name_raises(self) -> None:
        with pytest.raises(ValueError, match="name must not be empty"):
            greet("   ")


class TestComputeScore:
    def test_basic_average(self) -> None:
        assert compute_score([1.0, 2.0, 3.0]) == pytest.approx(2.0)

    def test_weighted(self) -> None:
        assert compute_score([1.0, 2.0, 3.0], weight=2.0) == pytest.approx(4.0)

    def test_empty_returns_none(self) -> None:
        assert compute_score([]) is None

    def test_single_value(self) -> None:
        assert compute_score([5.0]) == pytest.approx(5.0)
