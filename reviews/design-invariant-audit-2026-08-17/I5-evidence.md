# Q-079 — Design invariant I5 tier audit

**Invariant text (verbatim, CLAUDE.md:109-113):**
> I5 — Every claim of skill must survive the adversary · PARTIAL
> No strategy, factor, or model reaches the UI or the docs without out-of-sample
> results, Deflated Sharpe Ratio, Probability of Backtest Overfitting, and an
> entry in `.quantlab/TRIAL_REGISTRY.jsonl` recording how many configurations
> were tried. Report the deflated number as the headline, never the raw one.

**Audit date:** 2026-08-17 · **Tree:** `claude/q079-invariants-audit-2e38e2` @ `18afde2`
**Method:** static read of executing artifacts (CI YAML, npm scripts, source, tests,
committed result JSON) plus one numerical reproduction using the repo's own
`lib/quant/deflatedSharpe.ts`. `npm run benchmark` was NOT executed (per scope);
the committed artifact `scripts/benchmark-results.json` (timestamp
`2026-07-16T17:31:14.334Z`) was read instead.

---

## VERDICT

| | Tier |
|---|---|
| **CURRENT TIER (CLAUDE.md:109)** | PARTIAL |
| **PROPOSED TIER (whole invariant)** | **VIOLATED** |
| — gate clause, considered alone | ASPIRATIONAL (no mechanism exists) |
| — reporting clause, considered alone | VIOLATED (a live path does the opposite) |

**This is a two-step downgrade.** Two independent facts drive it, and either
alone would be disqualifying.

**Fact 1 — there is no gate.** I5 is written as a gate ("no strategy …
**reaches the UI or the docs without** …"). No executing artifact anywhere in
this repo stops any strategy, factor, or model from reaching the UI or the docs
when OOS results, DSR, PBO, or a registry entry are absent. Not one. The four
artifacts either do not exist (PBO), or sit beside the pipeline as things a
human must remember to produce (OOS, registry), or are computed into a JSON
field that nothing reads (DSR). A gate nobody can fail is not partial
enforcement of a gate.

**Fact 2 — a live path does the opposite, so VIOLATED dominates.** The engine
backtest reaches the production UI publishing a "Win Rate" and a "Sharpe Ratio"
with none of the four artifacts beside them
(`app/backtest/page.tsx:237` → `components/backtest/KeyMetricsStrip.tsx:62-88`,
fed by a live `/api/backtest` fetch at `app/backtest/page.tsx:64-72,122` —
mount and data flow both verified, see §"Reporting rule"). The engine win rate
is also published bare in the frozen docs
(`reviews/invariants-baseline.md:137-142`). And the only automated performance
gates in the repo (`.github/workflows/ci.yml:74-101`,
`.github/workflows/nightly-backtest.yml:37-72`) gate on the **raw** win rate
and never read the deflated one.

Under the tier vocabulary, VIOLATED ("a live path actively does the opposite")
dominates ASPIRATIONAL. Reporting the whole invariant as ASPIRATIONAL would
understate it, because a strategy has in fact already reached both the UI and
the docs without a single one of the four required artifacts.

**Counterweight, stated for fairness:** the *research statistics themselves* are
genuinely strong for a repo at ASPIRATIONAL — purge+embargo walk-forward is
implemented and unit-tested, pre-registered acceptance rules have demonstrably
rejected candidates, and the trial registry rows are unusually candid about
their own weaknesses. The tier is about the presence of a gate, not the quality
of the statistics. Both statements are true simultaneously.

---

## SUB-TIERS

| # | Requirement | Tier | One-line reason |
|---|---|---|---|
| 1 | Out-of-sample results | **PARTIAL** | Purged walk-forward exists, is unit-tested, and was used for the one shipped decision; no CI job runs any OOS script and nothing fails if OOS is skipped. |
| 2 | Deflated Sharpe Ratio | **PARTIAL** | Computed and persisted on exactly one path (the canonical label benchmark); read by nothing, gated by nothing, and its published value is numerically saturated at 1.0000 and provably insensitive to `nTrials`. |
| 3 | Probability of Backtest Overfitting | **ASPIRATIONAL** | Zero implementation: no `.ts`/`.js`/`.mjs` file in the repo contains PBO or CSCV logic. |
| 4 | `TRIAL_REGISTRY.jsonl` entry | **ASPIRATIONAL** | 9 rows, all `backfilled:true`, all `logged_at:2026-08-15`; no code writes it, no code reads it, no CI job validates it. A static file is not a mechanism. |
| — | Reporting rule (deflated is the headline) | **VIOLATED** | CI gates on raw WR; the UI publishes raw Sharpe/WR with no deflated counterpart. |

---

## THE CENTRAL QUESTION — is there a gate?

**Answer: no. No file:line can be named, because none exists.**

The complete set of jobs in `.github/workflows/ci.yml` is `typecheck` (:15),
`test` (:29), `coverage` (:44), `benchmark` (:61), `smoke` (:103). The only
performance gate is the `benchmark` job.

The single executing artifact in the repo that FAILS on a quantitative claim is:

- `scripts/benchmark-signals.ts:325-331`
  ```ts
  const FLOOR_EDGE_PP = 1.81
  if (benchmark.edgeOverBaseRatePp < FLOOR_EDGE_PP) {
    console.error(...)
    process.exit(1)
  }
  ```
  invoked by `.github/workflows/ci.yml:73` (`run: npm run benchmark`) on every PR
  to `main`, and by `.github/workflows/nightly-backtest.yml:35`.

This gate is real and it does bite. But it gates the **raw, full-sample,
in-sample edge over the base rate** — none of I5's four artifacts. It would pass
identically if `deflatedSharpeN10` were `null`, if the registry file were
deleted, if no OOS run had ever been performed, and if PBO were 0.99.

Secondary confirmations that no artifact enforces the four requirements:

- **No test references the published artifact.** `grep -rn "benchmark-results\|tradeStats\|deflatedSharpeN" __tests__ tests` → **zero matches**. Nothing fails if `tradeStats` disappears or `deflatedSharpeN10` is `null`.
- **The re-check in CI reads only the raw WR.** `.github/workflows/ci.yml:82-96` extracts `r.aggregate.aggregateNetWinRate` and `r.aggregate.aggregateWinRate`; it never touches `r.tradeStats`. Same at `.github/workflows/nightly-backtest.yml:42-69`.
- **No CI job runs any OOS or experiment script.** `package.json` defines `benchmark:oos`, `benchmark:oos:wf`, `experiment:rotation`, `experiment:sell-check`, `experiment:stop-removal`, `experiment:calibrated-score`, `experiment:score-select`, `experiment:hold-horizon`, `optimize:grid`, `portfolio:backtest`. None appears in any workflow file (`.github/workflows/` = `a11y-axe.yml`, `ci.yml`, `nightly-backtest.yml`, `refresh-data.yml`, `stryker-weekly.yml`).
- **No code reads or writes the registry.** See requirement (4).

---

## REQUIREMENT (1) — OUT-OF-SAMPLE RESULTS · PARTIAL

### What genuinely exists (compliant, with proof)

- **Purged walk-forward is implemented.** `lib/optimize/gridSearch.ts:342`
  (`purgedWalkForwardFolds`), with `embargoBars = 5` defaulted at
  `lib/optimize/gridSearch.ts:347` and the OOS entry boundary computed at
  `:362` (`const oosEntryStart = isEnd + embargoBars`). Protocol string at
  `:486`: *"expanding-window purged walk-forward: per-fold selection on IS ONLY
  (labels close before the boundary by construction), 5-bar embargo, OOS
  reported from unseen data"*. This matches the house convention (20d purge /
  5-bar embargo) stated in CLAUDE.md:I4.

- **The purge geometry IS enforced by an executing artifact.**
  `__tests__/optimize/gridSearchPurged.test.ts:36-45`:
  ```ts
  expect(lastIsExit).toBeLessThan(fold.oosEntryStart)
  expect(fold.oosEntryStart - fold.isEnd).toBe(5) // embargo
  ```
  This test fails if the embargo is removed or the IS label window is allowed to
  straddle the boundary. It runs in the `test` job (`.github/workflows/ci.yml:41`).
  **This is the strongest genuine enforcement anywhere in I5's scope** — but note
  precisely what it enforces: *the correctness of the OOS tool*, not *the use of
  the tool before publishing*. Those are different properties.

- **Pre-registered acceptance rules demonstrably rejected candidates**, i.e. the
  human process is not vacuous. `.quantlab/TRIAL_REGISTRY.jsonl` T-0005: all 3
  exit variants failed pre-registered WR/return criteria, verdict `REJECTED`,
  note *"Pre-registration held — recorded as a negative result rather than re-cut
  until something passed."* T-0008 (Q-077): `REJECTED`, "do not build". T-0007:
  `REJECTED` on negative Brier skill despite an attractive top-decile result.

- **The shipped decision did carry OOS evidence.** T-0009 (H=60) records 4 OOS
  segments under a pre-registered rule; corroborated in
  `reviews/invariants-baseline.md:124-151`.

- **The purged IS-selection / single-OOS protocol is embedded in the committed
  artifact.** `scripts/portfolio-backtest-results.json` → `protocol` =
  *"Q-064/Q-076: label-matched exit-family grid; selection on IS only (purged),
  one OOS validation of the selected config; full window = context"*,
  `oosBoundary: "2025-01-01"`, `isPurgeBars: 21`.

### CROSS-CHECK FROM THE PARALLEL I4 AUDIT — verified independently, one claim REFUTED

The I4 data-integrity audit reported that `lib/backtest/walkForward.ts` has a
zero embargo and is "the PRODUCTION path, not a spare". I read it myself.

**CONFIRMED — the embargo is genuinely zero.** `lib/backtest/walkForward.ts:157-159`
(the I4 audit cited :158-160; the code is as described, my line numbers differ by one):
```ts
const trainEndDate = dateAt(trainEnd - 1)
const testStartDate = dateAt(trainEnd)
```
The test window opens on the bar immediately following the last train bar. There
is no embargo and no purge. Worse, trade attribution at `:164-174` buckets trades
by **entry date** (`if (t.date <= trainEndDate) isReturnSum += pnl; else if
(t.date >= testStartDate) osReturnSum += pnl`), so with
`DEFAULT_TIME_EXIT_CONFIG.maxHoldDays = 60` (`lib/backtest/exitRules.ts:85-88`)
against `testDays = 63` (`lib/backtest/walkForward.ts:124`), a trade entering on
the last IS bar resolves its label ~60 bars *inside* the test window. Train and
test share overlapping label horizons. The I4 audit's leakage reasoning is correct.

**REFUTED — it is NOT the production path.** `walkForwardAnalysis` and
`walkForwardSummary` are re-exported by `lib/backtest/engine.ts:239-242`, but
`grep -rn "walkForwardAnalysis(\|walkForwardSummary(" --include="*.ts" --include="*.tsx"`
across the entire repo returns invocations in **exactly three test files and
nowhere else**: `__tests__/backtest/walkForward.test.ts:20,21,38,39,46,47`,
`__tests__/backtest/engine.test.ts:267,273,285,286,296,310`, and
`__tests__/backtest/mutationHardening.golden.test.ts:448,474,484,485`. There are
**zero call sites in `app/`, `scripts/`, `components/`, or elsewhere in `lib/`.**

It is therefore neither the production path nor a spare — it is **dead code that
is re-exported from the public engine surface and pinned by three test files**,
which is arguably more dangerous than either, because it looks live and blessed.

**Which path produces the PUBLISHED numbers — traced for each surface:**

| Published surface | Path | Embargo status |
|---|---|---|
| Canonical label WR / edge / DSR (`scripts/benchmark-results.json`, CI gate, `invariants-baseline.md` §1b) | `scripts/benchmark-signals.ts:63` → `runInstrumentLabelBenchmark`, **full sample, no walk-forward at all** | N/A — no IS/OOS split exists to embargo |
| UI backtest page cards + tables (`/api/backtest`) | `app/api/backtest/route.ts` → `backtestInstrument`, **full window** | N/A — no split |
| UI "Walk-Forward / Overfitting Check" panel | `components/backtest/WalkForwardPanel.tsx:41-68`, computed **client-side** by slicing `selected.equityCurve` into 4 equal parts | N/A — a chronological split of one in-sample run, not an IS/OOS protocol |
| Purged OOS research (portfolio-backtest, hold-horizon H=60, `oos-walkforward`) | `lib/optimize/gridSearch.ts:342` `purgedWalkForwardFolds`, `embargoBars = 5` (`:347`), boundary at `:362` | **5-bar embargo present and unit-tested** (`__tests__/optimize/gridSearchPurged.test.ts:36-45`) |

**Conclusion: no published number flows through the zero-embargo function.** The
DSR is not being applied on top of a contaminated OOS estimate — it is applied to
a full-sample label benchmark that has no OOS split whatsoever, which is a
different and separately-stated problem (see requirement (1) gap, below).

**Sub-tier (1) is UNCHANGED at PARTIAL.** The leak is latent, not live. But it
adds a real finding (F-I5-14) and it sharpens the gap: the repo contains two
walk-forward implementations, one correct and embargoed
(`lib/optimize/gridSearch.ts`) and one with zero embargo re-exported from the
public engine API (`lib/backtest/walkForward.ts`), and nothing marks which is
which at the call site.

**Correction for the I4 agent / parent:** the cited path `lib/backtest/gridSearch.ts`
**does not exist** (`ls` → No such file). The purge arithmetic lives in
`lib/optimize/gridSearch.ts`. The substance is right and the file is wrong;
please do not propagate that citation.

**On CLAUDE.md's "the strongest area of the platform":** that sentence is wrong,
but for a different reason than the I4 audit supposed. The OOS layer that
produces the *research* results does not leak — it is genuinely purged and
embargoed. What fails is that the published headline numbers do not come from
that layer at all, and nothing forces them to.

**Bonus — this likely resolves the Q-084 1024-vs-16 mystery.**
`lib/optimize/gridSearch.ts:87` carries the comment *"Inert (not consumed by
`simpleBacktestSlice`) — held at first provided value."* If three of `LOOP1_GRID`'s
five 4-valued dimensions are inert, the declared 4⁵ = 1024 collapses to an
executed 4² = 16 — exactly the `totalCombinations=16` the Loop-1 run reported.
`lib/optimize/parameterSets.ts:52` declares `maxHoldDays: [15, 20, 25, 30]`
while `simpleBacktestSlice` hardcodes a 20-bar hold (`:181`,
`for (let i = 220; i < closes.length - 21; i++)`) — a declared grid dimension
that is silently ignored. **I did not trace all five dimensions**, so this is a
strong lead for Q-084, not a settled finding. If it holds, the honest
multiplicity denominator for T-0001 is **16, not 1024**, and the registry sum of
**45** is the right one to deflate against — which also means
`maxHoldDays` can be varied by one field change and would then exceed the
hardcoded 22-bar purge, silently leaking (the I4 audit's point, and it stands).

### The gap (why not ENFORCED)

- **The canonical benchmark that CI gates on is NOT out-of-sample.**
  `scripts/benchmark-signals.ts:62-75` iterates every instrument over the full
  window with no IS/OOS split; the gated statistic `edgeOverBaseRatePp`
  (`:252`) is a full-sample number. The CI performance gate therefore certifies
  an in-sample statistic.
- **No CI job executes `benchmark:oos:wf` or any experiment script** (see above).
  A PR that ships a signal change with zero OOS evidence goes green.
- **Sub-period evidence is computed and printed but not gated.**
  `scripts/benchmark-results.json` → `perYearEdge` records **2024: −3.31pp** and
  **2025: −3.16pp** edge over base rate — the two most recent full years are
  NEGATIVE — while the pooled `edgeOverBaseRatePp` of 2.55 clears the 1.81 floor
  and CI passes. `scripts/benchmark-signals.ts:295-299` prints this table; no
  branch acts on it.

---

## REQUIREMENT (2) — DEFLATED SHARPE RATIO · PARTIAL

### CLAIM-BY-CLAIM VERIFICATION OF CLAUDE.md:117-123

| CLAUDE.md claim | Verdict | Evidence |
|---|---|---|
| DSR is implemented at `lib/quant/deflatedSharpe.ts` (Bailey & López de Prado) | **TRUE** | File exists; `deflatedSharpe()` at `:126-130`, `expectedMaxSharpe()` at `:114-120`, `probabilisticSharpe()` at `:95-108`. Docstring cites BLdP 2012 (JoR 15(2)) and 2014 (JPM 40(5)) at `:4-10`. |
| `scripts/benchmark-signals.ts` calls it with a hardcoded `nTrials` of 10 and 100 | **TRUE** | `scripts/benchmark-signals.ts:105-106`: `const dsr10 = deflatedSharpe(netRets, 10)` / `const dsr100 = deflatedSharpe(netRets, 100)`. Literals, no config, no registry read. |
| Both are guesses | **TRUE (and self-declared)** | `scripts/benchmark-signals.ts:96-97` comment: *"DSR shown as a sensitivity band (N=10 / N=100 assumed trials) rather than a single invented trials count."* |
| The registry accounts for ~45 configs minimum, or 1053 on the Loop-1 declared grid | **TRUE — arithmetic reproduced exactly** | Sum of `configs_tried.declared_grid` over all 9 rows = **1053** (T-0001=1024 + 29). Substituting T-0001's `reported_total_combinations_per_instrument`=16 gives **45**. Both figures are exact, not hand-waves. |
| The published DSR therefore under-corrects for multiplicity | **MISLEADING — see the saturation finding below** | The published DSR is 1.0000 and does not move for ANY value of `nTrials` in the plausible range. Under-correction is real in principle but has zero effect on the published number. |
| The code's own note flags the trade-overlap treatment as optimistic | **TRUE** | `scripts/benchmark-signals.ts:94-97` and `:240-241` (persisted `note` field): *"Trades overlap (daily signals, 20d holds) so these are OPTIMISTIC upper bounds"*. Also printed to stdout at `:287`. |

### FINDING: the published DSR is numerically saturated and `nTrials` is irrelevant

`scripts/benchmark-results.json` (committed, 2026-07-16):
```json
"tradeStats": { "nTrades": 3410, "perTradeSharpe": 0.1874,
                "psrGtZero": 1, "deflatedSharpeN10": 1, "deflatedSharpeN100": 1 }
```

Reproduction using the repo's own `expectedMaxSharpe` and the PSR z-score from
`lib/quant/deflatedSharpe.ts:104-107`, at the published `T = nTrades = 3410` and
`SR = 0.1874`, across three skew/kurtosis assumptions (the raw returns are not
persisted, so the moments are bracketed rather than known):

| nTrials | deflation bar `sr0` | DSR (g3=0,g4=3) | DSR (g3=−0.5,g4=8) | DSR (g3=+1,g4=10) |
|---:|---:|---:|---:|---:|
| 10 | 0.02697 | 1.0000 | 1.0000 | 1.0000 |
| 45 | 0.03829 | 1.0000 | 1.0000 | 1.0000 |
| 100 | 0.04334 | 1.0000 | 1.0000 | 1.0000 |
| 1053 | 0.05600 | 1.0000 | 1.0000 | 1.0000 |
| 10,000 | 0.06612 | 1.0000 | 1.0000 | 1.0000 |
| 1,000,000 | 0.08337 | 1.0000 | 1.0000 | 1.0000 |
| 10^12 | 0.12185 | 0.9999 | 0.9998 | 1.0000 |

**Consequence: Q-081 as currently scoped is cosmetic.** Wiring `nTrials` to the
registry-derived 45 or 1053 would change the published headline from
`1` to `1`. The backlog note at `workspace/IMPROVEMENT_BACKLOG.json:1796`
("the published DSR is deflated against too small a number") identifies a real
defect with no effect on the artifact it points at.

**The binding defect is the sample size, not the trial count.** `expectedMaxSharpe`
scales by `sqrt(1/(T-1))` (`lib/quant/deflatedSharpe.ts:117`), and the PSR z-score
scales by `sqrt(T-1)` (`:106`). Both are computed on `T = 3410` *overlapping*
trades. The repo's own honest effective sample is `nonOverlapStats.nTrades = 347`
(`scripts/benchmark-signals.ts:153-164`). Recomputing at `T = 347`:

| nTrials | `sr0` | DSR (g3=0,g4=3) |
|---:|---:|---:|
| 10 | 0.08465 | 0.9709 |
| 45 | 0.12019 | **0.8924** |
| 100 | 0.13605 | 0.8282 |
| 1053 | 0.17578 | **0.5848** |
| 10,000 | 0.20755 | 0.3551 |

At the honest effective n and the registry-derived trial count, DSR falls from
`1.0000` to **0.58–0.89** depending on which Loop-1 denominator is correct
(Q-084). That range spans "supported" to "coin flip". **The published `1` is an
artifact of counting each trade ~10 times.** The code flags the overlap in prose
(`:94-97`, `:240-241`) but does nothing about it in the computation.

> **The T=347 row is ILLUSTRATIVE, not measured.** It assumes the
> non-overlapping subsample has the same per-trade Sharpe (0.1874) as the pooled
> sample. `nonOverlapStats` persists only `nTrades`, `netWinRatePct` and the
> Wilson interval (`scripts/benchmark-signals.ts:257-263`) — no Sharpe, no
> moments — so that assumption is stacked on top of the bracketed skew/kurtosis.
> **F-I5-2 does not depend on it.** The T=3410 saturation is robust across all
> three moment assumptions and every `nTrials` to 10¹², and the mechanism is
> provable from the code alone: `expectedMaxSharpe` scales the deflation bar by
> `sqrt(1/(T−1))` (`lib/quant/deflatedSharpe.ts:117`) while the PSR z-score
> scales by `sqrt(T−1)` (`:106`), both evaluated on an overlap-inflated `T`.

### The test that looks like it guards this cannot detect it

`__tests__/quant/deflatedSharpe.test.ts:75-83`:
```ts
expect(d10).toBeLessThanOrEqual(psr)
expect(d100).toBeLessThanOrEqual(d10)
expect(d100).toBeGreaterThan(0)
```
Every assertion is satisfied by `1 <= 1 <= 1`. A test named *"DSR is monotone
non-increasing in assumed trials"* passes identically whether deflation is
working or completely saturated. This is the same green-and-inert pattern the
previous sprint shipped: the test exists, it is green, and it cannot fail in the
regime the production artifact actually occupies.

### Implementation fidelity against Bailey & López de Prado — checked line by line

**Correct (verified by hand):**
- `normCdf` (`:51-60`) — Abramowitz–Stegun 7.1.26. Substitution `x = |z|/√2` at `:52`
  with `exp(−z²/2) = exp(−x²)` at `:58` is consistent; the Horner nesting at `:56-57`
  expands to `a₁t + a₂t² + a₃t³ + a₄t⁴ + a₅t⁵` with the published coefficients. Correct.
- `probabilisticSharpe` (`:104-107`) — `denom = 1 − γ₃·SR + ((γ₄−1)/4)·SR²`,
  `z = (SR − SR*)·√(T−1) / √denom`. This is BLdP 2012 eq. 11 exactly, including
  the `T−1` (not `T`) and the non-excess kurtosis convention documented at `:40`.
- `expectedMaxSharpe` (`:118-119`) — `(1−γ)·Z⁻¹[1−1/N] + γ·Z⁻¹[1−1/(N·e)]` with
  γ = Euler–Mascheroni (`:16`). This is BLdP 2014 eq. 4 exactly.
- Skew/kurtosis use the biased moment estimators (`:31-48`), which is the BLdP
  convention, and the docstrings say so.

**Fidelity gap (documented, not hidden):** `lib/quant/deflatedSharpe.ts:117` uses
`sdSr = sqrt(1/(T−1))` — the H₀ sampling variance of a *single* Sharpe estimator.
BLdP 2014 specifies `V[{SR_n}]`, the **cross-sectional variance of the trial
Sharpe ratios**. The docstring at `:113` discloses the substitution
("with V[SR] ≈ 1/(T-1) under H0"), so this is a stated approximation rather than
a bug — but it understates deflation whenever the trial Sharpes are more
dispersed than `1/(T−1)`, which is the normal case for a real grid search. The
repo has the raw material to do it properly (`scripts/optimization-results-loop1.json`
holds per-combination results) and does not.

**Undocumented numerical fail-open:** at `nTrials ≳ 1e16`, `1 − 1/nTrials` rounds
to exactly `1.0` in float64, `normInv` returns `NaN` (`:64`, `if (!(p > 0 && p < 1)) return NaN`),
and `expectedMaxSharpe` returns `NaN` rather than `null`. `deflatedSharpe:128`
guards with `if (sr0 == null) return null`, which is **false for `NaN`**, so the
function returns a non-null `NaN`. The caller at `scripts/benchmark-signals.ts:238`
then does `Number(dsr10.toFixed(4))` → `NaN` written into the JSON. Reproduced at
`nTrials = 1e20`. No current call site passes such a value; severity LOW, but it
is a numerical guard that fails open.

### Where DSR is and is not surfaced

- **Persisted:** `scripts/benchmark-signals.ts:234-242` → `benchmark-results.json` `tradeStats`.
- **Printed to stdout:** `scripts/benchmark-signals.ts:286-288`, as the *sixth*
  console line, after four raw-metric lines.
- **NOT in CI:** no workflow reads `tradeStats` (proven above).
- **NOT in the UI:** `grep -rn "deflat\|psrGtZero\|probabilisticSharpe" app components` → zero matches.
- **NOT in the README:** `README.md:9` advertises "corrected Sharpe/Sortino metrics" with no deflation anywhere in the file.

---

## REQUIREMENT (3) — PROBABILITY OF BACKTEST OVERFITTING · ASPIRATIONAL

**Confirmed absent.** `grep -ril "cscv\|combinatorial\|probability of backtest overfitting\|\bpbo\b"`
over the whole repo (excluding `node_modules`, `.next`, `.git`, `__pycache__`)
returns **10 files, all prose or config, zero implementation**:

`CLAUDE.md`, `workspace/IMPROVEMENT_BACKLOG.json`, `workspace/SESSION_STATE.json`,
`workspace/REAL_WORLD_VALIDITY_CRITIQUE_2026-05-26.md`, `workspace/MEMORY_LOG.md`,
`.quantlab/README.md`, `.quantlab/TRIAL_REGISTRY_SCHEMA.json`,
`.claude/agents/quant-validator.md`, `reviews/findings-ledger.csv`,
`reviews/OSS-BENCHMARK-2026-05-26.md`.

No `.ts`, `.tsx`, `.js`, or `.mjs` file contains any of these terms. CLAUDE.md's
claim "PBO/CSCV is not implemented at all" is **TRUE**. Tracked as Q-085
(`workspace/IMPROVEMENT_BACKLOG.json:1879`), which itself records "Confirmed
absent 2026-08-15".

Note that this alone is sufficient to make I5's gate clause unsatisfiable: one
of the four required artifacts cannot be produced by any code in the repo, so no
strategy has ever met I5's stated bar, including the one shipped result (T-0009,
the H=60 hold-horizon change).

---

## REQUIREMENT (4) — TRIAL_REGISTRY.jsonl ENTRY · ASPIRATIONAL

### Measured facts (read and counted, not taken on trust)

- **Row count: 9** (`.quantlab/TRIAL_REGISTRY.jsonl`, `wc -l` = 9, all parse as JSON).
- **All 9 rows are `"backfilled": true`.**
- **All 9 rows carry `"logged_at": "2026-08-15"`** — a single distinct value. The
  registry has never been appended to outside the day it was created.
- **Exactly 1 row has `"shipped": true`** (T-0009).
- **3 rows are flagged `configs_tried.uncertain: true`** (T-0001, T-0007, T-0008).
- **Sum of `configs_tried.declared_grid` = 1053** (T-0001 = 1024 declared).
- **Sum with T-0001's reported 16 combinations = 45.**

The 1024-vs-16 contradiction is self-declared in T-0001's own `note`
("The discrepancy is UNRESOLVED … provisional until reconciled — see Q-084").
T-0007's note is explicit that its count is a floor: *"feature-set and
hyperparameter choices made before this run are NOT logged and are unaccounted
multiplicity."* **Both 45 and 1053 are lower bounds**, and the file says so at
`.quantlab/README.md:50-54`.

### Why ASPIRATIONAL and not PARTIAL

The artifact exists. The *mechanism* does not.

- **Nothing writes it.** `grep -rn "TRIAL_REGISTRY\|\.quantlab"` across the whole
  repo returns 9 files: `CLAUDE.md`, `workspace/IMPROVEMENT_BACKLOG.json`,
  `workspace/MEMORY_LOG.md`, `.quantlab/README.md`,
  `.quantlab/TRIAL_REGISTRY_SCHEMA.json`, `workspace/SESSION_STATE.json`,
  `.claude/agents/quant-validator.md`, `.claude/commands/handoff.md`,
  `reviews/findings-ledger.csv`. **Every one is prose, backlog, or agent
  instruction. Zero are executable code. Zero are CI configuration.**
- **Nothing reads it.** Same grep. In particular `scripts/benchmark-signals.ts`
  does not import, read, or reference it — which is exactly why `nTrials` is
  hardcoded at `:105-106`.
- **Nothing validates it.** `TRIAL_REGISTRY_SCHEMA.json` exists but no test, no
  zod parser, and no CI step loads it. A malformed or empty registry breaks no build.
- **The only "enforcement" is an instruction to a human/agent**
  (`.claude/commands/handoff.md`), and `.quantlab/README.md:56-58` concedes the
  point: *"Nothing appends to this file automatically yet … Until then it decays
  whenever someone forgets."*

Per the tier vocabulary, a file that no mechanism creates, requires, or consumes
is the target state, not partial enforcement.

---

## REPORTING RULE — "report the deflated number as the headline, never the raw one" · VIOLATED

This is the clause where a live path actively does the opposite.

1. **CI gates on the raw number and never reads the deflated one.**
   `.github/workflows/ci.yml:82-96` and `.github/workflows/nightly-backtest.yml:42-69`
   extract only `aggregate.aggregateNetWinRate` / `aggregate.aggregateWinRate`.
   `scripts/benchmark-signals.ts:325-337` exits non-zero on the raw
   `edgeOverBaseRatePp` and the raw `aggregateNetWinRate`. The deflated statistic
   has no floor, no gate, and no reader.

2. **The console headline is raw.** `scripts/benchmark-signals.ts:281-285` prints
   gross WR, net WR, gross/net returns and expectancy; DSR appears only at `:287`.

3. **The live UI publishes raw performance with no deflated counterpart —
   mount and data flow both verified, not assumed.**
   `components/backtest/KeyMetricsStrip.tsx:62-88` renders a "Sharpe Ratio" card
   and a "Win Rate" card (green when `winRate > 0.5`, `:87`), with sub-labels
   "Risk-adj return" and "{n} total trades". No DSR, no PSR, no confidence
   interval, no trial count, no base-rate comparison. Same for
   `components/backtest/InstrumentTable.tsx:131-137` and
   `components/backtest/AnalysisTab.tsx:132-139` (per-instrument Sharpe/Win Rate
   colour-coded green at `>= 0.5`).

   **Liveness proof** (checked explicitly, because this repo has a confirmed
   dead-reader defect elsewhere — see F-I5-10):
   - imported at `app/backtest/page.tsx:18`;
   - **mounted** at `app/backtest/page.tsx:237`:
     `<KeyMetricsStrip portfolio={portfolio} instrumentCount={results.length} />`;
   - `portfolio` is destructured from live fetched state at
     `app/backtest/page.tsx:122` (`const { results, portfolio, computedAt } = data`),
     where `data` is set at `:75` from a real `fetch` of `/api/backtest`
     (`:64-72`, `cache: 'no-store'`);
   - the server builds that object at `app/api/backtest/route.ts:101-118` from
     the real engine run.

   This is a live production path. F-I5-4 and F-I5-5 rest on verified mounting,
   not on the existence of a component file.

4. **The published docs carry raw engine numbers with no deflated counterpart.**
   `reviews/invariants-baseline.md:137-142` publishes, as a FROZEN baseline:
   portfolio engine "net WR 55.37% → **62.75%**", "Sharpe −0.634 → **+0.198**",
   "total return +8.31% → **+53.47%**"; and per-instrument engine
   "net WR 54.28% → **64.60%**". The file contains no DSR, no PSR, no PBO, and
   no trial count anywhere (`grep -c "deflat\|PSR\|PBO" reviews/invariants-baseline.md` → 0).
   The same bare figure is propagated in `.quantlab/TRIAL_REGISTRY.jsonl` T-0009
   `notes`: *"Prod WR after adoption: 64.60%."* Because I5 names "the docs"
   explicitly alongside the UI, this is an independent instance of the reporting
   violation that does not depend on any UI liveness argument.

4. **The panel explicitly named "Walk-Forward / Overfitting Check"
   (`components/backtest/WalkForwardPanel.tsx:74`) contains no overfitting
   statistic at all.** Its three "Overfitting metric" cards (`:108-127`) are
   In-Sample Ann. Return, B&H Ann. Return, and Strategy Alpha. Its own footer
   text (`:132`) says *"A robust strategy should maintain similar Sharpe ratios
   across both [IS and OOS]"* — and the panel never renders an OOS Sharpe beside
   the IS Sharpe. The quarterly Sharpes at `:96-99` are computed from
   `selected.equityCurve` sliced into 4 equal parts (`:41-68`), which is a
   chronological split of a single in-sample run, not an IS/OOS comparison.
   This is the single surface in the product where DSR/PBO most obviously
   belongs, and it is where they are most conspicuously absent.

5. **The README advertises the metric without the deflation.** `README.md:9`:
   "5Y walk-forward backtest across 56 instruments with corrected Sharpe/Sortino
   metrics".

### Compliant counter-evidence (stated for completeness)

The repo is not uniformly dishonest here, and two disclosures are genuinely good:

- `app/backtest/page.tsx:250-254` renders a standing universe caveat:
  *"results are computed over 56 currently-listed S&P large-caps plus BTC — a
  survivor set with no delisted names, which flatters absolute win-rate and
  return levels versus a point-in-time universe."* This is a correct,
  user-visible survivorship disclosure and it should be preserved.
- `scripts/benchmark-results.json` → `alwaysBuyBaseline.note` and
  `nonOverlapStats.note` are candid to the point of self-incrimination
  (*"note the CI net-WR floor (53.29) sits BELOW it"*).

---

## ADDITIONAL FINDING — the UI's "Sharpe Ratio" is not a Sharpe ratio

`components/backtest/KeyMetricsStrip.tsx:38-44`:
```ts
// Displayed Sharpe heuristic: avgAnnReturn / maxPortfolioDd. NOT the
// canonical (Rp - Rf) / σ; this is the same simplified ratio the
// pre-extract code shipped. Preserve verbatim to avoid regression.
const displayedSharpe =
  portfolio.avgAnnReturn > 0 && portfolio.maxPortfolioDd > 0
    ? portfolio.avgAnnReturn / (portfolio.maxPortfolioDd || 1)
    : null
```
rendered at `:62-71` under `label="Sharpe Ratio"` with `sub="Risk-adj return"`.

Two distinct defects:
1. **Mislabelling.** The quantity is return-over-max-drawdown — a MAR/Calmar
   ratio. It contains no volatility term. A user reading "Sharpe Ratio: 1.40"
   is reading a different statistic than the label states, and the repo's own
   comment admits it.
2. **The card cannot display bad news.** The guard `portfolio.avgAnnReturn > 0`
   means a portfolio with a *negative* annualised return renders `—` (via
   `fmtRatio(null)` at `:33-35`), not a negative ratio. The colour branch at `:70`
   contains a `displayedSharpe >= 0 ? 'text-amber-400' : 'text-red-400'` arm whose
   red case is **unreachable**, because `displayedSharpe` is either `null` or
   strictly positive by construction. A losing portfolio shows a dash where a
   red number belongs. This is precisely the green-and-inert pattern flagged in
   the task brief, in a live production surface.

Contrast `reviews/invariants-baseline.md:190-207`, where the portfolio backtest's
*real* Sharpe over the same engine was **−0.9422 / −1.013**. Under this card, a
Sharpe of −1.013 renders as `—`.

---

## ADDITIONAL FINDING — the portfolio dashboard reads a schema that no longer exists

`app/portfolio/page.tsx:6-8` declares `ranking?: {...}[]` and `:23` reads
`data?.ranking?.[0]`. The committed artifact
`scripts/portfolio-backtest-results.json` has top-level keys
`timestamp, version, protocol, elapsed_seconds, instruments, selectedConfig,
oosValidation, targets, isRanking, fullWindowContext, bestFullEquityCurve, bestTrades`
— there is **no `ranking` key** (it was renamed to `isRanking` by the Q-064/Q-076
purged-grid rewrite, `version: "v2.0-q076-label-matched-grid"`).

Consequence: `best` is `undefined` and the page permanently renders the fallback
*"Run `npm run portfolio:backtest` to populate metrics"* (`:34-37`). The
win-rate card at `:44-47` is currently **dead code**, so it is not today a live
reporting-rule violation — but it is a silent-degradation defect (a stale reader
that shows "not computed" for an artifact that WAS computed on 2026-07-16), and
it would become a live violation the moment the schema mismatch is repaired,
because `:44-47` renders `winRate` in emerald with no Sharpe, no DSR and no
trial count beside it. Note that `ranking[0]` was, by construction, the
**best-of-8 selected config** — the single most selection-biased statistic the
pipeline produces.

I flag this so the eventual fix does not silently ship the violation.

---

## WHAT I CHECKED (reproducible)

Working tree: `.claude/worktrees/sweet-dubinsky-4e07b2` @ `18afde2`, clean.

**Greps actually run** (all excluding `node_modules`, `.next`, `.git`, `__pycache__`):
- `grep -rn "deflatedSharpe\|expectedMaxSharpe\|probabilisticSharpe\|nTrials\|deflated" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.json" --include="*.md" --include="*.jsonl" .` → 60 hits, enumerated above; the only *call sites* are `scripts/benchmark-signals.ts:104-106`.
- `grep -ril "cscv\|combinatorial\|probability of backtest overfitting\|\bpbo\b" .` → 10 files, all prose.
- `grep -rn "TRIAL_REGISTRY\|\.quantlab" . -l` → 9 files, all prose/instruction.
- `grep -rn "benchmark-results\|tradeStats\|deflatedSharpeN" __tests__ tests` → **0 matches**.
- `grep -rn "deflat\|psrGtZero\|probabilisticSharpe" app components` → **0 matches** (run literally against `app` and `components`, not inferred from a wider glob).
- `grep -rn "KeyMetricsStrip" app components` → import at `app/backtest/page.tsx:18`, mount at `:237`.
- `grep -rn "walkForwardAnalysis(\|walkForwardSummary(" --include="*.ts" --include="*.tsx" .` → 16 hits, **all in `__tests__/`**; zero production call sites.
- `ls lib/backtest/gridSearch.ts` → **No such file** (refutes a path cited by the parallel I4 audit).
- `grep -rn "sharpeRatio\|winRate\|Sharpe\|Win rate\|Win Rate" components/backtest/*.tsx` → hits enumerated above.
- `grep -rn "purge\|embargo" lib __tests__ scripts -l` → `lib/optimize/gridSearch.ts`, `__tests__/optimize/gridSearchPurged.test.ts`, 6 scripts.

**Files read in full:** `lib/quant/deflatedSharpe.ts`, `__tests__/quant/deflatedSharpe.test.ts`,
`.quantlab/TRIAL_REGISTRY.jsonl` (all 9 rows), `.quantlab/README.md`,
`.github/workflows/ci.yml`, `.github/workflows/nightly-backtest.yml`,
`components/backtest/KeyMetricsStrip.tsx`, `app/portfolio/page.tsx`,
`reviews/invariants-baseline.md`.
**Files read in part:** `scripts/benchmark-signals.ts` (:60-351),
`components/backtest/WalkForwardPanel.tsx` (:1-135), `app/backtest/page.tsx` (:250-300).
**Artifacts parsed programmatically:** `scripts/benchmark-results.json`,
`scripts/portfolio-backtest-results.json`, `.quantlab/TRIAL_REGISTRY.jsonl`.
**Numerical work:** one throwaway `tsx` script importing the repo's own
`expectedMaxSharpe` / `normCdf` to produce the two saturation tables. Not committed.
**Not run:** `npm run benchmark` (out of scope), `npm run test`, `npm run typecheck`.

## WHAT WOULD HAVE SHOWN FAILURE (i.e. refuted these ratings)

Each rating is falsifiable by a concrete, named artifact. None was found:

- **Would have moved I5 to ENFORCED:** any step in `.github/workflows/*.yml` that
  reads `tradeStats.deflatedSharpe*`, or asserts `.quantlab/TRIAL_REGISTRY.jsonl`
  contains a row matching the current commit, or runs `benchmark:oos:wf` with a
  non-zero exit on failure. I read all five workflow files end to end; no such step exists.
- **Would have moved (2) DSR to ENFORCED:** a test in `__tests__` asserting
  `benchmark-results.json.tradeStats.deflatedSharpeN100 != null` or above a
  threshold. The grep for `benchmark-results|tradeStats|deflatedSharpeN` in
  `__tests__` and `tests` returned zero matches.
- **Would have refuted the saturation finding:** any `nTrials` in `[10, 10^12]`
  producing a DSR below ~0.999 at `T=3410`. The table above sweeps 7 values across
  3 moment assumptions; the minimum is 0.9998, at `nTrials = 10^12`.
- **Would have refuted (3) ASPIRATIONAL:** a single `.ts`/`.js`/`.mjs` file matching
  `cscv|combinatorial|pbo`. Zero.
- **Would have refuted (4) ASPIRATIONAL:** any `readFileSync`/`appendFileSync`/import
  targeting `TRIAL_REGISTRY.jsonl` in code, or a second distinct `logged_at` value
  in the file. Neither exists (all 9 rows are `2026-08-15`).
- **Would have refuted the reporting VIOLATED call:** a DSR/PSR/CI rendered next to
  the Sharpe or Win Rate cards. `grep "deflat|psrGtZero|probabilisticSharpe" app components`
  → zero matches.
- **Would have supported CLAUDE.md's "45 / 1053" being a stale hand count:** a sum
  other than 1053/45. Reproduced exactly by summing the file.

## BLIND SPOTS

1. **The exact DSR at the honest effective n is not computed, only bracketed.**
   `benchmark-results.json` persists `perTradeSharpe` and `nTrades` but **not** the
   skew, kurtosis, or the raw `netRets` array. I therefore swept g₃ ∈ {−0.5, 0, 1}
   and g₄ ∈ {3, 8, 10} rather than using the true moments. The saturation
   conclusion at T=3410 is robust across that whole range (all ≥ 0.9998). The
   T=347 figures (0.58–0.89) carry a **second** assumption on top of that: the
   non-overlapping subsample's per-trade Sharpe is not persisted anywhere, so I
   reused the pooled 0.1874. Those figures are illustrative only. **That the
   moments are not persisted is itself a reproducibility defect** — the published
   DSR cannot be recomputed or reinterpreted from the committed artifact (F-I5-9).
2. **I did not execute `npm run benchmark`, `npm test`, or `npm run typecheck`**
   (scope constraint / session budget). All statements about what CI *does* come
   from reading the workflow YAML and the script's exit paths, not from observing
   a run. A workflow could in principle be overridden by branch protection rules
   or required-checks configuration I cannot see from the filesystem.
3. **GitHub branch-protection settings are not in the repo.** If `main` requires
   some check not defined in `.github/workflows/`, I cannot see it. I consider
   this unlikely to change the verdict, since the four I5 artifacts are not
   computed by any script that could be wired to such a check (except DSR).
4. **The Python surface (`alpha_miner.py`, `ml/`, `quant_framework/`,
   `multi_agent_factor_mining/`) was not audited.** My PBO grep covered it by
   extension-agnostic `-ril` and found nothing, but I did not read those trees for
   an equivalent statistic under a different name. If a PBO-like computation lives
   there under other terminology, requirement (3) could be PARTIAL rather than
   ASPIRATIONAL.
5. **I did not verify that the UI surfaces I cite are reachable in production**
   (no deployment check was made). I read the component source and the page that
   composes it; I did not confirm the `/backtest` route renders for an
   unauthenticated user.
6. **Survivorship is unmeasured, as always.** Every number discussed here — the
   56-instrument universe, the base rate, the DSR — sits on a fixed present-day
   instrument list. The magnitude of the inflation is unknown and unmeasured.
   `app/backtest/page.tsx:250-254` discloses this qualitatively; nothing quantifies it.

---

## FINDINGS NOT FIXED

Filed, not fixed, per audit scope. Proposed for `reviews/findings-ledger.csv`
by whoever owns the ledger (this audit did not write to it).

| # | Severity | One-line risk-register description | Evidence |
|---|---|---|---|
| F-I5-1 | **CRITICAL** | I5 is written as a gate but no CI job, test, or runtime guard blocks a strategy lacking OOS, DSR, PBO, or a registry entry from reaching the UI or the docs — the invariant has never been enforceable on any commit. | `.github/workflows/ci.yml:15,29,44,61,103` (complete job list); no workflow reads `tradeStats` or the registry |
| F-I5-2 | **CRITICAL** | The published Deflated Sharpe is saturated at 1.0000 and is provably insensitive to `nTrials` up to 10^12, because it is computed on 3,410 overlapping trades instead of the repo's own 347 non-overlapping effective sample — the headline multiplicity correction is informationally void. | `scripts/benchmark-results.json` `tradeStats`; `lib/quant/deflatedSharpe.ts:117,106`; `scripts/benchmark-signals.ts:98-106` vs `:153-164` |
| F-I5-3 | **HIGH** | Q-081 as scoped (wire `nTrials` to the registry) would change the published DSR from 1 to 1 and must be re-scoped to fix the overlap-inflated `T` first, or it will close as "done" with zero effect. | `workspace/IMPROVEMENT_BACKLOG.json:1777-1796`; saturation table above |
| F-I5-4 | **HIGH** | The live backtest UI publishes a card labelled "Sharpe Ratio" whose value is `annualisedReturn / maxDrawdown` (a MAR ratio, no volatility term), and whose guard makes a negative value unrenderable — a losing portfolio shows `—` where a red number belongs. | `components/backtest/KeyMetricsStrip.tsx:38-44,62-71` |
| F-I5-5 | **HIGH** | No published surface — UI, README, or CI gate — carries a deflated statistic beside the raw Sharpe/win rate, directly contradicting I5's reporting sentence. | `components/backtest/KeyMetricsStrip.tsx:62-88`; `README.md:9`; `.github/workflows/ci.yml:82-96`; zero matches for `deflat` under `app`/`components` |
| F-I5-6 | **HIGH** | The panel titled "Walk-Forward / Overfitting Check" displays only in-sample statistics and contains no overfitting metric; its own caption promises an IS/OOS Sharpe comparison it does not render. | `components/backtest/WalkForwardPanel.tsx:74,108-127,132`, quarterly split at `:41-68` |
| F-I5-7 | **MEDIUM** | `.quantlab/TRIAL_REGISTRY.jsonl` has no writer, no reader, and no schema validation; all 9 rows share one `logged_at` date, so it has not been appended to since creation and will decay silently. | `.quantlab/TRIAL_REGISTRY.jsonl` (9 rows, all `2026-08-15`); `grep TRIAL_REGISTRY` → prose only; `.quantlab/README.md:56-58` |
| F-I5-8 | **MEDIUM** | The CI performance gate passes on a pooled full-sample edge (+2.55pp) while the two most recent complete years show negative edge (2024 −3.31pp, 2025 −3.16pp) — the gate structurally cannot see decay. | `scripts/benchmark-results.json` `perYearEdge`; `scripts/benchmark-signals.ts:325-331` |
| F-I5-9 | **MEDIUM** | The DSR is not reproducible from the committed artifact: skew, kurtosis and the raw per-trade returns are not persisted, so the published value cannot be recomputed or recomputed at a different `nTrials`/`T`. | `scripts/benchmark-signals.ts:234-242` (persists only `nTrades`, `perTradeSharpe`, `psrGtZero`, two DSR values) |
| F-I5-10 | **MEDIUM** | `app/portfolio/page.tsx` reads a `ranking` key that the current artifact schema no longer has (renamed `isRanking` by Q-064/Q-076), so the portfolio dashboard permanently renders "Run npm run portfolio:backtest" for an artifact that exists; repairing it would ship a best-of-8 selected win rate with no Sharpe or DSR. | `app/portfolio/page.tsx:6-8,23,34-47` vs `scripts/portfolio-backtest-results.json` top-level keys |
| F-I5-11 | **LOW** | `expectedMaxSharpe` returns `NaN` (not `null`) for `nTrials ≳ 1e16` because `normInv` receives exactly `1.0`; `deflatedSharpe`'s `sr0 == null` guard does not catch `NaN`, so a `NaN` propagates into the persisted JSON. A numerical guard that fails open. | `lib/quant/deflatedSharpe.ts:64,114-120,127-129`; `scripts/benchmark-signals.ts:238` |
| F-I5-12 | **LOW** | The test named "DSR is monotone non-increasing in assumed trials" uses `toBeLessThanOrEqual` and passes identically under total saturation (`1 <= 1 <= 1`), so it cannot detect the regime the production artifact occupies. | `__tests__/quant/deflatedSharpe.test.ts:75-83` |
| F-I5-13 | **LOW** | `lib/quant/deflatedSharpe.ts` substitutes `V[SR] ≈ 1/(T−1)` for BLdP 2014's cross-sectional `V[{SR_n}]`; disclosed in the docstring, but it understates deflation for real grid searches and the repo holds the per-combination results needed to do it properly. | `lib/quant/deflatedSharpe.ts:113,117`; `scripts/optimization-results-loop1.json` |
| F-I5-14 | **MEDIUM** | Two walk-forward implementations coexist and nothing distinguishes them at the call site: `lib/optimize/gridSearch.ts` is correctly purged with a 5-bar embargo, while `lib/backtest/walkForward.ts` has a ZERO embargo and is re-exported from the public engine API — dead today, but pinned by three test files so it looks blessed, and any future caller silently inherits train/test label overlap. | `lib/backtest/walkForward.ts:157-159,164-174,124`; `lib/backtest/engine.ts:239-242`; zero non-test call sites; cf. `lib/optimize/gridSearch.ts:347,362` |
| F-I5-15 | **MEDIUM** | `LOOP1_GRID` declares 5×4 dimensions (1024 combos) but `simpleBacktestSlice` silently ignores several — `lib/optimize/gridSearch.ts:87` "Inert … held at first provided value" — which likely explains the unresolved 1024-vs-16 discrepancy and means the declared research grid is not the executed one. Lead for Q-084; NOT fully traced. | `lib/optimize/gridSearch.ts:87,181`; `lib/optimize/parameterSets.ts:52`; `.quantlab/TRIAL_REGISTRY.jsonl` T-0001 note |
| F-I5-16 | **MEDIUM** | The `/api/backtest` response supplies a genuine `sharpeRatio` (`route.ts:106`) and the page types it (`page.tsx:30`), but `KeyMetricsStrip`'s prop interface omits it and the component substitutes a return/drawdown heuristic under the "Sharpe Ratio" label — the real statistic is available and discarded. | `app/api/backtest/route.ts:106`; `app/backtest/page.tsx:30`; `components/backtest/KeyMetricsStrip.tsx:14-22,41-44` |
| F-I5-17 | **LOW** | This audit run was not appended to `.quantlab/TRIAL_REGISTRY.jsonl` because the task scope forbade editing any file but this one — so the audit that documents registry decay is itself an unlogged trial, illustrating the decay it reports. | scope constraint; `.quantlab/README.md:56-58` |

---

## PROPOSED CLAUDE.md AMENDMENT (not applied — audit scope forbids editing CLAUDE.md)

Replace the `· PARTIAL` tier on CLAUDE.md:109 with `· VIOLATED`, and replace
the *Today:* paragraph (CLAUDE.md:115-124) with text that says:

- No gate exists for any of the four required artifacts; the only executing
  performance gate (`scripts/benchmark-signals.ts:325-331` via `ci.yml:73`) gates
  a raw, in-sample edge.
- The strongest real enforcement in this area is
  `__tests__/optimize/gridSearchPurged.test.ts:36-45`, which fails if the
  purge/embargo geometry breaks — it enforces the *correctness of the OOS tool*,
  not its *use*.
- The published DSR is `1.0000` and does not respond to `nTrials`; Q-081 must be
  re-scoped around the overlapping-trade sample size before it can have any effect.
- PBO/CSCV does not exist (Q-085).
- The registry has no writer and no reader; 45 / 1053 are both correct arithmetic
  and both lower bounds (Q-084 must resolve which).

Also correct the standing claim that this is "the strongest area of the
platform". On the *quality of the statistics* that is arguably true. On *whether
the invariant binds anything*, I5 is among the weakest, because it is the only
invariant phrased as a hard gate that has zero gate.
