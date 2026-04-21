# Function Zone Taxonomy

## Purpose

Define a consistent hybrid information architecture for all user-facing modules so every page exposes the same decision flow:

1. Primary work
2. Contextual support
3. Analytics interpretation
4. Action guidance

## Zone Model

- `PrimaryWorkZone`: the core activity the user came to perform (charting, backtest, execution, monitoring).
- `ContextualFunctionZone`: local controls and state (watchlist, filters, indicators, session snapshot).
- `AnalyticsZone`: computed interpretation layers (metrics, scenario summaries, quality/confidence states).
- `OptionsIntelligenceZone`: options-specific guidance (walls, max pain, safety-tier setups, entry bands).
- `ActionZone`: immediate next steps and risk-aware recommendations.

## Page Mapping

- `/simulator`
  - Primary: strategy config and simulation runs
  - Context: watchlist and runtime controls
  - Analytics: run metrics + walk-forward outputs
  - OptionsIntelligence: ticker-level options walls and safety-tier candidates
  - Action: run/iterate/optimize controls

- `/stock/[ticker]`
  - Primary: chart, quant lab, dark pool, news tabs
  - Context: indicator toggles and session snapshot
  - Analytics: in-context market state and confidence labels
  - OptionsIntelligence: wall + max pain + safety-tier short premium candidates
  - Action: watchlist + decision-support cards

- `/desk`, `/portfolio`, `/monitor` (follow-up standardization)
  - Adopt same five-zone hierarchy for consistent operator UX.

## UX Rules

- Keep global nav compact; favor contextual sections over top-level route explosion.
- Every zone must answer:
  - What is happening now?
  - Why does it matter?
  - What can I do next?
- Guidance is decision support, never guaranteed returns.
- Show data quality and confidence labels for computed insights.
