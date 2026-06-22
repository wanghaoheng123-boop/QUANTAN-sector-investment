# Program Day — 2026-06-22 (manual Opus-4.8 run; queue recovery)

Run context: **manual**, not the scheduled fire. The owner reported an
`API Error: 400 tools.16.model: Claude Fable 5 is not available` and asked to fix
the errors and continue. Diagnosis below. Cell run this day: **Q05**.

> NB: 2026-06-22 is a **Monday** → the program's §7 default is the weekly deep sweep.
> The owner explicitly chose to run the next pending cell (Q05) instead, so the deep
> sweep was **not** run today; it remains due.

---

## Root cause — why the program stalled since 2026-06-15

The daily scheduled task (`quantan-autonomous-program`, cron `0 9 * * *`) fired every
day 06-16 → 06-21 but produced **zero** output (no daily logs, no checkpoints, no
blockers, queue frozen at Q05). Discriminator: zero daily logs ⇒ the runs died at the
**first API request**, i.e. they fired on the **Fable 5** model, which Anthropic has
gated (fable-mythos-access) → every request 400s with `tools.16.model: Claude Fable 5
is not available`.

- **Nothing in the repo or local config pins Fable.** All `~/.claude.json` Fable
  references are the harness's own "Fable is disabled" bookkeeping; the scheduled task
  carries no model field (and `update_scheduled_task` exposes none — the harness picks
  the model at fire time).
- **This interactive run is on Opus 4.8, so it works.** Resolution everywhere = Opus 4.8.
- **The recurring fix is the owner's** (a UI action, not a file edit): keep the app's
  selected model on Opus 4.8 so the next 09:08 fire runs on Opus and resumes the queue.
  A one-off manual cell (this run) recovers a single day but does not change what model
  tomorrow's scheduled fire uses.

## Q05 — `lib/backtest/regimeSignal.ts` (WS-Q) — DONE, merged (PR #66, `ac4ce09`, prod ✓)

**Verdict: VERIFIED CLEAN (no live bug).** Line-by-line review:
- `sma200DeviationPct` / `sma200Slope` SSOT (`lib/quant/indicators.ts`) have finite/zero
  guards; `sma200Slope` requires ≥221 bars (`now`/`prev` 200-SMAs 20 bars apart).
- The `dev == null` **fail-closed** guard catches non-finite/non-positive price or broken
  SMA before any branch → HOLD/0-confidence (the documented prior fix that stopped bad
  data emitting CRASH_ZONE BUY/SELL at 78–95% confidence). Confirmed intact.
- No look-ahead — only historical `closes` slices are read; the deviation zone is driven
  by the separately-passed `price`.
- Deviation-zone thresholds (EXTREME/EXTENDED/HEALTHY_BULL ≥0; FIRST_DIP ≥−10; DEEP_DIP
  ≥−20; BEAR_ALERT ≥−30; CRASH_ZONE <−30) are internally consistent;
  `canBuyDip = slopePositive && nearSma` gates every BUY.

**Parity-safe cleanup (output byte-identical — proven by `signalParity`):**
- Removed **6 redundant `dev != null &&`** conditions: `dev` is narrowed to `number` past
  the fail-closed early return, so the checks were always-true dead code that wrongly
  implied `dev` could still be null there. Added a one-line note to prevent re-introduction.
- Fixed a wrong inline comment: `FIRST_DIP: -10% to -5%` → `-10% to 0%` (matches the code
  `dev >= -10` and the function docstring).

**Tests — closed a real coverage gap** (the prior FIRST_DIP test was a conditional that
could assert nothing): new `Regime Signal — zone boundaries & invariants` block. It uses
the fact that `regimeSignal(price, closes)` derives slope/near-SMA from `closes` but the
zone from `price`: a **flat** array (slope 0 → dips not buyable) and a **rising** array
(positive slope + near SMA → dips buyable) pin every zone deterministically, plus
cross-cutting invariants (`BUY ⇒ slopePositive`, `SELL ⟺ FALLING_KNIFE`, `confidence ∈
[0,100]`, purity). signals.test.ts 26 → **37**.

**The shipped change is SAFE** (no published-number/contract/auth/secret change → auto-merge).

**One latent finding ESCALATED (pre-existing, NOT introduced here; owner-gated → ledger `Q05-1`):**
At **201–220 bars**, `sma200Slope` returns null (it needs ≥221: a 200-SMA now and 20 bars
ago) so `slopePositive` is false, and a sub-−10% dip then emits a **confident
`FALLING_KNIFE` SELL (82–95%)** purely from *missing-slope data* — which contradicts this
file's own `dev==null` fail-closed intent. It is **reachable in the prod backtest path**:
`resolveBacktestSignal` (the non-enhanced default) is called from `core.ts:238`
`for (let i = 200; …)` with `closes.slice(0, i+1)`, i.e. 201–220 bars on each instrument's
first ~20 evaluated bars. Long-only, so a SELL-when-flat is a no-op; the real effect is
spurious early exits if a position is already held that early. **Owner-gated** because the
honest fix (treat slope-uncomputable dips as INSUFFICIENT/HOLD, extending the fail-closed
intent) changes backtest output → published numbers. Did **not** fix it in this cell.

## Verification (VERIFY A–F)
- **A typecheck:** `tsc --noEmit` clean.
- **B tests:** `signals.test.ts` 37/37; `signalParity.test.ts` 2/2 (behavior preserved).
- **C benchmark/WR:** unchanged by construction (output-parity change). Local benchmark
  froze on the Google-Drive FUSE mount → the **CI `benchmark` job (pass, 44s)** is the
  authoritative WR-floor confirmation; CI typecheck/test/coverage/smoke all pass.
- **D build/deploy:** Vercel production deploy `dpl_DRZByi3oq1T8QJsmy8RZJUFFDfop` (sha
  `ac4ce09`) → **READY**.
- **E prod smoke (quantan.vercel.app):** `/`=200 (60,713 B), `/api/sector-rotation`=200,
  `/api/analytics/AAPL`=200. **PASS** → no auto-revert.
- **F record:** this report + PROGRAM_QUEUE Q05→done + run-log + MEMORY_LOG row +
  SESSION_STATE bump.

## Q06 — `lib/backtest/executionModel.ts` (WS-Q) — DONE, merged (PR #67, `0c138fc`, prod ✓)

**Target verdict: VERIFIED CLEAN.** `executionModel.ts` is pure, correct cost math
(`spread 5 + slippage 2 + commission 4 = 11 bps/side` → 22 bps round-trip), and already
has an engine-parity test (`TX_COST_BPS_PER_SIDE === costBpsPerSide()`).

**Seeded F-9 finding CONFIRMED REAL — ESCALATED, not auto-fixed (ledger `F-9`, owner-gated):**
the double-count is in the engine, not the SSOT. In `core.ts backtestInstrument` a BUY pays
**both**:
1. a 2 bps `ENTRY_SLIPPAGE_BPS` bump baked into `entryPrice` (`core.ts:344`), and
2. `txCost = costBasis × 11 bps/side` (`core.ts:358-360`) — and 11 bps **already includes**
   a 2 bps `slippageBpsPerSide` component.

So the 2 bps open friction is **counted twice at entry** → entry ≈ **13 bps** vs the SSOT's
11 bps/side; round-trip ≈ **24 vs 22 bps**. Exit (`closePosition`, `core.ts:169`) is clean at
11 bps with no price bump (an existing comment already declines to mirror entry slippage onto
exit). The fix (reconcile to a single 2 bps source) shifts net returns / the published WR →
**owner re-baseline**, so it was left as-is.

**SAFE shipped (behavior-preserving — `signalParity` 2/2):**
- `executionModel.test.ts`: +2 tests for a custom `ExecutionCostConfig` and a zero-cost
  identity. The config-injection path was previously untested (only the default) → a
  parameterization regression would have passed silently.
- `core.ts`: a **doc-only** comment at the entry-cost site marking the F-9 double-count + the
  re-baseline caveat, so it is not silently "fixed" without a re-baseline.

### Verify (VERIFY A–F)
- **A** tsc clean. **B** executionModel 6/6 + signalParity 2/2. **C** benchmark unchanged
  (no behavior change; CI `benchmark` pass 43s). **D** Vercel prod deploy READY (`0c138fc`).
  **E** prod smoke `/`,`/api/sector-rotation`,`/api/analytics/AAPL` all 200. **F** recorded
  (queue/run-log/ledger F-9/this report/MEMORY_LOG/SESSION_STATE).

## Q07 — `lib/backtest/exitRules.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)

**Target verdict: VERIFIED CLEAN.** The exit primitives are correct and exhaustively
tested (50 cases): `evaluateStopHit` (intra-bar breach + gap-fill SSOT), `atrAdaptiveStop`
(forming-bar exclusion F1.22, floor/ceiling, property invariants), `checkExitConditions`
(priority stop>panic>signal>profit>trail>time, F1.3 intraday semantics), `computeExitStats`.
The **live** path (`core.ts`) imports only the clean `evaluateStopHit` primitive — NOT the
`checkExitConditions`/`maxHoldDays`/trailing machinery.

**Both seeded findings are caller-side in `portfolioBacktest.ts` and ESCALATED (ledger):**
that engine is a **dev script** (`scripts/portfolio-backtest.ts`) — in **no API route and no
CI gate**, so its output is not published.
- **F-11 (real bug, dormant):** `holdDays = currentIdx − entryIdx` (`exitRules.ts:252`) is fed
  **union-calendar** indices (`portfolioBacktest.ts:151` builds the union; passes `di` at `:316`,
  `entryIdx: di` at `:464`). An instrument that doesn't trade on some union dates has its hold
  window inflated by other tickers' sessions → `time_exit` on the wrong horizon. Fix needs a
  per-instrument bar count + a portfolio test (none exists).
- **F-3 (methodology note):** `updatePosition(pos, row.close)` (`:268`) ratchets `highestPrice`
  on the **close**, not the intra-bar high, so the trailing anchor understates the true peak.
  Arguably a *deliberate* conservative choice, and there is **no same-bar look-ahead**
  (checkExitConditions receives the pre-update `pos`, so today's close can't move today's trail).

Neither is auto-fixable under §4b: dormant engine with no validating gate, and F-3 is a
judgment call. No code change → tracking-only commit.

### Verify (VERIFY A–F)
- **A** n/a (no code change). **B** existing exitRules 50/50 (unchanged). **C** n/a (no
  behavior change). **D/E** n/a (no deploy). **F** recorded (queue/run-log/ledger F-11+F-3/
  this report/MEMORY_LOG/SESSION_STATE).

## Q08 — `lib/backtest/benchmarkLabel.ts` (WS-Q) — DONE, merged (PR #68, `4e801b8`, prod ✓)

**Verdict: parity-correct + one SAFE latent fix.** The label path calls the same
`resolveBacktestSignal` SSOT (parity guarded by `signalParity`); T+1 entry/exit indices,
warmup and bounds are correct.

**Latent bug FIXED (SAFE, benchmark-neutral):** `signalAtBarIndex` guarded `entryPrice` but
**not `exitPrice`** (`benchmarkLabel.ts:91-96`). A non-finite/≤0 exit close → `grossReturn`
NaN → slips the caller's `out.grossReturn == null` filter (`NaN != null`, `:137`) → counted as
a **loss** (`NaN > 0` is false) + poisons `avgReturn20d`. Added the symmetric exit guard (same
corrupt-bar class as Q02/Q04).

**Proven benchmark-neutral:** scanned all **56 `scripts/backtestData` files / 70,796 rows → 0
non-finite or ≤0 closes**, so no current BUY has a bad exit → the guard skips nothing today →
CI `benchmark` WR unchanged (CI `benchmark` pass 41s confirms). It only closes a latent leak.

**Test (`__tests__/backtest/benchmarkLabel.test.ts`, new):** exercises the guard through the
**real production BUY path** on committed AAPL data — corrupt EXIT close (`NaN`/`Infinity`/`0`/
`-5`) → null returns, action unchanged (signal uses `[0..buyBar]`); + an entry-guard regression
lock.

### Verify (VERIFY A–F)
- **A** tsc clean. **B** benchmarkLabel 2/2 + signalParity 2/2. **C** benchmark WR unchanged
  (proven by dataset scan; CI benchmark pass). **D** Vercel prod deploy READY (`4e801b8`).
  **E** prod smoke `/`,`/api/sector-rotation`,`/api/analytics/AAPL` all 200. **F** recorded.

## Q09 — `lib/backtest/liveSignal.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)

**Verdict: production-consistent and clean.** `buildLiveInstrumentSignal` maps OHLCV rows to
the live desk payload through the **same `resolveBacktestSignal` SSOT** as the backtest; every
indicator (rsi/macd/atr/bb/atrPct) is wrapped in `Number.isFinite(x) ? x : null`; `price =
last close`, no look-ahead. `signalParity` already locks `live.action/confidence/KellyFraction
=== resolveBacktestSignal` on the latest bar.

**Escalated Q09-1 (dormant, ledger):** `liveSignal` calls `resolveBacktestSignal` with **no
`sectorGates` arg** (`:85-92`) while `benchmarkLabel` passes `sectorGatesForTicker(ticker)`
(`:77`). `sectorGates` only affect the **enhanced** path, which is **off in production**
(`featureFlags.ts:15` → false when `NODE_ENV=production`), so live and backtest are identical
today. If enhanced is ever enabled, the live desk would skip sector gating the backtest
applies → divergence on gated tickers. Owner-gated: enhanced is research-only and slated
retire-or-invest; the fix is a prod-no-op but the enhanced path is unvalidated. Not changed.

### Verify (VERIFY A–F)
- **A** n/a (no code change). **B** signalParity 2/2 (live↔backtest parity, unchanged).
  **C/D/E** n/a (no deploy). **F** recorded (queue/run-log/ledger Q09-1/this report/MEMORY_LOG/
  SESSION_STATE).

## Q10 — `lib/backtest/portfolioBacktest.ts` (WS-Q) — DONE; F-2 escalated (no code change)

**Cell file is the DORMANT engine.** `portfolioBacktest.ts` is a dev script
(`scripts/portfolio-backtest.ts`), in no API route / no CI gate. Its `sectorGateByTicker`
wiring (`:215-232`) is correct-but-dormant (gates only bite the enhanced path); it computes
no alpha. F-3/F-11 already live here.

**F-2 was mis-scoped to this file — it actually lives in the LIVE path `engine.ts`
`aggregatePortfolio`:** `alpha = truePortfolioReturn − bnhAvg` (`engine.ts:189`). The portfolio
leg (`truePortfolioReturn`) is the **end-aligned common (min-length) window** combine, but
`bnhAvg` (`:188`) averages each instrument's **full-history** `bnhReturn` (`core.ts:422`
`computeBuyAndHoldReturn` over all rows). For unequal-length instruments the two legs span
different horizons → alpha is apples-to-oranges. **LATENT** on the current 56-file dataset (all
1255 bars → common == full → alpha currently correct), but `/api/backtest` accepts arbitrary
tickers, so mixed-length sets are reachable in production and alpha is shown in the backtest UI.
**Escalated** (ledger `F-2`): changes a published metric, and `aggregatePortfolio` is **not**
covered by the CI benchmark (which uses `benchmarkLabel`), so a fix can't be WR-gated → owner
re-baseline. Not changed.

### Verify (VERIFY A–F)
- **A** n/a (no code change). **B** unchanged. **C/D/E** n/a (no deploy). **F** recorded
  (queue/run-log/ledger F-2/this report/MEMORY_LOG/SESSION_STATE).

## Q11 — `lib/backtest/walkForward.ts` (WS-Q) — DONE, merged (PR #69, `0dc8122`, prod ✓)

**"OOS non-zero" already fixed** (F1.1 trade-attribution rework — see docstring; no action).

**F-12 FIXED (SAFE):** `annualized()` / `windowSharpe()` hardcoded **252** trading-days/yr for
IS/OS returns, the rf daily rate, and the Sharpe √T → wrong for **crypto (365)**. Threaded
`tradingDaysPerYear(ticker, sector)` (default 252 preserves equities).

**Why SAFE / nothing published changes:** `walkForward` is a **diagnostic** — not in any API
route, not UI-surfaced, not a CI gate; its only consumer is `engine.test.ts` (equity). The fix
is a **no-op for equities** (`→ 252`) and only corrects crypto, so the **engine suite (21
tests) is unchanged** and the CI `benchmark` (which uses `benchmarkLabel`, not `walkForward`)
is unaffected.

**Test (`__tests__/backtest/walkForward.test.ts`, new):** on real AAPL data, crypto (365)
annualizes the same window returns to a strictly **larger magnitude** than equity (252); equity
output identical across sectors (regression lock); crypto summary invariants hold.

### Verify (VERIFY A–F)
- **A** tsc clean. **B** walkForward 3/3 + engine 21/21. **C** benchmark unaffected (not in the
  walkForward path; CI `benchmark` pass 42s). **D** Vercel prod deploy READY (`0dc8122`,
  `dpl_AJMv…`). **E** prod smoke — first pass showed `/`=HTTP 000 (transient curl failure mid
  deploy-finalize; APIs were 200); **re-smoke `/`=200 ×2 + both APIs 200** → healthy, **no
  auto-revert** (re-smoke-before-revert per the workflow). **F** recorded.

## Q12 — `lib/backtest/dataLoader.ts` (WS-Q) — DONE, merged (PR #70, `5c78ecf`, prod ✓)

**OHLC + NaN-time sanitize VERIFIED CORRECT** across all three paths (warehouse + 2 JSON;
the D5-1 mirror is consistent). **One gap FIXED (SAFE):** all three pushed
`volume: x.volume ?? 0` — and `??` only catches null/undefined, so a **NaN/Infinity volume**
slipped through into the volume indicators (VWAP/VPOC/OBV/volSMA/`detectVolumeClimax`).
**Reachable on the warehouse path** (same non-finite source as D5-1; JSON serializes NaN→null,
so `?? 0` sufficed there). All three now `Number.isFinite(v) ? v : 0` — non-finite volume → 0,
valid price bar preserved.

**Why SAFE / benchmark-neutral:** scanned all 56 `backtestData` files / **70,796 rows = 0
non-finite volume** (latent guard); and the production signal (`regimeSignal`) uses **price
only, not volume** → cannot move the WR. +1 warehouse `NaN`/`Infinity`-volume test (row kept,
volume zeroed).

### Verify (VERIFY A–F)
- **A** tsc clean. **B** dataLoader 22/22. **C** benchmark-neutral (scan + price-only signal;
  CI `benchmark` pass 44s). **D** Vercel prod deploy READY (`5c78ecf`). **E** prod smoke
  `/`,`/api/sector-rotation`,`/api/analytics/AAPL` all 200. **F** recorded.

## Q13 — `lib/optimize/gridSearch.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)

Dev-only optimizer (consumers `parameterSets.ts` + `scripts/optimize-grid.ts`; **not in any API
route / no CI gate**). The **2026-06-04 remediation is intact**: the SELECTION-ON-OOS bias is
prominently documented (`:11-15`) — reported OOS metrics are upward-biased, treat as optimistic;
the inert 3/5 grid dims are collapsed + documented (`:71-85`); survivorship is a known data
limitation. **Code correct:** the OOS slice's 220-bar overlap (`:259`) is **warmup-only** — the
trade loop's `i=220` start counts trades from exactly `splitIdx`, so **no IS-trade leaks into
OOS**; T+1 entry (`:200`); no look-ahead; trade-level Sharpe guarded (`returns.length ≥ 5`,
`sd > 0`). **Nit (ledger `Q13-1`, LOW):** `equity`/`dailyRets` locals in `simpleBacktestSlice`
are computed but never returned (dead) — dev-only, no deploy warranted.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change). **D/E** n/a (no deploy). **F** recorded (queue/run-log/ledger
  Q13-1/this report/MEMORY_LOG/SESSION_STATE).

## Q14 — `parameterSets.ts` + `sectorProfiles.ts` (WS-Q) — DONE; Q14-1 escalated (no code change)

**Config VERIFIED SANE.** Grid combo counts correct (LOOP1 = 4⁵ = 1024, LOOP2 = 4×4×3×2×3 =
288); baselines/targets/`PARAM_INTERPRETATION` coherent; `SectorProfile` thresholds in sensible
ranges; both files tested.

**Escalated Q14-1 (dormant enhanced-path — ledger):** incomplete macro-gate plumbing —
(a) `SectorProfile.maxVixForBuy` is defined per-sector (Technology 30, etc.) + glossed but **read
by no signal logic** → inert (the VIX gate is unimplemented); (b) `SectorGateConfig.yieldCurveGate`
(`signalTypes.ts:102`) has **no `SectorProfile` source** and the core signal files don't consume
it → Financials' yield-curve gate is unwired; (c) doc nit: `parameterSets.ts:5` says "768
combinations" vs the actual 1024. All enhanced-path (off in prod) → part of the enhanced
retire-or-invest decision.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change). **D/E** n/a (no deploy). **F** recorded (queue/run-log/ledger
  Q14-1/this report/MEMORY_LOG/SESSION_STATE).

## Q15 — `lib/quant/indicators.ts` (WS-Q, core LIVE SSOT) — DONE, VERIFIED CLEAN

Reviewed all **25 primitives** in depth — **exemplary, no live issue:** `ema` (SMA-seeded;
short-array footgun documented F2.8) + `emaFull` (index-aligned); `rsi`/`rsiLatest` (Wilder
smoothing); **`macd` signal-line anchoring `signal[i+slow+sig-2]` is correct** (the F-NEW offset
fix fills the recent bars); `bollinger` (period≥2 guard, `sd=√max(var,0)`, `pctB` only when
`upper≠lower`); `trueRange`/`atr` (Wilder + correct index alignment); `obv` (F2.6 throws on
length mismatch); `vwap` (`cumVol>0`); `stochRsi` (`max−min>0 ? : 50`); `adx` (`trVal>0` +
`pdi+mdi>0`, F2.2); `sharpe` (configurable annualization, `sd==0→null`); `sortino` (canonical
F1.16, `n_d≥30`, `dsd<1e-12→null`). Every primitive is finite/÷0-guarded and carries documented
fixes for all prior bugs. **EMA seeding (the named concern) is correct.**

**Nit Q15-1 (LOW, ledger):** `bollingerLatest` lacks the `period<2` guard that `bollingerArray`
has (F2.9) — at `period=1` it returns degenerate collapsed bands instead of null. Not a live bug
(default 20, unreachable); SSOT-consistency only. No deploy warranted.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change; file is heavily tested — indicators.test.ts + sma200Ssot +
  cryptoIndicators + multiTimeframe). **D/E** n/a (no deploy). **F** recorded.

## Q16 — `lib/quant/technicals.ts` (WS-Q, live) — DONE, VERIFIED CLEAN (no code change)

Thin-adapter layer over the indicators SSOT, used by the analytics + ma-deviation APIs and
BtcQuantLab. The `sma/rsi/macd/bollinger/atr/maxDrawdown/dailyReturns/sharpe/sortino` adapters
all **delegate** to the canonical indicators (no reimplementation → no drift; D1-5 WON'T-FIX
thin-adapter verdict confirmed); `sma200DeviationPct`/`sma200Slope` re-exported from the F-6 SSOT.
**`ma200Regime` is fail-closed** (`:131` null sma / non-finite-or-≤0 price; `:134` null dev →
INSUFFICIENT_DATA — same guard as `regimeSignal` Q05) and its zone thresholds **exactly match**
`regimeSignal`, so the analytics/UI regime and the backtest regime can't diverge. Minor latent
note (not escalated): the `sharpeRatio`/`sortinoRatio` adapters drop the canonical `annualization`
param (always 252) — fine for their only caller `buildFundamentalsPayload` (equity-only, Q22);
a footgun only if a crypto Sharpe is ever wired through them.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change; technicals has its own tests + indicators SSOT tested).
  **D/E** n/a (no deploy). **F** recorded.

## Q17 — `lib/quant/volatility.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)

Single export `annualizedVolFromCloses` (31 LOC): strong finite guards (filters non-finite/≤0;
`c.length<8 → 0.22` default), log returns on positive-filtered data (no `log(≤0)`),
`sqrt(max(var,0))`, `/max(1,n-1)` sample variance. Math correct. ("Parkinson" in the cell label
is a misnomer — this is close-based realized vol; range-based vol is in regimeDetection, Q20.)
The regimeDetection/relativeStrength "consumers" are only docstring mentions — the **sole caller
is `buildFundamentalsPayload.ts`**. Latent note (same F-12 theme as Q16, not escalated):
`sqrt(252)` is hardcoded and the fn takes only `closes`, so it can't annualize crypto (365) — but
`buildFundamentalsPayload` is equity fundamentals/DCF (BTC has none), so 252 is correct. **Q22
confirms `buildFundamentalsPayload` is equity-only** (the linchpin for the Q16+Q17 latent notes).

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change; has volatility.test.ts). **D/E** n/a. **F** recorded.

## Q18 — `correlation.ts` + `intermarket.ts` (WS-Q) — DONE, VERIFIED CLEAN (no code change)

Exemplary. `pearsonCorrelation`: length-match + min-2, zero-variance (`varA<=0||varB<=0→null`),
finite check, clamp [-1,1]. `maxCorrelationVsPeers`: fail-closed (the prior fail-OPEN `<minWindow
→ 0` bug is fixed → now `→ null`) + SIGNED-max per Markowitz (penalize +rho overlap, reward −rho
hedges) with a tail-correlation caveat. `correlationAdjustedKelly`: fail-closed on unmeasurable
rho (→0), `denom=max(1e-9,1−gate)` div-guard, continuous linear shrink. `intermarketCorrelations`:
n≥63/252 window guards; `classifyRegime`: null-safe (requires both SPY & VIX corr non-null before
thresholds, else 'mixed'). All NaN-handled; both tested. No findings.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change; correlation.test.ts + intermarket.test.ts). **D/E** n/a. **F** recorded.

## Q19 — `lib/quant/kelly.ts` (WS-Q, live) — DONE, VERIFIED CLEAN (no code change)

`kellyFraction` correct (`f = p − (1−p)/b`) with the explicit non-finite guard (R8-H-1 — the
`NaN<=0===false` slip is fixed, covered by `kelly.property.test.ts`), valid-probability `0<p<1` +
positive-payoff guards, no ÷0 (`avgLoss>0` guaranteed). `halfKelly` floors at 0. Raw fraction is
intentionally unbounded-above (educational; docstring directs UI to half-Kelly); upper bounds are
enforced at call sites (`Math.min(KellyFraction, 0.50)` in core.ts; 0.30/0.15 caps in
`resolveBacktestSignal`). No findings.

### Verify (VERIFY A–F)
- **A/B/C** n/a (no code change; property-tested). **D/E** n/a. **F** recorded.

## Next cell
**Q20** — `lib/quant/regimeDetection.ts` + `regimeHmmClient.ts` (regime labels; HMM client
fallback). Owner-gated backlog unchanged (F-4, F-9, F-2, F-11, F-3, Q05-1, Q09-1, Q14-1, +
scheduled-task model re-point to Opus). Monday weekly deep sweep also still due.
