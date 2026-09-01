# Red team — Q107-O2 scheduled-workflow alerting (PR #173)

Reviewed 2026-09-01. Ids reserved `Q107-A1`…`Q107-A19`.
**Nothing was written to `reviews/findings-ledger.csv`.** No workflow was
dispatched, cancelled or re-run; no issue was created, commented on or closed.
All GitHub API access was read-only (`gh api` GET).

## Scope and a moving head

The task named head `fec401b`. **The branch moved during this review**: the
remote and this worktree are now `06fd327` — *"fix(ci): the issues endpoint
returns pull requests, and one page is not all pages (Q107-O2)"*. All line
citations and all mutation results below are against **`06fd327`**. Baseline at
that commit: `npx vitest run __tests__/ci/alertDecision.test.ts
__tests__/architecture/scheduled-alerts.test.ts` → **16/16 green**;
`npm run typecheck` → clean.

The reviewable surface is **`bece0c7..HEAD`** — 10 files, ~448 lines. The
`main...HEAD` diff is 7,465 lines because `main` is behind by two merged PRs
(#170–#172); that bulk was **not** reviewed and is not endorsed here. The
2-line change to `reviews/findings-ledger.csv` inside `bece0c7..HEAD` is the
author's, and it was left alone (see `Q107-A15`, which is about its *content*).

`06fd327` independently fixed two of the four dedupe defects I was asked to
attack (PRs returned by `/issues`, and single-page listing). I verified the
fixes behaviourally against a mock API — they work. They have **no test**
(`Q107-A13`).

---

## Ranked by "would this make the alert silently not fire"

| id | sev | status | one line |
|---|---|---|---|
| A1 | **CRITICAL** | CONFIRMED | `refresh-data.yml` is an **invalid workflow file**. Zero jobs have run since the alerting landed. |
| A2 | **CRITICAL** | CONFIRMED | The whole mechanism can be **deleted** and the suite stays green. It cannot see A1. |
| A3 | HIGH | CONFIRMED | "every scheduled workflow that can fail raises an alert" — nothing computes that set. |
| A4 | HIGH | CONFIRMED | A wired job gaining `continue-on-error: true` goes silent forever, green suite. |
| A5 | HIGH | CONFIRMED | The `with:` inputs are unvalidated: a broken `conclusion:` goes inert, a wrong `workflow:` merges two outages. Green suite. |
| A6 | HIGH | CONFIRMED | The alerter's own failure is unalerted — and one branch of it **exits 0**. |
| A7 | HIGH | PLAUSIBLE | `permissions: issues: write` zeroes `contents`; the called workflow runs `actions/checkout`. |
| A8 | INFO | CONFIRMED | Repo default workflow permission is `read` — reported as asked; **not** the inert-maker. |
| A9 | MEDIUM | CONFIRMED | A manual `workflow_dispatch` success closes a live scheduled outage. |
| A10 | MEDIUM | CONFIRMED | `skipped` on a scheduled data job is treated as nothing to say. |
| A11 | MEDIUM | PLAUSIBLE | The quarantine `detail` branch is only reachable from a **failed** job's outputs. |
| A12 | MEDIUM | CONFIRMED | No heartbeat. "The workflow never ran" is uncovered and looks identical to health. |
| A13 | MEDIUM | CONFIRMED | The runner has **zero** test coverage, including the just-landed dedupe fixes. |
| A14 | LOW | PLAUSIBLE | No `concurrency:`; `findOpen`→`create` is not atomic. |
| A15 | LOW | CONFIRMED | The ledger row says FIXED while the workflow it is filed against has never run a job. |
| A16 | LOW | CONFIRMED | The reusable workflow's own comment is self-refuting. |
| A17 | LOW | CONFIRMED | The a11y `continue-on-error` regex — loud in every direction but one. |
| A18 | LOW | — | No label, assignee or mention; the dedupe key is a human-editable title. |
| A19 | LOW | CONFIRMED | The `  alert:`-to-EOF slice can be satisfied by a different job. |

---

## Q107-A1 — CRITICAL · CONFIRMED · `refresh-data.yml` has not run a single job since this work landed

**`.github/workflows/refresh-data.yml:178`**

```yaml
      detail: ${{ ${{ needs.refresh.outputs.quarantine == '2' && '…' || '…' }} }}
```

GitHub Actions expressions **do not nest**. The template scanner takes the first
`${{`, scans to the first `}}`, and hands the expression parser a string
beginning with `$` → *Unexpected symbol*. This is a **compile-time** error for
the whole file, not a runtime error in one job.

**Evidence — live, read-only, and unambiguous.** GitHub creates a pseudo-run
named after the *file path* (not the workflow's `name:`) when a pushed workflow
fails to parse. Three exist on this branch, one per commit since the alerting
landed, each with **zero jobs**:

| run id | head | name | conclusion | `jobs.total_count` |
|---|---|---|---|---|
| 33519805342 | `7f99030` | `.github/workflows/refresh-data.yml` | failure | **0** |
| 33519937171 | `fec401b` | `.github/workflows/refresh-data.yml` | failure | **0** |
| 33522477405 | `06fd327` | `.github/workflows/refresh-data.yml` | failure | **0** |

Differential control: querying every run on the branch for a path-named run
returns **exactly one distinct name** — `refresh-data.yml`. `nightly-backtest`,
`stryker-weekly`, `a11y-axe` and `ci` all parse. The defect is specific to the
line above, and `${{ 'literal' }}` in the other two callers is fine.

**Cause, narrowed by elimination.** Across the **last 100 runs on all
branches** (window 2026-08-16 → 2026-09-01, which spans the entire Q-107
sequence #170/#171/#172 and `bece0c7`), the *only* path-named pseudo-runs in the
repository are the three above. None predates `7f99030`. `7f99030` touched this
file in exactly two places — the `outputs:` block (`:15-17`,
`quarantine: ${{ steps.refresh.outputs.code }}`, valid) and the `alert` job
(`:166-178`). Line 178 is the only added line containing invalid expression
syntax. The alerting work introduced the invalidity.

**Consequence.** The weekly data refresh — the pipeline `Q-107` spent three PRs
un-deadlocking — is dead again, *and* its alert job can never execute, so the
alerting cannot report its own most important subject. This is worse than the
state before the PR: previously the workflow ran and failed loudly in run
history; now it does not run.

**What the author should have done.** One delimiter:

```yaml
      detail: ${{ needs.refresh.outputs.quarantine == '2' && '…' || '…' }}
```

and, structurally, **parse the YAML in the architecture test** — see A2.

---

## Q107-A2 — CRITICAL · CONFIRMED · The guard never visits the mechanism it guards

`__tests__/architecture/scheduled-alerts.test.ts:14-16` enumerates only files
containing `schedule:`. `scheduled-failure-alert.yml` has no `schedule:` key, so
**the reusable workflow and the runner script are never read by any test**.
Nothing resolves the `uses:` target; nothing parses YAML.

Mutations run against `06fd327`, restored with `cp` after each:

| # | mutation | result |
|---|---|---|
| M11 | `rm .github/workflows/scheduled-failure-alert.yml` (delete the entire mechanism) | **SURVIVED — 16/16 green** |
| M13 | `scheduled-failure-alert.yml:53` `run: node scripts/ci/notify-scheduled-failure.mjs` → `run: echo 'lol'` | **SURVIVED — 16/16 green** |
| M12 | `mv scripts/ci/notify-scheduled-failure.mjs` away (delete the runner) | **SURVIVED — 8/8 green** |
| M3 | inject the *same* nested-expression bug into `nightly-backtest.yml:84` | **SURVIVED — 16/16 green** |
| M1 | strip `permissions:\n issues: write` from `scheduled-failure-alert.yml:39-40` | **SURVIVED — 16/16 green** |
| M16 | `stryker-weekly.yml:76` `workflow: stryker-weekly.yml` → `workflow: refresh-data.yml` | **SURVIVED — 16/16 green** (see A5) |

M1 may be an **equivalent mutant** and is listed for reachability, not for
behaviour: a called workflow's job that omits `permissions` inherits the
caller's grant, and all three callers declare `issues: write`. The point it
makes is narrow and still worth making — the guard never reads that file at all,
so a *non*-equivalent edit to it (M11, M13) is equally invisible.

M3 is the one that matters most: **the suite structurally cannot see A1.** M11
is the one that should end the argument: you can delete the alerting outright
and CI is green.

Positive controls confirm the guard is not simply broken — it is *aimed at the
wrong files*: M5 (`if: always()`→`if: failure()` in `refresh-data.yml`) KILLED;
M6 (delete the `alert` job from `nightly-backtest.yml`) KILLED; M9/M10 (drop the
**caller-side** `permissions` block) KILLED; M8 (move a11y's
`continue-on-error` to step level) KILLED.

**What the author should have done.** Parse the workflows (`yaml`) rather than
string-match them, resolve every `uses: ./…` to a file that must exist, walk
every `${{ … }}` and reject a nested `${{`, and assert the called workflow's
`run:` actually invokes the runner. This is the repo's own documented lesson —
*"when a guard is green, ask what it VISITED before you ask what it decided"* —
recurring for the sixth time.

---

## Q107-A3 — HIGH · CONFIRMED · The describe title is a claim no test computes

`__tests__/architecture/scheduled-alerts.test.ts:20` —
*"every scheduled workflow that can fail raises an alert"*. It does not check
that. `:26` hardcodes three filenames; `:39` and `:46` iterate
`scheduled.filter(x => read(x).includes('scheduled-failure-alert.yml'))`, i.e.
**only files that are already wired**. Nothing ever computes
`scheduled ∧ canFail ∧ ¬wired`.

- **M2** — add `.github/workflows/zz-mutant-scheduled.yml`, scheduled daily,
  one job, `run: exit 1`, unwired → **SURVIVED, 16/16 green**.
- **M2b** — the same file as `zz-mutant.yaml` → **SURVIVED, 16/16 green**, and
  additionally invisible: `:14` is `readdirSync(DIR).filter(f => f.endsWith('.yml'))`.
  GitHub reads `.yaml` too. An extension allowlist hiding a whole class is the
  exact defect `Q-098` and `Q-100` each shipped.
- `:23` `expect(scheduled.length).toBeGreaterThanOrEqual(4)` asserts a constant,
  not a property. It is a magic number with no source, and it only killed M4
  (renaming an existing `.yml` to `.yaml`) by arithmetic accident.

**What the author should have done.** Compute the unwired-but-failable set and
assert it is empty, with the a11y exclusion expressed as a named, justified
allowlist entry rather than as a bespoke `if/else` for one filename. Glob
`*.yml` **and** `*.yaml`.

---

## Q107-A4 — HIGH · CONFIRMED · `continue-on-error` on a wired job silently disables its alert

The design's own premise (`scheduled-failure-alert.yml:7-11`) is that job-level
`continue-on-error: true` forces `needs.<job>.result` to `success`, which is why
a11y is excluded. That premise is not checked for the *wired* workflows.
`canFail()` at `:18` of the test is called in exactly one place, `:58`, with the
literal `'a11y-axe.yml'`.

**M14** — insert `continue-on-error: true` at job level into
`.github/workflows/stryker-weekly.yml:42` (`stryker:`) → **SURVIVED, 8/8 green**.
The alert would then never fire for the mutation gate, forever, with a green
suite and a green workflow.

This is not hypothetical for this file: `stryker-weekly.yml:7` records that the
job **carried `continue-on-error: true` for a long period** and it was removed
in #137. The regression has happened here before.

**What the author should have done.** Apply `canFail()` to every wired workflow
and fail when a wired job cannot fail — the alert and the flag are mutually
exclusive by construction.

---

## Q107-A5 — HIGH · CONFIRMED · A broken `conclusion:` input is inert and untested

**M15** — `stryker-weekly.yml:77` `conclusion: ${{ needs.stryker.result }}` →
`${{ needs.stryker.outputs.nonexistent }}` (always empty) → **SURVIVED, 8/8
green**. At runtime `scripts/ci/notify-scheduled-failure.mjs:21-24` sees a falsy
`ALERT_CONCLUSION`, prints to stderr and `process.exit(1)`. The alert job goes
red, **nobody is notified**, and a red scheduled job is precisely the signal
this package exists because nobody reads.

The `workflow:` input is unvalidated in the same way. **M16** —
`stryker-weekly.yml:76` `workflow: stryker-weekly.yml` → `workflow:
refresh-data.yml` → **SURVIVED, 16/16 green**. At runtime, stryker failures
would comment on the *refresh-data* alert thread, and a refresh-data **recovery
would close an issue that also represents a live mutation-gate outage** — the
exact merge that `__tests__/ci/alertDecision.test.ts:68-70` claims to prevent.
That test is a tautology: `expect(alertTitle('refresh-data.yml')).not.toBe(alertTitle('stryker-weekly.yml'))`
asserts only that string concatenation is injective. It reads no workflow file,
and the architecture suite never reads a `workflow:` value at all.

No test asserts that the `conclusion` input is `needs.<the-real-job>.result`,
and nothing validates the input's *value* inside the reusable workflow.

**What the author should have done.** Assert in the architecture test that each
caller passes `needs.<job>.result` for a job that exists in that file **and that
`workflow:` equals the caller's own filename**, and make
the reusable workflow reject an unrecognised `conclusion` **by alerting**, not
by exiting 1 (see A6).

---

## Q107-A6 — HIGH · CONFIRMED · The alerter fails open into silence, and one path exits 0

Two distinct failure modes, both proven against a mock GitHub API (the real
runner, unmodified except for the API base URL, run offline):

| scenario | exit | API calls | notification |
|---|---|---|---|
| `GET /issues` → **403** ("Resource not accessible by integration"), conclusion `failure` | **1** | 1 GET | **none** |
| conclusion `timed_out`, alert issue open | **0** | 1 GET | **none** |
| conclusion `cancelled`, alert issue open | 0 | 1 GET | none *(by design)* |
| conclusion `failure`, no open issue | 0 | GET + POST `/issues` | create ✓ |
| conclusion `failure`, open issue #42 | 0 | GET + POST `/issues/42/comments` | comment ✓ |
| conclusion `success`, open issue #42 | 0 | GET + POST comment + PATCH `/issues/42` | close ✓ |

The 403 row is the "permission model is wrong" case: an unhandled rejection at
`notify-scheduled-failure.mjs:36`, alert job red, zero notifications.

The `timed_out` row is worse. `scripts/ci/alertDecision.mjs:44`
(`const failed = conclusion === 'failure'`) and `:46`/`:60` mean **anything not
exactly `'failure'` and not exactly `'success'` returns `{action:'none'}`** and
the runner exits **0** — a green alert job that did nothing. Measured across
inputs: `'Failure'`, `'FAILURE'`, `'failure '` (trailing space), `'timed_out'`,
`'startup_failure'`, `'action_required'`, `'neutral'`, `'stale'`, `''`, `null`,
`undefined` → all `none`.

`needs.<job>.result` documents only four values, so the *reachable* instance
today is `skipped` (A10) — but the `inputs.conclusion` is `type: string`
(`scheduled-failure-alert.yml:21-24`) with no validation, the runner is a
general entry point, and the **default is silence**. For an alerting system the
default must be to alert. This is design invariant **I2, "fail closed, never
fail silent"**, in the one place the platform cannot afford it.

**What the author should have done.**
`if (!KNOWN.has(conclusion)) → treat as failure with a body saying the
conclusion was unrecognised`. And make the runner's own exception path do
something louder than `exit 1` — at minimum a `::error::` annotation and a job
summary, ideally a second channel.

---

## Q107-A7 — HIGH · PLAUSIBLE · `issues: write` zeroes `contents`, and the job checks out

`.github/workflows/scheduled-failure-alert.yml:39-40` sets
`permissions: issues: write`. In Actions, naming any scope sets **every
unnamed scope to `none`** — including `contents`. `:42` then runs
`actions/checkout@v5`.

I could not settle this empirically from here and I will not assert it is
broken. What I can say: **there is no precedent in this repo.** Grepping every
`permissions:` block in `.github/workflows/` returns only `refresh-data.yml:9`
(`contents: write`, file level) and the four *new* alert blocks. `a11y-axe.yml`
runs `checkout@v5` with **no** `permissions:` block, so it inherits the repo
default (`contents: read`) — it is not evidence. Nothing in this repository has
ever run `checkout` under a restricted permissions block.

If checkout 403s, the alert job dies at step 1 and produces exactly the A6
403 outcome: red job, no notification. It is also a latent trap the day the
repo stops being public.

**What the author should have done.** `permissions: { contents: read, issues: write }`.
Costs nothing, removes the question. Alternatively drop `checkout` and inline
the script — the job needs two files.

---

## Q107-A8 — INFO · CONFIRMED · The repo default workflow permission is `read`

As requested, read-only:

```
GET /repos/wanghaoheng123-boop/QUANTAN-sector-investment/actions/permissions/workflow
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
```

**This is not the inert-maker, and the PR's own reasoning is right.** That
setting is the default applied when a workflow declares no `permissions:` key;
an explicit block elevates. The repo proves it: `refresh-data.yml:9-10` declares
`permissions: contents: write` and `:154` runs `git push origin HEAD:main`, and
per CLAUDE.md I7 that bot push has been landing on `main` weekly under this same
`read` default.

`secrets.GITHUB_TOKEN` likewise reaches a `uses: ./…` reusable workflow
automatically — no `secrets: inherit` needed. Forks are irrelevant: all three
callers are `schedule` + `workflow_dispatch` only.

Residual risk is A7 (`contents` zeroed) and A6 (if elevation is ever policy
-blocked, the failure is silent).

---

## Q107-A9 — MEDIUM · CONFIRMED · A manual run's success closes a live scheduled outage

`scripts/ci/alertDecision.mjs:50` — `if (conclusion === 'success' && openIssue)`
→ close. It does not look at `github.event_name` or `run_attempt`.

Sequence that breaks it: the weekly refresh fails Sunday → issue opened →
Monday an engineer clicks **Run workflow** to try a fix, or re-runs the single
failed job, and it happens to pass → **the issue is closed** and the recovery
comment says *"Recovered — `refresh-data.yml` succeeded."* → the next scheduled
run fails and opens a **new** issue, splitting the history the design's own body
text tells the reader to rely on (*"if this thread is long, the problem is old"*).

The author explicitly reasoned at `:47-49` that `cancelled`/`skipped` must not
count as recovery because they are not evidence the pipeline came back. A
manually dispatched success on a different input set is the same argument, and
it was not applied.

**What the author should have done.** Pass `github.event_name` into the
decision and close only on `schedule`; comment "manual run succeeded" otherwise.

---

## Q107-A10 — MEDIUM · CONFIRMED · `skipped` is silence, and on a data job it means the data is stale

`alertDecision.mjs:46`/`:60`. `skipped` is a documented `needs.<job>.result`
value, so this is reachable today: add an `if:` to the `refresh` job that
mis-evaluates, or a `needs` chain that short-circuits, and `refresh-data.yml`
skips forever with **no alert and no red run**. Not closing on `skipped` is
correct; being silent about it is the same class of defect as A6.

---

## Q107-A11 — MEDIUM · PLAUSIBLE · The quarantine `detail` branch is only reachable from a failed job

`.github/workflows/refresh-data.yml:15-17` exposes `quarantine:
${{ steps.refresh.outputs.code }}`. It is read at `:178` in the branch
`quarantine == '2'`. But exit code 2 is *precisely* the case in which the last
step (`:160-164`, `if: steps.refresh.outputs.code == '2'`) runs `exit 1` and the
job **fails**.

So the quarantine branch is *never* evaluated on a successful job. Its only
reachable state is "outputs of a failed job". If those do not propagate — and I
could not verify the propagation rule from here — the branch is dead **100% of
the time**, not occasionally, and every quarantine is reported as *"The data
refresh did not complete. `scripts/backtestData/` is now staler than it should
be"*, which is the **opposite of the truth**: clean fixtures were committed.
Under the PRIME DIRECTIVE, an alert that misdescribes the state is worse than a
terse one.

Moot until A1 is fixed, since the file does not run at all.

**What the author should have done.** Prove the propagation with one dispatched
run before relying on it, or carry the quarantine signal in a way that does not
depend on a failed job's outputs (e.g. a step summary the alert reads, or split
the "fail the run" step into a separate job).

---

## Q107-A12 — MEDIUM · CONFIRMED · No heartbeat: "the workflow never ran" is uncovered

Every path in this design is triggered **by a run**. There is no dead-man's
switch. The uncovered failure modes:

- GitHub disables scheduled workflows in repositories with 60 days of no
  activity (email to the owner; no run thereafter).
- A workflow disabled from the UI or via the API. All five are `state: active`
  today (verified read-only) — but nothing would notice a change.
- A cron that simply stops producing runs.
- **A1 itself.** Right now `refresh-data.yml` produces *zero real runs*, which
  is exactly the state the design cannot observe.

Silence looks identical to health, which is the premise of the whole package.

**What the author should have done.** A cheap freshness assertion that runs on a
*different* trigger — e.g. the nightly benchmark (or `ci.yml`) failing when the
newest bar in `scripts/backtestData/` is older than N days, or when
`/actions/workflows/<id>/runs` shows no run in N days. That single check would
also have caught the original 13-day outage *and* catches A1.

---

## Q107-A13 — MEDIUM · CONFIRMED · The runner has zero test coverage

Nothing imports `scripts/ci/notify-scheduled-failure.mjs`. A repo-wide grep
returns only the workflow's `run:` line and the vendor register's evidence
field. **M12** (delete the file) → 8/8 green.

That is the file `06fd327` just fixed. Both fixes are unprotected:
- `:66` `!i.pull_request` — I verified this works: with a mock page-1 response
  containing a **PR** carrying the exact alert title *and* the
  `<!-- quantan-scheduled-alert -->` marker, the runner correctly ignored it and
  created a fresh issue. Delete `!i.pull_request &&` and the suite is green,
  and the `close` path at `:92` (`PATCH /issues/{n}` `state: closed`) would then
  **close a pull request**. This repo's open-item list is currently 1 item and
  100% PRs, so the collision surface is the whole surface.
- `:62-69` pagination + `:73` the loud `MAX_PAGES` warning — same, unprotected.

A fix with no test in this repository has a documented habit of being reverted.

**What the author should have done.** Inject the `fetch`/`gh` seam and unit-test
the runner: 403, non-array body, PR collision, page-2 hit, `MAX_PAGES`
exhaustion, and the three write paths. The mock-API harness I used is ~40 lines.

---

## Q107-A14 — LOW · PLAUSIBLE · No `concurrency:` and a non-atomic read-then-create

`findOpen()` (`:60-75`) and the `create` at `:82` are not atomic, and none of
the three callers declares a `concurrency:` group. Two overlapping runs of the
same workflow (a `workflow_dispatch` while a scheduled run is in flight, or a
re-run) both see no open issue and both create one. Consequence is duplicate
issues, i.e. the alert fatigue the design says it prevents. Cross-workflow races
are not a problem — the title is per-workflow.

---

## Q107-A15 — LOW · CONFIRMED · The ledger row says FIXED and three supporting claims are false

`reviews/findings-ledger.csv`, row `Q107-O2`, changed in `7f99030` from OPEN to
**"FIXED 2026-08-30"**. The row is filed against
`.github/workflows/refresh-data.yml` — the file that, as of the same commit, has
not executed a single job (A1). *Tagged code ≠ fixed effect*, on the row that
asserts the effect.

One checkable claim in that row is wrong:

- *"wiring has **9** architecture tests"* — `scheduled-alerts.test.ts` has
  **6 blocks / 8 executed cases** (5 `it` + `it.each` over 3). Neither reading
  gives 9. *(The companion claim of "7 unit tests" for the decision logic is
  fine under a block count — 6 `it` + 1 `it.each` — so it is not disputed here,
  and the "permission dropped" mutation the row cites IS caught on the caller
  side, M9/M10 both KILLED. Two claims I initially challenged are withdrawn.)*

The commit message for `06fd327` also states *"Verified against the live API:
with one open PR and no alert issue, the runner correctly decides `none` and
writes nothing."* That is a **success**-path verification (`conclusion` unset or
non-failure produces `none`); it does not exercise `create`, `comment` or
`close`, and should not be read as an end-to-end proof.

---

## Q107-A16 — LOW · CONFIRMED · The reusable workflow's comment is self-refuting

`.github/workflows/scheduled-failure-alert.yml:35-38`:

> *"If an org policy ever forbids elevating, the runner 403s and exits 1, which
> turns the alert job red rather than failing silently. **Loud beats absent.**"*

A red scheduled run **is** the silence this package exists to remove — that is
verbatim the Q-107 incident (`refresh-data.yml` ran red weekly for 13 days and
nobody was told). The reassurance describes the original defect as the mitigation.
Confirmed empirically in A6: 403 → exit 1 → zero notifications.

---

## Q107-A17 — LOW · CONFIRMED · The a11y regex is fragile but loud, with one silent direction

`__tests__/architecture/scheduled-alerts.test.ts:18`
`/^\s{4}continue-on-error:\s*true/m`. Every direction the flag can move makes
`canFail()` return true, which makes the test **demand** wiring and go RED:
step level (M8, 8 spaces — **KILLED**), removed, or quoted `'true'`. False-red,
not silence. Low.

The one silent direction, confirmed: **M7** — append a second job to
`a11y-axe.yml` with no `continue-on-error` while job 1 keeps its 4-space flag →
`canFail` still false → exclusion upheld → **SURVIVED, 16/16 green**, and the
new failable job is unalerted. The predicate is file-scoped where the property
is job-scoped.

---

## Q107-A18 — LOW · No addressee, and a human-editable dedupe key

- `notify-scheduled-failure.mjs:82-85` creates the issue with **title and body
  only** — no label, no assignee, no `@mention`. Delivery depends entirely on
  the owner's watch/notification settings. The design rejected a webhook because
  it needs an owner-provisioned secret; an issue nobody is subscribed to has the
  analogous "did anyone receive it" gap, and it is untested. This is the one
  thing the live end-to-end test should confirm explicitly: *did an email
  actually arrive*.
- The dedupe key is `title === alertTitle(workflow)` **plus** the body marker
  (`:66`). A human renaming the issue (adding "[P0]", say) permanently breaks
  dedupe: a new issue every week, and recovery never closes the renamed one. The
  docstring at `:43-46` argues against a label because a label can be missing —
  but a title is *more* mutable than a label, not less. A marker-only match, or
  a label created idempotently, is more robust.

---

## Q107-A19 — LOW · CONFIRMED · The `  alert:`-to-EOF slice

`__tests__/architecture/scheduled-alerts.test.ts:40` and `:47` build the
assertion window as `read(f).slice(read(f).indexOf('  alert:'))`. Two
weaknesses: (a) the **first** two-space `  alert:` anywhere in the file — a
comment, a step name — sets the window start; (b) the window runs to **EOF**, so
`if: always()` or `issues: write` belonging to some *later* job satisfies the
assertion for the alert job. Passes today only because `alert` is the last job
in all three files.

---

## Answers to the six questions as posed

1. **Will it fire?** For `nightly-backtest.yml` and `stryker-weekly.yml`:
   probably yes, subject to A7. For `refresh-data.yml`: **no — the file does not
   parse and has run zero jobs since the alerting landed (A1).**
   `needs.<job>.result` is `failure` on failure, `cancelled` on cancellation,
   `skipped` when not run, and `always()` does admit the job on a cancelled
   workflow. If a step in the alert job itself fails, nothing is notified (A6).
   The caller's `permissions` is passed to the called workflow and the called
   workflow may only narrow it — both declare `issues: write`, so the grant is
   consistent; the real permission defect is the **implicit `contents: none`** (A7).
2. **`GITHUB_TOKEN` / forks.** `secrets.GITHUB_TOKEN` reaches a `uses: ./…`
   reusable workflow automatically. Forks are not in play (schedule + dispatch
   only). Repo default is `read` (A8) and an explicit block elevates — evidenced
   by this repo's own weekly bot push under the same default. **Not the
   inert-maker.**
3. **Dedupe.** PRs-as-issues and single-page listing were real and are **fixed
   in `06fd327`**; I verified both behaviourally. They have no test (A13). Title
   editing (A18) and the create race (A14) remain open. >100 open issues is now
   handled up to 1,000 with a loud warning.
4. **The a11y exclusion test.** Fragile, but loud in every direction except one
   (A17). Low.
5. **The decision function.** Everything except exactly `'failure'` / `'success'`
   is silence, including `''`, wrong case, trailing whitespace and every
   `conclusion` value GitHub emits outside the `needs.result` four (A6);
   `skipped` is the reachable instance (A10); manual success closes a live
   outage (A9).
6. **Test quality.** Yes, three ways. The architecture suite **ratifies A1**
   (M3 survived), and the entire mechanism can be deleted while it stays green
   (M11/M12/M13). `scheduled-alerts.test.ts:23` asserts a constant (`>= 4`), not
   a property, and the describe title at `:20` states something nothing computes
   (A3). `alertDecision.test.ts:68-70` — *"gives each workflow its own issue
   title, so two outages do not merge"* — is a **tautology**: it asserts that
   `alertTitle` is injective, which is a property of string concatenation, while
   the thing it names (two outages not merging) depends entirely on the
   `workflow:` input, which no test reads and which M16 shows can be pointed at
   the wrong workflow with a green suite.

## Suggested minimum before merge

1. Fix `refresh-data.yml:178` (A1). **Blocker.** Confirm by pushing and checking
   that no path-named pseudo-run appears.
2. Parse-and-resolve in the architecture test so M3, M11, M12, M13 all die (A2).
3. `contents: read` on the reusable workflow's job (A7).
4. Unknown conclusion ⇒ alert, not silence (A6, A10).
5. Validate the `with:` inputs — `workflow:` must equal the caller's filename,
   `conclusion:` must be that file's `needs.<job>.result` (A5/M16).
6. Add a freshness assertion on a **different** trigger (A12). It is the only
   proposed control that would have caught A1 without a human reading run
   history, and A1 is a live instance of the class A12 cannot see.
7. Correct or reopen the ledger row (A15).

## Housekeeping

Every mutation was applied to a `cp` backup in
`/private/tmp/q107o2-backup/` and restored with `cp`. **`git checkout` was not
used.** `git status --porcelain` and `git diff HEAD` are both empty for tracked
files; the only new path is this document.
