# Red team — `fix/Q107-O4-check-name-collisions` (9ae4921, 83b5245, b8838aa)

Reviewed 2026-09-09 against the tree and against live GitHub API data
(`wanghaoheng123-boop/QUANTAN-sector-investment`). Every mutation below was RUN;
the tree was restored per file and `git status --porcelain` confirmed clean
(only the four pre-existing untracked dirs remain).

**Baseline on the branch, measured here:** `npm run typecheck` exit 0 ·
`npm run test` 2003 passed / 17 skipped, exit 0 · `npx vitest run
__tests__/architecture/` 304/304 · `npm run lint:workflows` → "Linting 6
workflow file(s) with actionlint 1.7.12 / actionlint: clean".

**The core fix works.** `actions/runs/34368245585/jobs` returns exactly
`nightly-benchmark` and `alert-nightly-benchmark / alert`, and
`commits/83b5245/check-runs` confirms those land on the branch head. Both real
collisions are closed. What follows attacks the guard and the prose, not the
rename.

Ranked by severity. F3 should be read first: a false sentence used to downgrade a
ledger row, falsified by the author's own dispatch.

---

## F1 · HIGH — `requirable()` asks whether the WORKFLOW has a `pull_request` trigger, never whether the JOB runs on the PR. A `paths:` filter turns all seven recommendations into permanent blockers, and the guard stays 100% green.

`__tests__/architecture/workflowCheckNames.ts:212-217` (`requirable`), with
`:109-124` (`triggers`) collecting only the two-space-indented event keys under
`on:`. A `paths:`, `paths-ignore:`, `branches:` or `branches-ignore:` sub-key
sits at four spaces and is discarded. Job-level `if:` is not modelled at all.

**Reproduction (run, green):** insert one line under `.github/workflows/ci.yml:11-12`

```yaml
  pull_request:
    branches: [main]
    paths: ['app/**']
```

`npx vitest run __tests__/architecture/` → **304/304 pass**. Probed output of the
shipped function under that mutation:

```
requirable: ['benchmark','coverage','pytest','smoke','test','typecheck','workflows']
collisions: []
```

A docs-only PR then produces **zero** ci.yml check runs. GitHub leaves a required
check that was never reported in `pending` **forever**, and the PR cannot be
merged. This repo merges docs/state-only PRs routinely (`chore(state): close
Q-080`, `chore(state): close Q-085`), and `paths-ignore: ['**.md',
'reviews/**','workspace/**']` on seven `npm ci` jobs is the single most common CI
optimisation there is.

That is foot-gun **(b)** — the one the docstring at `:205-210` and the test at
`workflow-check-names.test.ts:186-195` say this artifact exists to name. The
guard would recommend the name and never see the block.

**Not a declared gap.** `describe('Q107-O4 — what this guard CANNOT do')`
(`workflow-check-names.test.ts:214-243`) declares four things: matrix-expression
normalisation, the Vercel status, composite-naming knowledge, and no enforcement.
Trigger filters and job conditions are not among them.

**Live in-tree instance of the same modelling gap:** `ci.yml:11-12` already
carries `branches: [main]`, and `triggers()` has no representation for it.
Harmless while protection is scoped to `main` — but this repo does stacked PRs
(base = a feature branch; see the stacked-PR merge-trap lesson) and CLAUDE.md's
I7 records `rulesets: []`, i.e. the owner will be configuring from zero. Same
defect, one live instance, not a second finding.

**What the author should have done:** either model job reachability, or hard-fail
the guard when a `pull_request` trigger carries `paths`/`paths-ignore`/
`branches`/`branches-ignore`, or when a job in the requirable set carries `if:`
or `needs:`; and if it is not modelled, put it in the CANNOT-do block.

---

## F2 · HIGH — `collisions()` keys on WORKFLOW, so two jobs in one workflow sharing a name are invisible. The describe title says "job"; the code says "workflow".

`workflowCheckNames.ts:191-201` filters on
`new Set(v.map((c) => c.workflow)).size > 1`. The `describe` at
`workflow-check-names.test.ts:140` is titled **"no check-run name identifies more
than one job"**, which the implementation does not test.

**Reproduction (run, green):** append to `ci.yml`

```yaml
  test-e2e:
    name: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
```

`npx vitest run __tests__/architecture/` → **304/304 pass**;
`collisions(): []`; `requirable()` still contains `test`. GitHub emits two check
runs named `test` from a single CI run, and a required `test` resolves to
whichever the API reports last. That is foot-gun **(a)**, missed.

**Why the near-miss is worse than it looks:** the same mutation with
`name: benchmark` IS caught — but by the frozen historical-fixture assertion at
`workflow-check-names.test.ts:93`, not by the live collision check at `:141-146`.
The catch is an accident of which name you pick.

**The stated rationale does not support the code.** `:186-189` justifies
workflow-keying with "two runs of the same workflow carrying the same name are
re-runs". Re-runs are different *run ids*; keying on `(workflow, jobId)` collapses
them just as well while catching same-run duplicates. Key on job identity.

---

## F3 · HIGH (claim defect) — "the two have never co-occurred on a commit" is false. `benchmark` from ci.yml and nightly-backtest.yml co-occur on ten commits, including the current tip of `main`.

The sentence appears in three places: `workflowCheckNames.ts:15-20`, the 83b5245
commit message, and the test comment at `workflow-check-names.test.ts:188-192`.
It is used to downgrade the Q107-O4 ledger row's own example from live to latent —
i.e. it moves the record in the flattering direction.

**Evidence.** Intersect head_shas over `actions/workflows/ci.yml/runs` (150 runs,
paginated) and `.../nightly-backtest.yml/runs` (77 runs):

```
10f9017 3f81075 41bcf2c 4396ba0 834ecce 8b3d7cd 9dd300b 9fbdbf9 bece0c7 f0fda05
```

`f0fda05` is the current tip of `main`. `commits/f0fda05.../check-runs` returns
two check runs named `benchmark`:

| suite | run | workflow | event | created |
|---|---|---|---|---|
| 89678952717 | 33096354980 | **Nightly Benchmark** (`nightly-backtest.yml`) | schedule | 2026-08-27 |
| 89343933131 | 32982665852 | **CI** (`ci.yml`) | push | 2026-08-26 |

Two workflows, one commit, one name. The author sampled two commits; ten exist.

**The PR-scoped defence also fails, by the author's own evidence.**
`nightly-backtest.yml:17` carries `workflow_dispatch`, and the author dispatched
it onto this branch's head — `commits/83b5245/check-runs` shows
`nightly-benchmark` and `alert-nightly-benchmark / alert` from run 34368245585
landing on that sha. Pre-fix those would have read `benchmark` and `alert / alert`
on a would-be PR head. The collision was reachable on a PR head by a mechanism
the author personally exercised in this very branch.

The rename is still correct. The rationale that downgraded the finding is not.
Correct all three sites before this merges.

---

## F4 · HIGH — the `<UNRESOLVED …>` escape hatch has zero reachable instances in production, and the comment defending it is false for the only unresolvable case that can occur.

`workflowCheckNames.ts:158-166`. The comment at `:160-163` states:

> An unresolvable callee is not silently skipped: dropping the edge is how a rule
> ends up with zero instances. It is surfaced as a name so the caller can assert
> on it.

That branch fires only when `calleeOf` (`:132`) has already matched — and `:132`
matches **only** `uses: ./.github/workflows/<file>`, an unquoted local path. So
the marker fires only for a local reusable workflow missing from the directory,
which `actionlint` already rejects outright (`npm run lint:workflows` is a CI
job). The one unresolvable case that genuinely exists — a **remote** reusable
workflow, `uses: octo/repo/.github/workflows/x.yml@v1`, which cannot be resolved
from this repo at all — returns `null` from `calleeOf` and is **silently treated
as an ordinary job**.

**Measured** by feeding the shipped functions a caller with a remote `uses:`:
derived names `['alert']`. GitHub reports it as `alert / <callee job>`. The `/`
composite is dropped, exactly the failure the module docstring at `:52-54` says
the design prevents. A collision on the real composite name is undetectable, and
`alert` is a name GitHub never emits.

This is the "correct and unreachable" defect class that CLAUDE.md's I3 section
records recurring three times — *"when a guard is green, ask what it VISITED
before you ask what it decided"* — committed inside the guard written to close a
reachability defect. The author caught one instance of it themselves (M-2, the
matrix suffix) and shipped another.

**Should have:** match `uses:` generally, classify local vs remote, and emit
`<UNRESOLVED …>` for the remote case — or assert the remote case in the CANNOT-do
block. As written the marker cannot fire on any input actionlint would pass.

---

## F5 · MEDIUM — the "oracle" is a frozen snapshot of today's six files, so its reachability defence does not extend to any workflow added later; and adding one forces a hand-edit that converts the oracle into a copy of the model.

`workflow-check-names.test.ts:39-51` (`OBSERVED_BEFORE_THIS_FIX`), `:55-58`
(`expect(files.length).toBe(6)`), `:64-78`, `:180`, `:197-200`.

**Reproduction (run):** add `.github/workflows/zz-probe.yml` with
`on: pull_request` and one job. Four tests fail, including *"derives the
historical name set EXACTLY from the pre-fix sources"*. The only way forward is
to add a name GitHub has never emitted to a list documented at `:33-38` as
GitHub's actual output — at which point the oracle stops being a measurement and
becomes the second copy of the model that `workflowCheckNames.ts:52-54` and
`workflow-check-names.test.ts:15-17` say the design prevents. Nothing in the file
forbids it.

This is the delivery mechanism for F4 and F6: every parser hole is a *future-file*
hole, and this is how future files enter unoracled.

**Should have:** split the frozen list into (i) an immutable observed-names record
with the SHA and pull date beside each entry, and (ii) a derived set that may grow;
assert (i) is a subset of (ii), so adding a workflow never requires editing a
measurement.

---

## F6 · MEDIUM — the hand-written parser silently mis-models valid, actionlint-clean YAML, in the quiet direction. Five further cases, each run through the shipped functions.

| # | Input | Derived | GitHub would emit |
|---|---|---|---|
| a | `  deploy: # second job` (trailing comment on a job header), preceded by job `build` | jobs `['build']`, names `['deployer']` | `build`, `deployer` |
| b | `    name: builder # disambiguated` (whitespace before `#`) | `builder # disambiguated` | `builder` |
| c | `uses: "./.github/workflows/scheduled-failure-alert.yml"` (quoted) | `alert` | `alert / alert` |
| d | `on: [push, pull_request]` or `"on":` | `triggers() = ∅` | n/a |
| e | comment at column 0 inside the `on:` block | `{push}` only, `pull_request` lost | n/a |

- **(a)** `jobBlocks:97` requires `\s*$` after the job id's colon. The job is never
  registered, and its four-space `name:` line is appended to the PREVIOUS job's
  block, so one job vanishes *and* another is renamed. A collision on the vanished
  name is undetectable.
- **(b)** `jobName:126-129` captures the trailing comment. YAML strips a `#`
  comment from an unquoted scalar **when the `#` is preceded by whitespace**,
  which is the probed case, so GitHub emits `builder` while the guard derives
  `builder # disambiguated`. If that job is in a PR-triggered workflow,
  `requirable()` recommends a name no check run will ever carry — the guard
  **manufactures** foot-gun (b). (The no-whitespace form `name: builder#tag` is a
  single YAML scalar and the parser is correct there; the defect is the
  whitespace-preceded case only.)
- **(c)** `calleeOf:132` requires an unquoted literal. Quoting silently drops the
  `/` composite — the same class as F4, reached by a different input.
- **(d)/(e)** push in the safe (under-recommend) direction, except that a
  `workflow_call`-only file written in flow style defeats the `:152` skip and
  emits a phantom name.

All five are valid YAML and all five pass `actionlint`. "actionlint remains the
schema authority" (claim 6) is true and is exactly why these are silent.

**Checked and clean in this class:** CRLF line endings parse correctly (`\r` is
absorbed by `\s*$`); tabs and a four-space `jobs:` mapping yield zero jobs but are
caught by the per-file `jobBlocks(f.source).size > 0` reachability test at
`workflow-check-names.test.ts:60-62`; a quoted job `name:` is unquoted correctly.

---

## F7 · MEDIUM — one of the eleven oracle entries has been pre-processed by the rule under test, and it is the entry that most needed independence.

`workflow-check-names.test.ts:47`. GitHub emitted four concrete names on 50bbab4 —
`stryker (quant-indicators)`, `stryker (quant-rest)`, `stryker (backtest)`,
`stryker (options)`. The frozen list carries `stryker (*)`. `:36` admits the
collapse. Ten of eleven entries are independent measurements; this one is the
model's own normalisation asserted against itself. By the author's own account
(`:109-115`) the matrix branch is where the guard had zero reachable instances.

The virtual fixture at `:116-121` does restore reachability for the **suffix**
branch — verified by discriminator: replacing `:177` with `const suffix = ''`
fails exactly *"appends the matrix suffix for a matrix job whose name carries no
expression"*, 1 failed / 19 passed. It does **not** restore independence for the
normalisation collapse.

**Should have:** keep the four concrete names in the frozen list and assert that
each *instantiates* the derived template, rather than folding them before
comparison.

---

## F8 · LOW — the record is not updated, and it now misdirects the owner.

- `reviews/findings-ledger.csv:252` still carries Q107-O4 as `OPEN 2026-08-29`
  at `.github/workflows/ci.yml,70` with "Rename one before enabling branch
  protection". The fix renamed `nightly-backtest.yml`, not ci.yml, and the row
  never mentions `alert / alert` — the collision that was actually live.
- `workspace/SESSION_STATE.json:713` tells the next agent the same thing.

Neither is touched on this branch. Per CLAUDE.md's WHAT "DONE" MEANS, the ledger
is the risk register; leaving it pointing at the wrong file and the wrong
collision is how the next reader re-derives a solved problem.

---

## Claims verified TRUE — stated explicitly

1. **Claim 2 (77cc18e).** Three `benchmark` runs: 34339653871 / 34214413055 /
   34114231189, all *Nightly Benchmark* / `nightly-backtest.yml` / `schedule`, on
   2026-09-07, -08, -09, head_branch `main`. Same workflow, unmoved sha. Not a
   cross-workflow collision. ("Re-running" is loose — they are fresh scheduled
   triggers, not re-runs — but the substance is right.)
2. **Claim 3 (`alert / alert` on 50bbab4).** Two check runs, suites 92294213100
   (run 34066964667, *Weekly Data Refresh*) and 92207063320 (run 34031930047,
   *Stryker Weekly*). Live cross-workflow collision. Confirmed.
3. **Claim 4 (no id renamed, no consumer affected).** The diff adds only `name:`
   keys. `needs: [benchmark]`, `needs.benchmark.result`
   (`nightly-backtest.yml:105`), `needs.refresh.result`, `needs.stryker.result`
   and `alertPermissions()` (`__tests__/architecture/scheduled-alerts.test.ts:212`)
   all key on the id. Grepped `scripts/`, `.github/`, `workspace/*.md` and
   `__tests__/` for literal `'benchmark'` / `'alert / alert'` poll targets — none
   outside this branch's own files. Also grepped for check-name pollers
   (`gh pr checks`, `statusCheckRollup`, `--required`): the only hits are
   `workspace/VERCEL_OPERATIONS.md:340-341`, a human runbook that reads the
   rollup, not a script waiting on a named check. `scripts/ci/notify-scheduled-failure.mjs`
   keys the alert issue title on `inputs.workflow` (a file name), not a job name.
   304/304 architecture tests pass unmutated. **No consumer breakage found.**
4. **Claim 6 (no YAML dependency).** No `package.json` change on the branch;
   `npm run lint:workflows` clean on actionlint 1.7.12. True — and see F6 for why
   that is the problem rather than the reassurance.
5. **Claim 7 (oracle completeness).** The union of `commits/50bbab4/check-runs`
   and `commits/77cc18e/check-runs` is exactly the eleven frozen entries, with all
   six files represented (ci 7, nightly 2, refresh 1 + shared alert, stryker
   4→1 template + alert, a11y `axe` on 77cc18e, `scheduled-failure-alert.yml` 0 by
   design). **Nothing is missing.** Qualified only by F7.
6. **Claim 8 (M-2 reachable).** Verified by discriminator, see F7.
7. **The Vercel CANNOT-do note (`:224-228`).** `commits/<sha>/status` returns
   context `Vercel`, state `success`, on both 83b5245 and f0fda05. Accurate. Note
   Vercel *also* posts a check run named `Vercel Preview Comments`; the note says
   "status", which is the one that matters for requiring, so this is not a defect.

## Categories that yielded nothing

- **Concurrency, retry storms, partial failure, feeds dying mid-request, stale
  cache served as live** — nothing. The diff is declarative YAML keys plus a pure
  test-only module. No runtime path, no I/O, no cache, no network.
- **Untrusted text reaching a tool-enabled path** — nothing. The parser reads only
  `.github/workflows/*.y?ml` from this repo, inside a vitest process.
- **Statistics / claims of skill** — none in this diff. Nothing for
  `quant-validator`; no I5 surface touched.
- **Fail-closed, `catch {}`, defaults substituting for real values,
  forward-fill** — nothing beyond the `<UNRESOLVED …>` marker in F4.
- **Determinism** — `checkNames` is a pure function of the file set; `readdirSync`
  order affects array order only and every assertion sorts. No nondeterminism.
- **I1/I2/I4 surfaces (provenance, staleness, point-in-time)** — not touched.
- **Job-level `if:` skip semantics** — deliberately NOT claimed. Whether GitHub
  treats a `skipped` check-run conclusion as satisfying a required check is not
  settleable from this repo, and no empirical instance exists here (the two failed
  CI runs sampled, 34009997192 and 33950293627, had `smoke` succeed). F1 is staked
  on `paths:` filtering, which GitHub documents as pending-forever.

## Restoration

Every mutation was reverted with `git checkout -- <file>` on committed files only,
and `.github/workflows/zz-probe.yml` / `__tests__/_probe/` were deleted.
`git status --porcelain` shows only the four pre-existing untracked directories
(`.agents/`, `.codex/`, `reviews/wsa-2026-06-23/`, `reviews/wspy-2026-06-22/`)
plus this report.
