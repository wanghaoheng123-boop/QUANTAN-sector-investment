# Quant/Algorithm Review PART 2 (uncovered files) — 2026-06-04

## Severity legend: P0 correctness / P1 bias-methodology / P2 cleanup

P0 = correctness bug that produces wrong numbers / look-ahead / leakage in production path.
P1 = methodology/bias issue (overfitting, in-sample selection, survivorship) or correctness bug only on a non-prod path.
P2 = cleanup / robustness / minor numerical hygiene.

> NOTE: file was appended incrementally after every 2–3 reads (session-death resilience). Sections may
> appear out of order; this header is the authoritative roll-up.

## SUMMARY ROLL-UP

**Counts: P0 = 0 | P1 = 6 | P2 = 8.**

**Headline:** No P0 (correctness-in-production) defects found. The two highest-risk axes the prior agent
flagged — the **correlation min-window guard** and the **walkForward equity-curve index mapping** — were
both investigated to ground truth and are CORRECT (not P0s). The indicator SSOT (indicators.ts) and the
options (greeks/GEX/max-pain) / portfolio / VaR math are all clean. The real exposure is **methodology /
bias** in the research tooling and a **doc-vs-code gap**, all P1:

The 6 P1s (the body has one canonical entry each; this is the digest, most-material first):
1. **Survivorship bias** across the whole backtest/benchmark universe (hard-coded current mega-caps) —
   inflates every reported WR / return / Sharpe, including prod CI floors. (scripts/*; universe lists)
2. **gridSearch selects the winner ON the OOS set** — no multiple-testing correction, no third holdout →
   reported OOS metrics are upward-biased (lib/optimize/gridSearch.ts:247-279).
3. **gridSearch optimizes a cost-free, simplified NON-SSOT signal** (no 11 bps cost; hard-coded
   regime/sizing) → tuned params can't transfer to the real strategy (lib/optimize/gridSearch.ts:89-216).
4. **3 of gridSearch's 5 grid dimensions are INERT** (buyW/sellW/confidence thresholds never read) →
   768-combo grid is effectively ~16-combo; "optimal" thresholds in the JSON are artifacts
   (lib/optimize/gridSearch.ts:62-82, grep-verified).
5. **Macro risk gates advertised in glossary but NOT wired into signals; named gates + Parkinson formula
   have no implementation.** intermarket.ts exists (TLT/UUP/VIX correlation) but signals.ts/core.ts never
   import it → analytics-only, enforces nothing (lib/metricGlossary.ts:82,338,344; lib/quant/intermarket.ts).
6. **GARCH(1,1) MLE branch is UNREACHABLE DEAD CODE** — a `float(numpy-array)` TypeError swallowed by a
   bare `except` makes the Python "GARCH" sidecar always return EWMA; `arch` isn't installed either.
   Verified empirically. Research/sidecar only (quant_framework/garch.py:19-24).

P2 (8): verify-indicator-math SSOT drift; deprecated `ema()` used by MACD; correlation peers==0 full-Kelly;
exitRules test T+1/short gaps; checkExitConditions hard-codes long (short stops never fire); oos-validation
warmup overlap; benchmark-enhanced inline Sharpe/Sortino drift; gex spot² notional simplification (noted).

Correlation min-window guard: **EXISTS (correlation.ts:74,96) — NOT a P0.**
Findings file: this document.

## CRITICAL ANSWER — correlation min-window guard

**The min-window guard EXISTS. This is NOT a P0.**
`lib/quant/correlation.ts:74` — `maxCorrelationVsPeers(candidate, peers, minWindow=20)` opens with
`if (candidate.length < minWindow) return null`, and per-peer at `:96` `if (peer.length < minWindow) continue`.
So any candidate or peer with <20 obs is excluded. When NO peer is measurable it returns `null`
(unless `peers.length === 0`, which returns 0 = "isolated, full Kelly"). The downstream
`correlationAdjustedKelly` fails CLOSED on null (`:143 if (maxRho == null) return 0`). The seed concern
the prior agent raised (portfolioBacktest.ts:194-208 passing <20 obs) is therefore *handled defensively
at the correlation layer*: a short seed → null → Kelly shrunk to 0 (conservative). See P1-1 for the one
residual edge (peers.length===0 → 0 → full Kelly) which is correct-by-design but worth flagging.

## P0 Findings

_(NONE found. The two highest-risk axes — correlation min-window guard and the walkForward
equity-curve index mapping — were both investigated to ground truth and are CORRECT. See
"Invariants verified clean" below.)_

## P1 Findings

- [P1] quant_framework/garch.py:19-22 — **the GARCH(1,1) MLE branch is UNREACHABLE DEAD CODE; the
  function always returns the EWMA proxy.** Verified empirically (python3): `forecast.variance.values[-1]`
  for horizon>1 is a **length-`horizon` numpy array** (the per-step term structure), so
  `vol = forecast.variance.values[-1] ** 0.5 / scale` is an array, and `ann = float(vol) * np.sqrt(252)`
  raises `TypeError: only 0-dimensional arrays can be converted to Python scalars` **on every MLE
  invocation**. That exception is swallowed by the bare `except Exception: pass` (:23-24), so control
  ALWAYS falls through to the EWMA block (:26-32). NOTE: this is the LOAD-BEARING proof and is
  environment-independent — it holds whether or not `arch` is installed, because the TypeError fires
  *after* a successful fit+forecast. (Separately, `arch` is not installed in this review env →
  ImportError → same fallback; that's a second, weaker path I do not rely on, since the prod/CI env may
  differ.) Net: `method:"garch11_mle"` can never be emitted; the platform's "GARCH(1,1)" is in fact
  RiskMetrics EWMA(0.94) 100% of the time. Two
  consequences fold into this one finding: (a) the convergence-flag / stationarity (α+β<1) checks are
  moot because the branch never completes; (b) the bare `except` hides the bug — and is why
  test_analytics.py:6-11 passes (it only asserts len + conditionalVol>0, both satisfied by EWMA). The
  intended fix (iterate `values[-1, i]` for the decaying term structure) is also where the type bug must
  be repaired. Severity P1 not P0: `fit_garch11` has **no non-test caller** (grep), and the live API uses
  garchClient.ts's own TS EWMA (`source:'python'|'ewma-fallback'`). Research/sidecar dead code. Honest
  label: the Python "GARCH" sidecar does not compute GARCH.

- [P1] lib/optimize/gridSearch.ts:247-279 — **grid winner is selected ON the OOS set → the reported
  OOS metric is upward-biased; no multiple-testing correction.** `baseScore = oos.sharpe ?? oos.winRate`
  (:247), results sorted by score desc (:268), `best = results[0]` (:279). Across 768 combos
  (optimize-grid.ts LOOP1) the "best" is the max OOS Sharpe over 768 trials — so the OOS set has been
  used for *selection* and is no longer a genuine holdout. Even pure-noise strategies produce a
  max-of-768 OOS Sharpe inflated by ~2-3 std-errors (this is the classic backtest-overfitting /
  selection-bias trap; Bailey & López de Prado 2014, "The Deflated Sharpe Ratio"). There is **no third
  validation holdout, no Deflated Sharpe, no White Reality Check / Hansen SPA, no Bonferroni** (grep
  confirmed: only constant 0.60 appears; no holdout/deflate/bonferroni tokens). The 8pp `overfitGap`
  cap (:245) does NOT fix this — it filters survivors, then still picks the OOS-max of them. The
  `optimization-results-loop1.json` "best OOS win rate" per instrument is therefore an optimistic point
  estimate, not an unbiased OOS expectation. Mitigant in practice: the script's own header
  (optimize-grid.ts:13-16) says "Do NOT ship grid winners as production defaults" and prod uses fixed
  sector profiles — so this is research tooling, kept P1 (methodology) not P0. Fix: nest a true OOS
  (select on a validation fold, report on an untouched test fold) and/or deflate the selected Sharpe by
  the number of effective trials.

- [P1] lib/optimize/gridSearch.ts:89-216 — **the grid optimizes a simplified, COST-FREE strategy that
  is NOT the production SSOT.** The function comment admits it (:86 "not resolveBacktestSignal SSOT").
  Concretely: (a) **no transaction costs** in the trade P&L (`ret = (exitPrice-entryPrice)/entryPrice`,
  :190; grep confirms no cost/fee/bps/slippage in the entry/exit block) whereas the SSOT charges
  11bps/side; (b) position fraction hard-coded to 0.15 (:192) regardless of Kelly; (c) BUY logic
  hard-codes dev∈[-20,0) (:171) and rsi<40 (:173), bypassing the regime/weighted-score machinery.
  Parameters tuned on a frictionless simplified signal do not transfer to the cost-bearing SSOT — any
  edge the grid "finds" can be entirely consumed by the costs it ignored. P1 (research tooling), but the
  sector recommendations it prints (optimize-grid.ts:268-285) read as production-applicable.

- [P1] lib/optimize/gridSearch.ts:62-82, 238-265 — **3 of the 5 grid dimensions are INERT — they
  inflate the trial count without changing any outcome.** `simpleBacktestSlice` references ONLY
  `params.slopeThreshold` (:167) and `params.atrStopMultiplier` (:183); `buyWScoreThreshold`,
  `sellWScoreThreshold`, and `confidenceThreshold` are **never read** (grep-verified). So the
  768-combo (4×4×4×3×4) grid collapses to an effective slope×atr ≈ 16-combo grid, with the other three
  axes acting as 48× duplication. Consequences: (1) the 768 trial count that drives the selection-bias
  in the finding above is mostly fictitious duplication — but the bias is real because the duplicated
  rows still compete for the OOS-max; (2) `robustParams` / `aggregateGridResults.bestGlobalParams`
  report "optimal" `confidenceThreshold` / `buyWScoreThreshold` / `sellWScoreThreshold` values
  (gridSearch.ts:290-317, 347-357; surfaced in optimize-grid.ts:282 + JSON output) that are pure
  artifacts of tie-breaking among identical scores — they were never optimized and carry no signal.
  Anyone reading optimization-results-loop1.json would wrongly conclude these thresholds were tuned.
  P1: misleading optimization output. Fix: either wire these params into simpleBacktestSlice or remove
  them from the grid + reports.

- [P2] scripts/oos-validation.ts:56 / lib/optimize/gridSearch.ts:240 — OOS slice starts at
  `split - 220` (a 220-bar warmup buffer reaching back INTO the IS period). Feature/indicator warmup
  for the first ~220 OOS bars is computed from bars that were also IS. This is defensible (indicators
  need 200-bar warmup and you cannot warm up on nothing), but it means the earliest OOS signals share
  underlying bars with IS, so IS-WR and OOS-WR are not measured on disjoint information for the overlap
  region. Not a true label-leak (the *trade outcome* windows differ), so P2. Worth a note that the
  effective OOS sample is smaller than the nominal 30%.

- [P1] **Survivorship bias across the entire backtest/benchmark universe.** scripts/optimize-grid.ts:41-54,
  scripts/benchmark-enhanced.ts:~37-54, scripts/benchmark-signals.ts (loadAllTickers), and
  scripts/portfolio-backtest.ts all backtest a HARD-CODED list of TODAY's mega-cap survivors (NVDA, AAPL,
  MSFT, AVGO, LLY, META, TSLA, …). Backtesting the current index leaders over their full price history is
  the textbook survivorship trap (Brown, Goetzmann, Ibbotson & Ross 1992): these names are in the list
  *because* they won; stocks that were large-cap in 2015 and then crashed/delisted (e.g. failed energy or
  retail names) are absent. There is no delisting/point-in-time-constituent handling. Consequence: EVERY
  aggregate win-rate, return, and Sharpe the platform reports is upward-biased — including the production
  CI floors (benchmark-signals.ts FLOOR_NET_WR=53.29). Severity P1 (systematic methodology bias affecting
  headline numbers), not P0 (no single computation is "wrong"; the *sample* is biased). Fix: use a
  point-in-time constituent set with delisted tickers, or explicitly disclose the universe as
  "current-constituent, survivorship-biased — not a tradable backtest."

- [P2] scripts/benchmark-enhanced.ts:222-236 — re-implements Sharpe and Sortino INLINE instead of importing
  the SSOT `sharpeRatio`/`sortinoRatio` from lib/quant/indicators.ts. The inline Sortino (:235) uses a
  different denominator convention than the SSOT (which mandates n_d≥30 and the negative-count denominator,
  indicators.ts:653-660) and hardcodes `rfDaily = 0.04/252` (:228,235) — not crypto-365-aware. Because
  this is the enhanced (non-prod) research benchmark, P2; but it means the enhanced-path Sharpe/Sortino in
  benchmark-results-enhanced.json are NOT comparable to the SSOT numbers elsewhere. Consolidate onto the
  SSOT.

- [P1] **Macro risk gates are documented + gloss-advertised but NOT wired into the signal/backtest path;
  the specific named gates and the Parkinson formula have NO implementation.** lib/metricGlossary.ts
  defines `parkinsonVol` (:82), `dxyGate` (:338), `yieldCurveGate` (:344) with prescriptive `howToUse` —
  e.g. dxyGate: "When DXY rising and gate fails, skip new longs in affected sectors"; parkinsonVol: "Used
  as macro risk gate." Findings after corrected search (my first TLT/DXY grep had a zsh glob error and did
  not run — re-ran cleanly):
    • There is **no `lib/backtest/gates.ts`** and **no** `isTltRising` / `parkinsonVol()` /
      `isParkinsonOk` / `isDxyOk` / `isYieldCurveOk` / yield-curve-inversion / Parkinson-formula code
      anywhere (grep across lib/ app/; `git log --all -S parkinsonVol` → only doc/roadmap commits;
      `git log --diff-filter=D` → no deleted gates.ts). So the Parkinson formula
      `sqrt((1/(4 ln2))·mean((ln(H/L))²))` has NO code to verify.
    • A RELATED module DOES exist — `lib/quant/intermarket.ts` (`INTERMARKET_BENCHMARKS = ['SPY','^VIX',
      'UUP','TLT']`, functions `intermarketCorrelations` / `classifyRegime` / `analyzeIntermarket`). It
      computes SPY/VIX/UUP(≈DXY)/TLT correlation regimes. BUT it is **NOT imported by lib/backtest/
      signals.ts or core.ts** (grep: zero import hits) — i.e. it feeds (at most) a UI panel, not the
      trading decision. There is no DXY-rising or yield-curve-inversion *gate* that blocks longs.
  Net: the glossary advertises macro risk gating ("skip new longs when gate fails") that **no code path
  enforces on signals**, and the dxyGate/yieldCurveGate/parkinsonVol named primitives don't exist.
  Severity P1 — not a numerical bug, but it misrepresents the strategy's live risk controls (user-trust /
  doc-integrity). Fix: either implement + wire the gates, or annotate glossary entries as "planned / not
  yet active," and clarify intermarket.ts is analytics-only.

## P2 Findings

- [P2] scripts/verify-indicator-math.mjs:96-107 — the golden test `calcBB` uses **population variance
  `/period`** (line 102: `variance = ... / period`) while the SSOT `bollingerArray`
  (indicators.ts:259) uses **sample variance `/(period-1)`** (Bessel). The "golden" test therefore
  pins a *different* number than production. The mid-band check passes (mean is identical) but a
  band-width check would diverge by factor sqrt(period/(period-1)) ≈ 2.6% at period=20. Header of the
  file claims it tests "lib/crypto.ts" — stale reference; crypto indicators were consolidated into
  indicators.ts. This is a test-fidelity gap, not a prod bug. Also `calcRSI` here uses `if (diff > 0)`
  for the seed while the SSOT uses `if (d >= 0)` (indicators.ts:110) — for an exactly-flat tick the
  zero change is bucketed differently (SSOT puts 0 into gain side, test into neither). Immaterial for
  RSI value but shows the duplicate has drifted from SSOT.

- [P2] lib/quant/indicators.ts:67-78 — `ema()` (the short-array variant) is `@deprecated` yet still
  used internally by `macdArray` for the signal line (line 202). The deprecation comment says internal
  callers "should migrate to emaFull"; the MACD signal path is the exact footgun the comment warns
  about. The current anchoring math (line 200-205) is CORRECT (verified: sigEma[k] placed at line index
  k+slow+sig-2, accounting for ema()'s length-(N-sig+1) output), but the SSOT depends on a deprecated
  primitive it tells others not to use. Cleanup: rewrite signal line via emaFull on the NaN-padded line
  and drop the slice gymnastics.

- [P2] lib/quant/correlation.ts:110 — `maxCorrelationVsPeers` returns 0 (→ full Kelly) when
  `peers.length === 0`. Correct-by-design for a genuinely empty book (first position has no peers, so
  full Kelly is right), and the prod call-site (portfolioBacktest builds peers from open positions)
  cannot reach a dangerous interpretation. Logged as P2 (not P1) cleanup: a future caller that
  pre-filters short peer series down to an empty array would get the "isolated → full Kelly" branch
  instead of the fail-closed null. Recommend distinguishing `noPeers` from `peersAllTooShort`.

- [P2] __tests__/backtest/exitRules.test.ts — coverage is strong (see "Exit-test quality" below) but two
  invariant gaps: (1) no T+1 symmetry assertion at this layer — T+1 entry/exit timing lives in core.ts /
  portfolioBacktest.ts (already reviewed), not exitRules, so checkExitConditions returns a fill price but
  the bar-offset semantics are untested here; acceptable since the SSOT primitive is timing-agnostic, but
  worth a cross-reference. (2) The SHORT (side='short') paths of checkExitConditions are never exercised
  — only evaluateStopHit is tested for shorts. checkExitConditions hard-codes 'long' on every
  evaluateStopHit call (exitRules.ts:216,236,245), so short positions are silently un-stopped by the
  high-level path. Strategy is long-only in prod, so P2 — but if shorts are ever enabled, the exit engine
  will not stop them and no test would catch it.

## Files inspected (LOC)

- lib/quant/correlation.ts (150) — pearsonCorrelation, maxCorrelationVsPeers, correlationAdjustedKelly. CLEAN.
- lib/quant/indicators.ts (667) — SMA/EMA/RSI/MACD/ATR/Bollinger/ADX/StochRSI/Sharpe/Sortino. Math CLEAN; see P2 notes.
- lib/backtest/liveSignal.ts (113) — delegates to resolveBacktestSignal (SSOT). No look-ahead: uses [-1]/[-2] only. CLEAN.
- lib/backtest/walkForward.ts (229) — IS/OS via trade attribution. Equity-index mapping VERIFIED CORRECT (see below). CLEAN.
- lib/backtest/dataLoader.ts (144) — warehouse+JSON loaders. D5-1 finite-guard present on BOTH paths. CLEAN (notes below).
- lib/backtest/exitRules.ts (315) — evaluateStopHit + checkExitConditions. Math/precedence CLEAN; long-only caveat (P2).
- __tests__/backtest/exitRules.test.ts (567) — proves invariants (see Exit-test quality). 2 gaps (P2).
- quant_framework/garch.py (33) — GARCH MLE + EWMA fallback. 2× P1 (convergence/stationarity + flat term structure).
- lib/quant/garchClient.ts (skim) — TS EWMA fallback for live API. Business-day skip + flat-forecast honesty noted. CLEAN.
- lib/backtest/core.ts:230-399 + closePosition (re-read for invariant) — one-push-per-iteration VERIFIED. (core.ts itself out of scope — already reviewed.)
- scripts/verify-indicator-math.mjs (113) — golden test; drifted from SSOT (P2).
- quant_framework/test_analytics.py (19) — weak garch smoke test. Confirms decimal-return convention (no double-scale).
- lib/optimize/gridSearch.ts (365) — the grid engine. 3× P1 (selection-on-OOS, cost-free non-SSOT signal, 3 inert params).
- scripts/optimize-grid.ts (418) — LOOP1/LOOP2 driver. Inherits gridSearch P1s; header itself warns "do not ship winners".
- scripts/oos-validation.ts (83) — 70/30 IS/OOS WR slice. Warmup overlap (P2). Correctly sets enhanced=0 (prod path).
- lib/quant/btc-indicators.ts (433) — adapters delegate to SSOT (no SSOT violation). BTC models guarded. CLEAN. (No 365-annualization here — it lives in indicators.ts sharpe/sortino, already audited.)
- lib/options/greeks.ts (271) — Black-Scholes-Merton + Greeks + IV solver. Math fully verified. CLEAN.
- lib/options/gex.ts (185) — per-side GEX, flip detection. CLEAN (spot² notional simplification noted).
- lib/portfolio/tracker.ts (342) — position CRUD + PnL. No double-counting. Div-by-zero guards throughout. CLEAN.
- lib/portfolio/var.ts (338) — Historical/Parametric VaR + CVaR + Kupiec POF. Drift-scaling correct. CLEAN.
- lib/portfolio/riskParity.ts (194) — inverse-vol + ERC (sqrt-damped). CLEAN. Dead 30%-floor Kelly already removed.
- lib/portfolio/greeks.ts (66) — pure Greeks aggregation with pre-weight contract. CLEAN.
- scripts/benchmark-signals.ts (148) — production CI benchmark via SSOT. Gross+net WR, cost-aware, regression floors. CLEAN (no selection bias).
- scripts/benchmark-enhanced.ts (skim, ~340) — enhanced/non-prod benchmark. IS/OOS reported (not selected). Inline Sharpe/Sortino drift (P2).
- lib/options/sentiment.ts (195) — putCallRatio + maxPain (scope item 9 max-pain). Math verified. CLEAN.
- lib/quant/intermarket.ts (grep/skim) — SPY/VIX/UUP/TLT correlation regime. Exists but NOT wired into signals (feeds P1 #5).
- quant_framework/garch.py: empirically tested float()/arch — MLE branch proven unreachable (P1 #6).

## Verified clean — options & portfolio math (audited, no findings)

- **greeks.ts**: BSM with Merton dividend `q`. d1/d2 (:83), delta (:163 `e^{-qT}N(d1)` call / `e^{-qT}(N(d1)-1)`
  put), gamma (:168 `e^{-qT}N'(d1)/(Sσ√T)`), theta (:172 annual incl. +qS term, ÷365 → $/day), vega
  (:182 `Se^{-qT}N'(d1)√T`/100), rho (:186) — ALL match Hull 10e. normalCdf A&S 26.2.17 (err<7.5e-8),
  |z|≥8 saturation. IV solver: Brenner-Subrahmanyam ATM seed, clamps [0.005,5.0], flat-vega guard, 100-iter
  cap → null on non-convergence. T≤0 intrinsic-delta and σ≤0 degenerate cases separated (F3.6).
- **gex.ts**: per-side gamma (callOI·γc − putOI·γp)·100·spot²·0.01 (F3.3 fix correct). Spot guard, NaN-gamma
  excluded from side-average, strict sign-change flip detection w/ linear interp. (spot² dealer-notional
  is a standard simplification; noted, acceptable.)
- **var.ts**: hist VaR `−sorted[floor(αn)]`, CVaR = mean of tail, parametric `z·σ·√T − μ·T` (drift scales
  linearly — correct, prior √T-on-mean bug fixed), Kupiec POF LR via logs w/ correct χ²₁ crits. n≥30 guard.
- **riskParity.ts**: inv-vol + ERC with sqrt-damped multiplicative update (Q-051-NEW oscillation fix is
  legitimate). Sample cov /(n-1) ×252. SSOT-dup `correlationAdjustedKelly` w/ 30%-floor bug already DELETED.
- **tracker.ts**: weighted-avg cost on add, realized PnL booked to cash once (totalReturn uses totalValue →
  no double-count), avgCost>0 guards everywhere, schema validator at load boundary, quota-exceeded soft-fail.
- **portfolio/greeks.ts**: pure sum with explicit pre-weight input contract (Hull §19).
- **btc-indicators.ts**: all standard indicators delegate to SSOT (genuine SSOT compliance, prior inline
  dupes removed F-NEW HIGH). MVRV/PiCycle/S2F/DifficultyRibbon/btcRegime all null-guarded.
- **sentiment.ts (max-pain, item 9)**: `maxPain` minimizes Σ OI-weighted writer payout across strikes
  (×100 multiplier), total-OI=0 fail-closed, epsilon tie-tracking, spot-nearest / median tie-break (F2).
  `putCallRatio` finite-guarded with PCR_MAX=99 sentinel for one-sided chains. CLEAN.

## Indicators.ts math verification (audited axes — all PASS)

- **SMA** (`smaArray` :31): rolling-sum O(n), `out[period-1]` first valid, no centered window → no look-ahead. PASS.
- **EMA** (`emaFull` :84): SMA-seeded at index period-1, k=2/(N+1). Index-aligned. PASS.
- **RSI** (`rsiArray` :103): Wilder. Seed avgGain/Loss over first `period` deltas → `out[period]`.
  Recursive `(avg*(N-1)+chg)/N` = Wilder alpha=1/N. avgLoss===0 → 100 guard. PASS (no look-ahead;
  uses closes[i] and closes[i-1] only).
- **MACD** (`macdArray` :155): line=emaFast-emaSlow (both emaFull, index-aligned). Signal anchoring fixed
  (F-NEW). Length guard `slow+sig-1`. PASS.
- **ATR** (`atrArray` :306): TR=max(H-L,|H-Cprev|,|L-Cprev|), Wilder smoothed, `out[period]` first valid,
  `out[i+1]` mapping accounts for TR starting at bar 1. PASS.
- **Bollinger** (`bollingerArray` :242): SAMPLE variance /(N-1), period≥2 guard, pctB div-by-zero guard
  (`upper!==lower`). No look-ahead (slice ends at i+1). PASS.
- **ADX** (`adxArray` :501): double-Wilder (DI then DX→ADX) per Wilder 1978. trSmooth[i-1] offset correct
  (tr starts bar 1). pdi/mdi div-by-zero guards. PASS — but needs ~2*period bars to warm up (documented).
- **StochRSI** (`stochRsiArray` :443): min/max over rsi window, flat-window → 50 guard. PASS.
- **Sharpe** (`sharpeRatio` :604): sample SD /(N-1), n≥20, configurable annualization (252/365), sd===0→null. PASS.
- **Sortino** (`sortinoRatio` :648): downside dev uses n_d denominator (count of neg), n≥30 AND n_d≥30 guards,
  dsd<1e-12→null. Numerator (mean-MAR). Matches Sortino&van der Meer 1991. PASS.
- **maxDrawdown** (:580): peak-tracking, n≥2 guard, peak>0 guard. PASS.
- **dailyReturns** (:572): closes[i-1]>0 guard, simple returns. PASS.

## Invariants verified clean (investigated to ground truth — NOT P0s)

1. **Correlation min-window guard EXISTS** — correlation.ts:74 (`candidate.length < minWindow → null`)
   + :96 (per-peer skip). Downstream fail-closed at correlationAdjustedKelly:143. The prior agent's
   <20-obs seed worry (portfolioBacktest:194-208) resolves to null → Kelly 0 (conservative). NOT a P0.

2. **walkForward equity-curve index mapping is CORRECT** — the claim "row i ↔ equityHistory[i-199]"
   (walkForward.ts:177) rests on exactly-one-push-per-iteration in core.ts's main loop. I re-read
   core.ts:238-391 AND closePosition (core.ts:165-184). Every branch pushes exactly once:
   - exit paths (2×ATR :290, 4×ATR :300, primary stop :315, max-DD :332) call closePosition which
     pushes at its last line (core.ts:183), then `continue` → 1 push.
   - BUY entry → explicit push :371. SELL → closePosition pushes, then `else-if` falls through, no
     second push → 1 push. HOLD → explicit push :389. shares≤0 → push :347 then continue → 1 push.
   equityHistory[0] = initialCapital (set before loop). So equityHistory[1] ↔ row 200, and the -199
   offset holds. The per-window IS/OS Sharpe slices are correctly aligned. NOT a bug.

## Exit-test quality (item 7 — do tests prove invariants or pin numbers?)

**Verdict: they PROVE invariants, not merely regression-pin.** Evidence:
- evaluateStopHit tested across ALL FOUR (side,kind) quadrants (long/short × stop/target), each with
  trigger / gap-fill-at-open / no-trigger / boundary cases (test lines 469-549).
- Boundary semantics asserted explicitly: `bar.low === stop` fires (≤), `bar.high === target` fires (≥)
  (lines 486-489, 509-512).
- Gap-through fills assert worse-of for stops / better-of for targets (open beyond level → open;
  lines 476-479, 499-502).
- Precedence ordering asserted as behaviour, not numbers: stop > signal (287-291), panic > target
  (293-298), stop > target on a wide-range bar that breaches both (418-428).
- Property-based invariant test: 5 deterministic LCG seeds assert stop ∈ (0, entry) and
  stop% ∈ [floor, ceiling] for randomized bar series (97-152) — a true invariant, not a pinned value.
- Defensive: NaN/zero/negative level and non-finite OHLC → null (552-566).
The numeric `toBe(97)` / `toBe(108)` assertions are *derived from the documented fill rule*, so they
read as invariant checks, not opaque golden numbers.
**Gaps (logged P2):** (a) no T+1 timing assertion at this layer (lives in core/portfolioBacktest);
(b) checkExitConditions never tested for shorts — and it hard-codes side='long' (see note below).

## NOTE — latent short-side exit gap (re-stated for visibility, P2)

lib/backtest/exitRules.ts:216, 236, 245 — `checkExitConditions` always calls
`evaluateStopHit(bar, level, 'long', ...)`. The `position` has no side field; the function assumes long.
core.ts's own loop correctly derives `tradeSide` (core.ts:313) and passes it to evaluateStopHit, so the
*core* engine handles shorts — but the *exitRules* high-level helper (used by portfolioBacktest) cannot
stop a short. Strategy is long-only in prod → P2. If shorts are enabled, short stops silently never fire
via this path and no existing test would catch it (tests only cover evaluateStopHit's short quadrants in
isolation, never checkExitConditions with a short).

## What I did NOT cover (honest scope ledger)

**Scope items fully covered:** 1 (indicators), 2 (correlation), 4 (walkForward), 5 (liveSignal),
6 (dataLoader), 7 (exitRules + test), 8 (btc-indicators), 9 (options greeks/gex), 10 (tracker + key
portfolio: var/riskParity/greeks), 11 (garch.py), 12 (optimize-grid/gridSearch/oos-validation/
benchmark-signals + benchmark-enhanced skim).

**Scope item 3 (gates.ts):** the file does NOT exist; covered as a P1 doc-vs-code finding. The Parkinson
formula could not be verified (no implementation). NOT a coverage hole — there is nothing to read.

**Read by targeted grep/skim, not line-by-line (low risk, would deepen with more budget):**
- scripts/benchmark-enhanced.ts (~440 LOC) — confirmed IS/OOS-report-not-select + inline Sharpe/Sortino
  drift via grep; did not read every line of the enhanced signal plumbing (enhanced path is OFF in prod).
- scripts/portfolio-backtest.ts (~450 LOC) — NOT opened line-by-line; flagged only for the shared
  survivorship-universe P1. Its T+1 / cost mechanics ride on portfolioBacktest.ts which the PRIOR agent
  already reviewed (out of my scope). Worth a dedicated pass if portfolio-sim realism is a concern.

**NOT opened (lower-priority lib/quant and lib/portfolio files, outside the explicit scope list):**
- lib/portfolio/{diversification.ts, stressTest.ts, tailRiskAlerts.ts} — item 10 said "remaining
  lib/portfolio/*"; I covered tracker/var/riskParity/greeks (the PnL/risk core). diversification/stressTest/
  tailRisk are secondary analytics; not audited. RECOMMEND a follow-up pass.
- lib/options/sentiment.ts — COVERED (max-pain + put/call, item 9). lib/options/chain.ts and
  app/api/options/[ticker]/route.ts — NOT opened (chain enrichment / route wiring; greeks+gex+maxpain core
  is covered). lib/quant/intermarket.ts — examined for the gates finding (functions + wiring), not a full
  line audit.
- lib/quant/{technicals.ts, multiTimeframe.ts, regimeDetection.ts, relativeStrength.ts, researchScore.ts,
  sectorRotation.ts, volatility.ts, volumeProfile.ts, dcf.ts, pivots.ts, priceBands.ts, kelly.ts} —
  not in the explicit scope list; not audited.
- enhancedBacktest — NO file by that name exists (grep: no lib/**/enhancedBacktest*). The enhanced PATH is
  enhancedCombinedSignal in lib/backtest/signals.ts, which the PRIOR agent reviewed. So item 9's
  "enhancedBacktest look-ahead/survivorship" reduces to: survivorship → see P1 above; look-ahead in the
  enhanced signal → prior agent's scope.
