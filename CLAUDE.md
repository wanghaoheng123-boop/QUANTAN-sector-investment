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
here; two were confirmed.** I1–I8 remain the TARGET state — the tier measures
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

### I2 — Fail closed, never fail silent · VIOLATED *(was PARTIAL; corrected 2026-08-17)*
Stale data displays as STALE with age. Missing data displays as MISSING.
Never forward-fill into a live quote. Never substitute a cached value for a
live one without a visible flag. A broken feed must degrade the UI, not
invisibly poison it.
*Today:* the two halves sit at different tiers, so the heading takes the worse.
**Staleness · PARTIAL:** `components/DataFreshnessIndicator.tsx:66-71` correctly
renders `Stale — refresh` with age, but is mounted on **2 of 16 pages**
(`app/desk/page.tsx:163`, `app/sector/[slug]/page.tsx:345`).
**Cache substitution · VIOLATED:** the flag `_cached`
(`app/api/chart/[ticker]/route.ts:60`) appears at **7 sites, 3 of which set it,
with zero consumers** — so a cached value *is* substituted for a live one with no
visible flag, which is precisely what I2 names and forbids. That is a live path
doing the opposite, not merely a missing mechanism. → `Q-101`.

### I3 — No synthetic data crosses the boundary · VIOLATED *(was PARTIAL; corrected 2026-08-17)*
Mock/fixture/synthetic data is permitted only in `__tests__/` and `tests/` and
must be tagged `__SYNTHETIC__` at the type level. Any code path that could
route synthetic data into a backtest, a chart, or a signal is a P0 defect.
Add a runtime assertion, not just a comment.
*Today:* after `Q-088` no live synthetic path reaches a chart — both stock and
sector pages pass no marker props, and `components/BtcChartPanel.tsx:94-95`
passes empty constants. The wrapper brand's direction is correct and `scripts/`
**is** scanned. But **the guard is a name blocklist, not a property check**:
`__tests__/architecture/synthetic-containment.test.ts:85` matches the literal
string `mockData`, so **6 of 7 adversarial mutations escaped**, including a
one-prop restoration of the exact Q-088 chart defect. The test's own header at
`:14-17` claims it checks "a property rather than a pattern match" — that
sentence is false. `assertNotSynthetic` (`lib/synthetic.ts:87-95`) has **zero
production call sites**, so I3's "runtime assertion" clause has no executing
instance on any chart, signal, or backtest boundary. → `Q-098`.
*Provenance of the "6 of 7" figure:* it is single-sourced to this audit's
mutation run and is **not reproducible from the repo** — the mutations were
applied and reverted, leaving no executable artifact. `Q-098` converts them into
tests. Note the test file's own `:19-20` says "All five mutations are now
caught": that refers to Q-088's *different* five (M1, M2b, M4, M5, M6), not to
these seven, so the two claims do not conflict. **The tier does not rest on that
figure** — it rests on `assertNotSynthetic` having zero production call sites,
which was independently re-verified.
*Why VIOLATED and not PARTIAL:* I3 explicitly requires "a runtime assertion, not
just a comment", and that assertion exists as an exported function with no
caller. The invariant names a gate that does not exist — the same clause that
moved I5 and I8. That no live path is emitting synthetic data today is what
keeps this from being worse; it is not what would make it PARTIAL.

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

### I5 — Every claim of skill must survive the adversary · VIOLATED *(was PARTIAL; corrected 2026-08-17)*
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
- **PBO/CSCV · ASPIRATIONAL** — zero implementation. The 10 files matching
  `cscv|combinatorial|pbo` are all prose. `Q-085`.
- **Trial registry · ASPIRATIONAL** — 9 rows, all `backfilled:true`, all
  `logged_at:2026-08-15`; no writer, no reader, no validator. A static file is
  not a mechanism.

**Because PBO does not exist, no strategy has ever met I5's bar — including the
one shipped result.** The published DSR is **saturated at 1.0000**: the committed
`scripts/benchmark-results.json` carries `deflatedSharpeN10 = 1` **and**
`deflatedSharpeN100 = 1`, so a 10× change in the trial count already moves the
headline by nothing. **`Q-081` as currently scoped would change the headline from
1 to 1.** The 45/1053 arithmetic in the old text verifies exactly, but both are
lower bounds and both are the wrong lever.

**The saturation is an artifact of sample size, and the repo names the honest one
itself.** `scripts/benchmark-results.json` carries `nonOverlapStats.nTrades = 347`
whose own note reads *"the honest effective n behind the pooled WR"*, while DSR is
computed on `tradeStats.nTrades = 3410`, the overlapping count
(`lib/quant/deflatedSharpe.ts:106,117`). Because `expectedMaxSharpe` scales as
`1/√(T−1)` (`:117`), `T` and `nTrials` are coupled — and at the honest `T` the
trial count stops being inert:

| `T` | n=10 | n=45 | n=100 | n=1053 |
|---|---|---|---|---|
| 3410 (as published) | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| **347 (honest effective n)** | 0.9709 | 0.8924 | 0.8282 | **0.5848** |

**At the honest `T` the shipped result falls below any conventional bar at every
trial count the registry supports.** So `Q-081` is not merely mis-scoped: fixing
`nTrials` alone changes 1 to 1, but fixing `T` alone leaves multiplicity
uncorrected. **The fix is joint.** The real caveat is narrower than the previous
draft claimed — the distributional moments are not persisted, so the table
assumes `g3=0, g4=3`; the direction and magnitude are robust, the third decimal
is not.

The previous claim that this is "the strongest area of the platform" is
withdrawn. The good layer exists; the published headlines do not come from it.

### I6 — Securities identified by permanent ID, never ticker · ASPIRATIONAL *(confirmed 2026-08-17)*
Tickers are recycled and reassigned. Use FIGI/PermID/internal surrogate keys
with a ticker→ID mapping table that is itself bitemporal.
*Today:* total non-compliance, not partial. `lib/data/warehouse.ts:46-55` is
`PRIMARY KEY (ticker, date)`, and grepping `figi|permId|securityId|isin|cusip`
across `lib/ scripts/ app/ components/ hooks/ types/ __tests__/` returns **zero
hits**. Identity is a lossy string mangle — `lib/backtest/dataLoader.ts:37`
`.replace(/\./g,'-')`, inverted at `:143`, duplicated at
`scripts/benchmark-signals.ts:36`. `verify-data-integrity.mjs` cannot detect a
clean ticker handover: a reassignment would splice two issuers into one series.
→ `Q-080`.

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

### I8 — Vendor terms are law · VIOLATED *(was UNVERIFIED; corrected 2026-08-17)*
Market data licences almost universally prohibit redistribution. Before any
feature exposes vendor data to end users, confirm the licence permits it and
record the finding. This is a business-ending risk, not a detail.
*Today:* the invariant has two separable halves at different tiers. **The
heading takes the worse one.** Do not read the UNVERIFIED half as covering the
whole invariant — that reading is what kept this at UNVERIFIED for a year while
the process failure ran live.
- **(a) The substantive licence question · UNVERIFIED.** No licence, account or
  agreement is visible in the repo for any vendor. This is a legal question about
  off-repo documents and **no agent can close it** — it needs the owner and
  external counsel. `Q-082`, `Q-083`.
- **(b) The process requirement · VIOLATED.** "Confirm the licence permits it
  **and record the finding**" has no mechanism anywhere — no checklist, PR
  template, or CI check — and its trigger condition is live now with zero
  recorded findings. PR #147 turned the stock-page news surface from synthetic to
  **live Yahoo content** and descends from the commit that wrote I8; no licence
  finding was recorded with it.

Scope is far wider than `yahoo-finance2`: **11 vendors**, six of them
end-user-exposed with **no auth** — Yahoo (`app/api/prices/route.ts:131` + 12
sites), CoinGecko (browser-direct at `hooks/useBtcCandles.ts:34`), Kraken,
Coinbase, Bybit, OKX. `middleware.ts:119` matches all paths but its body
(`:51-116`) only does CSP + CSRF, so ~19 public routes serve vendor data to
anyone.
*Correction to the previous text:* "the position has never been written down" is
**false**. The *risk* was recorded in Phase 14 (`reviews/findings-ledger.csv`
row F4.5, still `open`; `reviews/R7-security-compliance.md:213`); a licence
*confirmation* never was. `reviews/PHASE-15-PLAN.md:44` records a compliance
banner as "present" whose three required elements — research-only text, a ToS
link, and a `YAHOO_RESEARCH_ONLY` kill flag — do not exist. → `Q-100`.

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
