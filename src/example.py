"""
Example module demonstrating code quality standards for this project.
Every new module should follow this pattern: type hints, docstrings, logging, main().
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def greet(name: str, greeting: str = "Hello") -> str:
    """Return a formatted greeting string.

    Args:
        name: The name of the person or entity to greet.
        greeting: The greeting word to use (default: "Hello").

    Returns:
        A string in the format "{greeting}, {name}!"

    Raises:
        ValueError: If name is empty or only whitespace.
    """
    if not name.strip():
        raise ValueError("name must not be empty")

    return f"{greeting}, {name}!"


def compute_score(values: list[float], weight: float = 1.0) -> Optional[float]:
    """Compute a weighted average score from a list of values.

    Args:
        values: List of numeric values.
        weight: Multiplier applied to the average.

    Returns:
        The weighted average, or None if values is empty.
    """
    if not values:
        return None

    mean = sum(values) / len(values)
    return mean * weight


def main() -> None:
    """Entry point — runs the example."""
    logging.basicConfig(level=logging.INFO)

    logger.info("Starting example module")
    print(greet("world"))
    logger.info("Example complete")


if __name__ == "__main__":
    main()
