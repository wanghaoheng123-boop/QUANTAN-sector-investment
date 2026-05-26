# Phase 15 — Pending Tasks Audit (2026-05-24)

**Canonical tree:** `.claude/worktrees/competent-wu-a84629` (branch `fix/options-investigation`)  
**Stale tree:** repo root (missing `lib/portfolio/*`, `lib/data/providers/*`, `SectorRotationPanel.tsx`; 486 vs 825 tests)

## Backlog tally

| Metric | Count |
|--------|------:|
| Total tasks (Q-001..Q-051-NEW) | 51 |
| Done before session | 27 |
| Pending before session | 24 |
| Completed this session | 23 |
| Remaining pending | 1 (Q-051-NEW) |

## Remaining blocker

- **Q-051-NEW** — Raise coverage on excluded lib dirs: full `coverage.include[]` still ~62% global; `vitest.config.ts` excludes `hooks`, `lib/ml`, `lib/optimize`, `lib/portfolio`, `lib/data/providers`, `lib/data/bloomberg` until dedicated tests land.

## Partial completions (honest)

| ID | Note |
|----|------|
| Q-008 | `components/stock/QuantLabMarketCards.tsx` extracted; `QuantLabPanel.tsx` still ~1684 LOC |
| Q-019 | `components/backtest/BacktestMetricsGrid.tsx` extracted; `app/backtest/page.tsx` still ~887 LOC |
| Q-040-NEW | `middleware.ts` nonce scaffold; CSP remains **Report-Only** in `next.config.js` until `QUANTAN_CSP_ENFORCE=1` + zero violations |
| Q-047-NEW | `stryker.conf.mjs` + `npm run stryker`; packages not installed in CI yet |

## Verification (canonical worktree)

- `npm run typecheck` — clean
- `npm run test` — **825** passed (61 files)
- `npm run benchmark` — **57.05%** aggregate WR (floor 56.35% / 56.55% guard OK)
