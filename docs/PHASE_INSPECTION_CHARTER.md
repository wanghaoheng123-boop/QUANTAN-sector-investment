# Phase Inspection Charter

## Purpose

Enforce institutional-grade delivery with independent inspection so no phase can pass on self-asserted quality.

## Scope

Applies to all phases, all modules, all agent teams, and all release candidates.

## Three-Line Control Model

- Builder line: implements feature or fix.
- Internal verifier line: adversarial review and break-testing.
- External expert line: independent pass/fail inspection.

No phase is promotable unless all three lines sign off.

## Required External Expert Roles

- Quant research expert
- Options microstructure expert
- Data engineering expert
- Software reliability expert
- Institutional risk expert

Each expert must publish a written pass/fail assessment with evidence.

## Mandatory Gates Per Phase

- Code gate: typecheck, tests, lint/security checks
- Algorithm gate: canonical formula parity and drift checks
- Data gate: provenance, schema, reconciliation, freshness
- Backtest gate: OOS, walk-forward, regime and stress replay
- Risk gate: drawdown/tail-risk/concentration limits
- UX/disclosure gate: confidence labels, non-misleading language
- Audit gate: reproducibility package and evidence completeness

## Anti-Manipulation Controls

- All validation runs require run ID, commit SHA, config hash, and data snapshot hash.
- Failed runs cannot be deleted from decision records.
- Promotion requires independent rerun by reviewer line.
- Selective reporting is prohibited; pass/fail history must be preserved.

## Promotion Decision Policy

- Promote only when all mandatory gates pass in the same cycle.
- Hold if any mandatory gate fails.
- Rollback if post-deploy monitoring violates critical thresholds.

## Current Deployment Targets (Authoritative)

- GitHub repository:
  - `https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment.git`
- Vercel project:
  - `quantan-sector-investment`
  - `projectId: prj_Rk9lpO090omeU1IiFvHmTG2HMnbk`
  - `orgId: team_TXgmnu4Bwg2rqPJupexBjrU9`

## Continue Contract

When user prompts `continue`, agents must:

1. Resume first pending high-priority item.
2. Execute bounded work with evidence artifacts.
3. Update scorecard and phase inspection status.
4. Publish next action for the next `continue`.
