---
name: QUANTAN Agent Handoff Protocol
description: Deterministic startup/resume workflow so any agent can continue work immediately
type: process
last_updated: 2026-04-21
---

# Agent Startup Order

Any agent entering this repository must read in this order:

1. `AGENTS.md`
2. `memory/MEMORY.md`
3. `memory/project_status.md`
4. `docs/MASTER_PLAN_PHASES_8_16.md` (for Phase 8+ work)
5. `docs/PHASE_INSPECTION_CHARTER.md`

# Resume Rule

If user says "continue" or equivalent:

1. Read `memory/project_status.md`.
2. Identify first pending queue item.
3. Execute code changes and verification for that item.
4. Update `memory/project_status.md` and `AGENTS.md` when milestone moves.
5. Continue to next pending item unless user redirects.

## Multi-Agent Workstream Roles

- Data QA: data integrity, provenance, schema, and reconciliation checks.
- Quant Core: signal, options wall/max pain, and safety-tier algorithm correctness.
- Backtest/Optimization: long-window matrix runs and loop mission automation.
- Product UX: function-zone consistency and contextual analytics usability.
- Audit/Governance: scorecard gate validation and commercial readiness pack.

All roles report using the same scorecard schema in `memory/execution_scorecard_protocol.md`.
All merge/deploy decisions must satisfy:
- `docs/GITHUB_PR_INSPECTION_CHECKLIST.md`
- `docs/VERCEL_PROMOTION_CHECKLIST.md`

# Memory Rule

- Canonical shared memory is only `memory/`.
- Do not create alternate memory trees for individual agent tooling.
- Always emit `next_action_for_continue` at the end of every execution cycle.

# Cleanup Rule

- Remove duplicate/non-canonical planning or memory files when detected.
- Never delete source code unless it is proven unused and superseded.

