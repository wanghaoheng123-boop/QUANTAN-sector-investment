# Program Day — 2026-07-06 (Monday weekly deep-sweep → owner-directed FIX WAVE)

Owner directive mid-sweep: **"continue, find out the issues, fix the issues. especially fix the
bugs and improve the UI UX and algorithms."** The sweep's gate phase completed first (baseline),
then the session pivoted to a find-and-fix wave. The owner directive constitutes the sign-off for
the previously owner-gated re-baselines shipped below.

---

## 1. Weekly deep-sweep gates (§7) — baseline BEFORE the fix wave

| Gate | Result |
|---|---|
| tsc --noEmit | CLEAN |
| pytest (sidecar) | 127 passed / 1 skipped (= 06-30 baseline) |
| benchmark (label SSOT) | **net 56.33% / gross 57.35%** — floor 53.29 PASS; **+0.44pp WoW** (55.89 on 06-30; 07-05 data refresh in play). Note: net is 0.02pp under the §4 "investigate <56.35" line — investigated: it *improved* WoW on a data refresh with no code change; the 56.35 band predates recent refreshes. |
| benchmark:oos | IS 68.72 / OOS 62.23 → **gap 6.49pp** (<10 no-collapse PASS; was 6.19) |
| Vercel runtime errors (7d) | **0 errors, 0 warnings** — B-2 news fix holding (standing sweep step) |
| npm audit --omit=dev | 14 (1 low / 8 moderate / **5 high, 0 critical**) — unchanged, owner-deferred build chain |
| portfolio:backtest, stryker | **skipped** — owner redirected to the fix wave mid-sweep |

## 2. Fix wave — 4 PRs, all CI-green (6 gates) and merged to main

### PR #84 — fix(backtest): F-9 + F-2 + Q05-1 (quant correctness)
- **F-9** (core.ts, was owner-gated): entry double-counted the 2 bps open friction (price markup
  AND inside the 11 bps/side txCost). Entries now fill at the **raw next-open**; the executionModel
  11 bps/side is the sole friction — symmetric with exits. The backtest page's "≈22 bps round-trip"
  copy is now exactly true.
- **F-2** (engine.ts + core.ts, was owner-gated): alpha compared MISMATCHED windows (common-window
  portfolio return vs full-history B&H incl. 200-bar warmup). `BacktestResult.bnhCurve` is now
  index-aligned with `equityCurve` by construction; `aggregatePortfolio` measures B&H over the SAME
  end-aligned common window.
- **Q05-1** (regimeSignal.ts, was owner-gated): unknown 200SMA slope (200–220 bars) in a dip zone
  emitted FALLING_KNIFE SELL at 82–95% confidence from missing data → now fails closed to a
  20-confidence HOLD. Backtest-trade-neutral (BUY requires known-positive slope → no position can
  exist before bar 221).
- **Measured deltas (real 56-instrument universe):** published label WR **byte-identical**
  (net 56.33 / gross 57.35); displayed alpha **−104.58% → −89.24%** (bnhAvg 104.88 → 89.55,
  window-matched); engine totalReturn 0.3023% → 0.3048%; trade WR unchanged 34.6154% (no flip).
- 5 new regression tests; 160 targeted tests green.

### PR #85 — fix(quant): Q25-1 BTC conditional vol √365 + 7-day calendar (was owner-gated)
`ewmaVolForecast` gains `{ periodsPerYear, includeWeekends }` (defaults 252/weekdays — equities
unchanged); `fetchGarchForecast` derives 365 + 7-day week from the `tradingDaysPerYear` SSOT.
**BTC displayed conditional vol +20.3%** (√(365/252)) — the correct annualization. 4 new tests.

### PR #86 — fix(data): F1.5 dividends actually flow (fetch + loader)
The dividend-aware B&H was inert for TWO reasons: the fetch script saved OHLCV only, **and**
`loadStockHistory` rebuilt rows dropping any `dividend` field (second inertness layer — NOT in the
ledger row; found by tracing to the boundary per the 06-30 lesson). Both fixed; `chart()` already
returns dividend events by default (v3.13.2 verified). **No numbers move until the next Saturday
data refresh** regenerates fixtures; then B&H/alpha include dividends (honest comparison).

### PR #87 — feat(ui): NEW-Q-1 user-facing survivorship disclosure + matched-window label
- Backtest page "How these are measured" block now carries the **Universe note** (56 currently-
  listed large-caps + BTC; survivor set; flatters absolute levels). Completes NEW-Q-1 (internal
  SSOT half was #79).
- KeyMetricsStrip Alpha card sub-label → "B&H avg (matched window)" (mirrors F-2).

## 3. Ledger reconcile
F-9, F-2, Q05-1, Q25-1 → **FIXED** · F1.5 → **FIXED-PENDING-DATA** (activates next refresh) ·
NEW-Q-1 → **FIXED**. Rows updated in `reviews/findings-ledger.csv` (this PR).

## 4. Environment / method notes
- **jsdom component tests freeze locally on BOTH the FUSE mount and a local-disk worktree with
  FUSE-mounted node_modules** (5-min timeouts; two attempts). They run fine in CI. Extends the
  known MEMORY_LOG env lesson — don't attempt local jsdom runs at all; targeted pure-node vitest
  files remain fine (~3s).
- BacktestPage snapshots pin only loading/error states by design (Q-058-NEW) → data-state copy
  changes are snapshot-neutral; no `-u` needed.
- Runtime-errors sweep (the B-2 method) came back clean — the actionable bugs this pass were all
  code-verified ledger items unblocked by the owner directive.

## 5. Remaining owner-gated backlog (unchanged)
A6-1 CSP-flip LANDMINE (do NOT set `QUANTAN_CSP_ENFORCE=1`); scheduled-task → Opus 4.8 re-point
(daily-program stall root cause); F-4 gross→net WR label decision; F-11 union-calendar maxHoldDays
(dormant); F-3 close-based trailing peak (deliberate-conservative candidate); Q09-1 (dormant
enhanced path); F4-3 axe-CI infra. Next Monday: full §7 sweep incl. portfolio:backtest + stryker.
