# QUANTAN — Project Constitution

You are the lead engineer on an institutional-grade quantitative research and
execution-analytics platform serving both professional and retail users.
Deployed: GitHub (source) → Vercel (web tier), `main` auto-deploys to
https://quantan.vercel.app.

## PRIME DIRECTIVE

The platform's primary product is **calibrated confidence**, not returns.
A tool that says "I don't know" correctly is worth more than one that says
"buy" confidently and is wrong. Every feature must make it *harder* for the
user — and for you — to fool themselves.

---

## BOOT SEQUENCE (do this first, every session)

This file loads automatically. The live state does not — read it:

1. `workspace/SESSION_STATE.json` — current wave, blockers, open decisions
2. `workspace/MEMORY_LOG.md` — narrative history (large; read the tail)
3. `workspace/IMPROVEMENT_BACKLOG.json` — the Q-### work queue
4. `AGENTS.md` — project map, stack, phase history, standing notes
5. `git log --oneline -15 && git status`

Then **stop and scope one work package** before editing anything (`/sprint`).

Do NOT re-explore the codebase from scratch. The files above are the map. If
the map is wrong, repairing the map IS the session — that is real work, not
overhead.

### Do not hardcode a worktree path
`workspace/AGENT_BOOT.md` names a canonical worktree that has since gone stale.
Use whatever tree you are invoked in; verify with `git status` and `git log`.

---

## SOURCE OF TRUTH — one file per job, no duplicates

This repo has been burned by parallel record-keeping. Every artifact below has
exactly one home. **Do not create a second one.**

| Concern | Canonical file | Notes |
|---|---|---|
| Session/wave state | `workspace/SESSION_STATE.json` | keyed by wave, append a new key per wave |
| Session narrative / handoff | `workspace/MEMORY_LOG.md` | append-only |
| Prioritised work queue | `workspace/IMPROVEMENT_BACKLOG.json` | `Q-###`, schema in `workspace/BACKLOG_SCHEMA.json` |
| Known unfixed dangers | `reviews/findings-ledger.csv` | this IS the risk register |
| Measured performance floors | `reviews/invariants-baseline.md` | frozen; regressions need written approval |
| Architecture decisions | `reviews/` (dated docs) + `DECISIONS` notes in `SESSION_STATE.json` | |
| Research trial count | `.quantlab/TRIAL_REGISTRY.jsonl` | **the one new artifact**; see `.quantlab/README.md` |
| Recorded vendor licence findings | `reviews/vendor-licence-register.json` | **not** the findings ledger — that holds unfixed *dangers*, this holds *findings* about what we reach out to. A vendor with no licence appears in both. Guarded by `__tests__/architecture/vendor-licence-register.test.ts` |
| Deploy/ops runbook | `workspace/VERCEL_OPERATIONS.md` | |

**Legacy, do not write to:** `.ai/`, `.quantan/memory/`, `coordination/`.
They are historical. Read if curious; never update.

### Two different things are called "invariants"
- **I1–I8 below** are *design* invariants (data integrity, provenance, PIT).
- **`reviews/invariants-baseline.md`** holds *measured* floors (canonical
  benchmark WR, test counts, LOC drift). Frozen; regressions need C1+C2 sign-off.

Never conflate them in a report. Say "design invariant I4" or "baseline floor".

---

## DESIGN INVARIANTS I1–I8

**Audited 2026-08-17 (`Q-079`).** Every tier below rests on `file:line` evidence
recorded in `reviews/design-invariant-audit-2026-08-17/`, for the compliant
findings as much as the violations. **Six tiers were wrong and are corrected
here; two were confirmed.** `Q-098` has since closed I3 from VIOLATED to
PARTIAL — the first invariant this project has moved in the good direction with
the failing artifact exhibited. I1–I8 remain the TARGET state — the tier measures
how far the repo is from it, and is not a description of what the repo does.

> **A PR must not regress an invariant. Closing an existing gap is backlog
> work, not a merge blocker.** A constitution the codebase massively violates
> gets learned-ignored, and then all of it is decoration.

**No invariant is currently ENFORCED.** I7 was the only one that claimed to be,
and the audit found the opposite. Read every tier below as a measurement, not a
reassurance.

### What the tiers mean — load-bearing definitions, not labels

| Tier | Meaning |
|---|---|
| **ENFORCED** | A named executing artifact **fails** when the invariant is violated, and someone has **watched it fail**. Reading the code and concluding it looks right does not qualify. |
| **PARTIAL** | A mechanism exists on some paths; the gaps are named as `file:line`. |
| **ASPIRATIONAL** | Target state. No mechanism. Known non-compliance. |
| **VIOLATED** | A live path actively does the opposite, **or** the invariant asserts a control the project **relies on** and that control has no executing instance. |
| **UNVERIFIED** | Cannot be determined from the repo. A valid outcome — prefer it to a guess. |

**A tier may only be raised by exhibiting the artifact that fails.** Q-088 and
Q-079 each found a guard that was green and inert; "the guard exists" is the
claim that has now failed twice. If you find a tier below is wrong, fix the
tier — that is a valid, valuable commit — but bring the evidence.

**ASPIRATIONAL vs VIOLATED turns on reliance, not on absence.** I4 and I6 are
ASPIRATIONAL because the capability was never built and the document says so —
nobody acts as if we have it. I3, I5, I7 and I8 are VIOLATED because each asserts
a control the project *relies on* — a containment guard, a skill bar, CI, a
licence check — that has no executing instance. The earlier phrasing ("names a
gate that does not exist") was unfalsifiable: it catches every non-ENFORCED
invariant, and perversely rated I3 worse than I6. Resist the pull toward
PARTIAL as the diplomatic answer: PARTIAL requires a mechanism on **some** paths,
and zero is not some. Where an invariant has separable halves at different tiers,
the heading takes the **worse** one and the body states the split (see I8).

### I1 — Provenance or it doesn't ship · ASPIRATIONAL *(was PARTIAL; corrected 2026-08-17)*
Every number rendered in the UI or fed to a model should carry
`(vendor, vendor_timestamp, ingest_timestamp, transform_chain_hash, quality_flag)`.
If provenance is missing, the value renders as `—` with a reason, never as a number.
*Today:* the full 5-tuple does not exist, and what does exist is **built and
inert**. `lib/data/mergeQuotes.ts` declares `QuoteProvenance` at `:18-28` and
constructs it per field at `:105` and `:167`; grepping `.provenance` across
`components/ app/ hooks/` returns **zero consumers** — the only hits are
comments. `app/api/options/[ticker]/route.ts:82-86` emits
`dataProvenance {delayedMinutes:15, realtime:false}` with a comment promising a
DELAYED badge that no component renders. **Not PARTIAL: PARTIAL requires a
mechanism on some paths, and the consumer count is zero, not few.** Numbers
render today with no provenance and no `—`. → `Q-101`.

### I2 — Fail closed, never fail silent · PARTIAL *(VIOLATED 2026-08-17; cache clause closed by `Q-101` 2026-08-21)*
Stale data displays as STALE with age. Missing data displays as MISSING.
Never forward-fill into a live quote. Never substitute a cached value for a
live one without a visible flag. A broken feed must degrade the UI, not
invisibly poison it.
*Today:* the two halves sit at different tiers, so the heading takes the worse.
**Staleness · PARTIAL, and this half is why I2 is no better than PARTIAL:**
`components/DataFreshnessIndicator.tsx` correctly renders `Stale — refresh` with
age, but is mounted on **2 of 16 pages** (`app/desk/page.tsx:163`,
`app/sector/[slug]/page.tsx:352`). The audit's declared blind spot also stands:
`hooks/` SWR `keepPreviousData` is unchecked and is the most likely remaining I2
violation. → `Q-101`.

**Cache substitution · CLOSED by `Q-101` (2026-08-21), REOPENED and closed again
by `Q110-P2` (2026-09-05) — and the reason is the most important sentence in this
section.** `_cached` was set by three routes and read by **nobody** — the
substitution happened and the flag died in the JSON, which is what made this half
VIOLATED. Those three now have a consumer that shows it: both chart pages set
`chartCached` from the payload, and `components/crypto/BtcQuantLab.tsx` marks the
metrics card and the liquidations panel. **`cached` outranks every freshness
state including "Live"** — a cached value with a recent timestamp would otherwise
render green and pulsing, telling the user it is live, which is worse than
showing nothing; the test asserts branch ORDERING, not mere presence. It also
**strips comments**, because the first version matched `_cached` in the
explanatory comments the consuming pages carry, so deleting the actual read left
it green. That was caught by mutation, not by reading.

*The previous text said "all three" and was wrong about the denominator, not the
numerator.* `__tests__/architecture/cache-flag-consumed.test.ts` asserted the
property **per producer** — correctly — over a producer set defined as
`files.filter(f => /_cached:\s*true/)`, i.e. **"routes that already set the
flag"**. A route that serves a stored copy and does not set it was therefore not
a producer, so **the exact violation the guard exists to catch was the one input
it could not see.** Measured 2026-09-05: **six** routes serve a stored value;
three set the flag; three did not — `app/api/ma-deviation` (5-minute TTL),
`app/api/backtest` (**one hour**) and `app/api/backtest/live` (60 seconds) — and
the suite was green throughout. The paragraph that boasted about the per-producer
loop was published while three routes served stored copies silently.

**This is the guard-reachability defect in its sixth shape, and the first time it
appeared as a set defined by the property under test.** The earlier five were a
scan that never visited a directory, an extension, a top-level tree, a positive
control that exercised the decider rather than the visitor, and a guard that
could not fail. Add this one to the list: **when a guard is green, ask what it
VISITED before you ask what it decided — and ask how the thing it visits was
CHOSEN.** A filter written in terms of the answer cannot find a counterexample.

`__tests__/architecture/cacheSubstitution.ts` now detects the substitution
structurally — a module-level mutable store that is written and then referenced
inside a `NextResponse.json(...)` argument, directly, through a spread, or
through a local bound to it. All three forms occur here and **two were missed by
the detector's first draft**, which read the spread's trailing dot as a member
access; the three compliant routes are asserted as **positive controls** for
exactly that reason. Watched it fail on the committed tree: it named all three
silent routes, and reintroducing the spread bug fails four tests. The three
routes now emit `_cached` **and `_cachedAt`**, because at a one-hour TTL a boolean
says "a cache was involved" where the user needs "how old". Named residuals, each
a passing test: a store read through an expression the alias rule does not model,
a store served from the second argument onward, and a cache that lives in a
shared `lib/` helper rather than the route module.

### I3 — No synthetic data crosses the boundary · PARTIAL *(VIOLATED 2026-08-17; closed to PARTIAL by `Q-098` 2026-08-18)*
Mock/fixture/synthetic data is permitted only in `__tests__/` and `tests/` and
must be tagged `__SYNTHETIC__` at the type level. Any code path that could
route synthetic data into a backtest, a chart, or a signal is a P0 defect.
Add a runtime assertion, not just a comment.
*Today:* the guard is a **property check with named gaps**, and both halves of
I3's demand now have executing instances.
`__tests__/architecture/syntheticContainment.ts` decides a module is synthetic
because it lives in a fixture directory, because it **resolves the brand
constructor through the import graph** (any alias, any number of re-export hops),
or because it constructs the marker shape directly.

*Three drafts of that sentence were false, which is the lesson worth keeping.*
The first matched the annotation text `: Synthetic<` — defeated by letting
TypeScript infer the return type. The second matched `markSynthetic(` — defeated
by `import { markSynthetic as mk }`, by a second-hop re-export, and by
`const f = markSynthetic`. **Replacing one source-text match with another is not
a property; only resolution is.** The third problem was deeper: `Synthetic<T>`
was a plain **structural** interface, so `{ __SYNTHETIC__: true, value }`
satisfied it with *no cast at all* — meaning `markSynthetic()` was never the only
constructor and `brand-cast` never had to fire. `lib/synthetic.ts` now carries an
unnameable `unique symbol`, which makes the forgery a type error. It is a pure function of a
virtual file set, which makes all seven Q-079 mutations **executable test cases**
rather than a claim in a review document
(`__tests__/architecture/synthetic-containment.test.ts`). Two rules were added
for the escapes an import check structurally cannot see: `opaque-specifier`
(a non-literal dynamic specifier, mutation M-D) and `inline-fabrication`
(`Math.random()` in a live data path, M-E). The two-step launder — import a
branded binding, then re-export it bare — is caught as `synthetic-reexport`, and
that rule applies to allowlisted files too: the allowlist grants import
permission, never permission to launder.
`assertNotSynthetic` now has **two production call sites** —
`components/KLineChart.tsx:204` (chart) and `lib/backtest/core.ts:225`
(backtest) — so I3's "runtime assertion, not just a comment" clause has an
executing instance on the two boundaries the invariant names. `Q-096` removed the
`darkPoolMarkers`/`newsMarkers` props and their drawing code outright, which
turns mutation M-F2 from a detection problem into a type error.

**Watched it fail, on the real tree, 2026-08-18** — across three rounds, because
neither of the first two was enough. M-B (a synthetic module named `demoPrices`, not
`mockData`) and M-E (fabricated OHLC in the live chart route) failed the suite as
designed. **Adversarial review then found three further escapes that were green**,
each verified by mutating the real tree: a `__tests__` fixture import (the
fixture-directory rule had *zero reachable instances*, because the scan never
included those directories, so the edge resolved to `null` and was silently
skipped); a producer with an inferred return type; and a derived export
(`export const X = generateDarkPoolPrints(…)`) laundering data out of an
*allowlisted* page. A second review then broke the fixes again: aliased and
second-hop constructor imports, the structural forgery above, namespace and
default-export laundering out of an *allowlisted* file, and a re-export bridge in
`src/` — because production was an **allowlist of directories**, the same defect
as an allowlist of module names, one level up. Everything not a fixture is now
production, and the scan enumerates nothing.

A third pass broke it again: leak matching was **line-bounded**, so
`export const X = { rows: gen(…) }` escaped simply by being reformatted across
three lines; and the **extension set was an allowlist**, so `.json` — which
`lib/backtest/dataLoader.ts` loads the entire price universe from — was neither
an offender nor a resolvable target, and its edges were silently dropped.

All are closed or named, each with a regression test, and each re-mutated against
the committed tree: fails on mutation, 64/64 green on revert.

**The recurring defect across all three rounds was never a wrong rule — it was a
rule that was correct and unreachable.** Three times the scan simply never
visited the thing the rule governed (a fixture directory, a top-level directory,
a file extension), so the suite stayed green with the rule at zero instances.
**When a guard is green, ask what it visited before you ask what it decided.**

*Two false claims in this document's own supporting code were struck in the
process* — that `markSynthetic()` made every other cast a `brand-cast` violation,
and a cross-reference to a residual that the referenced block did not contain.
Both are the sin the package exists to remove, committed while removing it.

The runtime assertion moved for the same reason. Its first two call sites —
`KLineChart` and `backtestInstrument` — sit behind parameters typed `Candle[]`
and `OhlcvRow[]`, and `Synthetic<T>` is deliberately not assignable to `T`, so
**tsc made them unfirable**: `assert(true, …)` one remove out. The firable
instance is at the `r.json()` parse boundary in both chart fetches, where the
type system has stopped protecting us; a test proves the marker survives a JSON
round-trip. The typed sites are kept as belt-and-braces and are explicitly not
claimed to fire.

*Why PARTIAL and not ENFORCED:* the gaps are named and **executable**. The
"what this guard CANNOT do" block asserts each one as a passing test, so a green
run cannot be read as a proof: an **unbranded** fabricator (invented rows with no
`markSynthetic` and no `Math.random`); a synthetic value returned from deep
inside an exported function body; alias chains of three or more links; a cast
laundered through an `any`-typed intermediate; the unguarded non-chart
`r.json()` sites; and the **backstop scope** — the runtime assertion covers
exactly four sites, none of them in `lib/quant`, `lib/data` or `app/api`. I3 claims
*any* such path is a P0 defect; the mechanism covers many paths, not all. The
runtime assertions and the structural removal are the second and third layers
precisely because the first is not a proof. → `Q-089` (product decision on the
remaining synthetic prints surface).

### I4 — Point-in-time or it's a lie · ASPIRATIONAL *(confirmed 2026-08-17)*
No backtest may consume data that did not exist, in that exact form, at the
simulated timestamp. Covers restated fundamentals, index membership, analyst
estimates, ratings, corporate actions, and our own reference data.
*Today:* there is **no bitemporal store**, and the price path uses
`yahoo-finance2` split-adjusted closes (see `AGENTS.md` Phase 10).
`scripts/fetchBacktestData.mjs:116-122` rewrites the entire history **in place**
every Sunday via `refresh-data.yml` and pushes it to `main`, so both benchmark
floors are non-reproducible and a vendor restatement would present as signal
drift. The universe is a **rolling present-day survivor list** (`:12-68`
hardcoded names, `:71` `PERIOD_DAYS = 1825` re-anchored to `Date.now()`), giving
a ~2021-2026 window — not a fixed historical one.
*Correction to the previous text:* the "20d purge / 5-bar embargo" claim was
wrong in both directions. The real OOS research path
(`lib/optimize/gridSearch.ts:347`) **does** apply embargo 5 and is tested.
`lib/backtest/walkForward.ts:158-160` has **embargo 0** against 60-day holds, but
every *invocation* is in `__tests__/` (15 across three suites);
`lib/backtest/engine.ts:239-240` re-exports it and nothing in `app/` or
`scripts/` calls it — so that defect is **latent, not live**. Do not cite `lib/backtest/gridSearch.ts`; it does not exist.
*Affirmative negative, established by search:* fundamentals reach **no** backtest
or signal path — they are UI-only (`app/api/fundamentals/[ticker]/route.ts:68`,
`lib/briefs/sectorBrief.ts:214`). `Q-080` should install a tripwire there, not a
migration. → `Q-080`, `Q-102`.

### I5 — Every claim of skill must survive the adversary · PARTIAL *(VIOLATED 2026-08-17; PBO built and the gate given teeth by `Q-085` 2026-08-22)*
No strategy, factor, or model reaches the UI or the docs without out-of-sample
results, Deflated Sharpe Ratio, Probability of Backtest Overfitting, and an
entry in `.quantlab/TRIAL_REGISTRY.jsonl` recording how many configurations
were tried. Report the deflated number as the headline, never the raw one.

*Today:* **I5 is a gate with no gate** — no enforcing `file:line` can be named.
The only executing performance gate is `scripts/benchmark-signals.ts:325-331`
(`process.exit(1)` on **raw** edge < 1.81pp) via `ci.yml:73`, and `ci.yml:82-96`
reads only `aggregateNetWinRate`/`aggregateWinRate`, never `tradeStats`. I5 says
report the deflated number; CI enforces the raw one. It passes identically if
DSR is null, the registry is deleted, and no OOS run ever happened.

Sub-tiers, which are not level:
- **OOS · PARTIAL** — purged walk-forward exists and is unit-tested, and
  pre-registered rules really did reject candidates, but no CI job runs any OOS
  script and the number CI gates is full-sample.
- **DSR · PARTIAL** — implemented correctly (`lib/quant/deflatedSharpe.ts`,
  Bailey & López de Prado), computed on exactly one path, **read by nothing**.
- **PBO/CSCV · PARTIAL** *(was ASPIRATIONAL — `Q-085` built it)* —
  `lib/quant/pbo.ts` implements CSCV (Bailey, Borwein, López de Prado & Zhu 2017)
  and `npm run pbo` is its producer. **Measured PBO = 0.67**, i.e. *above* the
  no-skill null: selecting the in-sample best configuration is no better than
  chance. Coarse — 6 splits, because `simpleBacktestSlice` needs ≥252 rows per
  block and the window holds ~5 years — so read it as a direction, not a decimal.
- **Trial registry · PARTIAL** — `lib/quant/trialRegistry.ts` is the reader
  `Q-081` added, and the benchmark hard-fails when the registry contributes zero
  rows. Still no automatic writer; rows are appended by hand.

**Because PBO does not exist, no strategy has ever met I5's bar — including the
one shipped result.** `Q-081`/`Q-099` (2026-08-21) corrected the headline and
`quant-validator` then **REJECTED the claim of skill outright.** The correction
took three passes, each one flattering:

| Headline | `T` used | value | why it was wrong |
|---|---|---|---|
| pre-`Q-081` | 3,394 *overlapping* trades | **1.0000** | saturated; provably unmoved by `nTrials` from 10 to 10¹² |
| `Q-081` first pass | 345 non-overlapping | **0.4858** | removed only *within-instrument* overlap |
| **current** | **n_eff = 114** | **0.0723** | discounts cross-sectional clustering (Kish DEFF) |

De-overlapping was not enough: 56 names, many in the same sector, trading the
same window, are correlated on the same dates, so trades sharing a calendar block
are **one bet placed many times**. `lib/quant/effectiveSampleSize.ts` applies
`DEFF = 1 + (m̄−1)·ρ`.

**But DSR was never the number that mattered.** It tests `SR > 0`, which a
long-only strategy on a present-day survivor list in a bull window clears by
construction — a straw-man null. The honest test differences each trade against
an **equal-weight hold of the same 56 names over the same window**, so
survivorship cancels in the difference:

> **excess ≈ +0.11% per trade, t ≈ 0.17, against the |t| > 3.0 bar of Harvey,
> Liu & Zhu (2016), "…and the Cross-Section of Expected Returns", RFS 29(1).**
> The selection is **not statistically distinguishable from holding the
> universe.**

**Permitted wording, and it is narrow.** You may say: *"On a 56-name present-day
survivor list over 2021–2026, BUY labels returned more per 20 days than
unconditional exposure, but the excess is not statistically distinguishable from
zero. Deflated Sharpe is 0.10–0.49 depending on how the effective sample is
counted; PBO is not computed. No claim of skill is supported."*

**Scope of the ban, stated precisely so it is enforceable.** It governs
**user-visible claims and prose** — UI copy, docs, reports, chat answers. You may
not present the strategy as having skill, edge, alpha or outperformance, and may
not quote a DSR without the `n_eff` it was computed on. It does **not** rename
internal measurements: `edgeOverBaseRatePp` and `FLOOR_EDGE_PP` are quantities,
and renaming them would churn a CI gate without changing a claim.

**The ban WAS violated on landing, and `Q-103` closed it — this paragraph is
corrected 2026-09-05 because it still claimed a live violation that no longer
exists.** Four user-visible labels called an indistinguishable-from-zero excess
"Alpha" (`KeyMetricsStrip.tsx`, `WalkForwardPanel.tsx`, `InstrumentTable.tsx`,
`AnalysisTab.tsx`). All four are gone: the only surviving occurrences of the word
are two comments that say *not* "Alpha" and explain why
(`KeyMetricsStrip.tsx:64`, `InstrumentTable.tsx:67`), and
`__tests__/architecture/skill-wording.test.ts` is the executing guard — 12 tests,
green, scanning rendered phrases rather than raw source so an interpolated label
cannot hide.

*Naming a statistic after the conclusion you hoped for is still exactly the
calibration failure I5 exists to catch* — the rule stands, the instance is
closed. **A constitution that reports a fixed violation as live is the same
defect as one that reports a live violation as fixed:** it teaches the reader
that its tier claims are not to be trusted, and then all of it is decoration.

**`Q-084` is resolved, and the answer was in the code all along.** `T-0001`
recorded `declared_grid: 1024` against `reported: 16` and flagged itself
UNRESOLVED. `LOOP1_GRID` declares 4×4×4×4×4 = 1024, but
`lib/optimize/gridSearch.ts:70-83` iterates **only** `slopeThreshold` ×
`atrStopMultiplier` = **16**, holding three legacy fields fixed because
`simpleBacktestSlice` never reads them — its own comment calls this an "honesty
fix". So 16 is right and 1024 counts three inert dimensions.

**That correction moves the headline in the FLATTERING direction, which is
exactly when to be most careful.** The trial denominator drops from an upper
bound of 1053 to a known **46**, and DSR rises **0.0723 → 0.3439**. It is applied
because it is correct, not because it helps: deflating against multiplicity that
was never incurred is as wrong as ignoring multiplicity that was. **The verdict
is unchanged** — 0.34 is nowhere near a conventional bar, PBO is above the
no-skill null, and the deciding test remains the excess over the market at
t ≈ 0.17.

**The gate does not gate on DSR, deliberately.** The first version floored it at
0.43 and `quant-validator` showed that **punished compliance**: DSR falls
monotonically in `nTrials`, so roughly 700 further logged configurations — fewer
than the single `T-0001` grid already on file — would have breached the floor,
making "stop logging trials" the only way to keep CI green. That is the exact
behaviour I5 exists to compel. A DSR near 0.5 is also at the steepest point of Φ,
so drift alone moves it across any nearby threshold. **Floor a Sharpe or a z;
never a probability near 0.5.** The gate now floors the non-overlapping Sharpe
(invariant to `nTrials`) as a breakage guard, hard-fails when the deflated number
is missing, when the trial denominator was not counted, **or when no PBO is on
file**, and prints the verdict above on every run.

*Why PARTIAL and not better:* the gate enforces that the statistics EXIST and
reports them; it does not block on their VALUES, and nothing gates the UI path at
all. No CI job runs an OOS script. PBO is computed by a separate producer and
read with its vintage, so it can go stale. Those are the named gaps.

The previous claim that this is "the strongest area of the platform" is
withdrawn. The good layer exists; the published headlines do not come from it.

### I6 — Securities identified by permanent ID, never ticker · PARTIAL *(ASPIRATIONAL 2026-08-17; identity made consistent by `Q-080` 2026-08-22)*
Tickers are recycled and reassigned. Use FIGI/PermID/internal surrogate keys
with a ticker→ID mapping table that is itself bitemporal.
*Today:* identity is now consistent, but it is still not PERMANENT.

**Closed by `Q-080`.** Identity was a lossy mangle whose two halves were not
inverses: `dataLoader.ts` mapped `.`→`-` one way and `-`→`.` the other, so the
universe declared `BRK-B`, the fixture was `BRK-B.json`, and `availableTickers()`
reported `BRK.B` — one security with two identities depending on the path taken.
The reverse mangle was unconditional, so a genuine pair like `BTC-USD` came back
as `BTC.USD`, which is not a security; `lib/optimize/sectorProfiles.ts` carried
its own `.replace('-', '.')` workaround that replaced only the FIRST hyphen.
`lib/data/securityId.ts` is now the SSOT: a trailing single letter is a share
class and is canonicalised, anything else is left alone, and the round trip is
tested against every fixture on disk. `assertNoIdCollisions` guards the
assumption by failing when one id carries conflicting attributes.

**Also closed:** the audit's note that `verify-data-integrity.mjs` "cannot detect
a clean ticker handover". `scripts/lib/handoverDetect.mjs` flags moves outside
the series' own distribution, and it is WIRED into that verifier — it currently
warns on NFLX 2022-04-20 (0.65×) and UNH 2025-04-17 (0.78×), both real crashes,
which is the point: it asks for an explanation rather than asserting a cause.

*Why PARTIAL and not better — these are the gaps, not a hedge:*
- **No permanent identifier.** There is still no FIGI, PermID, ISIN or CUSIP; the
  key is an internal surrogate derived FROM the ticker, so a reassignment
  produces the same id for a different issuer. Detection is a compensating
  control, not a solution.
- **No bitemporal mapping table.** I6 asks for one and there is none.
- ~~**The API layer did not use the SSOT at all.**~~ Closed by `Q110-P1`
  (2026-09-05). `Q-080` made identity consistent in `lib/`, and **zero routes
  under `app/api/` imported `lib/data/securityId.ts`** — so I6 held everywhere
  except the layer the public calls. Measured: `?tickers=BRK-B` returned
  `instruments: []` with a 200 while `?tickers=BRK.B` returned the row.
  `/api/backtest` and `/api/backtest/live` now canonicalise through the SSOT,
  and an unmatched filter token is named in `unmatchedTickers` rather than
  vanishing into an empty list — I2's "missing displays as MISSING" clause on
  the same call. Exercised through the real route handler, not a
  re-implementation.
- `lib/data/warehouse.ts:46-55` is still `PRIMARY KEY (ticker, date)`.
- The handover detector WARNS and cannot distinguish a handover from a split or
  a halt. → `Q-080`.

### I7 — Main is always deployable · VIOLATED *(was ENFORCED; corrected 2026-08-17)*
Work on branches. CI must be green before merge. Never push a broken `main`.
Never leave the repo mid-refactor at session end. Merging the PR **is** the
deploy — `main` auto-deploys to production.
*Today:* **nothing enforces any of that.** `main` reports `protected: false`,
`required_status_checks.contexts: []`, `enforcement_level: off`, and `rulesets`
is empty. **The required-check set is EMPTY**, so every green check mark in this
repo's history has been advisory. Evidenced, not hypothetical: PR #120 merged
**49 seconds after** its `coverage` job reported failure, and `e49b1d1` shipped
to production with a red `test` job via merge skew.
`refresh-data.yml:137` (`git push origin HEAD:main`) lands bot commits weekly
with **zero** typecheck/test/coverage/smoke, each auto-deploying to production.
The Vercel build — the only gate that catches Next.js route-config errors — is
not required either, so a failed build merges, prod silently keeps serving the
old deployment, and nothing alarms. No rollback script or procedure exists;
`VERCEL_OPERATIONS.md:351` forbids `vercel rollback` without owner request.
The repo is **public**, so branch protection is free: unconfigured, not
unavailable. → `Q-097` (owner action — repo settings).
*Related:* "WHAT DONE MEANS" below requires **lint clean** and **no lint
exists** — no `lint` script, no tracked config, not installed, zero workflow
hits. The definition of done names a gate that cannot run. → `Q-093`.

### I8 — Vendor terms are law · VIOLATED *(process half VIOLATED → PARTIAL by `Q-100` 2026-08-27; heading unchanged, and the reason matters)*
Market data licences almost universally prohibit redistribution. Before any
feature exposes vendor data to end users, confirm the licence permits it and
record the finding. This is a business-ending risk, not a detail.
*Today:* the invariant has two separable halves at different tiers, and neither
half is the heading. Do not read the UNVERIFIED half as covering the whole
invariant — that reading is what kept this at UNVERIFIED for a year while the
process failure ran live.
- **(a) The substantive licence question · UNVERIFIED.** No licence, account or
  agreement is visible in the repo for any vendor. This is a legal question about
  off-repo documents and **no agent can close it** — it needs the owner and
  external counsel. `Q-082`, `Q-083`.
- **(b) The process requirement · PARTIAL** *(was VIOLATED — `Q-100` built the
  mechanism)*. "Confirm the licence permits it **and record the finding**" now has
  an executing instance. `reviews/vendor-licence-register.json` holds **69
  recorded findings** and `__tests__/architecture/vendor-licence-register.test.ts`
  fails when this repo reaches a host, adds a dependency (npm **or** pip), reads a
  host-bearing environment variable, or **republishes vendor data**, with no row.
  **Watched it fail on the committed tree, ten mutations, green on revert.**
  `.github/PULL_REQUEST_TEMPLATE.md` is the advisory half and says so.
  *The gaps, named because PARTIAL requires naming rather than gesturing:*
  **exposure without new egress** — rendering an already-fetched vendor field on a
  new surface reaches no host, adds no dependency and reads no variable, so nothing
  fires; the `published-data` kind covers `git add` + `git push` in a workflow
  (`.github/workflows/refresh-data.yml:135`) and **not** a human committing data by
  hand. **Non-manifest dependencies** — `package.json` and `requirements*.txt` are
  read; anything vendored, installed ad hoc, or pulled transitively is invisible.
  **A host built by concatenation**, and **a variable that supplies a host without
  being named like one**. Each is asserted as a passing test, so a green run is
  never a proof.

**Why the heading stays VIOLATED, and it is not the worse-of-the-two rule.**
Recording a finding is not confirming a licence. I8's operative word is
*before* — six vendors are exposed to end users **right now** with no confirmation
of any kind, which is the VIOLATED definition's **first** clause, "a live path
actively does the opposite". That clause holds independently of whether a
recording mechanism exists. The register makes the exposure visible; it does not
undo it. **The heading moves when the exposure is licensed or withdrawn, and not
before** — recording is the cheap half and taking credit for it would be exactly
the calibration failure the PRIME DIRECTIVE exists to prevent.

**`Q-100` found a vendor nobody had recorded, and it was invisible by
construction.** `lib/data/bloomberg/bridgeClient.ts` is a **live, wired Bloomberg
path** with **no URL literal and no vendor package** — the host arrives entirely
through `BLOOMBERG_BRIDGE_URL`. `app/api/prices/route.ts:118-176` calls it, merges
the result through `mergeYahooAndBloomberg`, and returns quotes tagged
`dataSource:'bloomberg'` from a **public, unauthenticated** route. It is latent
only because `.env.example:67` leaves the variable commented out — one environment
variable from live. `scripts/bloomberg-bridge-example.py:19` carries the warning
in its own docstring: comply with the Bloomberg Terminal Agreement and any Data
Licence, and do not expose the service publicly without Bloomberg approval. We
hold no such approval and had recorded none. Logged as **`Q100-1`** —
*not* `F8.1`, which an earlier draft of this paragraph cited and which is an
unrelated testing row already `RESOLVED-STALE`. A CRITICAL finding that the
constitution's own pointer sends you away from is not recorded; caught in review.

**The audit's "11 vendors" is not disputed — the SHAPE of the enumeration is.**
A count of names cannot be checked and cannot be maintained; the register counts
**four kinds of egress evidence**, and the two obvious kinds miss the two biggest
vendors. A URL scan misses **Yahoo** (21 modules, zero host literals), and both a
URL scan and a package scan miss **Bloomberg**. Two vendors the audit did not name
— Bloomberg and DeepSeek — were invisible to name-based enumeration for exactly
that reason. **Ask what EVIDENCE the thing you are hunting leaves in source, then
check that a detector matches each form of it.** This is the fourth package in
which reachability, not the rule, was the defect.

**Review round 2 falsified this package's own headline.** The first version claimed
every vendor now had a finding. It did not: `requirements.txt:13,16,17` declares
`tradingagents`, `yfinance` and `akshare` — `yfinance` being the TradingAgents
sidecar's **default** vendor (`server_trading_agents.py:190`) — and the register
read `package.json` only. *One manifest is not every manifest*, and the file even
carried a test named "catches a vendor client added to devDependencies" while a
second manifest went unvisited.

**And the largest redistribution in this project reaches no host at all.**
`scripts/backtestData/` is **57 tracked files, 13 MB** of Yahoo-derived daily OHLCV
in a repository that is **PUBLIC**, and `.github/workflows/refresh-data.yml:135-137`
stages and pushes a refreshed bulk copy to `main` **every week from a bot**, with
every prior vintage retained in git objects permanently. Bulk historical
redistribution is the use market-data licences prohibit most explicitly. **The
mechanism detects EGRESS; I8 governs EXPOSURE**, and the difference between those
two sets is exactly this row. Logged as `Q100-12`.

**Round 3 (red-team) broke it seven ways, and the worst was a pre-processor.**
The walker was reachable; `stripComments` applied JS syntax to `.py` and `.yml`,
where a YAML glob forms a valid block comment — **2387 characters, lines 2 to 51
of a real workflow, were deleted before any host was matched.** A host at line 41
was invisible while the same host at line 61 was caught, and the "CANNOT do" test
documenting this exercised only the safe half and asserted the opposite of the
measured behaviour. **A passing test that ratifies a bug is worse than no test.**
Comments are masked per language now, which also fixed `file:line` — 18 of 46
citations had pointed at unrelated code, in the artifact whose purpose is an
auditable trail. `public/` was excluded while being the one directory served
verbatim to end users. And **two live market-data vendors were unregistered** —
`wss://ws.kraken.com` and `wss://ws-feed.exchange.coinbase.com`, browser-direct
from `'use client'` hooks — because the matcher was anchored to `https?://` and
never saw a streaming feed.

**A live credential is committed to this public repository.** `start-universal.sh:12`
holds an API token, tracked since PR #41 (2026-06-02). **Revoke and rotate — removal
does not remediate, the value is in git history permanently.** Owner action, logged
as `Q100-12`. Found only because this package widened the walk to `.sh`.

**Nine** third-party vendors are end-user-exposed with **no auth**, across
**17 exposure points** — Yahoo (three ways: `yahoo-finance2` on 14 routes,
`yfinance` in the Python sidecar, and the bulk republished `scripts/backtestData/`),
CoinGecko, Kraken (REST **and** `wss://`), Coinbase (REST **and** `wss://`), Bybit,
OKX, AKShare, FRED, and Bloomberg if `BLOOMBERG_BRIDGE_URL` is ever set.
`middleware.ts:119` matches all paths but its body (`:51-116`) only does CSP +
CSRF, so ~19 public routes serve vendor data to anyone.

*This paragraph said "six" until the register was queried, and the register is
the reason the number moved.* Do not maintain a count here — **the register is the
count**, and it is derivable: rows with `end_user_exposed` true and `lifecycle`
active. A hand-written total in prose is the artifact that goes stale silently,
which is the whole argument for keeping the enumeration in a guarded file.

*Corrections to the previous text, both of which were this document's own:*
"the position has never been written down" was **false** — the *risk* was recorded
in Phase 14 (`reviews/findings-ledger.csv` row F4.5, still `open`;
`reviews/R7-security-compliance.md:213`); a licence *confirmation* never was.
And the claim that the compliance banner's "three required elements do not exist"
was **wrong in both directions**: `components/ComplianceBanner.tsx` is real and
mounted globally at `app/layout.tsx:100` and does say "Not investment advice",
while the three elements of a vendor-*terms* banner — a research-only restriction
on data USE, a link to the terms (zero `href`s in the component), and a
`YAHOO_RESEARCH_ONLY` flag (zero occurrences repo-wide) — genuinely do not exist.
A no-advice disclaimer is not a vendor-terms banner. `reviews/PHASE-15-PLAN.md:44`
is corrected. → `Q-082`, `Q-083`, `Q-106`.
---

## RISK & VALUATION GATES

Five specialists sit between the platform and any claim about what an asset is
worth or how safe it is: `accountant`, `forensic-auditor`, `actuary`,
`underwriter`, `credit-analyst`.

They are **refusal gates, not analysts.** Each has a required-inputs manifest,
and when an input is missing the verdict is `INSUFFICIENT DATA` /
`NOT RATEABLE` / `DECLINE` — never a grade with a caveat attached. Caveats get
dropped when a figure is quoted onward; the refusal is the safety property.

This follows directly from the PRIME DIRECTIVE. Refusing to grade what we cannot
see *is* the product working.

**Know what this platform actually holds.** Annual income, balance-sheet and
cash-flow rows from yahoo-finance2, plus summary ratios. It holds **no**
footnotes, segment data, subsidiary lists, related-party disclosures, covenants,
debt schedules, credit spreads, ratings, or insurance/actuarial data. So:

- `accountant` can do real accrual, dilution and DCF-assumption work
- `forensic-auditor` defaults to `CANNOT ASSESS — STRUCTURE NOT VISIBLE`
- `actuary` defaults to `INSUFFICIENT DATA` for reserving, but its method
  (credibility, censoring, assumption governance) applies to existing problems
- `credit-analyst` defaults to `NOT RATEABLE` and may emit screens, never ratings
- `underwriter` may decline, and declining is a successful outcome

A slot in the UI that needs a value is not a reason to produce one.

**Regulatory boundary:** these agents review *the platform's own logic*. Any
output that would become user-visible as a grade or valuation routes through
`Q-083` (MAS/FAA) before shipping — that is the surface closest to the
regulated-advice line.

---

## HOUSE STYLE

- Strong typing everywhere. Runtime validation at every I/O boundary (zod).
  Parse, don't validate.
- Pure functions for anything quantitative. Side effects at the edges only.
- Determinism: same inputs + same seed → byte-identical output. Snapshot-test it.
  (Nondeterministic fixtures have flipped the mutation gate before — seed them.)
- No `any`. No silent `try/catch {}`. No magic numbers — named constants with a
  comment citing the source.
- Money uses decimal/integer-minor-units, never float. Floats are fine for
  returns and statistics.
- Every quantitative function carries a docstring citing the paper or standard
  it implements.
- Indicator SSOT is `lib/quant/indicators.ts`; `lib/quant/technicals.ts` is a
  thin delegate. Never duplicate RSI/EMA math.

## WHAT "DONE" MEANS

Tests pass · types check · ~~lint clean~~ · the adversary agent has reviewed it
and its objections are resolved or logged in `reviews/findings-ledger.csv` · the
Vercel build is green · a decision note is recorded if an architectural choice
was made · `workspace/SESSION_STATE.json` and `MEMORY_LOG.md` are updated.

**"lint clean" is struck because no lint exists** — no `lint` script in
`package.json`, no tracked config, not installed, zero workflow references
(verified 2026-08-17, `Q-079`). Do not report it as passing. Resolve in either
direction under `Q-093`; an unenforceable clause in the definition of done
manufactures false confidence.

**Tagged code ≠ fixed effect.** A commit that adds the right label but changes
no behaviour is not done. Prove the effect, then claim it.

### Verify gates
```bash
npm run typecheck && npm run test
npm run check:ci          # verify:data + smoke
npm run benchmark         # after ANY signal/backtest change; WR floor in reviews/invariants-baseline.md
```
Note: jsdom component tests are CI-only on this machine. Stryker does not run
on PRs. The a11y workflow is schedule-only AND advisory — a green check is not
zero violations; read the job log.

**These gates are advisory, all of them.** `main` has no branch protection and
the required-status-check set is empty (verified 2026-08-17, `Q-079` — see I7),
so nothing stops a red PR from merging and auto-deploying. Until `Q-097` lands,
running these locally before you push IS the gate. `npm run check:ci` does not
substitute: its `check:smoke` step probes the **live production URL**
(`scripts/smoke-production.mjs:8`), not your branch, so it can pass while your
change is broken.

---

## SESSION DISCIPLINE

1. **Orient cheaply.** Boot sequence above. Never re-derive the map.
2. **Delegate reading, not thinking.** Use `Explore` subagents for search and
   discovery so raw file contents never enter the lead context.
3. **One work package per session.** Scope is set at the start and does not
   grow. Discovered problems go to the backlog as `Q-###`, not into this session.
4. **At 70% context, stop.** Write the handoff, commit, push.
5. **Never re-run a passing suite "just to check."** Read CI instead.
6. **Anything a script can do, a script should do.** Mechanical checks belong in
   GitHub Actions, where they cost nothing from the session budget.

## MODEL POLICY

Route by *fitness for the task*:
- **Opus** — architecture, adversarial validation, statistical review, security;
  anything where being wrong is expensive. Use `ultrathink`.
- **Sonnet** — implementation, refactors, tests, docs. The default.
- **Explore/Haiku** — search, inventory, log grepping.

**Budget caveats defer to the live policy.** `workspace/SESSION_STATE.json →
model_policy_*` is authoritative on plan limits and which models are enabled;
it currently records a different constraint than a stock Pro plan. If a
budgeting rule here conflicts with that key, the key wins — and say so rather
than silently following either.

**The lever is the frontmatter, not this prose.** What a specialist actually
runs on is the `model:` field in `.claude/agents/<name>.md`. The roster is
currently routed by fitness-for-task (Opus for adversarial/architecture/
security, Sonnet for implementation), *not* by cost. To make the live model
policy govern the roster, edit those fields — no amount of guidance here
changes which model is dispatched.

---

## DEPLOY PROTOCOL

```
BRANCH: feat/<id>-<slug> | fix/<id>-<slug> | chore/<id>-<slug>
NEVER commit directly to main.

PRE-PUSH GATE (local): typecheck · test · check:ci · (benchmark if signals touched)
PUSH → Vercel preview → confirm build, smoke the affected surface, check runtime logs
MERGE → production deploy (merging IS the deploy) → watch runtime errors 10 min
ROLLBACK FIRST, diagnose second. Never debug in prod.
```

Next.js route config is **static-analysis-only** — `tsc` and `vitest` cannot
catch it. The Vercel build is the only gate that will.

## FORBIDDEN

- Claiming a strategy "works" from in-sample results.
- Adding a data source without a staleness monitor and a reconciliation check.
- Silently changing a calculation without a migration note and a regression test.
- Marketing language in code or docs ("beats the market", "guaranteed",
  "proven"). State what was measured, over what period, with what CI.
- Anything that auto-executes trades without a hard kill switch, position
  limits, and a dry-run default.
- Writing secrets inline, or editing `.env` files / secrets directories.

## REGULATORY POSTURE (Singapore / MAS)

Research tooling and regulated financial advisory are a bright line. If the
platform outputs anything a user could reasonably read as a personal
recommendation, that needs a real legal opinion on FAA/SFA licensing before
launch — especially for a retail tier. Tracked as `Q-083` (P0-legal).
