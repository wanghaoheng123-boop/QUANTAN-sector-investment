# Cursor PR #41 + Branches Deep-Dive — 2026-06-04

**Reviewer:** Claude Opus 4.7 (independent inspection)
**Scope:** PR #41 (commit `27186af`, merged as `de9a3d5` to main 2026-06-02) — 19 source files + 4 unmerged `cursor/*` branches + coordination role.
**Base ref:** `532f0c4c`

## Verdict: TBD

## P0 Findings
_(populated incrementally)_

## P1 Findings
_(populated incrementally)_

## P2 / Quality Findings
_(populated incrementally)_

## Unmerged cursor/* branches assessment
_(populated incrementally)_

## Coordination role assessment
_(populated incrementally)_

## What I did NOT cover
_(populated at end)_

---
## Working notes (will be condensed into sections above)

### Scope traps flagged at outset
- `__tests__/backtest/exitRules.test.ts` is NOT in PR #41 — verify via `git log 532f0c4c..27186af -- __tests__/backtest/exitRules.test.ts` (expect empty). Likely from commit `7e11970` (#50). Out-of-scope for Cursor review.
- `components/stock/quantlab/tabs/LlmTab.tsx` has only a 5-line diff. Review the 5 lines only, not the 470 LOC file.
- The two JSON artifacts (`portfolio-backtest-results.json` +7394, `benchmark-results.json`) are GENERATED output. Spot-check headlines only.

### Verification plan
1. Look-ahead grep across `core.ts` / `engine.ts` / `portfolioBacktest.ts` / `signals.ts` (cheapest, highest-signal).
2. Trace T+1 fill path through `core.ts` (the headline is here, not in `portfolioBacktest.ts`).
3. Check entry vs exit symmetry (next-bar open both sides).
4. Cost model round-trip symmetry.
5. BTC annualization factor (365 vs 252).
6. Confirm portfolio-backtest WR ~48.37 appears in JSON diff.
7. Factor attribution test: prove vs regression-pin.
8. GARCH MLE constraints.
9. BTC page decomp + WS hooks.
10. lib/chartEma.ts vs lib/quant/indicators.ts duplication.
11. Per-branch verdict for 4 `cursor/*` branches.
12. Coordination doc alignment.
