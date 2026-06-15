# Program Day — 2026-06-15 (kickoff; interactive multi-cell)

The scheduled task first fires next launch ≥09:00 local; this day's cells were run
interactively on owner "keep going". Cells completed: **Q01, Q02**.

---

## Q01 — `lib/backtest/engine.ts` (WS-Q) — DONE, merged (PR #61, b5515a8, prod ✓)
- `aggregatePortfolio`: F-1/F-1a stub-exclusion + `excludedTickers` confirmed correct;
  end-aligned common-window combine, 252/365 annualization, Sharpe/Sortino/DD sound.
- **BUG FIXED (SAFE):** all-wins profit factor = `Infinity` → `NextResponse.json` emits
  `null` → `AnalysisTab` `null.toFixed(2)` crashed the table. Fixed via node-testable
  `lib/backtest/formatMetrics.ts:formatProfitFactor()` (null/non-finite → ∞) + 3 tests.
  Display-only; no published-number / contract change. Auto-merged; prod deploy success.
- **Escalated:** F-4 gross-WR (owner re-baseline); profitFactor response type `number`
  emits `null` (contract → `number | null`); unused `aggregatePortfolio` `initialCapital`
  param (cosmetic).
- **Perf:** single-pass O(instruments × minLen), no per-bar alloc → no optimization needed.

## Q02 — `lib/backtest/core.ts` (WS-Q) — DONE (PR auto/wsq-q02-core-2026-06-15)
- Reviewed `backtestInstrument` end to end: T+1 signal→next-open execution, 2bps entry
  slippage (long-only, correct after the prior `rows[i].action` fix), ATR-adaptive +
  trailing + lock stops via the `evaluateStopHit` SSOT, DD circuit breaker with T+1 exit,
  `currentEquity` mark-to-market, `closePosition` SSOT, 252/365 annualization. All sound.
  `<252`-bar stub (the F-1 root) confirmed present.
- **BUG FIXED (SAFE):** entry sizing had no finite/positive guard on `entryPrice`
  (= nextOpen + slippage). A corrupt bar (open 0/NaN/Infinity) → `shares` Infinity/NaN
  (the `shares <= 0` check misses both) → NaN poisons capital + the whole equity curve +
  totalReturn/Sharpe/maxDD. Added an explicit guard (skip-and-mark on unpriceable bar).
  Behavior-preserving on clean data → benchmark WR unchanged (CI gate). +5 corrupt-open
  invariant tests (16/16 pass); tsc clean.
- **Escalated (change published numbers — owner re-baseline, per §4b):**
  - **F-4** — `closePosition:171` books gross pnlPct (no cost subtraction) → winRate /
    profitFactor / the published ~54% WR + CI floor are GROSS of cost.
  - **F-8** — the equity curve marks MTM at `rows[i].close` (today) while fills are at
    `rows[i+1].open` (tomorrow) → MTM "booked one bar early"; affects Sharpe / DD /
    dailyReturns. Self-consistent but a half-bar timing skew.

## Open escalation queue (owner decisions)
1. **F-4** net-of-cost per-trade WR + CI-floor re-baseline (Q01+Q02). Highest-value, owner-gated.
2. **F-8** T+1 MTM one-bar-early in the equity curve (Q02). Owner-gated (changes Sharpe/DD).
3. profitFactor response contract `number` → `number | null` (Q01).

## Q03 — `lib/backtest/signals.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)
- `enhancedCombinedSignal` + `resolveBacktestSignal`. Every per-indicator score is
  finite-guarded and `clamp`-ed to [-1,1] (documented Phase-13 ensemble-bound audit);
  thresholds match the docstring (BUY >0.25 / SELL <-0.30); no look-ahead (the caller
  in core.ts passes lookback-only slices); the SSOT import block (indicators imported
  from `@/lib/quant/indicators`, NOT re-exported) is correct. The enhanced path is
  research-only (off in prod via `useEnhancedCombinedSignal()`); prod uses the
  regime-only branch. Covered by `signals.test.ts` + `signalParity.test.ts`. No bug found.

## Session cells: Q01 (fixed, live) · Q02 (fixed, merged) · Q03 (clean). 
**Next cell:** Q04 — `signalHelpers.ts` + `signalTypes.ts` (post-F-6 SSOT; confirm parity).
The scheduled routine continues Q04+ daily; the F-4/F-8/profitFactor-contract escalations
await owner decisions.
