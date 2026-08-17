> **ERRATUM — added 2026-08-18 after cross-check and red-team review.**
> Two claims below are superseded; `CLAUDE.md` carries the corrected version.
>
> 1. **`walkForwardAnalysis` is NOT a production path.** This file calls it
>    "Path 1 — production / UI … published as an OOS robustness signal" at
>    `:189-191` and `:335`. Every *invocation* is in `__tests__/` (15 across
>    three suites); `lib/backtest/engine.ts:239-240` only re-exports it, and
>    `WalkForwardPanel` computes its own quarterly split. The embargo-0 defect is
>    real but **latent**, and severity is MEDIUM, not HIGH. Its line range is
>    `:158-160`, not `:157-159`.
> 2. **`lib/backtest/gridSearch.ts` does not exist.** Citations to it below are
>    void. The live grid-search path is `lib/optimize/gridSearch.ts`, which
>    applies embargo 5 and is tested.
> 3. `_cached` is **7 sites, 3 of which set it** — not 8 producers. The 8th grep
>    hit is the substring `no_cached_analysis`.
> 4. `lib/data/mergeQuotes.ts:18-28` is the `QuoteProvenance` *interface*;
>    construction is at `:105` and `:167`. The zero-consumer finding stands.
>
> Left otherwise unedited as the frozen record of what the audit actually found.

# Q-079 — Design invariant audit: I1, I2, I4, I6

**Date:** 2026-08-17 · **Branch:** `claude/q079-invariants-audit-2e38e2` · **Scope:** evidence only, no fixes.

Tier vocabulary applied strictly:
- **ENFORCED** — a *named executing artifact* (test file, CI job, or runtime guard on the live
  path) *fails* when the invariant is violated. Reading code and concluding "the code does the
  right thing" is PARTIAL at most.
- **PARTIAL** — mechanism exists for some paths; named gaps.
- **ASPIRATIONAL** — target state; no mechanism; known non-compliance.
- **VIOLATED** — a live code path actively does the opposite.
- **UNVERIFIED** — cannot be determined from the repo.

### Summary table

| Inv | Claimed (CLAUDE.md, inferred 2026-08-15) | Proposed after audit | Movement |
|---|---|---|---|
| I1 | PARTIAL | **PARTIAL** (but weaker than claimed — the mechanism that exists is inert) | confirmed tier, downgraded substance |
| I2 | PARTIAL | **PARTIAL** | confirmed |
| I4 | ASPIRATIONAL | **ASPIRATIONAL**, with one **VIOLATED** sub-path: two live lines actively destroy the prior vintage — `scripts/fetchBacktestData.mjs:116-122` (`writeFileSync` over the full 5Y history, weekly, committed to `main`) and `lib/data/warehouse.ts:198` (`INSERT OR REPLACE` on `PRIMARY KEY (ticker, date)`) | confirmed + scoped escalation |
| I6 | ASPIRATIONAL | **ASPIRATIONAL** | confirmed |

No invariant in this set reaches ENFORCED. I say that as a positive claim with a named search
below, not as a default.

### Severity calibration (applied uniformly)

**No finding in this audit is rated CRITICAL, deliberately.** The bar I applied: CRITICAL is
reserved for a live path that *fabricates or invalidates a user-visible claim of skill* with no
disclosure. Every I4 defect here distorts a number that the platform already discloses as an
upper bound — the survivorship caveat is in code (`scripts/optimize-grid.ts:44-54`), in a review
doc (D7), and in the user-facing universe note, and the headline metric is base-rate-relative.
The measurement-hygiene failures (restatement, no embargo) make published numbers
*non-reproducible and over-precise*, not *fabricated*. That is HIGH.

I initially drafted I4-1 as CRITICAL and downgraded it for internal consistency: restatement of
the corpus is strictly *less* distorting than the survivorship selection in I4-3, which I rated
HIGH, so rating it above I4-3 could not be justified. Three mitigations also apply — the refresh
commits to `main` so vintages are incidentally retained in git, the refresh has a fail-closed
freshness gate, and no lookahead enters the signal itself. A risk register with an
unjustifiable CRITICAL gets learned-ignored, which is the exact failure CLAUDE.md warns about.

---

## I4 — "Point-in-time or it's a lie"

**CURRENT TIER:** ASPIRATIONAL
**PROPOSED TIER:** **ASPIRATIONAL** overall, with sub-finding (d) rated **VIOLATED** as a
standalone code path.

CLAUDE.md's I4 text is broadly right but under-states two things and mis-states one:
- it under-states the **weekly destructive restatement** of the historical fixtures that the CI
  benchmark floor is measured against;
- it under-states that the **production walk-forward has no purge and no embargo at all**;
- it mis-states "the research side does use purge + embargo walk-forward (20d purge / 5-bar
  embargo)" as if it applied to the research path generally. It applies to *one* function
  reachable from *one* script, and that function backtests a **different, simplified signal**
  than production.

### (a) SURVIVORSHIP — the universe is a fixed present-day list. Confirmed.

- `scripts/fetchBacktestData.mjs:12-68` — `const TICKERS = [...]`, a hardcoded literal of 55
  US equities (+ BTC fetched separately at `:197-217`), each with a hardcoded `sector` string.
  There is no date on any entry, no `addedOn` / `removedOn`, no membership table.
- `scripts/backtestData/` contains exactly **56 JSON files** (`ls | wc -l` → 56). Every ticker
  in the list is a name that is still listed and still large-cap as of 2026-08.
- `lib/backtest/dataLoader.ts:137-148` — `availableTickers()` derives the universe by
  `readdirSync(dataDir())`. The universe *is* "whichever files exist on disk right now."
  There is no place a historical membership record could live in this design.
- `scripts/optimize-grid.ts:44-54` — the repo already documents this in a comment:
  > "⚠️ SURVIVORSHIP BIAS (known limitation, affects EVERY metric this script reports): This is
  > a hard-coded list of TODAY's large-cap survivors... treat all reported edge as an UPPER
  > BOUND, not an expectation."
- `reviews/RETHINK-2026-07-11/D7-POINT-IN-TIME-UNIVERSE.md` — a prior investigation reached the
  same conclusion and costed the fix (Sharadar ≈ $49/mo). Its first-order mitigation
  (base-rate-relative reporting) is real, and I confirmed the survivorship comment is present in
  the optimizer. It does **not** close the second-order gap.

**Correction to the task framing:** the window is **not** 2015–2025.
`scripts/fetchBacktestData.mjs:71` — `const PERIOD_DAYS = 1825; // 5 years`. The fixtures are a
rolling trailing-5Y window (≈2021-08 → 2026-08), re-anchored to `Date.now()` on every refresh
(`:162`). This is a *rolling* survivor universe, which is if anything worse for interpretation:
the historical start date silently moves forward every week, so no two benchmark runs are over
the same period, and `reviews/invariants-baseline.md`'s frozen WR floor is a floor on a moving
sample.

**Severity:** the survivorship bias is disclosed in code comments and in the D7 review, and the
headline metric is base-rate-relative, so this is a **HIGH**, not a CRITICAL — the platform is
not claiming an unadjusted number.

### (b) SPLIT / DIVIDEND ADJUSTMENT — confirmed split-adjusted; no adjustment factor is stored anywhere.

- `scripts/fetchBacktestData.mjs:161-164` — `const result = await yf.chart(ticker, { period1:
  new Date(Date.now() - PERIOD_DAYS*86400000), interval: '1d' })`.
- `scripts/fetchBacktestData.mjs:179-190` — the persisted bar takes `open: q.open, high: q.high,
  low: q.low, close: q.close`. Per the standing repo finding (Phase 10, NVDA 10:1 / TSLA 3:1),
  `q.close` from `chart()` is **split-adjusted**. Not re-litigated here; taken as given.
- **The discriminating check:** `grep -rniE "adjclose|adjClose|splitRatio|splits\b|splitRatio"`
  over `lib scripts app components hooks types` returns **zero** functional hits. The only three
  matches are the English word "splits" in prose (`lib/backtest/walkForward.ts:4`,
  `components/backtest/WalkForwardPanel.tsx:132`) and one comment
  (`scripts/fetchBacktestData.mjs:167`). **Nothing in this repo reads `adjclose` and nothing
  stores a split factor.** The adjustment is therefore *destructively applied upstream and never
  recoverable* — the exact "adjustment factors stored, never destructively applied" failure.
- Dividends are handled *differently and better*: `scripts/fetchBacktestData.mjs:171-178` reads
  `result.events.dividends` and attaches a per-bar `dividend` field; `lib/backtest/dataLoader.ts:102-104`
  preserves it. So cash dividends are stored **as an event, not baked in** — that half is
  PIT-correct. Splits are not.
- **Asymmetry finding:** the warehouse path has *no* dividend column
  (`lib/data/warehouse.ts:46-55`; noted in `lib/backtest/dataLoader.ts:101`), so a warehouse hit
  and a JSON hit produce *different* total-return series for the same ticker. This is also an
  I2-adjacent "two paths, one silently lossier" defect.

### (c) FUNDAMENTALS RESTATEMENT — fundamentals do NOT reach any backtest or signal path. Stated affirmatively.

This is a *negative* result and I want it on the record as one, because it materially lowers the
I4 severity.

- Consumers of fundamentals, exhaustively: `app/api/fundamentals/[ticker]/route.ts:68`
  (`yahooFinance.quoteSummary(symbol, { modules: [...MODULES] })`, modules listed at `:20-26`)
  → `buildFundamentalsPayload` at `:134`; and `lib/briefs/sectorBrief.ts:214`
  (`fetchers.quoteSummary(etf, ...)`) for the sector-brief narrative.
- `grep -rn "fundamental|dcf|DCF|peRatio|earnings|revenue|epsTrailing|bookValue"` over
  `lib/backtest/ lib/optimize/ scripts/benchmark-signals.ts scripts/oos-*.ts
  scripts/optimize-grid.ts` returns **only** matches on the substring `sharpeRatio`
  (`lib/backtest/engine.ts:26,219`, `lib/backtest/core.ts:64,228,463`,
  `lib/backtest/portfolioBacktest.ts:118,653,670`). **Zero** genuine fundamentals hits.
- The full import list of `lib/backtest/*.ts` (`grep -rhn "^import" lib/backtest/*.ts | sort -u`)
  contains only `lib/quant/indicators`, `multiTimeframe`, `regimeDetection`, `volumeProfile`,
  `kelly`, `correlation`, `riskFreeRate`, `lib/optimize/sectorProfiles`, `lib/featureFlags`, and
  intra-package modules. No fundamentals module, no `quoteSummary`.

**Conclusion (c): fundamentals are a UI-only surface (stock detail page, sector briefs). They do
not enter any backtest, benchmark, optimizer, or trading signal. There is therefore no
fundamentals-restatement lookahead in any published performance number.** The residual exposure
is that a *user-visible* fundamentals panel and a DCF (`lib/quant/dcf.ts`) show
currently-restated figures with no as-filed vintage and no filing timestamp — that is an I1
provenance gap (see I1), not an I4 backtest-lookahead gap. **Severity: MEDIUM**, and it becomes
CRITICAL the moment anything in `lib/backtest/` or `lib/quant/researchScore.ts` imports a
fundamental. That is the tripwire Q-080 should install.

### (d) BITEMPORALITY / RESTATEMENT — the price history is destructively restated weekly, and a CI floor is measured against it. **VIOLATED.**

This is the finding I consider the most serious in the whole audit, and it is not in CLAUDE.md.

- `.github/workflows/refresh-data.yml` runs `node scripts/fetchBacktestData.mjs` every Sunday
  22:00 UTC and then **`git add scripts/backtestData/ && git commit && git push origin HEAD:main`**
  (final step, "Commit & push if changed").
- `scripts/fetchBacktestData.mjs:116-122` — `saveResult` writes `{ ticker, sector, fetchedAt:
  new Date().toISOString(), candles }` with `writeFileSync`, i.e. it **overwrites the entire 5-year
  history**, not just appends new bars. Every prior bar is re-fetched from Yahoo and re-written
  with today's split adjustment and today's Yahoo restatements.
- `fetchedAt` (`:119`) is a single scalar that is *overwritten on each save*. It is the closest
  thing to a `knowledge_time` in the repo and it retains exactly one vintage: the latest.
- `lib/data/warehouse.ts:46-55` — `PRIMARY KEY (ticker, date)`. One row per (ticker, valid_time).
  No `knowledge_time`, no `as_of`, no vintage column.
- `lib/data/warehouse.ts:196-205` — `INSERT OR REPLACE INTO candles ...`. **Destructive
  upsert**: a restated historical bar silently overwrites the original with no record that it
  changed. This is the textbook bitemporal anti-pattern.
- **Why this is VIOLATED and not merely ASPIRATIONAL:** `.github/workflows/ci.yml:61-95` gates
  every PR on `npm run benchmark` and `FLOOR_NET = 53.29` (`:88`), computed by
  `scripts/benchmark-signals.ts` over `scripts/backtestData/` — a corpus that a scheduled job
  rewrites in place every week. `.github/workflows/nightly-backtest.yml:34-68` enforces the *same*
  floor (`NET_FLOOR = 53.29` at `:51`, soft `GROSS_FLOOR = 54.27` at `:53`) nightly against the
  same self-restating corpus, so the drift is measured against a moving reference every single
  night. The floor in `reviews/invariants-baseline.md` is therefore not a reproducible
  measurement: the same commit benchmarked in two different weeks reads different history. No
  mechanism detects a silent Yahoo restatement — and a restatement large enough to move net WR
  would present as "signal drift," which is exactly the misdiagnosis
  `scripts/fetchBacktestData.mjs:73-82` warns about for the truncation case but does not cover for
  the restatement case.
- **The one mitigation that does exist, stated fairly:** because the refresh commits to `main`,
  **git history is a de-facto append-only vintage log** for these fixtures. That is a real
  partial answer, but it is (i) accidental rather than designed, (ii) not queryable by any code,
  and (iii) destroyed by any future squash/rewrite. No code reads it.
- **The restatement-detection guard does not exist.** `scripts/verify-data-integrity.mjs` checks
  duplicate timestamps (`:60`), non-monotonic time (`:67`), calendar gaps (`:72`), the OHLC
  invariant (`:88`), and zero-volume bars (`:94`). All five are *structural integrity* checks on
  the current snapshot. **None compares today's history to yesterday's.** Conflating this script
  with a PIT guard would be exactly the "green and inert" error.
- `.github/workflows/refresh-data.yml` "Assert fixture freshness" step is genuinely good — it
  fails RED if any fixture's newest bar is >5 days old, closing the frozen-fixture hole. It is a
  *liveness* check, not a *restatement* check: a fetch that silently rewrote 5 years of history
  passes it.

### (e) PURGE + EMBARGO — the claim is true of one function and false of the production path.

**There are two walk-forward implementations and they must not be conflated.**

**Path 1 — production / UI. NO purge, NO embargo.**
- `lib/backtest/walkForward.ts:119-209`, `walkForwardAnalysis()`. Re-exported through
  `lib/backtest/engine.ts:239-240`, which is the module the app and scripts import.
- `:152-206` — the window loop. `trainEnd = trainStart + trainDays`;
  `testEnd = trainEnd + testDays`; `trainStart += testDays` (`:205`).
- `:158-160` — `trainEndDate = dateAt(trainEnd - 1)` and `testStartDate = dateAt(trainEnd)`.
  **The OOS window begins on the very next bar after the IS window ends. Gap = 0 bars.**
- `:165-174` — trades are attributed by *entry* date only. A trade entering on `trainEndDate`
  is booked 100% to IS, but with `DEFAULT_TIME_EXIT_CONFIG.maxHoldDays = 60`
  (`lib/backtest/exitRules.ts:87`) its outcome resolves up to **60 bars inside the OOS window**.
  IS and OOS samples therefore overlap in realised time by up to 60 bars out of a 63-bar test
  window (`testDays = 63`, `:124`) — i.e. essentially the entire OOS window can be
  serially correlated with the IS window.
- Because parameters are fixed here (no per-window re-optimisation — stated at `:109-114`),
  this is *not* a selection leak. It is an **independence failure**: `overfittingIndex`
  (`:221-223`) and `avgOosRatio` are presented as robustness diagnostics over two samples that
  are not independent. **Severity: HIGH** — the number is published as an OOS robustness signal
  and it cannot bear that weight.
- `__tests__/backtest/walkForward.test.ts` and `__tests__/backtest/engine.test.ts:267-285`
  exercise this function. **Neither asserts any purge or embargo property.** They test
  annualisation calendars, window counts, and empty-input behaviour. Nothing in the suite fails
  if the embargo is (as it is) zero.

**Path 2 — `gridSearchPurged`, reachable only from `scripts/optimize-grid.ts`.**
- `lib/optimize/gridSearch.ts:342-371`, `purgedWalkForwardFolds()`.
  `embargoBars = 5` (`:347`), `oosEntryStart = isEnd + embargoBars` (`:362`). **The 5-bar
  embargo claim is TRUE.**
- **The "20d purge" is not a constant and not a separate mechanism.** It is implicit:
  `gridSearch.ts:311-315` states "Purge is BY CONSTRUCTION: simpleBacktestSlice stops entries 22
  bars before its slice end, so every IS label window (20-bar hold, T+1 entry) closes strictly
  before isEnd." I verified this arithmetically against `simpleBacktestSlice`:
  - `:181` — `for (let i = 220; i < closes.length - 21; i++)`, so the last possible entry index
    is `len-22`.
  - `:202` — entry at `closes[i+1]` (T+1).
  - `:206` — exit at `closes[i+21]`, i.e. 20 bars after entry; stop-loss scan `:208` runs
    `k = i+1 .. i+20`.
  - Last label therefore closes at index `(len-22)+21 = len-1`, strictly inside the IS slice.
    **The purge is arithmetically correct for a 20-bar hold, and it is applied only on the
    trailing side of IS (removing IS labels that would cross into OOS). It is NOT applied on the
    leading side of OOS** — but the 5-bar embargo (`:362`) serves that role, and no OOS label can
    look backwards, so for this specific fixed-20-bar-hold construction the geometry is sound.
- **The gap that matters:** the purge constant is **hardcoded to the 20-bar hold of a simplified
  model that is not the production model.** `gridSearch.ts:106-108` says so explicitly:
  > "Simple inline backtest for grid search. Uses inline simplified signal logic for speed
  > (not resolveBacktestSignal SSOT)."
  Production holds 60 bars (`lib/backtest/exitRules.ts:87`). If anyone parameterises the hold
  horizon (the grid `LOOP3_EXIT_GRID` at `lib/optimize/parameterSets.ts:51-56` already declares
  `maxHoldDays: [15, 20, 25, 30]`) and routes it through `simpleBacktestSlice`, the 22-bar buffer
  silently becomes insufficient and labels leak across the boundary with no test failing.
  Today `GridPoint` (`gridSearch.ts:36-42`) does **not** contain `maxHoldDays`, so the leak is
  **latent, not active** — but it is one field addition away. **Severity: HIGH** (latent, and the
  guard is a comment plus an arithmetic coincidence, not an assertion).
- **What is tested:** `__tests__/optimize/gridSearchPurged.test.ts:43` asserts
  `expect(fold.oosEntryStart - fold.isEnd).toBe(5)` and `:36-48` assert per-fold leak-freeness.
  This is the *closest thing to an ENFORCED PIT guard in the repo* — a real executing assertion
  that fails if the embargo is removed. It does **not** reach ENFORCED for I4 because (i) it
  covers only Path 2, which publishes nothing gated by CI, and (ii) it pins the constant `5`, not
  the relationship `embargo ≥ holdHorizon`, so it would still pass if the hold horizon changed.

**The CI-gated benchmark has no IS/OOS split at all.**
`grep -n "purge|embargo|gridSearchPurged|walkForward|OOS|oos|split" scripts/benchmark-signals.ts`
returns **zero hits**. `scripts/benchmark-signals.ts:29-51` loads every fixture and `:63-70`
runs `runInstrumentLabelBenchmark` over the whole 5Y series. That is defensible for a *label*
benchmark (nothing is fitted inside the run), but the parameters being labelled were selected by
grid search over the same corpus, and the CI floor at `ci.yml:88` is enforced on the result. That
is a HIGH-severity provenance-of-the-floor problem, adjacent to I5's `nTrials` gap (Q-081).

### (f) Secondary path — `ml/server.py` uses fully-adjusted (total-return) prices.

- `ml/server.py:58` — `yf.download(ticker, period="3y", interval="1d", progress=False,
  auto_adjust=True)`. `auto_adjust=True` back-adjusts for **both splits and dividends**, i.e. a
  restated total-return series, a strictly larger restatement than the TS path.
- Consumers: `app/api/conditional-vol/[ticker]/route.ts:5` → `lib/quant/garchClient.ts`, and
  `app/api/regime/[ticker]/route.ts:5` → `lib/quant/regimeHmmClient.ts`.
- `Procfile` lists `server_trading_agents.py`, `multi_agent_factor_mining.server`, and
  `server_options.py` — **`ml/server.py` is not in it.** Whether it is deployed elsewhere is
  **UNVERIFIED** from this repo. Severity **MEDIUM**, contingent on deployment.

### WHAT I CHECKED (I4)

Paths read in full: `scripts/fetchBacktestData.mjs`, `lib/backtest/dataLoader.ts`,
`lib/backtest/walkForward.ts`, `lib/optimize/gridSearch.ts:105-240` and `:300-440`,
`.github/workflows/refresh-data.yml`, `.github/workflows/ci.yml`,
`reviews/RETHINK-2026-07-11/D7-POINT-IN-TIME-UNIVERSE.md`.
Greps run (all over `lib scripts app components hooks types` unless noted):
`adjclose|adjClose|splitRatio|splits\b|events.*split|'split'`;
`purge|embargo` (repo-wide, incl. `*.py`);
`fundamental|dcf|DCF|peRatio|earnings|revenue|epsTrailing|bookValue` scoped to
`lib/backtest lib/optimize scripts/benchmark-signals.ts scripts/oos-*.ts scripts/optimize-grid.ts`;
`buildFundamentalsPayload|quoteSummary|incomeStatementHistory|balanceSheetHistory`;
`holdDays|HOLD_DAYS|maxHold|MAX_HOLD|timeExit|TIME_EXIT|holdBars`;
`walkForwardAnalysis|walkForwardSummary`; `auto_adjust|yf.download|universe|TICKERS|symbols =`
over `quant_framework/*.py ml/*.py alpha_miner.py`.
`ls scripts/backtestData | wc -l` → 56.

### WHAT WOULD HAVE SHOWN FAILURE (I4)

I was looking for, and would have downgraded the finding on discovering, any of:
a **membership table** with add/remove dates or a `delisted` flag (searched `*universe*`,
`*instrument*`, `*symbol*` filenames and the ticker literals — none exists); any read of
**`adjclose`** or a stored **split factor** (zero hits — its *presence* would have refuted
"destructively applied"); a **`knowledge_time` / `as_of` / vintage column** in the warehouse
schema or a second dimension on the fixture JSON (schema read in full at `warehouse.ts:44-72` —
absent); a **history-diff / hash-snapshot** step in `refresh-data.yml` or
`verify-data-integrity.mjs` (both read in full — absent); any **fundamentals import** inside
`lib/backtest/` or `lib/optimize/` (grep returned only `sharpeRatio` substring collisions — a
single genuine hit would have escalated (c) to CRITICAL); any **non-zero gap** between
`trainEnd` and `testStart` in `walkForward.ts` (`:158-160` shows adjacency — a gap would have
refuted the no-embargo finding); and a **test asserting embargo/purge on the production
walk-forward** (`__tests__/backtest/walkForward.test.ts` and `engine.test.ts:267-285` read —
none present; one would have moved I4 toward PARTIAL).

### BLIND SPOTS (I4)

- **Resolved (was a blind spot): the second Python backtest engine is orphaned.**
  `grep -rn "BacktestEngine|run_backtest|\.backtest\(" --include=*.py .` returns call sites in
  **`tests/test_quant_framework.py` only** (`:17,229,233,241,251,258`), plus the class definition
  (`quant_framework/backtest.py:91`) and the package re-export (`quant_framework/__init__.py:14`).
  **No production or deployed code constructs a `BacktestEngine`.** It is not a live PIT surface,
  and I4 findings do not need to cover it.
- **But `quant_framework/data_engine.py` IS on a deployed path, and it restates prices.**
  `multi_agent_factor_mining/server.py:146` does `from quant_framework.data_engine import
  get_daily`, and `multi_agent_factor_mining.server` is in the `Procfile` (`alpha:` line).
  `alpha_miner.py:595` imports it too. `quant_framework/data_engine.py:73` passes `adjust="qfq"`
  to the A-share fetcher — *forward-adjusted* (前复权) prices, which are re-anchored to the present
  and therefore restate the entire history on every fetch, exactly like `auto_adjust=True`. Filed
  as I4-11 below. I did **not** read the rest of `data_engine.py`, so the US branch's adjustment
  behaviour is UNVERIFIED.
- I did **not** read `quant_framework/strategy.py`, `quant_framework/deploy.py`,
  `alpha_miner.py` (beyond the import line), `multi_agent_factor_mining/` (beyond `server.py:146`),
  `server_trading_agents.py`, `server_options.py`, `options_*.py`, or `src/`. Three of these
  Python services ARE in the `Procfile` and therefore ARE deployed; I have not audited what they
  compute or publish.
- I did not execute `npm run benchmark`, `verify:integrity`, or any test (task constraint), so
  every claim here is static-analysis; I have not empirically confirmed that e.g. the embargo
  test currently passes.
- I did not check git history to confirm how many distinct fixture vintages `main` actually
  retains.
- I did not audit `lib/scenarios/`, `lib/portfolio/`, or `lib/ml/` for a third backtest path.

### FINDINGS NOT FIXED (I4)

| # | Sev | One-line risk-register row |
|---|---|---|
| I4-1 | **HIGH** | `.github/workflows/refresh-data.yml` rewrites all 56 fixtures' full 5Y history in place weekly (`scripts/fetchBacktestData.mjs:116-122`) and pushes to `main`, so the CI and nightly benchmark floors (`ci.yml:88`, `nightly-backtest.yml:51`, both `53.29`) are measured against a corpus that silently restates itself; no baseline in `reviews/invariants-baseline.md` is reproducible, and a vendor restatement would present as "signal drift". |
| I4-2 | **HIGH** | The production walk-forward `lib/backtest/walkForward.ts:158-160` has zero embargo (OOS starts on the bar after IS ends) while holds run 60 bars (`exitRules.ts:87`), so `overfittingIndex` and `avgOosRatio` are computed over overlapping, serially-correlated samples and cannot support an OOS-robustness claim. |
| I4-3 | **HIGH** | The instrument universe is a hardcoded present-day survivor list (`scripts/fetchBacktestData.mjs:12-68`) with no historical membership record and no delisted names, over a *rolling* 5Y window (`:71`) that re-anchors weekly — every win-rate and Sharpe is an upper bound on a moving sample. |
| I4-4 | **HIGH** | The purged-fold purge is a hardcoded 22-bar arithmetic coincidence tied to `simpleBacktestSlice`'s fixed 20-bar hold (`lib/optimize/gridSearch.ts:181,206,311-315`); adding `maxHoldDays` to `GridPoint` (already declared in `parameterSets.ts:51-56`) would silently leak labels with no test failing. |
| I4-5 | **MEDIUM** | `lib/data/warehouse.ts:196-205` uses `INSERT OR REPLACE` on a `PRIMARY KEY (ticker, date)` table, destructively overwriting restated historical bars with no vintage or change record. |
| I4-6 | **MEDIUM** | No split-adjustment factor is stored anywhere (`adjclose`/`splitRatio` grep: zero hits); the split adjustment is applied upstream and is unrecoverable, so no as-of-date price series can ever be reconstructed. |
| I4-7 | **MEDIUM** | Warehouse candles have no `dividend` column (`warehouse.ts:46-55`) while JSON fixtures do (`dataLoader.ts:102-104`), so the same ticker yields a different total-return series depending on which loader branch wins. |
| I4-8 | **MEDIUM** | Fundamentals (`app/api/fundamentals/[ticker]/route.ts:68`, `lib/quant/dcf.ts`) render currently-restated Yahoo figures with no filing timestamp or as-reported vintage; harmless today because no backtest consumes them, but there is no tripwire preventing that import. |
| I4-9 | **MEDIUM** | `ml/server.py:58` uses `auto_adjust=True` (splits **and** dividends back-adjusted), feeding `/api/regime` and `/api/conditional-vol`; deployment status UNVERIFIED (`Procfile` does not list it). |
| I4-10 | **LOW** | `scripts/benchmark-signals.ts` has no IS/OOS split at all (zero hits for `oos|split|purge|embargo`); the CI-gated headline is a full-sample label benchmark of parameters that were selected on that same sample. |
| I4-11 | **MEDIUM** | `quant_framework/data_engine.py:73` fetches A-share prices with `adjust="qfq"` (forward-adjusted, re-anchored to the present on every fetch) and is reached from the deployed alpha service (`multi_agent_factor_mining/server.py:146`, `Procfile` `alpha:` line); the US branch's adjustment behaviour is UNVERIFIED. |

---

## I6 — "Securities identified by permanent ID, never ticker"

**CURRENT TIER:** ASPIRATIONAL
**PROPOSED TIER:** **ASPIRATIONAL** — confirmed. No mechanism exists, and the non-compliance is
total rather than partial.

### EVIDENCE

- **Named negative result:**
  `grep -rniE "\bfigi\b|permId|perm_id|securityId|security_id|\bisin\b|\bcusip\b|surrogate"`
  over `lib scripts app components hooks types __tests__` returns **zero hits**. There is no
  permanent identifier of any kind, no mapping table, and nothing to make bitemporal.
- `lib/data/warehouse.ts:46-55` — `CREATE TABLE candles (ticker TEXT NOT NULL, date TEXT NOT
  NULL, ..., PRIMARY KEY (ticker, date))`. The ticker string *is* the security identity in the
  storage layer.
- `lib/data/warehouse.ts:57-65` — `CREATE TABLE quotes (ticker TEXT PRIMARY KEY, ...)`. Same.
- `lib/data/warehouse.ts:116-122, 141-147, 172-177, 194-205, 212-219` — every accessor
  (`getCandles`, `getCachedQuote`, `warehouseTickers`, `upsertCandles`, `upsertQuote`) takes or
  returns `ticker: string`. There is no ID parameter anywhere in the data layer's public surface.
- `lib/data/mergeQuotes.ts:31-33` — `UnifiedQuote = { ticker: string; price: number; ... }`. The
  wire type crossing the vendor boundary is ticker-keyed.
- **Sharpest single citation — the identity function is a string mangle:**
  `lib/backtest/dataLoader.ts:37` — `const safe = ticker.replace(/\./g, '-')  // BRK.B → BRK-B`,
  and the inverse `lib/backtest/dataLoader.ts:143` —
  `f.replace(/\.json$/, '').replace(/-/g, '.')  // BRK-B → BRK.B`.
  The round-trip is **lossy in both directions**: any ticker legitimately containing a hyphen
  (`BRK-B` as some vendors write it, `BF-B`, warrant/unit classes like `XYZ-WT`) maps to a `.`
  on the way back and silently addresses a different security. `scripts/benchmark-signals.ts:36`
  repeats the same `.replace(/-/g, '.')` independently — a duplicated, unguarded identity
  transform on the CI-gated path.
- `scripts/fetchBacktestData.mjs:23` stores `BRK-B` as the *ticker* while
  `lib/backtest/dataLoader.ts:37` expects callers to pass `BRK.B`; the two conventions coexist
  and are reconciled only by these string substitutions.
- `lib/quant/yahooSymbol.ts` and `lib/tickerNormalize.ts` exist and normalise *vendor symbology*
  (e.g. `^VIX` prefixing). Both are string→string maps. Neither introduces an identifier; they
  are further evidence that the ticker string is the sole key, handled by ad-hoc rewriting.
- **No ticker-change / corporate-action handling exists.** The universe (`fetchBacktestData.mjs:12-68`)
  is re-fetched by ticker weekly. If a ticker is reassigned to a different issuer, the fixture
  silently splices two unrelated price series with no discontinuity flag —
  `scripts/verify-data-integrity.mjs` would not catch it, because its checks (`:60,67,72,88,94`)
  are duplicate-time, monotonicity, gap, OHLC-invariant and zero-volume. A clean ticker handover
  produces none of those.

### WHAT I CHECKED (I6)

The permanent-ID grep above; the full `lib/data/warehouse.ts` schema block (`:44-72`); every
exported accessor signature in `warehouse.ts`; `lib/data/mergeQuotes.ts:18-53`;
`lib/backtest/dataLoader.ts` in full; `find . -iname "*universe*" -o -iname "*instrument*" -o
-iname "*symbol*"` (excluding `node_modules`/`.git`) → 4 files, all of which I inspected or
accounted for; `scripts/verify-data-integrity.mjs` check list.

### WHAT WOULD HAVE SHOWN FAILURE (I6)

A single hit on `figi|permId|securityId|isin|cusip` anywhere would have moved this to PARTIAL. A
non-ticker column in the `candles` or `quotes` PRIMARY KEY would have. A ticker→ID mapping file
(searched by filename for `*universe*`/`*instrument*`/`*symbol*`) would have. A test asserting
identity stability across a ticker change would have — `__tests__/quant/yahooSymbol.test.ts` is
the only identity-adjacent test and it asserts vendor-symbol string formatting, not identity
permanence.

### BLIND SPOTS (I6)

- The permanent-ID grep did **not** cover the Python tree (`quant_framework/`, `ml/`,
  `multi_agent_factor_mining/`, `alpha_miner.py`, `server_*.py`, `options_*.py`) or `src/`. Given
  three of those are deployed via `Procfile`, an identifier could in principle exist there; I
  consider it unlikely but have **not** verified it.
- I did not check `.env.example` or Vercel config for a vendor ID service credential.

### FINDINGS NOT FIXED (I6)

| # | Sev | One-line risk-register row |
|---|---|---|
| I6-1 | **HIGH** | Security identity is the ticker string in the storage layer (`lib/data/warehouse.ts:46-65`, `PRIMARY KEY (ticker, date)`) with zero permanent identifiers anywhere in the repo; a ticker reassignment silently splices two issuers' price series into one fixture with no discontinuity flag. |
| I6-2 | **MEDIUM** | The ticker↔filename identity transform (`lib/backtest/dataLoader.ts:37` and `:143`, duplicated at `scripts/benchmark-signals.ts:36`) is a lossy `.`↔`-` substitution: any ticker containing a hyphen collides with a dotted class-share symbol, unguarded and untested. |
| I6-3 | **MEDIUM** | Two ticker conventions coexist (`BRK-B` in fixtures per `scripts/fetchBacktestData.mjs:23`, `BRK.B` at the `dataLoader` API per `:37`) reconciled only by ad-hoc string replacement, with no single canonical form asserted anywhere. |
| I6-4 | **LOW** | No corporate-action model exists at all — no splits, spin-offs, mergers, ticker changes, exchange migrations or share-class changes are represented in any type or table. |

---

## I1 — "Provenance or it doesn't ship"

**CURRENT TIER:** PARTIAL
**PROPOSED TIER:** **PARTIAL** — tier confirmed, but the substance is weaker than CLAUDE.md
implies. CLAUDE.md says "the full provenance tuple does not exist"; the sharper finding is that
**the provenance that does exist is produced and never consumed** — the same green-and-inert
shape as the Q-088 type brand.

### EVIDENCE

**What exists (supports PARTIAL, not ASPIRATIONAL):**
- `lib/data/mergeQuotes.ts:18-28` — `interface QuoteProvenance { price, change, changePct,
  volume, high52w, low52w, pe, marketCap, bid?, ask? }`, each a `FieldSource`. This is genuine,
  well-built **per-field vendor attribution** — the `vendor` slot of the 5-tuple, at field
  granularity, which is better than I1 asks for on that one axis.
- `lib/data/mergeQuotes.ts:53-63` (`ALL_YAHOO`), `:93`, `:105`, `:131`, `:136`, `:191` — it is
  populated on every merge branch, and `__tests__/data/mergeQuotes.test.ts:93-196` asserts the
  attribution is *correct*, including the subtle case where a Bloomberg zero falls through to
  Yahoo and provenance must agree (`:156-161`). Those are real, executing tests.
- `lib/data/mergeQuotes.ts:41` — `quoteTime?: string | null`, "Vendor last trade / regular
  session time when available (ISO)." This is a **vendor_timestamp**, present on the quote path.
- `app/api/options/[ticker]/route.ts:78,82-86` — `fetchedAt: new Date().toISOString()` (an
  **ingest_timestamp**) plus `dataProvenance: { provider: 'yahoo-finance2', delayedMinutes: 15,
  realtime: false }`. This is the closest thing to a full tuple anywhere in the repo.
- `components/MetricTooltip.tsx:101` — `Source: {meta.source}` renders a source string from
  `lib/metricGlossary.ts`. That is a *documentation* source, not a per-value vendor tag.
- `components/DarkPoolPanel.tsx:142,172` — `sub="Yahoo Finance"`, `Source: Finra / Yahoo Finance.`
  Hardcoded panel-level source labels. Real, user-visible, but static strings, not per-value.

**The gaps (why it is PARTIAL and inert):**
- **`provenance` is never read.** `grep -rn "\.provenance" --include="*.tsx" components app hooks`
  → **zero hits**. The field is constructed on every quote, typed, and unit-tested, and no UI
  component or hook consumes it. It cannot cause a value to render as `—`, because nothing looks
  at it.
- **`dataProvenance` is never read.** `grep -rn "dataProvenance|delayedMinutes|DELAYED|Delayed"
  --include="*.tsx" --include="*.ts" components app hooks` → the only hits are the producer at
  `app/api/options/[ticker]/route.ts:81-84` and a *comment* at
  `app/api/stream/[ticker]/route.ts:174` describing a badge. **No component renders a "DELAYED"
  label from it.** The comment at `:81` says "Surface this so UI can render an explicit 'DELAYED'
  label" — the surfacing half shipped; the rendering half did not.
- **Missing tuple members, repo-wide.** `grep -rni
  "transform_chain|transformChain|ingest_timestamp|ingestTimestamp|quality_flag|qualityFlag|vendor_timestamp|vendorTimestamp"`
  over the TS tree → **zero hits**. There is no transform-chain hash and no quality flag
  anywhere. Any indicator (RSI, EMA, ATR) is computed and rendered with no record of the
  transform that produced it.
- **The backtest path carries no *data* provenance.** `app/api/backtest/route.ts:37,98` and
  `app/api/backtest/live/route.ts:112` emit `dataSource: 'local'` — a literal string, not derived
  from the fixture. In fairness, `app/api/backtest/route.ts:96-97` does emit `runId` and
  `computedAt`, and `app/backtest/page.tsx:161` renders `computedAt` through `formatFreshness` —
  but that is the age of *our computation*, not of the underlying vendor data, and the two can
  differ by up to a week given the Sunday refresh cadence. The fixture's own `fetchedAt`
  (`scripts/fetchBacktestData.mjs:119`) is parsed by nobody: `lib/backtest/dataLoader.ts:36-46`
  reads the file and `loadStockHistory` (`:53-109`) returns bare `OhlcvRow[]`, **discarding
  `fetchedAt` and `sector`**. So the one true ingest timestamp that is written is structurally
  unreachable by any consumer, and the timestamp the UI *does* show is a different quantity that
  a user would reasonably read as data freshness.
- **The chart path carries no provenance.** `app/api/chart/[ticker]/route.ts:55-62` and
  `:117,236` return `{ ticker, candles, range, interval, _cached }` — no vendor, no vendor
  timestamp, no quality flag.
- **Scope summary:** the tuple's *vendor* slot exists on 1 of 4 feeds (quotes) and is unread;
  *vendor_timestamp* exists on quotes (`quoteTime`) and is read only as an age string (see I2);
  *ingest_timestamp* exists on options only; *transform_chain_hash* and *quality_flag* exist
  nowhere.

### WHAT I CHECKED (I1)

Greps: `provenance|transform_chain|transformChain|ingest_timestamp|ingestTimestamp|quality_flag|
qualityFlag|vendor_timestamp|vendorTimestamp` over the whole TS tree;
`\.provenance` scoped to `components app hooks` with `--include=*.tsx`;
`dataProvenance|delayedMinutes|DELAYED|Delayed` over `components app hooks`;
`dataSource` over `components app`;
`Source:|source:.*Yahoo|'Yahoo Finance'|dataNote|sourceNote` over `components app lib`.
Files read: `lib/data/mergeQuotes.ts:18-63`, `app/api/options/[ticker]/route.ts:75-95`,
`lib/backtest/dataLoader.ts` (full), `app/api/chart/[ticker]/route.ts:40-70`,
`components/MetricTooltip.tsx:101` context, `__tests__/data/mergeQuotes.test.ts:93-196`.

### WHAT WOULD HAVE SHOWN FAILURE (I1)

I was specifically hunting for a *consumer*: any `.tsx` reading `.provenance`, `dataProvenance`,
or `delayedMinutes` and branching to render `—`. One such hit would have upgraded the finding
substantially (and one in `components/` would have been the ENFORCED candidate). I was also
hunting for a `quality_flag` or `transform_chain_hash` anywhere in the type system — either would
have refuted "the tuple does not exist." And I checked whether `loadStockHistory` propagates
`fetchedAt`; had it returned a `DataFile` rather than bare rows, the backtest path would have had
an ingest timestamp and I would have rated the backtest gap lower.

### BLIND SPOTS (I1)

- I did **not** enumerate all 16 `app/**/page.tsx` files individually; I relied on greps for the
  provenance identifiers, which would miss a component that renames the field on destructuring
  (e.g. `const { provenance: p } = data`). The `\.provenance` grep would not catch
  `data["provenance"]` or a rename at the fetch boundary. I consider this a real, if narrow, hole
  in the search.
- I did not audit the Python services' payloads for provenance.
- I did not check whether SSE `market_state` events (`app/api/stream/[ticker]/route.ts:172-177`)
  are consumed by a badge — that is the one path where a "DELAYED"/"LIVE" indicator might exist
  under a different name.

### FINDINGS NOT FIXED (I1)

| # | Sev | One-line risk-register row |
|---|---|---|
| I1-1 | **HIGH** | Per-field vendor provenance is built and unit-tested on every quote (`lib/data/mergeQuotes.ts:18-28,53-63`) but **read by zero UI components** (`grep "\.provenance"` over `components app hooks`: no hits) — the mechanism is green and inert and can never cause a value to render as `—`. |
| I1-2 | **MEDIUM** | `dataProvenance { provider, delayedMinutes: 15, realtime: false }` is emitted by `app/api/options/[ticker]/route.ts:82-86` with a comment promising a "DELAYED" badge; no component renders one, so 15-minute-delayed options prices display indistinguishably from live. |
| I1-3 | **MEDIUM** | `transform_chain_hash` and `quality_flag` do not exist anywhere in the repo (zero grep hits); every derived indicator is rendered with no record of the transform chain that produced it. |
| I1-4 | **MEDIUM** | The backtest path drops its only ingest timestamp: `lib/backtest/dataLoader.ts:53-109` returns bare `OhlcvRow[]` and discards the fixture's `fetchedAt`/`sector`, while `app/api/backtest/route.ts:37,98` emits a hardcoded `dataSource: 'local'`. |
| I1-5 | **LOW** | The chart feed (`app/api/chart/[ticker]/route.ts:55-62,117,236`) returns candles with no vendor, no vendor timestamp and no quality flag. |

---

## I2 — "Fail closed, never fail silent"

**CURRENT TIER:** PARTIAL
**PROPOSED TIER:** **PARTIAL** — confirmed. Real staleness rendering exists on a minority of
surfaces; the cache-substitution clause of I2 is unmet.

### EVIDENCE

**What genuinely works (supports PARTIAL, not ASPIRATIONAL or VIOLATED):**
- `components/DataFreshnessIndicator.tsx:51-72` — computes `ageSec` and renders three real
  states: `Live` (<10s, green), `~Xs ago` (10–120s, amber), and **`Stale — refresh` (>120s, red)**
  with `aria-label` "Data is stale, N seconds old". `:38-49` renders a grey `—` with title "Data
  timestamp unknown" when `quoteTime == null`. **This is a correct, literal implementation of
  I2's "stale displays as STALE with age" and "missing displays as —".**
- `lib/format.ts:51-62` — `formatFreshness()` returns `'live' | 'Ns ago' | 'Nm ago' | 'Nh ago'`
  and `'stale'` for a null or unparseable timestamp. Used at
  `app/sector/[slug]/page.tsx:302`, `app/stock/[ticker]/page.tsx:363`, `app/backtest/page.tsx:161`.
- `.github/workflows/refresh-data.yml` "Assert fixture freshness" step — a genuine **fail-closed
  gate**: it fails the workflow RED if any fixture's newest bar is more than `MAX_STALE_DAYS: 5`
  old, and the commit/push steps are guarded `if: success()`. This is the single strongest I2
  mechanism in the repo and it is an executing CI artifact. It is a *pipeline* gate, not a *UI
  render* gate, so it does not make I2 ENFORCED.
- `scripts/fetchBacktestData.mjs:90-114` — `saveResult` refuses to overwrite a good fixture with
  a degraded fetch (`MIN_ABSOLUTE_ROWS = 252`, `MAX_SHRINK_PCT = 0.05` at `:80-81`) and `:249-252`
  exits non-zero. Fail-closed on the ingest path.
- `lib/backtest/dataLoader.ts:63-79, 86-107` — non-finite OHLC rows are **dropped**, not
  forward-filled or zero-filled. No forward-fill exists on the price path.

**The gaps:**
- **Coverage is 2 of 16 pages.** `grep -rn "DataFreshnessIndicator" --include=*.tsx app components`
  → mounted at `app/desk/page.tsx:163` and `app/sector/[slug]/page.tsx:345` only.
  `find app -name "page.tsx" | wc -l` → **16**. The chart page, stock page price header,
  portfolio, risk, heatmap, crypto, commodities, briefs and backtest surfaces have no staleness
  badge.
- **The badge never suppresses the number.** At `components/DataFreshnessIndicator.tsx:66-71` the
  >120s branch sets a red dot and the string `Stale — refresh`; it renders *beside* the price,
  which continues to display as a normal number. I2's first clause ("stale displays as STALE") is
  met; I1's fail-closed clause ("renders as `—` with a reason, never as a number") is not. This is
  a deliberate-looking design choice, not a bug, but it is the reason I2 cannot be ENFORCED: no
  artifact fails when a stale number is displayed as a number.
- **`_cached` is a dead flag — the clearest violation of I2's cache clause.**
  `app/api/chart/[ticker]/route.ts:60` returns `_cached: true` when serving from `_chartCache`
  (`:52-53`); `app/api/crypto/btc/metrics/route.ts:74` and
  `app/api/crypto/btc/liquidations/route.ts:34` do the same.
  `grep -rn "_cached" --include=*.ts --include=*.tsx .` (excluding `node_modules`) returns
  **only** the 8 producer lines inside `app/api/**` and **zero consumers**. I2 says "Never
  substitute a cached value for a live one without a visible flag." The substitution happens, the
  flag is emitted, and **the flag is invisible** — it dies in the JSON.
- **`formatFreshness` conflates missing with stale.** `lib/format.ts:52,54` — both a `null` ISO
  and an unparseable one return the literal string `'stale'`. I2 requires missing to render as
  MISSING and stale to render as STALE with age; this collapses the two into an ageless "stale".
  (`DataFreshnessIndicator` gets this right; `formatFreshness` does not, and it is the one used on
  the stock and sector detail pages at `:302`/`:363`.)
- **HTTP `stale-while-revalidate` is used with no UI signal.** `app/api/prices/route.ts:184-186`
  sets `s-maxage=3, stale-while-revalidate=5`; `app/api/chart/[ticker]/route.ts:64-67` sets
  `max-age=30, stale-while-revalidate=60`; `app/api/options/[ticker]/route.ts:88` sets
  `s-maxage=300, stale-while-revalidate=600`. A user can be served a value up to 10 minutes old on
  the options surface with nothing rendering its age.
- **No test asserts any I2 behaviour.** `__tests__/components/` contains `DarkPoolPanel`,
  `KLineChart`, `SiteNav`, `TailRiskBanner`, `signinEnvNames`, `smoke`, plus `backtest/` and
  `stock/` subdirs — **there is no `DataFreshnessIndicator.test.tsx`**. Nothing fails if the >120s
  branch is deleted. (Note also that jsdom component tests are CI-only on this machine, so even a
  test here would need CI confirmation.)

### WHAT I CHECKED (I2)

Greps: `STALE|'stale'|isStale|staleness|MISSING` over `lib app components`;
`asof|freshness|lastUpdated|dataAge|ageMs|ageSec|delayed|cached` over `lib app components hooks`;
`_cached` repo-wide excluding `node_modules`; `DataFreshnessIndicator` over `app components`;
`getCachedQuote` over `lib app components`.
Files read in full or in the relevant range: `components/DataFreshnessIndicator.tsx` (full),
`lib/format.ts:40-75`, `.github/workflows/refresh-data.yml` (full),
`scripts/fetchBacktestData.mjs:73-123`, `app/api/chart/[ticker]/route.ts:40-70`,
`app/api/prices/route.ts:180-192`, `app/api/stream/[ticker]/route.ts:160-195`,
`lib/backtest/dataLoader.ts` (full). `ls __tests__/components`; `find app -name page.tsx | wc -l`.

### WHAT WOULD HAVE SHOWN FAILURE (I2)

I was looking for a **forward-fill on a live quote** — a `?? previousClose`, a `?? lastKnown`, a
carry-forward loop — on the quote/chart paths. `app/api/prices/route.ts:144-149` uses
`num(q.regularMarketPrice)` with an explicit number-or-null helper (`:26` documents that a falsy
`|| 0` fallback was removed), and `lib/backtest/dataLoader.ts:63-107` drops rather than fills. I
found no forward-fill, and its presence would have moved I2 to VIOLATED. I also looked for a
**consumer of `_cached`** (a badge, a banner) whose presence would have satisfied I2's cache
clause; there is none. And I looked for a **test on `DataFreshnessIndicator`** whose presence
would have been the ENFORCED candidate; `ls __tests__/components` shows none.
`lib/data/warehouse.ts:141` `getCachedQuote` — I grepped for callers and found **zero outside its
own file**, so the "serve a stale warehouse quote as live" path is dead code, not a live risk.

### BLIND SPOTS (I2)

- I did not read all 16 pages or all ~30 components; a staleness treatment implemented inline
  (without importing `DataFreshnessIndicator` or `formatFreshness`) would not appear in my greps.
  In particular I did not inspect `components/crypto/`, `components/risk/`,
  `components/options/`, or `app/portfolio/`, `app/heatmap/`, `app/commodities/`.
- I did not run the app or exercise a degraded feed, so I have not empirically observed what the
  UI does when Yahoo returns an error — only what the code appears to do.
- I did not audit SWR error/`keepPreviousData` behaviour in `hooks/`, which is a plausible place
  for an invisible last-good-value substitution that greps for `_cached`/`stale` would miss.
  **This is the most likely place for an undiscovered I2 violation and I flag it as unexamined.**

### FINDINGS NOT FIXED (I2)

| # | Sev | One-line risk-register row |
|---|---|---|
| I2-1 | **HIGH** | `_cached: true` is emitted by three API routes (`app/api/chart/[ticker]/route.ts:60`, `app/api/crypto/btc/metrics/route.ts:74`, `.../liquidations/route.ts:34`) and read by zero components — a cached value is substituted for a live one with no visible flag, contrary to I2's explicit wording. |
| I2-2 | **MEDIUM** | `DataFreshnessIndicator` is mounted on only 2 of 16 pages (`app/desk/page.tsx:163`, `app/sector/[slug]/page.tsx:345`); the chart, stock price header, portfolio, risk, heatmap, crypto, commodities and briefs surfaces render prices with no age. |
| I2-3 | **MEDIUM** | No test anywhere covers `components/DataFreshnessIndicator.tsx` (absent from `__tests__/components/`), so the >120s "Stale — refresh" branch can be deleted or inverted with a green build. |
| I2-4 | **MEDIUM** | `lib/format.ts:52,54` returns the same literal `'stale'` for a missing timestamp and for an unparseable one, collapsing I2's MISSING and STALE states into an ageless label on the stock and sector detail pages. |
| I2-5 | **LOW** | `stale-while-revalidate` windows of 5s/60s/600s (`app/api/prices/route.ts:184`, `app/api/chart/[ticker]/route.ts:65`, `app/api/options/[ticker]/route.ts:88`) can serve a 10-minute-old options quote with no age rendered anywhere. |
| I2-6 | **LOW** | `lib/data/warehouse.ts:141-168` `getCachedQuote` has zero callers — dead code today, but it is a ready-made "serve a stored quote as live" path with no staleness gate on its return value. |

---

## Cross-cutting note: why nothing reached ENFORCED

I applied the ENFORCED bar as written — a *named executing artifact that fails when the invariant
is violated*. I checked `.github/workflows/ci.yml` (5 jobs: typecheck, test, coverage, benchmark,
smoke), `.github/workflows/refresh-data.yml`, `.github/workflows/nightly-backtest.yml`,
`.github/workflows/a11y-axe.yml`, `.github/workflows/stryker-weekly.yml`, and
`__tests__/architecture/` (3 files: `findings-ledger-integrity`, `module-ssot`,
`synthetic-containment` — the last is I3's, outside this scope).

The two artifacts that come closest, and why each falls short:
1. `__tests__/optimize/gridSearchPurged.test.ts:36-48` — genuinely fails if the embargo is
   removed. But it covers only `gridSearchPurged`, which publishes nothing CI-gated, and it pins
   the literal `5` rather than the relationship `embargo ≥ hold horizon`.
2. `.github/workflows/refresh-data.yml` "Assert fixture freshness" — genuinely goes RED on stale
   fixtures and blocks the commit. But it enforces *liveness of the ingest*, not I2's UI-render
   contract and not I4's PIT contract; a fetch that rewrote five years of history in place passes
   it cleanly.

`scripts/verify-data-integrity.mjs` is a real, executing, hard-failing check
(`:60,67,72,88,94`) — but on *structural* integrity (duplicate timestamps, monotonicity, gaps,
OHLC invariant, zero volume). Counting it toward I4 would be precisely the green-and-inert error
this audit was commissioned to avoid: it would still pass on a fully restated, fully
survivorship-biased, fully ticker-keyed corpus.
