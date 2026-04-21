# Execution Scorecard Protocol

## Objective

Create one uniform reporting language for all agents and all platforms so `continue` always resumes from a deterministic state.

## Required Per-Run Fields

- `run_id`
- `active_target_set` (A-G)
- `metric_ids_touched`
- `status_changes` (Pass/Fail/Blocked transitions)
- `artifacts_generated`
- `blockers`
- `next_action_for_continue`

## Artifact Contracts

- `artifacts/backtest-matrix.json`
- `artifacts/institutional-scorecard.json`
- `artifacts/loop-mission/<run_id>.json`

## Status Transition Rules

- Only move a metric from Fail/Blocked to Pass when fresh evidence exists in current artifacts.
- Any failed gate in current cycle sets release state to `Hold`.
- `Promote` requires all mandatory checks passing in the same cycle.

## Continue Protocol

On user prompt `continue`, agents must:

1. Read canonical memory startup bundle.
2. Locate first pending or blocked critical metric.
3. Execute next bounded step only.
4. Write updated scorecard/handoff entries.
5. Emit a single `next_action_for_continue`.
