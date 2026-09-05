# Q-110 deep inspection — quant-validator

Territory: `lib/quant/`, `lib/backtest/`, `lib/optimize/`, `scripts/benchmark-signals.ts`,
`scripts/compute-pbo.ts`, `scripts/oos-*.ts`, `lib/synthetic.ts`.
Branch `fix/Q107-A23-quarantine-vs-freshness`, head `c44d303`. No source edited; working tree clean.

**Scope note this report does NOT re-litigate:** the I5 verdict, PBO=0.6667, DSR=0.3439 at
n_eff=114/nTrials=46, the 0.10pp gate headroom, per-year edge sign. Those are settled.
This is an audit of the **arithmetic and the code paths underneath them**.

Everything below was traced in source; items marked CONFIRMED were additionally executed
against the real tree (probes run under `scripts/_q110tmp/`, since deleted; `git status` clean).

---

## SECTION 1 — RANKED FINDINGS

### Q110-Q1 — `excessReturn` compares a 1054-bar strategy against a 1254-bar buy-and-hold. Mean bias **20.81pp**, user-visible. CONFIRMED. HIGH.

`lib/backtest/core.ts:422` `const bnhReturn = computeBuyAndHoldReturn(rows)` measures B&H from
**row 0**. The strategy loop starts at **row 200** (`lib/backtest/core.ts:277`). `lib/backtest/core.ts:480`
then publishes `excessReturn: totalReturn - bnhReturn`.

The same result object already contains a correctly warmup-aligned B&H: `bnhCurve` is seeded at
`lib/backtest/core.ts:279` from `rows[200].close`, precisely because `engine.ts` needed an
end-aligned baseline (the F-2 comment at `lib/backtest/engine.ts:192-199` says the full-history
average "compared MISMATCHED windows … skewing alpha"). **That fix was applied to the portfolio
aggregate and never to the per-instrument field.** One result object now carries two B&H
baselines with different start bars.

Measured, all 56 fixtures, `backtestInstrument` on the committed data:

| ticker | `bnhReturn` (bar 0) | B&H from bar 200 | delta |
|---|---|---|---|
| AVGO | 798.30% | 581.40% | **+216.90pp** |
| ABBV | 147.09% | 69.99% | +77.10pp |
| CAT | 335.93% | 289.35% | +46.58pp |
| AMZN | 62.03% | 109.26% | −47.23pp |
| BTC | 40.60% | 59.50% | −18.89pp |
| **mean over 56** | | | **+20.81pp** |

200 of 1254 bars is 16% of the sample, in a bull window. The error is systematic (positive mean),
not noise, and it runs **against** the strategy — `excessReturn` is ~21pp too negative on average.
That direction is why it has survived: nobody audits a number that makes them look worse.

Rendered at `components/backtest/InstrumentTable.tsx:145` ("Excess"),
`components/backtest/AnalysisTab.tsx:148`, and `components/backtest/WalkForwardPanel.tsx:126` —
the last under the "Strategy Alpha" label that `CLAUDE.md` I5 already flags at `Q-103`. The label
is wrong AND the number behind it is wrong, for unrelated reasons.

Same root cause one line up: `lib/backtest/core.ts:419` `const years = days / annualization` with
`days = rows.length` (1254), while returns only accrue over 1054 bars — `annualizedReturn` is
deflated by the same warmup.

**Proposed fix** (lead to verify; this moves a frozen number, so it needs an owner decision):
```ts
// lib/backtest/core.ts:422
const WARMUP_BARS = 200   // must equal the loop start at :277
const bnhReturn = computeBuyAndHoldReturn(rows.slice(WARMUP_BARS))
// :419
const years = (rows.length - WARMUP_BARS) / annualization
```
The `200` is currently a bare literal in three places (`:270`, `:277`, `:279`); extracting it is
part of the fix, not cosmetic.

---

### Q110-Q2 — `maxDrawdown()` divides by the **global** peak, not the peak at the trough. Systematically understates risk on exactly this dataset. CONFIRMED. HIGH.

`lib/quant/indicators.ts:625-647`. The loop tracks a running peak and the maximum **absolute**
drawdown, then at `:634` computes `maxDdPct = maxDd / peak` using the peak's **final** value — the
global maximum of the series.

Max percentage drawdown is `max_t (peak_t − c_t)/peak_t`. Dividing a max-absolute by a
later, larger peak is a different quantity.

Executed:
```
maxDrawdown([100, 50, 1000, 900]) -> { maxDd: 100, maxDdPct: 0.1 }
```
Reported 10%. True max percentage drawdown is **50%** (100→50). Second case
`maxDrawdown([100,50,101,90])` reports 0.495 against a true 0.50.

**This is the modal case for this universe, not a corner case.** Any series that makes a new high
after its worst decline has its drawdown divided by the later peak — i.e. every name that fell in
2022 and recovered by 2026, which is most of the 56. The error always runs the **flattering** way:
reported drawdown ≤ true drawdown, never the reverse.

Live and user-visible: `lib/quant/buildFundamentalsPayload.ts:270` feeds the stock fundamentals
payload; re-exported as the SSOT delegate at `lib/quant/technicals.ts:55`.

`lib/backtest/core.ts:426-431` and `lib/backtest/engine.ts:154-162` each compute drawdown
correctly (per-step percentage against the running peak) — so the codebase already contains the
right algorithm twice and the wrong one in the file named as the indicator SSOT.

**Proposed fix:**
```ts
// lib/quant/indicators.ts:625
export function maxDrawdown(closes: number[]): { maxDd: number; maxDdPct: number } | null {
  if (closes.length < 2) return null
  let peak = closes[0]
  let maxDd = 0
  let maxDdPct = 0
  for (const c of closes) {
    if (c > peak) peak = c
    const dd = peak - c
    if (dd > maxDd) maxDd = dd
    if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak   // anchored at the trough's own peak
  }
  return { maxDd, maxDdPct }
}
```
Note `maxDd` and `maxDdPct` may then come from **different** troughs. That is correct and should be
documented, not "fixed".

---

### Q110-Q3 — The published `benchmark-results.json` asserts "PBO/CSCV has no implementation" in the same object that reports `pbo: 0.6667`. CONFIRMED. HIGH (claim defect).

`scripts/benchmark-signals.ts:486`, inside `tradeStats.note`:

> `'… NOT A SKILL CERTIFICATION: PBO/CSCV has no implementation (Q-085), so I5 is unmet by construction, …'`

`Q-085` shipped `lib/quant/pbo.ts` and `scripts/compute-pbo.ts` on 2026-08-22 (`c8704af`). The
committed `scripts/benchmark-results.json` now carries, side by side:

```
tradeStats.pbo  : {"value":0.6667,"splits":6,"configurations":16,"computedAt":"2026-08-22T…"}
tradeStats.note : "… PBO/CSCV has no implementation (Q-085), so I5 is unmet by construction …"
```

This is a machine-readable artifact contradicting itself, and it is the repo's own documented
failure mode (`feedback_adversarial_review_quantan.md`: *point reviewers at the CLAIMS not the
code*). Note that the *conclusion* — no claim of skill supported — remains correct for the reasons
stated in the rest of the sentence; it is the **reason given** that is now false. Both the
"unmet by construction" clause and the parenthetical `(Q-085)` need to go.

Also stale in the same block: `scripts/benchmark-signals.ts:481` labels
`deflatedSharpeBand` and prints `[0.3439, 0.3439]` — a degenerate "band" since `T-0001` gained an
`effective_grid` and `trials.lower === trials.upper === 46`
(`lib/quant/trialRegistry.ts:106-107`). Publishing a two-element array whose ends are equal invites
the reader to think a range was measured. Either collapse it to a scalar or emit `null` with a
reason.

**Proposed replacement for `:484-487`:**
```
'… counted from .quantlab/TRIAL_REGISTRY.jsonl. NOT A SKILL CERTIFICATION: PBO/CSCV is on file at '
+ 'tradeStats.pbo (0.5 is the no-skill null) and DSR tests a straw-man null (SR>0) that a long-only '
+ 'survivor-list strategy clears automatically. Trial bounds are LOWER bounds: …'
```

---

### Q110-Q4 — `sortinoRatio` divides by `n_d`, not `N`. Measured **1.73×** below the standard convention, and the docstring's justification is inverted. CONFIRMED. MEDIUM-HIGH.

`lib/quant/indicators.ts:705`:
```ts
const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / negDevs.length
```
`negDevs` is filtered to strictly-negative deviations at `:701-703`, so the denominator is the
**count of losing periods**, not the observation count.

The docstring at `:678-680` claims: *"Denominator is n_d (count of negative excess returns), NOT N
(total obs). Using N understates downside deviation, inflating Sortino by sqrt(N/n_d)."* That
directional claim is backwards for the standard target-downside-deviation, which divides the sum
of squared shortfalls by **total** observations.

Executed on a 400-point series with 134 negative days:
```
code (n_d denominator) = 3.1273
standard (N denominator) = 5.4031
ratio 1.7277   sqrt(N/n_d) = 1.7277
```
Exact agreement with `sqrt(N/n_d)` — this is the whole discrepancy, not a rounding artifact.

I am **not** asserting a page number in Bacon (2008); the docstring cites `p107` and I cannot verify
it from here. What I can assert is the measured 1.73× and that the docstring's directional sentence
contradicts the formula it defends. The lead should check the citation before choosing which side
to change.

Direction is conservative (reported Sortino is low). But the number is **not comparable to any
published Sortino**, which is the whole point of a ratio, and it is rendered at
`components/backtest/AnalysisTab.tsx:135` with a hard colour threshold at `>= 1` — a threshold
calibrated against the standard convention would fire ~1.7× too rarely here.

Consumers: `lib/backtest/core.ts:464`, `lib/backtest/engine.ts:183`,
`lib/backtest/portfolioBacktest.ts:610`, `lib/quant/buildFundamentalsPayload.ts:273`,
`lib/quant/technicals.ts:67`. One SSOT, five call sites, all affected.

---

### Q110-Q5 — `stochRsiArray` fabricates **11 literal `50`s** during the RSI warmup and seeds the K/D EMA entirely from them. CONFIRMED. MEDIUM.

`lib/quant/indicators.ts:482-486`:
```ts
for (let i = rsiPeriod; i < closes.length; i++) {
  const window = rsi.slice(i - rsiPeriod + 1, i + 1)
  const min = Math.min(...window)
  const max = Math.max(...window)
  stoch[i] = max - min > 0 ? ((rsi[i] - min) / (max - min)) * 100 : 50
}
```
`rsiArray` is NaN before index `rsiPeriod`. The loop starts at `i = rsiPeriod`, so for
`i ∈ [14, 26]` the window still contains NaN → `min`/`max` are NaN → `max - min > 0` is **false** →
the else-branch writes a hardcoded `50`. The `50` is meant for a *flat RSI window*; it is silently
reused for a *missing* one.

Executed on a 60-bar series:
```
first finite k index = 16      (first genuinely-valid stoch index is 2*14-1 = 27)
k[16..26] = 50.00 50.00 50.00 50.00 50.00 50.00 50.00 50.00 50.00 50.00 50.00
k[27..]   = 58.06 51.02 32.70 16.35
```
`smoothFinite` at `:496-503` takes `findIndex(Number.isFinite)` — which finds index 16, because the
fabricated 50s *are* finite — and seeds the EMA from `mean(50,50,50)`. The K line's entire
initialisation is synthetic.

This is a direct violation of the house rule that a missing value must never render as a number,
on the indicator SSOT. Reaches the UI via `lib/quant/btc-indicators.ts:102` → BtcQuantLab. Impact
in the 200-bar-warmup backtest is nil (decayed away); impact on a short chart series is not.

**Proposed fix** — write NaN when the window is not fully finite:
```ts
const window = rsi.slice(i - rsiPeriod + 1, i + 1)
if (!window.every(Number.isFinite)) continue          // leave NaN; do not fabricate a reading
const min = Math.min(...window); const max = Math.max(...window)
stoch[i] = max - min > 0 ? ((rsi[i] - min) / (max - min)) * 100 : 50
```
Warning to the lead: this changes StochRSI goldens and may move the mutation-gate score on
`quant-indicators`. It is a behaviour change, correctly.

Same function, `:480`: the insufficient-data guard returns `{ k: stoch, d: stoch }` — the **same
array object** under two names. Confirmed: `stochRsiArray([1,2,3,4,5])` gives `k === d → true`.
Aliasing bug, no current mutating caller. LOW.

---

### Q110-Q6 — `SECTOR_PROFILES` is a hand-tuned, in-sample-fitted parameter set with its tuning trace in the comments, wired unconditionally into `runPortfolioBacktest`, and absent from the trial registry. CONFIRMED in source; **latent, not live**. MEDIUM-HIGH.

This is the one leakage vector the "arrays are sliced to `i+1`" argument cannot rule out: slicing
protects against future *bars*, not against *constants fitted on the evaluation window*.

`lib/optimize/sectorProfiles.ts:12-21` states the research basis as measured outcomes on named
tickers over this exact window — *"AAPL 16.7% win rate, MSFT 31.7%, NVDA 21.4%"*, *"PLD 3.8%, WELL
0 trades, AMT 37.5%"*, *"LLY 82%, ABBV 94%"*. The per-field comments are an explicit tuning log:

- `:70` `buyWScoreThreshold: 0.22,  // relaxed: too few signals at 0.30`
- `:72` `slopeThreshold: 0.004,     // relaxed: 0.008 missed all entries in corrections`
- `:73` `goldenCrossGate: true,     // re-enabled: tech trends need EMA confirmation`
- `:77` `confidenceThreshold: 55,   // lowered from 60`

`lib/backtest/portfolioBacktest.ts:224-241` builds `sectorGateByTicker` from `SECTOR_PROFILES`
**unconditionally** — no flag, no opt-out — and passes it at `:307` and `:414`.

**Why it is latent.** `lib/backtest/signals.ts:331-333`: `resolveBacktestSignal` only forwards
`sectorGates` when `useEnhancedCombinedSignal()` is true; the regime-only branch below it discards
the argument. Every published producer forces the flag off:
`scripts/benchmark-signals.ts:9`, `scripts/oos-walkforward.ts:30`, `scripts/oos-validation.ts:6`,
`scripts/experiments/hold-horizon-decision.ts:32`, `scripts/portfolio-backtest.ts:25`. So the
H-DECISION, the CI benchmark and the OOS harness are all clean. **I checked this specifically
because if it had gone the other way it would be a P0.**

**Two things still wrong.**

1. `lib/featureFlags.ts:17-18` defaults the flag **ON** outside `NODE_ENV === 'production'`. A
   research script that forgets one line — and `portfolio-backtest.ts:25` uses `?? '0'`, so an
   inherited `QUANTAN_USE_ENHANCED_SIGNAL=1` in the shell silently flips it — runs the in-sample
   parameters and reports the result as OOS. There is no guard; the safety is a convention repeated
   in five files. Propose a runtime assertion inside `runPortfolioBacktest` that refuses to build
   `sectorGateByTicker` unless the caller opts in explicitly.
2. **The tuning is missing from the multiplicity denominator.** `nTrials = 46` is counted from
   `.quantlab/TRIAL_REGISTRY.jsonl`. The four comment lines above record at least four
   configurations tried and discarded, per sector, in a campaign that is nowhere in the registry.
   The registry's own docstring calls its numbers lower bounds; this is a concrete, nameable,
   *unlogged* trial family, in-repo, with `file:line` evidence. That should be logged as trials
   even though the parameters are not live — the degrees of freedom were spent.

Also note `scripts/benchmark-signals.ts:9` sets `process.env` **above** the ESM `import` block.
ES module imports are hoisted, so that assignment does not run before the imports execute. It works
only because `useEnhancedCombinedSignal()` reads the env lazily at call time. Any future
module-init read of that flag makes all five scripts silently wrong. Worth a comment at minimum.

---

### Q110-Q7 — The drawdown circuit breaker closes at an unguarded `nextOpen`; the identical call 16 lines above is guarded. CONFIRMED (asymmetry); latent on current data. MEDIUM.

`lib/backtest/core.ts:315-318` (time exit):
```ts
if (Number.isFinite(nextOpen) && nextOpen > 0) {
  closePosition(state, nextOpen)
```
`lib/backtest/core.ts:333` (drawdown circuit breaker):
```ts
closePosition(state, nextOpen)      // no guard
```
`closePosition` at `:170` computes `proceeds = state.position * fillPrice`. A NaN/0 `nextOpen`
makes `state.capital` NaN, which poisons `equityHistory`, `dailyReturns`, Sharpe, Sortino,
`maxDrawdown` and `totalReturn` for the rest of the run — silently, because `Number.isFinite(sharpe)
? sharpe : null` at `:470` renders the poisoned result as a clean `null`.

The entry side at `:347-353` reasons about exactly this hazard in a five-line comment, and the time
exit was given the guard on that basis. The circuit breaker was missed. Zero non-finite closes
across the current 56 fixtures / 70,796 rows (`benchmarkLabel.ts:101-102` records the same audit),
so this is latent — but it is the branch that fires precisely when the equity curve is already
misbehaving.

**Fix:** hoist the guard, or guard inside `closePosition` and return `false`.

---

### Q110-Q8 — `engine.ts:189` falls back to `max(per-instrument drawdown)` and calls it the portfolio drawdown. CONFIRMED. MEDIUM-LOW.

```ts
// lib/backtest/engine.ts:187-189
const maxDrawdown = portfolioMaxDdComputed
  ? portfolioMaxDdFromCurve
  : Math.max(...combinable.map(r => r.maxDrawdown), 0)
```
The primary path (`:154-162`) computes drawdown from the combined equity curve and is correct. The
fallback is the **maximum of the constituents' individual drawdowns**, which is a different
quantity — with any diversification the portfolio drawdown is normally *smaller*. Served to the UI
at `app/api/backtest/route.ts:108` (`maxPortfolioDd`) and rendered at
`app/portfolio/page.tsx:50`, with no flag distinguishing which branch produced it.

Direction is conservative (overstates risk), which is why it survives. Fix: return `null` on the
fallback path and render `—`, per I2. A number nobody can interpret is worse than a dash.

---

### Q110-Q9 — `excessT` applies a design effect estimated on **levels** to a **market-differenced** series. CONFIRMED. MEDIUM-LOW.

`scripts/benchmark-signals.ts:303`:
```ts
const excessT = excessSharpe == null ? null : excessSharpe * Math.sqrt(Math.max(1, nEff))
```
`nEff = 114` comes from `DEFF = 1 + (m̄−1)·ρ` with `ρ = 0.2494` estimated at
`scripts/benchmark-signals.ts:283-291` as the mean pairwise correlation of **raw instrument daily
returns**.

But `excessRets` (`:294-299`) has already subtracted the equal-weight market return date-by-date.
Differencing removes most of the common factor, so the cross-sectional correlation of the *excess*
series is far below 0.25 and the clustering discount applied to it is too large. n_eff for the
excess should sit much closer to the 345 non-overlapping count.

Magnitude: `t = 0.17` at n_eff=114 becomes ≈`0.30` at n=345 — `sqrt(345/114) = 1.74`. **The verdict
does not move**: 0.30 against a |t| > 3.0 bar is still nothing. Report it anyway, because it is a
wrong number whose error runs conservative, and conservative errors are where review stops.

**Fix:** estimate a second ρ on the *excess* series (mean pairwise correlation of per-instrument
excess-return series on the common date axis) and use it for `excessT` only. Keep the raw-return ρ
for the DSR on `netRetsEffective`, where it is the right quantity.

---

### Q110-Q10 — `intraClusterCorrelation` is a published field name for a quantity that is not the ICC. CONFIRMED. MEDIUM-LOW (naming/I5).

`lib/quant/effectiveSampleSize.ts:95` `meanPairwiseCorrelation` is the mean pairwise Pearson
correlation of **instrument daily returns**. `scripts/benchmark-signals.ts:439` publishes its value
as `tradeStats.clustering.intraClusterCorrelation`.

The intra-cluster correlation Kish's DEFF asks for is the ICC of the **observations being pooled** —
here, trade net returns within a 21-bar calendar block. Those are different quantities: one is a
property of the price tape, the other of the trade sample. The substitution is disclosed in the
module docstring (`effectiveSampleSize.ts:30-32`) but **not** in the field name, and the field name
is what travels.

This is the same defect class as the four "Alpha" labels I5 flags at `Q-103`: a statistic named
after the quantity you wanted rather than the one you computed. Cheapest honest fix is to rename
the published field `rhoProxyMeanPairwiseDailyReturnCorr` and keep the docstring note, rather than
build a true ICC estimator.

---

### Q110-Q11 — Determinism: both producers enumerate the universe with unsorted `readdirSync`. CONFIRMED (mechanism); measured impact ~nil today. LOW.

`scripts/benchmark-signals.ts:40` and `scripts/compute-pbo.ts:51` both drive instrument order off
`readdirSync(dataDir)`. POSIX does not guarantee directory order; it is sorted here only because
of APFS. Float addition is non-associative, so enumeration order perturbs
`blockPerf[b][ci] += r.sharpe` (`compute-pbo.ts:102`) and every pooled sum in the benchmark.

**I measured how much this actually matters rather than asserting it, and the honest answer is: not
much, today.** Order-sensitive decision points and their exposure:

- `compute-pbo.ts:117-119` `distinctColumns` via `toFixed(6)` — needs two columns within ~1e-16 of a
  rounding boundary. Currently 16/16 distinct with wide separation. Not at risk.
- `lib/quant/pbo.ts:183` argmax `isPerf[n] > isPerf[best]` — needs two configs tied to ~1e-16.
  Not at risk today.
- `scripts/benchmark-signals.ts:534` `results.sort((a,b) => (b.winRate ?? 0) - (a.winRate ?? 0))`
  — a non-total comparator, so ties fall back to input order. **Checked: 0 exact `winRate` ties
  across all 56 instruments**, so `byInstrument` ordering in the published JSON is stable. (ES2019
  mandates a stable `Array.prototype.sort`, so the JS-engine hazard the brief raises is not live
  on Node; the exposure is the *input* order, not the sort.)

So the finding is not "the output is nondeterministic" — it is that **the byte-identity property
rests on an unstated filesystem guarantee and three near-tie margins nobody is monitoring.** The
fix is one character of risk for zero: `readdirSync(dataDir).sort()` in both files.

Related, same comparator: `winRate` is `null` for `WELL` (0 buy signals) and `?? 0` sorts it
alongside a genuine 0% instrument. Missing becomes zero, again.

---

### Q110-Q12 — `simpleBacktestSlice` carries two dead accumulators; the CSCV grid is scored on 71 candidate entry bars per block. CONFIRMED. LOW-MEDIUM.

`lib/optimize/gridSearch.ts:183-184, 190, 218, 224`: `dailyRets` and `equity` are accumulated on
every iteration (`equity *= (1 + ret * 0.15)` — a 15% Kelly proxy) and **never read**. Dead code in
the evaluator that both `gridSearchPurged` and `scripts/compute-pbo.ts` select on. It is not wrong,
but it is 40 lines of arithmetic that looks load-bearing and is not; a future reader wiring
`equity` into the score would silently change what PBO measures.

More substantive, and it bounds how much the published PBO can mean: `compute-pbo.ts:93` splits
1254 rows into 4 blocks of 313. Inside `simpleBacktestSlice` entries run
`for (let i = 220; i < closes.length - 21; i++)` (`:186`) — **71 candidate entry bars per block**,
and `sharpe` is null below 5 trades (`:232`). `thinCells` came back **0**, so no cell was empty —
but with 71 bars per cell the per-block Sharpes are extremely noisy, which matters more for reading
PBO=0.6667 than the 6-split resolution the limitations note already flags. Worth adding to that
note.

Two one-line items in the same producer:
- `compute-pbo.ts:153-154` takes `sort(...)[Math.floor(n/2)]` — with 6 splits that is the **upper**
  of the two middle logits, not the median. The brief named the median-of-logits convention
  explicitly; average the two middle values for even `n`.
- `compute-pbo.ts:96` gives the last block the remainder (313/313/313/**315**), while
  `pboFromBlockPerformance`'s docstring at `lib/quant/pbo.ts:152-154` states mean-pooling is "the
  right aggregation for **equal-length** blocks." Truncate instead, as
  `probabilityOfBacktestOverfitting:229` already does.

---

### Q110-Q13 — `walkForwardSummary`: `overfittingIndex = 0` (the best possible score) whenever in-sample return is negative. CONFIRMED; test-only path. LOW.

`lib/backtest/walkForward.ts:221-223`:
```ts
const overfittingIndex = avgIsReturn > 0
  ? Math.max(0, Math.min(1, (avgIsReturn - avgOsReturn) / (Math.abs(avgIsReturn) + 0.001)))
  : 0
```
A strategy that lost money in-sample and lost more out-of-sample reports `overfittingIndex: 0`,
which the field's own comment defines as "IS ≈ OS". Meanwhile the empty-windows case at `:213`
returns `1`. So `0` means both "clean" and "undefined", and `1` means "no data" — the two sentinels
are inverted relative to each other.

Same function `:217-218`: `(w.isSharpe ?? 0)` summed over **all** windows — a window whose Sharpe
was not computable contributes 0 and still counts in the denominator, dragging the average toward
zero. Then `Number.isFinite(avgIsSharpe) ? avgIsSharpe : null` at `:227` can never fire, because
`?? 0` guaranteed finiteness upstream. A null-guard that cannot return null.

Also `:169-176`: window returns are **sums of `pnlPct`**, and `pnlPct` is the raw gross price move
(`core.ts:186`), so IS/OS window returns are gross while the engine's `totalReturn` is net. Two
return conventions in one result object.

**D5 claim re-verified as the brief asked:** `walkForwardAnalysis` / `walkForwardSummary` invocations
across the whole tree are `__tests__/backtest/engine.test.ts` (6), `__tests__/backtest/walkForward.test.ts`
(6), `__tests__/backtest/mutationHardening.golden.test.ts` (5), plus the re-export at
`lib/backtest/engine.ts:239-240`. **Zero invocations in `app/`, `scripts/` or non-test `lib/`.**
`components/backtest/WalkForwardPanel.tsx` takes `BacktestResult[]`, not walk-forward windows — it
is not a consumer. The `embargo 0` defect remains **latent, not live**. Confirmed, not assumed.

---

### Q110-Q14 — `profitFactor` mixes a net win/loss classification with gross P&L magnitudes, and can be `Infinity`. CONFIRMED. LOW.

`lib/backtest/core.ts:184-186`: a trade is classified by `netPnlPct = pnlPct - 2*TX_COST_PCT_PER_SIDE`,
but the magnitude booked into `grossProfit`/`grossLoss` is the raw `pnlPct`. A trade with
`0 < pnlPct <= 22bps` is counted a loss and contributes a **positive** `pnlPct` to `grossLoss`. The
resulting profit factor is neither gross nor net.

`:435`: `profitFactor` is `Infinity` when `grossLoss === 0 && grossProfit > 0`. `sharpeRatio` and
`sortinoRatio` get a `Number.isFinite` guard at `:470-471`; `profitFactor` does not.
`JSON.stringify(Infinity)` is `null`, so `app/api/backtest` serves `profitFactor: null` with no
reason attached — a missing value produced by a silent serialisation quirk rather than a decision.

---

### Q110-Q15 — `vwapArrayWindow` is documented as a sliding window and is not; its output depends on series length. CONFIRMED. LOW (zero callers).

`lib/quant/indicators.ts:444-457`. The docstring at `:441-443` says "sliding-window" / "20-day
anchored VWAP … without managing the anchor index manually". `:454` computes
`anchor = max(0, closes.length - windowBars)` and delegates to the **cumulative-from-anchor**
`vwapArray`. Executed on 30 bars with `windowBars=10`:
```
finite count 10  (a true 10-bar sliding window would give 21)
w[20] on a 30-bar input = 119.5000
w[20] on a 25-bar input = 117.0000     <- same bar, different value
```
Every element is a function of the total series length. That is not a look-ahead today — nothing
after bar `i` enters `out[i]` — but it is the exact shape of one, and it is the kind of helper a
future author calls once on the full series and indexes per bar. **Zero callers** across `lib/`,
`app/`, `components/`, `hooks/`, `scripts/`. Either implement the rolling window the name promises
or delete it; leaving a length-dependent function named "Window" is a trap.

---

### Q110-Q16 — Grid selection compares Sharpe against win rate on the same axis. CONFIRMED. LOW.

`lib/optimize/gridSearch.ts:273` `const baseScore = oos.sharpe ?? oos.winRate` and `:431-432`
`const score = is.sharpe ?? is.winRate` / `best.sharpe ?? best.winRate`. Sharpe here is a
trade-level ratio (~0.1–0.3, signed); win rate is a probability (~0.55). Any configuration whose
Sharpe is `null` — reachable when `sd === 0` at `:236` — scores ~0.55 and beats every genuine
Sharpe in the grid. Two incommensurable scales behind one `??`. Rare on current data but a
selection rule should not be able to prefer a candidate *because its statistic was undefined*.

Same file `:230`: the comment reads `// Sharpe on trade returns (annualized approximation)`; `:237`
computes `mean / sd` with no annualisation and the inline comment two characters later says
`// trade-level Sharpe`. One of the two comments is false.

---

### Q110-Q17 — Risk-free rate: one constant applied uniformly across 2021–2026, and network-dependent when prewarm is enabled. CONFIRMED. LOW (I4-adjacent).

`lib/backtest/core.ts:453` and `:463` call `getRiskFreeRateSync()`, which
(`lib/quant/riskFreeRate.ts:103-110`) returns a static fallback unless the FRED cache is warm.
Default is deterministic — good, and deliberately so per `:99-101`.

Two consequences worth stating:
1. The **same** rate is applied to every bar of a 2021–2026 backtest, over a window in which the
   1-year yield went from ~0.07% to ~5% and back. Sharpe and Sortino for 2021–22 are computed
   against a rate that did not exist at the simulated timestamp — design invariant I4, in a
   headline metric, on a live API path. Understates 2021–22 Sharpe.
2. With `QUANTAN_FRED_PREWARM=1` (documented for production at `riskFreeRate.ts:160`),
   `getRiskFreeRateSync` returns a **live, cached, time-expiring** value. The same backtest over the
   same frozen data then returns a different Sharpe on different days, on the deployed path. That is
   a determinism break the CI benchmark structurally cannot see, because CI never sets the flag.

---

### Q110-Q18 — `totalNetWins` is reconstructed by float round-trip under a gate with 0.10pp of headroom. CONFIRMED-safe today. LOW.

`scripts/benchmark-signals.ts:77`:
```ts
totalNetWins += Math.round(stats.netWinRate * stats.buySignals)
```
`InstrumentLabelStats` (`lib/backtest/benchmarkLabel.ts:117-137`) exports `wins`/`losses` but
**not** `netWins`/`netLosses`, so the aggregate integer is recovered by multiplying a ratio back by
its own denominator. This number is `aggregateNetWinRate`, which is `edgeOverBaseRatePp`, which is
the primary CI gate at `:640` — currently 1.91 against a floor of 1.81.

I checked all 56 instruments: **0 round-trip mismatches**, sum 1927/3394 = 56.7767%, matching the
published 56.78. So it is correct today. It is still a float round-trip standing directly under a
gate with 0.10pp of headroom, for no reason. Add `netWins`/`netLosses` to
`InstrumentLabelStats` and sum the integers.

---

## SECTION 2 — WHAT I SEARCHED AND FOUND CLEAN

A null result is only evidence if the mechanism is visible. Each of these was a live hypothesis
that died on inspection or execution, with the reason it died.

**Label pipeline entry/exit convention — clean, 4 of 4 consumers.** The brief asked that every
consumer use `rows[i+1].close` for entry and `rows[i+1+HOLD].close` for exit, and that none index
`rows[i]`. Verified at `lib/backtest/benchmarkLabel.ts:95-96` (the SSOT),
`scripts/benchmark-signals.ts:198-199` (base rate), `scripts/oos-walkforward.ts:97-98` (OOS base
bars), and `lib/optimize/gridSearch.ts:207,211` (grid). All four use `i+1` entry. All four bound
the loop at `i < rows.length - HOLD - 1`, so the `Math.min(…, rows.length-1)` clamps are provably
no-ops rather than silent last-bar reuse. No consumer indexes `rows[i]` for entry.

**Indicator array alignment — clean, 8 of 8 array-returning variants.** `smaArray:31` (`out[i]`
uses `values[i-period+1..i]`), `emaFull:112`, `rsiArray:131`, `bollingerArray:270`, `trueRange:321`,
`atrArray:334`, `wilderSmoothing:521`, `adxArray:546`. Specifically checked the two that had
history:
- `atrArray` — `trs[j]` is the TR at bar `j+1`; the seed lands at `out[period]` and the recursion
  writes `out[i+1]` after consuming `trs[i]`. Element `k` reflects bar `k`, not `k+1`. Clean.
- `macdArray:230-232` — `validLine = line.slice(slow-1)`, `sigEma[k]` is anchored at validLine index
  `k+sig-1`, i.e. line index `k+slow+sig-2`, and it is written to exactly that index. The
  documented F-NEW off-by-`(sig-1)` is genuinely fixed.
- `adxArray:579` `trSmooth[i-1]` — `tr` starts at bar 1, so `trSmooth[i-1]` covers bars 1..i.
  Correct, and the first valid index `2*period-1` matches the standard.

**The purged fold geometry is right, and I checked it against the code rather than the docstring.**
`lib/optimize/gridSearch.ts:314-320` claims purging "by construction". Verified: the entry loop
`i < closes.length - 21` puts the last IS entry at `len-21` and its exit at `len-1`, so the final
IS label closes at `isEnd-1`. `oosEntryStart = isEnd + 5` (`:367`), and
`oosWarmupStart = oosEntryStart - 220` (`:368`) lands the OOS slice's local `i=220` — the first
bar on which `simpleBacktestSlice` can enter — exactly on `isEnd+5`. Embargo 5 is real and the
warmup overlap does not create an entry inside the embargo.

**PBO `relativeRank` `<= 0` vs `< 0` — immaterial at the current grid, and here is the mechanism.**
`lib/quant/pbo.ts:99-110` counts the element itself in `equal`, so for distinct values
`rank = below + 1` and ranks run 1..N with `omega = rank/(N+1)`. `omega = 0.5` requires
`rank = (N+1)/2`, which is an integer only for **odd** N. At N=16 the two middle ranks give
`logit = ∓0.117783` — executed and confirmed — so no split can produce an exact-zero logit and the
`<=` is never exercised. It reappears if the configuration count goes odd, or if two columns tie at
the median; `distinctColumns` is 16/16 today, so neither is live. Worth a comment at `:190`, not a
fix.

**`compute-pbo.ts` degeneracy guards actually fired clean.** `thinCells = 0` and
`distinctColumns = 16` in the committed `pbo-results.json` — so the "cell scored 0 for sitting out"
hazard implied by `:112-113` has zero instances, and the tie-artifact that produced the earlier
PBO=1 is genuinely absent. Both were live hypotheses; both are dead.

**CSCV block calendar alignment across instruments — clean, despite unequal row counts.** I expected
this to break: `compute-pbo.ts:93` divides each instrument's own row count by 4, and BTC has 1826
rows against 1254 for equities. But all 56 fixtures span the **same calendar window**
(2021-08-17 → 2026-08-14; verified across all 56), so equal *fractions* of each series are
approximately calendar-aligned. Blocks differ by ~1 trading day (EQIX has 1253). Not a leak.

**`probabilisticSharpe` / `expectedMaxSharpe` — formulas match the cited papers.**
`deflatedSharpe.ts:117` `1 - g3*sr + ((g4-1)/4)*sr²` with `z = (sr-sr*)·sqrt(T-1)/sqrt(denom)` is
BLdP (2012) eq. 11 as stated; `g4` is correctly the raw (normal = 3) kurtosis, matching the
`(g4-1)/4` form. `:133-134` is BLdP (2014) eq. 4, `(1-γ)Z⁻¹(1-1/N) + γZ⁻¹(1-1/(Ne))`, with
`V[SR] ≈ 1/(T-1)` under H0 and the substitution documented at `:128`. `normCdf` is a correct
Abramowitz–Stegun 7.1.26 composition (`t = 1/(1+p|z|/√2)`, `exp(-z²/2)`); executed,
`normCdf(0) = 0.5000000005`, within the claimed 1.5e-7. Passing `effectiveT` into **both** the PSR
z and the expected-max bar (`:149-152`) is internally consistent and the comment justifying it is
correct. I probed `expectedMaxSharpe` at nTrials ∈ {1, 1.5, 2, 46} for a negative or NaN bar; none.

**Kish DEFF arithmetic — correct as implemented.** `meanClusterSize:39` is `Σm²/Σm`, the standard
unequal-cluster effective size, not the naive `Σm/k`. `designEffect:53` clamps at ≥1 and floors
negative ρ at 0, so the correction can only ever shrink the sample. `effectiveSampleSize:59` clamps
to `[2, n]`. The estimator's *identity* is the finding (Q110-Q10); its algebra is right.

**Fail-closed paths in the benchmark actually can fail.** `:265-272` (unmapped trades),
`:277-286` (ρ unestimable), `:161-169` (missing/empty registry), `:600-620` (null DSR, zero
registry rows, missing PBO). Each is an `process.exit(1)` on a condition reachable by deleting or
corrupting a real input — not a guard that cannot fire.

**Nondeterminism sweep across the whole territory.** Grepped `Math.random`, `Date.now()`,
`new Date()`, `process.hrtime`, `performance.now` over `lib/quant/`, `lib/backtest/`,
`lib/optimize/`, `scripts/benchmark-signals.ts`, `scripts/compute-pbo.ts`, `scripts/oos-*.ts`,
`lib/synthetic.ts`. **Zero `Math.random` anywhere in the territory.** All `new Date()` hits are
output timestamps (`benchmark-signals.ts:406`, `compute-pbo.ts:135`, `oos-walkforward.ts:254`,
`oos-validation.ts:68`) or out-of-territory UI helpers (`pivots.ts`, `garchClient.ts`,
`buildFundamentalsPayload.ts`). The only `Date.now()` in a computation path is the risk-free cache
(Q110-Q17), inert by default. Every `Object.keys`/`Object.entries` I found iterates a
literal-declared record whose insertion order is fixed in source.

**`Array.sort` comparator sweep.** Five comparators in the territory:
`benchmark-signals.ts:534` (`winRate`, 0 ties — see Q110-Q11), `:404` (`b.trades - a.trades`),
`compute-pbo.ts:154` (`a-b` on logits), `gridSearch.ts:294` (`b.score - a.score`),
`walkForward.ts:147` (string compare on ISO dates). None can return `NaN` on reachable inputs.
ES2019 mandates sort stability, so the non-total ones fall back to input order deterministically.

**`lib/synthetic.ts`** — read in full. The `unique symbol` brand makes structural forgery a type
error as `CLAUDE.md` I3 describes; no numerical surface; nothing to report.

---

## SECTION 3 — RANKED LIST

| # | ID | Finding | Status | Sev | Direction of error |
|---|---|---|---|---|---|
| 1 | `Q110-Q1` | `excessReturn`/`annualizedReturn` measure B&H from bar 0 vs strategy from bar 200; mean **20.81pp** | CONFIRMED | HIGH | against the strategy |
| 2 | `Q110-Q2` | `maxDrawdown()` divides by the global peak, not the trough's peak | CONFIRMED | HIGH | **flattering** (understates risk) |
| 3 | `Q110-Q3` | Published `benchmark-results.json` says "PBO has no implementation" beside `pbo: 0.6667` | CONFIRMED | HIGH | claim defect |
| 4 | `Q110-Q4` | `sortinoRatio` divides by `n_d` not `N` — measured **1.73×** low; docstring inverted | CONFIRMED | MED-HIGH | against |
| 5 | `Q110-Q6` | `SECTOR_PROFILES` in-sample-fitted, wired unconditionally into `runPortfolioBacktest`; unlogged trials | CONFIRMED, **latent** | MED-HIGH | flattering if ever live |
| 6 | `Q110-Q5` | `stochRsiArray` fabricates 11 literal `50`s and seeds the K/D EMA from them | CONFIRMED | MED | missing→number |
| 7 | `Q110-Q7` | DD circuit breaker closes at unguarded `nextOpen`; time exit guards the same call | CONFIRMED, latent | MED | NaN poisoning |
| 8 | `Q110-Q8` | `engine.ts:189` calls `max(per-instrument DD)` the portfolio drawdown | CONFIRMED | MED-LOW | against |
| 9 | `Q110-Q9` | `excessT` applies a levels-estimated DEFF to a differenced series (t 0.17→~0.30) | CONFIRMED | MED-LOW | against |
| 10 | `Q110-Q10` | `intraClusterCorrelation` names a proxy after the quantity it proxies | CONFIRMED | MED-LOW | naming/I5 |
| 11 | `Q110-Q11` | Byte-identity rests on unsorted `readdirSync` + three unmonitored near-tie margins | CONFIRMED (mech.) | LOW | none measured |
| 12 | `Q110-Q12` | Dead `equity`/`dailyRets` in the CSCV evaluator; 71 entry bars/block; upper-median logit; unequal last block | CONFIRMED | LOW-MED | none |
| 13 | `Q110-Q17` | One risk-free constant across 2021–26 (I4); network-dependent under `FRED_PREWARM` | CONFIRMED | LOW | against |
| 14 | `Q110-Q14` | `profitFactor` hybrid net-classification/gross-magnitude; `Infinity` → `null` on the wire | CONFIRMED | LOW | mixed |
| 15 | `Q110-Q13` | `overfittingIndex = 0` on negative IS; `?? 0` Sharpe average; gross vs net window returns | CONFIRMED, test-only | LOW | flattering |
| 16 | `Q110-Q16` | Grid selection compares Sharpe against win rate via `??`; false annualisation comment | CONFIRMED | LOW | flattering |
| 17 | `Q110-Q18` | `totalNetWins` float round-trip under a 0.10pp gate (0 mismatches today) | CONFIRMED-safe | LOW | none today |
| 18 | `Q110-Q15` | `vwapArrayWindow` is not a sliding window; output depends on series length; 0 callers | CONFIRMED | LOW | latent trap |

**Reserved and unused:** `Q110-Q19` … `Q110-Q29`.

### If the lead fixes only three

`Q110-Q2` (flattering, live, user-visible, four lines), `Q110-Q3` (a self-contradicting published
artifact, one string), `Q110-Q1` (the largest measured error in the territory — but it moves a
number rendered as "Alpha", so it needs an owner decision, not just a patch).

### One thing that is NOT in this report and should be said

I found **no look-ahead in the label pipeline, the engine, or the purged grid**. Entry/exit
conventions, indicator alignment, warmup geometry and embargo placement all check out, at the
specific `file:line`s listed in Section 2. That is a real result and it is worth more than any
single finding above — but it is a statement about *bar data*, and `Q110-Q6` is the reason it is
not a statement about the *parameters*. Slicing to `i+1` cannot protect a constant that was chosen
by looking at the answer.
