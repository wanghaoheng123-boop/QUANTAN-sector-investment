# C3 trade-count flag reconciliation — 2026-07-11 (follow-through session)

**Flag (MASTER §2, C3):** red-team engine re-run reported **250 trades / 23.2% net WR**; the
07-06 coordinator snapshot said **52 trades (WR 34.6154% = 18/52)**. Unreconciled at ratification.

## Method
Ran the actual committed engines on the same 56-instrument fixtures (07-05 refresh), at HEAD
(post-#101/#102) and at `f243d59` (post-#84, PRE-#91 — the commit state when the 07-06 numbers
were written down), via a scratch probe (deleted after use; method: `runPortfolioBacktest`
defaults + `backtestInstrument` defaults summed over the universe).

## Results
| Engine path | HEAD (today) | pre-#91 (`f243d59`) |
|---|---|---|
| `backtestInstrument` summed (single-instrument engine, defaults) | **250 trades / 24.0% WR** | **250 trades / 24.0% WR** |
| `runPortfolioBacktest` (portfolio engine, defaults) | 607 trades / 57.0% WR / +6.90% total | 751 trades / 55.8% WR / −1.61% total |
| `/api/backtest` aggregate (`aggregatePortfolio`) | same 250 closed trades (win def: net > 22 bps) | — |

## Findings
1. **The red team's 250 is CONFIRMED.** It is exactly the committed single-instrument engine
   (`lib/backtest/core.ts backtestInstrument`, defaults) summed across the 56 fixtures —
   reproduced today AND at the pre-#91 commit. Their 23.2% vs our 24.0% WR is the win-definition
   nuance (net-of-round-trip vs pnl>0), ~2 trades.
2. **The 52 is NOT reproducible from any committed engine path** at either commit (250, 607, and
   751 are the only counts the committed engines produce). The 34.6154%/52-trade figure in
   `PROGRAM-DAY-2026-07-06.md` (line 39) came from an **uncommitted scratch harness** used during
   #84/#93 verification whose scope (likely a ticker subset, a walk-forward segment, or a
   non-default exit config) was not recorded. Its companion figure "engine totalReturn 0.3023%"
   likewise matches no committed path.
3. **C3's conclusion is unaffected and now REINFORCED on the real portfolio engine:** the
   portfolio engine's +6.90% total return over ~5y (vs equal-weight B&H ≈ +94%) confirms the
   engine wrapper discards the label edge — the red team's ablation finding holds on the
   committed engine, not just their reimplementation.
4. Incidental positive: #91's union-calendar hold-days fix moved the portfolio engine from
   −1.61% to +6.90% total return on identical data (751 → 607 trades — less time-exit churn).

## Disposition
- Flag **CLOSED**: 250 = correct count for the per-instrument engine; 52 = scratch-scoped,
  unverifiable, superseded. Treat PROGRAM-DAY-2026-07-06 line 39's engine numbers as scoped to
  that unrecorded scratch, not to the committed engines.
- **Lesson (process):** any number that enters a records doc must name the harness + config that
  produced it (script path or command), or it is unreproducible by construction.
