# Cursor PR #41 Deep-Dive PART 2 — 2026-06-04

Reviewer: automated inspection agent (claude-sonnet-4-6)
Commit reviewed: 27186af `fix(handover): portfolio sim realism, backtest core split, BTC page decomp`
Base: 532f0c4c  Merge ref: de9a3d5 (PR #41, merged 2026-06-02)

Prior wave already verified: T+1 entry/exit logic, cost model (22 bps RT), portfolioBacktest.ts.
This file covers the remaining scope.

---

## Overall verdict on Cursor's week: ACCEPT-WITH-FOLLOWUP

The architectural work (engine/core split, BTC page decomposition, chartEma SSOT) is sound.
Generated artifacts are internally consistent. The coordination doc is accurate (pre-#46 snapshot
correctly superseded by SESSION_STATE). Two unmerged branches hold potential value.

Three issues require follow-up before production:
1. `useBtcPriceWs` unmount path leaks zombie WebSockets (P1 — genuine memory leak)
2. GARCH `arch` package not declared in requirements — MLE path is dead code in production (P1)
3. GARCH EWMA fallback lacks NaN guard on input returns (P1)

P1 count: 4 (priceWs leak, arch missing dep, GARCH NaN, priceFromBinanceWsRef name)
P2 count: 4 (GARCH convergence, priceWs backoff, klineWs LIVE flicker, vis/emaSelection dual state)

---

## P0 / P1 / P2 Findings

### P1 — `useBtcPriceWs`: immortal zombie WebSocket on unmount (memory leak)

File: `components/crypto/hooks/useBtcPriceWs.ts`, cleanup effect (~line 155-162)

The unmount cleanup clears the reconnect timer and then calls `priceWsRef.current?.close()`.
However, `ws.onclose` is **not nulled before close()** — calling `close()` fires `onclose`
asynchronously after the cleanup returns. `onclose` unconditionally schedules a new
`setTimeout(connectPriceWs, 5000)`. Five seconds later `connectPriceWs()` runs on the
unmounted component, opens a new Coinbase WebSocket, and its `onclose` again schedules
another reconnect — forever.

Contrast with `useBtcKlineWs`: its `onclose` guard `if (gen !== klineGenRef.current) return`
prevents reconnection after the gen-counter is incremented during unmount. `useBtcPriceWs`
has no such guard.

Effect: navigate to the BTC page and away N times → N zombie Coinbase sockets plus
`setState` on unmounted components (React warning in dev, undefined behavior in prod).

Fix: either null-out `ws.onclose = null` before `.close()` in the cleanup, or add an
`isMountedRef` / gen-counter guard mirroring `useBtcKlineWs`.

Severity: P1 (genuine memory leak + setState-on-unmounted-component).

### P1 — `priceFromBinanceWsRef` stale name (useBtcPriceWs.ts)

File: `components/crypto/hooks/useBtcPriceWs.ts` (no specific line — refs throughout)

The ref is named `priceFromBinanceWsRef` but the hook connects to **Coinbase** WS
(`wss://ws-feed.exchange.coinbase.com`). Naming is misleading for future maintainers and
suggests copy-paste from a Binance integration. No functional bug, but the flag controls
whether REST-fallback parse errors are suppressed (`if (!priceFromBinanceWsRef.current)`)
— confusion about what the flag means could cause a maintainer to break the suppression
logic when switching providers. Rename to `priceFromWsRef`.

Severity: P1 (naming/logic ambiguity in a live-data path; not a runtime crash).

### P1 — GARCH: `arch` package not declared as a dependency — MLE branch dead in production

File: `requirements.txt` (root), `ml/requirements.txt`

`quant_framework/garch.py` does `from arch import arch_model` inside a `try/except Exception: pass`.
Neither `requirements.txt` nor `ml/requirements.txt` declares `arch` (the package is `arch` on PyPI,
`arch-py` variant). In any deployment environment built from these requirements files, the `ImportError`
is silently swallowed and the function **always runs the EWMA fallback**. The GARCH(1,1) MLE path
is effectively dead code in production.

The UI labels the result `method: "garch11_mle"` vs `"ewma_proxy"`, so downstream callers
can distinguish — but users will never see "garch11_mle" unless `arch` is manually installed.
Fix: add `arch>=5.3.0` to `requirements.txt`.

Severity: P1 (feature silently non-functional; production always falls back to EWMA proxy).

### P1 — GARCH: no NaN guard on input `returns` array (`quant_framework/garch.py`)

File: `quant_framework/garch.py`, line 7 (`def fit_garch11`)

If `returns` contains NaN (e.g. from a price series with a missing bar), `np.var(returns[:20])`
silently propagates NaN through the EWMA init, yielding `ann = nan` in every output dict.
The TS client (`lib/quant/garchClient.ts`) does not validate `conditionalVol` before displaying.
Fix: add `returns = returns[np.isfinite(returns)]` after the `len(returns) < 30` guard,
and recheck length after filtering.

Severity: P1 (silent NaN in forecast output, would render blank or NaN in UI).

### P2 — GARCH: `horizon` not validated; EWMA lacks `len(returns) < 30` re-check after slicing

File: `quant_framework/garch.py`

If caller passes `horizon=0` or `horizon < 0` the function returns an empty list silently.
The EWMA init uses `returns[:20]`; if `len(returns) == 30` exactly, the loop `for r in returns[20:]`
runs only 10 iterations which is thin but not wrong. After the NaN-filter fix (P1 above), the
recheck is needed. Severity: P2.

### P2 — `useBtcPriceWs`: REST-fallback polling starts immediately at `setTimeout(…, 120_000)`

File: `components/crypto/hooks/useBtcPriceWs.ts` lines ~90-110

The REST fallback only fires if `Date.now() - lastWsMessageRef.current > 120_000`. The initial
`lastWsMessageRef.current` is set to `Date.now()` at module scope, so on first mount the 2-minute
guard works correctly. However, the interval (60 s) could theoretically fire during a brief
reconnect window between `ws.onclose` and the reconnect completing (5 s gap), unnecessarily
triggering a REST fetch. No user-visible bug, but slightly wasteful. Severity: P2.

### P2 — `vis` state initialization in page.tsx: `btcDefaultEmaSelection()` called inline in initializer

File: `app/crypto/btc/page.tsx` lines ~23-30

```ts
const [vis, setVis] = useState<Record<ChartVisKey, boolean>>(() => ({
  ...btcDefaultEmaSelection(),
  vwap: false,
  ...
}))
```

`btcDefaultEmaSelection` is also imported and used standalone for `emaSelection`. The spread
merges EMA keys + chart-vis keys correctly. No bug, but the two states (`emaSelection` and
`vis`) are partially duplicated: EMA toggles live in both. The `handleVisToggle` syncs them
via regex (`/^ema(\d+)$/`). This is a maintenance trap — if a new EMA key is added that
doesn't match the regex it will desync. P2 cleanup: derive emaSelection from vis rather than
keeping two independent states. Not a correctness bug in current code.

---

## BTC Decomposition Assessment

**CLEAN decomposition.** The original monolithic page shrank to ~125 LOC (pure orchestration):
state, refs, effects, and layout. Four components and three hooks are well-separated by concern:

- `BtcHeader` — display only, no state ownership; `memo()` applied correctly.
- `BtcTabBar` — display only; `memo()` applied; ARIA roles present (`role="tablist"`, `role="tab"`,
  `aria-selected`).
- `BtcChartPanel` — all chart UI/config; `memo()` applied; receives config via props.
- `useBtcCandles` — REST fetch with AbortController, 3-retry loop, request-ID guard against
  stale responses, CoinGecko client fallback. Lifecycle: cleanup aborts pending request on unmount.
- `useBtcKlineWs` — Kraken WS v2 OHLC. Generation counter (`klineGenRef`) prevents stale
  closures across interval changes. Reconnect timer cleared on disconnect/unmount. Cleanup
  effect (`useEffect(() => () => {...}, [])`) correctly cancels on unmount.
- `useBtcPriceWs` — Coinbase ticker WS. Reconnect timer with 5 s backoff. Cleanup effect
  closes socket and clears timer on unmount.

**Lifecycle assessment:**

**`useBtcKlineWs` — CLEAN.**
1. Generation counter (`klineGenRef`) is incremented on `disconnectKlineWs()` and before each new
   `connectKlineWs()`. The `onclose` handler guards `if (gen !== klineGenRef.current) return`,
   so reconnect timers from old sockets are suppressed after unmount. Unmount cleanup increments
   the counter and closes the socket. No zombie reconnects.
2. `connectKlineWs` is in the page effect dependency array; its `useCallback` deps are all refs
   (stable references). No infinite re-render loop.

**`useBtcPriceWs` — P1 LEAK (see Findings above).**
The unmount cleanup does NOT null `ws.onclose` before calling `.close()`. The `onclose` callback
fires asynchronously after cleanup, unconditionally schedules a reconnect timer, and the cycle
repeats forever. Navigate away from the BTC page and back N times → N zombie Coinbase sockets.

3. **`useBtcPriceWs` reconnect backoff**: fixed 5 s — no exponential backoff. For extended outages
   the hook retries at full rate. Minor; acceptable for a price ticker (P2).

4. **Race on timeframe change**: when `activeRange` changes, `connectKlineWs(activeRange)` is called
   without explicitly calling `disconnectKlineWs()` first. Internally `connectKlineWs` closes the
   prior socket, but the prior socket's async `onclose` fires after the new socket's `onopen` has
   already set `wsConnected=true`, briefly flashing the LIVE indicator off. Cosmetic only (P2).

**Overall verdict: `useBtcKlineWs` is clean. `useBtcPriceWs` has a P1 memory leak on unmount
that must be fixed before this page is used in a multi-route SPA.**

---

## GARCH MLE Assessment

File: `quant_framework/garch.py` (32 LOC total)

### Deployment status of MLE path
`arch` is NOT declared in `requirements.txt` or `ml/requirements.txt`. The `try/except Exception: pass`
silently swallows the `ImportError`. In production, the GARCH(1,1) MLE branch is dead code — the
EWMA proxy always runs. (See P1 finding above.) The constraint analysis below is therefore academic
until `arch>=5.3.0` is added to requirements.

### Parameter constraints (when arch is installed)
The `arch` library's `arch_model` with `vol="Garch"` uses scipy constrained optimization by
default: ω > 0, α ≥ 0, β ≥ 0, α+β < 1 (covariance-stationarity). These are **enforced by
the library**, not by Cursor's code. The code correctly delegates this to arch.

### Scaling
`returns * 100` is the recommended arch practice for numerical stability. Correct.

### Initial values
Not specified (arch auto-selects via MOM estimator). Acceptable for a production sidecar — 
arch's defaults converge reliably on daily equity returns.

### Convergence check
`res.convergence_flag` is NOT checked. If arch's optimizer fails to converge, it returns
parameters that may be on the constraint boundary (α+β ≈ 1, near-IGARCH). The forecast
is still mathematically valid but may overestimate persistence. For a Phase 16 deliverable,
not checking `res.convergence_flag` or `res.loglikelihood` is acceptable (falls back to EWMA
anyway on any exception). P2 enhancement.

### Log-likelihood stability
`rescale=False` prevents arch from auto-scaling the series — harmless because Cursor already
scales manually (`returns * scale`). No NaN/Inf risk from the arch call itself.

### NaN/Inf in input
Not guarded (see P1 finding above). EWMA init `np.var(returns[:20])` would return NaN if
any of the first 20 returns are NaN, propagating silently to output.

### TS sidecar contract
`garchClient.ts` fetches `${QUANT_FRAMEWORK_URL}/garch/${ticker}` via HTTP GET. The Python
sidecar API is assumed to serve at that path. The client does not pass the `returns` array —
it relies on the sidecar to fetch its own data for `ticker`. This means `garch.py`'s
`fit_garch11(returns, horizon)` is called from a Flask/FastAPI route that fetches returns
internally. The TS `closes` parameter to `fetchGarchForecast` is only used by the local
EWMA fallback, not sent to Python. **This is an important contract detail**: the TS and
Python sides are NOT coupled by the returns array — they use separate data sources.
No correctness bug, but worth documenting: Python sidecar result quality depends on its
own data-fetch path, not the chart data already in the browser.

**GARCH MLE verdict: NEEDS-REVISION.** MLE is dead code in production (missing `arch` dep, P1).
EWMA NaN guard missing (P1). Convergence check missing (P2). Add `arch>=5.3.0` to requirements,
then add NaN filter and convergence check.

---

## chartEma SSOT Claim: REAL

`lib/chartEma.ts` owns:
- `CHART_EMA_PERIODS` (the canonical list of all supported periods)
- `CHART_EMA_COLORS` (period → color mapping)
- `ChartEmaKey`, `ChartVisKey` types
- Preset → flag builders (`buildVisFromIndicatorPreset`, `buildIndicatorConfig`)
- Default selections (`btcDefaultEmaSelection`, `tradingDefaultEmaFlags`)

`lib/quant/indicators.ts` owns:
- `ema()`, `emaFull()` (the actual EMA math)

`components/KLineChart.tsx` imports from BOTH:
- Periods/colors from `chartEma`
- Math functions from `indicators`

There is NO duplication — `chartEma.ts` does not reimplement EMA math. The SSOT claim is
accurate: all chart-layer EMA config lives in one file, all computation lives in another.

---

## `lib/backtest/engine.ts` and `walkForward.ts` Changes

### engine.ts
Cursor's change was a **near-total rewrite** (−449 LOC, +21 LOC): the single-instrument
loop (`backtestInstrument`), all data types (`OhlcvRow`, `Trade`, `BacktestResult`),
and the transaction cost constants were extracted to `lib/backtest/core.ts` (new file).
`engine.ts` became a thin facade: re-exports from `./core` + the `aggregatePortfolio`
function + walk-forward re-exports.

Comments stripped: many inline explanatory comments (F1.2, C2, Phase 13 notes) were
removed. The logic is unchanged; only documentation was deleted. This is a minor
information loss but not a correctness issue.

### walkForward.ts
Single-line change: import source for `backtestInstrument` changed from `./engine` to
`./core`. This breaks the circular dependency that existed between engine↔walkForward
when walkForward imported from engine and engine re-exported walkForward. Architecturally
correct.

**No correctness changes in either file — pure structural refactoring.**

---

## Generated Artifacts Spot-Check

### `scripts/benchmark-results.json`
- `timestamp`: 2026-06-02T00:56:01Z
- `aggregate.aggregateWinRate`: 55.31 (gross), `aggregateNetWinRate`: 54.34 (net) — both in [0,100] range
- `byInstrument`: 56 entries; all `winRate` values in [0,1] (decimal form); no NaN or null
- `aggregate.totalBuySignals`: 3491, `totalWins`: 1931, `totalLosses`: 1560
  - Consistency check: 1931/(1931+1560) = 55.3% ≈ 55.31% gross WR. CONSISTENT.
- `executionCosts.roundTripPct`: present (22 bps RT confirmed separately)

**Benchmark results: internally consistent. No anomalies.**

### `scripts/portfolio-backtest-results.json`
The task description mentions "~48.37% WR" headline. This appears in the MEMORY_LOG as
"portfolio best WR 48.37%" (2026-06-03 FULL-VERIFY entry). The actual best config in the
file is `hold25_pt10_trail6_panic4` with `winRate: 49.46%` (metrics field, percentage form)
and trade-level verification gives 91/184 = 49.46%. The 48.37% figure does not appear in
this file — it may refer to an earlier run (the file's timestamp is 2026-06-03T15:18:19Z,
which post-dates the MEMORY_LOG entry). The current file's 49.46% is internally consistent.

All ranking entries:
- `winRate` in (46, 55) range — all in valid percentage range
- `maxDrawdown` in (15, 18) range — all positive percentages, plausible
- `profitFactor` in (1.23, 1.37) — all > 0, plausible
- `sharpeRatio` all negative (-1.01 to -1.38) — consistent with the negative total returns
  reported (-2.7% to -7.73%). Note: all configurations show negative Sharpe and negative
  total returns. This is the OOS period (2022-present bear market context); the strategy
  underperforms. The data is honest and consistent; not inflated.
- No NaN or null fields in bestTrades (184 trades checked)

**Portfolio results: internally consistent. The MEMORY_LOG "48.37%" figure (89/184 = 0.4837) and
the current file's "49.46%" (91/184 = 0.4946) differ by exactly 2 trades — consistent with a
re-run between the 2026-06-02 MEMORY_LOG entry and the 2026-06-03T15:18Z file timestamp.
This is artifact/doc drift across two separate runs, not a fabrication. No anomaly.**

---

## `components/stock/quantlab/tabs/LlmTab.tsx` Diff

PR #41 made exactly 3 changes:
1. Added `import { memo } from 'react'`
2. Changed `export function LlmTab(props: LlmTabProps)` to `export const LlmTab = memo(function LlmTab(props: LlmTabProps)`
3. Changed closing `}` to `})`

This is a pure performance optimization — wrapping the 470-LOC component in `memo` to
prevent re-renders when parent re-renders with same props. The LlmTab does not use any
unstable callbacks or context; memo is appropriate here. No correctness concern.

---

## Unmerged cursor/* Branches — Per-Branch Verdict

### cursor/backtest-ui-fixes (0682b10) — DEAD/SUPERSEDED

Single commit dated 2026-04-03 (2 months old). The commit-stat shows the branch contains
the entire repo as additions (it diverged from a very old base before the main refactors).
`git diff main..cursor/backtest-ui-fixes` confirms it's missing hundreds of test files,
`lib/backtest/core.ts`, all the rectification work, etc. The "fix slope pct bug" and
"CSS color tokens" changes mentioned in the commit message may have been independently
re-applied to main during later waves, or are superseded by the SSOT rewrite.
**Recommend: DELETE.** No unmerged value; rebasing would conflict on hundreds of files.

### cursor/fix-briefs-url (207bc5b) — DEAD/SUPERSEDED

Single commit dated 2026-04-03. The "Add commodities and indices live prices section"
change to the homepage is the nominal new feature, but `git diff main..cursor/fix-briefs-url`
shows this branch is also missing all post-April main work. The homepage live prices widget
(commodities/indices) is either already in main via a later PR or was superseded.
A quick check shows `app/page.tsx` in main already has market data sections.
**Recommend: DELETE.** Superseded.

### cursor/institutional-research-platform (ea1eea2) — HOLDS-UNMERGED-VALUE

Single commit dated 2026-04-04. The unique files NOT in main are substantive:
- `lib/quant/optionsGamma.ts` — Black-Scholes Greeks (delta, gamma, theta, vega, rho), GEX, call/put walls, max pain, Vanna, Charm
- `lib/quant/priceFloorCeiling.ts` — VWSR, order blocks, VWAP bands, Kelly ATR zones, Fibonacci, pivot points
- `lib/quant/marketMakerAnalysis.ts` — Cumulative delta, order imbalance, smart money divergence
- `lib/backtest/enhancedBacktest.ts` — Backtest validation (look-ahead, survivorship bias, overfitting), regime performance
- `app/research/[ticker]/page.tsx` — Research dashboard
- Several UI components (`GammaWallChart`, `DeltaFlowChart`, `MarketMakerPressureGauge`, `VerificationBadge`)

These are non-trivial quant features not present in main. The branch is 2 months old and
would need a rebase onto current main, but the intellectual content (options analytics,
floor/ceiling detection) has potential value.
**Recommend: EVALUATE before deleting.** Rebase and review for quality before deciding
whether to integrate. The optionsGamma Greeks implementation in particular could complement
the BTC quant lab.

### cursor/trading-simulator (87e3ca2) — HOLDS-UNMERGED-VALUE

Single commit dated 2026-04-27 (newer than the others). Unique files NOT in main:
- `app/api/simulator/run/route.ts` — simulator backend route
- `app/simulator/page.tsx` — simulator UI page
- `components/simulator/LiveQuoteCard.tsx`, `SimulatorResults.tsx`, `StrategyBuilder.tsx`, `StrategyGuide.tsx`

The commit message says "deprecate stale ts sqlite migration entrypoint" but the stat shows
substantial new simulator code. A trading simulator UI (paper trading / strategy builder)
is a distinct product feature not in main.
**Recommend: EVALUATE before deleting.** The simulator components could be a meaningful
UX addition. Rebase onto main and review quality.

---

## Coordination Role: Accurate, Not Misleading

`workspace/coordination/PROGRESS_COORDINATION_2026-06-03.md` was written at approximately
03:24 UTC on 2026-06-03, immediately after merging #44 and #45. At that moment:
- PR #46 was correctly described as "HOLD — awaiting owner merge approval" (CI green)
- PRs #47–#52 did not yet exist

The document is an accurate **point-in-time snapshot**, not a misleading status report.
It correctly described a "CONDITIONAL GO" state.

By 16:22 UTC the same day, `workspace/SESSION_STATE.json` was updated to reflect:
- PR #46 merged as `e076a99`
- PRs #47–#52 all merged
- `recent_merges: ["#46","#47","#48","#49","#50","#51","#52"]`
- `origin/main @ 63b2d17` (#49 push)

The SESSION_STATE correctly supersedes the coordination doc. No misleading claims.

One minor note: the coordination doc states "1017 / 85 files" for tests at Wave 11 baseline.
SESSION_STATE `last_inspection.results.tests` says "1017 passed / 85 files" — consistent.
The post-#46 state reached 1017+ tests (PR #46 added Q-051 coverage). No fabrication.

---

## What I Did NOT Cover

- `components/crypto/BtcQuantLab.tsx` (516 LOC) — full options/regime analytics component
- `app/api/crypto/btc/route.ts` (339 LOC) — BTC data API with Kraken/CoinGecko/Coinbase sources
- `lib/crypto.ts` (254 LOC) — crypto utility functions
- `lib/quant/btc-indicators.ts` (433 LOC) — BTC-specific indicators
- `quant_framework/data_engine.py` (229 LOC) — data pipeline
- `scripts/benchmark-enhanced.ts` (392 LOC) + `benchmark-results-enhanced.json` — enhanced benchmark
- Full walk-forward result validation (only structure checked, not statistical validity)
- The 207-test suite changes included in PR #41 (test quality review is a separate agent scope)
- `.ai/memory/*` files (Cursor's memory system — outside review scope)
