# Program Day — 2026-06-15 (kickoff run, interactive)

**Cell:** Q01 — `lib/backtest/engine.ts` (WS-Q lead). First program run, executed
interactively (not via the scheduled task, which first fires next launch ≥09:00 local).

## Correctness review
- `aggregatePortfolio`: the F-1/F-1a stub-exclusion fix (`combinable` partition +
  `excludedTickers`) is **present and correct**; end-aligned common-window combine,
  252/365 annualization, sample-variance Sharpe, Sortino, DD-from-curve all sound.
- **BUG FOUND + FIXED (SAFE):** profit factor is reported as `Infinity` for an
  all-wins/no-losses instrument (`engine.ts:83`, `core.ts:428`). `Infinity` does not
  survive `JSON.stringify` — `NextResponse.json` emits `null`. `AnalysisTab.tsx:141`
  guarded only `=== Infinity`, so the `null` reached `null.toFixed(2)` → **render
  crash** of the risk-return table for any zero-loss instrument. Fixed via a pure,
  node-testable `formatProfitFactor()` (`lib/backtest/formatMetrics.ts`) that maps
  null/non-finite → ∞; wired into AnalysisTab; +3 regression tests.

## Escalations (NOT auto-fixed — per program §4b)
1. **F-4 — per-trade win rate / profit factor are GROSS of costs** (`core.ts` pnlPct).
   Fixing changes the published WR / CI floor → **owner re-baseline required**. (Known.)
2. **profitFactor response-contract inconsistency** — `app/api/backtest/route.ts:49`
   and `PortfolioSummary` type it `number`, but the engine emits `Infinity`→`null`.
   Recommend typing it `number | null` (or a documented sentinel) — **contract change**,
   owner review. (Frontend is now crash-safe regardless.)
3. **Dead param** — `aggregatePortfolio(results, initialCapital)`: `initialCapital` is
   unused in the body (the returned `initialCapital` is `combinedEquity[0]`). Cosmetic;
   removing it changes the call signature (route.ts passes `100_000`). Left as-is.

## Carry-forward
- **F-8** (T+1 MTM booked one bar early) lives in `core.ts`, not engine.ts → handle at
  **Q02**. **Mixed-calendar end-alignment** residual is documented in engine.ts (needs
  dated equity curves) → WS-P / future.

## Performance
- `aggregatePortfolio` is a single pass O(instruments × minLen) with no per-bar
  allocation beyond the combined-equity array. **No hot-path issue**; no optimization
  needed at this size. (Profiling target for large universes deferred to WS-P/P1.)

## Verify
- `formatMetrics` test 3/3 · `tsc --noEmit` clean. benchmark unaffected (display-only
  change, not in the signal path) → CI gate.
- Disposition: **SAFE → PR auto/wsq-q01-engine-2026-06-15 → auto-merge on green CI**;
  post-merge prod smoke. Browser-render of the fix not done locally (auth-gated backtest
  page + FUSE jsdom freeze) — covered by the pure-fn test + CI; prod smoke after merge.

**Next cell:** Q02 — `lib/backtest/core.ts` (incl. F-8 T+1 MTM, F-1 stub confirm, F-4 context).
