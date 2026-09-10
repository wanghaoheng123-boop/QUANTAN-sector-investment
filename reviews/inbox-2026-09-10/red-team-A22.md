# Red-team: `2a485bb` — out-of-band workflow heartbeat (Q107-A22)

**Reviewer:** adversary agent · **Date:** 2026-09-10 · **Branch:** `fix/Q107-A22-out-of-band-heartbeat`
**Verdict:** DO NOT MERGE AS IS. One CRITICAL: the probe reports a genuinely
missed scheduled run as `healthy`, for 4 of the 5 weekday nightly fires, under
the dispatch timing that holds in 74 of 76 real runs.

Baseline before every mutation: `npx vitest run __tests__/ci/ __tests__/architecture/`
→ **359 passed**. Tree restored and re-verified green after each mutation
(`git status` clean of tracked changes throughout).

---

## Summary table

| # | Sev | Location | One line |
|---|---|---|---|
| C1 | **CRITICAL** | `scripts/ci/heartbeatDecision.mjs:111-113` | The judged window is open on the right, so the NEXT fire's run overwrites the verdict. An isolated missed or startup-failed Mon–Thu nightly is `healthy` forever. |
| H1 | HIGH | `scripts/ci/workflow-heartbeat.mjs:16-22`, `.github/workflows/workflow-heartbeat.yml:19-22`, test `:238-245` | The self-watch is structurally inert — the probe's own live run always occupies the verdict slot as `in-flight`. The claimed intermittent-coverage half is false. |
| H2 | HIGH | `scripts/ci/workflow-heartbeat.mjs:59-63` + `heartbeatDecision.mjs:75-77` | `extractCrons` → `[]` silently DROPS a scheduled workflow; the `unparseable` branch is unreachable from production. Demonstrated 361/361 green with a scheduled workflow unwatched. |
| H3 | HIGH | `scripts/ci/workflow-heartbeat.mjs:123-125` | Issue lookup regressed against the sibling: no pagination, no `!i.pull_request` filter — both hazards documented in `notify-scheduled-failure.mjs:41-75` as "verified against this repo". Falsifies "share ONE issue". |
| H4 | HIGH | `.github/workflows/workflow-heartbeat.yml:37-39` | `actions: read` is not granted, and the probe's only reason to exist is the Actions API. The "verified against the real repository" dry run used a full-scope PAT, not the workflow token. |
| H5 | HIGH | `scripts/ci/heartbeatDecision.mjs:98-104`; test `:147-154` | `too-early` is silence and, after the shift-back, has zero legitimate instances. The test titled "not silently treated as healthy" asserts `'skipped'`, which *is* silence. |
| M1 | MEDIUM | `scripts/ci/heartbeatDecision.mjs:134-145` | `cancelled` / `skipped` print `ALERT` and write nothing. Real instance in history (stryker 2026-07-12). |
| M2 | MEDIUM | `scripts/ci/heartbeatDecision.mjs:105-106`; test `:174-178` | Multi-cron workflows: only the max due is judged; the `< 24h` bound is a hardcoded literal with no tie to the tree. |
| M3 | MEDIUM | `scripts/ci/workflow-heartbeat.mjs:141` | `eventName: 'schedule'` hardcoded while the workflow declares `workflow_dispatch:`. A branch dispatch can CLOSE a live outage issue. |
| M4 | MEDIUM | `scripts/ci/cronSchedule.mjs:152-170` | A `run:` heredoc mentioning `schedule:` / `- cron:` makes a push-only workflow watched → permanent false alert. |
| M5 | MEDIUM | `.github/workflows/workflow-heartbeat.yml:31` + `heartbeatDecision.mjs:89` | Exactly one due per workflow per probe run is judged; nothing asserts probe cadence ≤ shortest watched cadence. |
| M6 | MEDIUM | `scripts/ci/workflow-heartbeat.mjs:76` | `state` on `/actions/workflows` is never read; the `missing` detail asserts an inactivity cause it never checked. |
| M7 | MEDIUM | `workflow-heartbeat.mjs:107` + `.yml:62-76` | Probe and alert job both manage the `workflow-heartbeat.yml` issue title and disagree within the same run: open, then close. |
| L1 | LOW | `scripts/ci/cronSchedule.mjs:73-74` | `dow` `0-7` silently narrows to Sunday-only; `5/10` → `{5}`. Contradicts "REFUSED rather than guessed". |
| L2 | LOW | `scripts/ci/workflow-heartbeat.mjs:86-94` | `unregistered` on a branch dispatch opens a real issue for a healthy workflow. |
| L3 | LOW | `scripts/ci/workflow-heartbeat.mjs:129-168` | Issue-writing loop is unguarded; one failed write aborts every alert after it. |

---

## C1 — CRITICAL: a missed scheduled run is reported `healthy`

**`scripts/ci/heartbeatDecision.mjs:111-113`**

```js
const since = (runs ?? [])
  .filter((r) => Date.parse(r.createdAt) >= due.getTime())
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
```

The window is `[due, ∞)` and the verdict comes from `since[0]` — the **newest**
run in it, not the run belonging to the fire being judged. The design shifts the
clock back by the grace so the judged fire is the *previous* one
(`:89`, and the commit is proud of this). But the window it then opens runs from
that fire all the way to `now`, i.e. `now - previousFire(now - grace)`, which is
never shorter than the grace and is longer whenever the probe's phase sits past
the following fire. Any fire inside that span is newer than the one under
judgement, becomes `since[0]`, and silently supplies the verdict.

Concretely, with `nightly-backtest` (`0 6 * * 1-5`) and the probe at `0 14 * * *`:
the window is `[D-1 06:00, D 14:00]` = 32 hours and contains **two** fires. The
D-1 fire under judgement is masked by D's run.

**Reproduction** (against the committed modules, no mutation). Drop exactly one
weekday fire, then run the real daily 14:00 probe for the following two weeks:

```
── nightly-backtest 0 6 * * 1-5 · probe 0 14 * * * · one fire dropped ──
dropped 2026-09-07 (Mon) -> *** NEVER REPORTED ***
dropped 2026-09-08 (Tue) -> *** NEVER REPORTED ***
dropped 2026-09-09 (Wed) -> *** NEVER REPORTED ***
dropped 2026-09-10 (Thu) -> *** NEVER REPORTED ***
dropped 2026-09-11 (Fri) -> 2026-09-12T14:00 missing
```

Only Friday is detectable, and only because Saturday has no fire to mask it.
The weekly workflows (`refresh-data`, `stryker-weekly`, `a11y-axe`) are all
detected correctly — the hole is specific to the sub-18h cadence.

**It also swallows the exact failure this package was built for.** An isolated
`startup_failure` whose run is created before the probe:

```
── isolated startup_failure, next weekday green ──
probe 2026-09-08 14:00  due=2026-09-07T06:00Z  -> healthy
probe 2026-09-09 14:00  due=2026-09-08T06:00Z  -> healthy
probe 2026-09-10 14:00  due=2026-09-09T06:00Z  -> healthy
```

**The perverse part: the probe works only when GitHub is LATE.** At the worst
measured lateness (+11.85h → 17:51, i.e. after the 14:00 probe) the same dropped
Tuesday IS caught, because the masking run has not been created yet at probe
time. Measured on the real history: **74 of 76** nightly scheduled runs were
created before 14:00 UTC. The masking regime is the normal case; the two
exceptions are the 2026-08-27/28 late dispatches.

**Why "verified against the real repository" did not catch it.** The two
startup_failures the probe rediscovers (2026-09-03, 2026-09-04) were caught only
because they were *consecutive* and dispatched at 10:19/10:07. Change either
fact and the probe is silent. A replay of the probe over 87 days of real history
produced `missing: 0` for `nightly-backtest` — that branch has never fired for a
daily workflow and, per the above, cannot for Mon–Thu.

**What the author should have done:** bound the window to the judged period,
`[due, due + graceMs]` (or `[due, nextFire)`).

**And the test suite cannot tell the two apart.** I applied exactly that fix as
a mutation:

```js
.filter((r) => Date.parse(r.createdAt) >= due.getTime()
             && Date.parse(r.createdAt) <= due.getTime() + graceMs)
```

Result: **43/43 `__tests__/ci/` still pass**, and the sweep above flips to
`missing` / `unhealthy startup_failure` for the dropped fires. Correct and
broken are indistinguishable to this suite — no test ever presents a run
belonging to a *later* fire than the one being judged. Reverted; baseline green.

---

## H1 — HIGH: the self-watch is inert, and the claim that it isn't is repeated four times

The commit, `workflow-heartbeat.mjs:16-22`, `.github/workflows/workflow-heartbeat.yml:19-22`
and the CANNOT-do test all say the same thing: the permanent case is conceded,
but *"an INTERMITTENT failure of this probe is reported by its own next
successful run"*. That half is also false.

When the probe runs on schedule, **its own currently-executing run is in the
`event=schedule` run list** with `status: 'in_progress'` and a `created_at`
newer than everything else. It therefore becomes `since[0]`, hits
`heartbeatDecision.mjs:128` (`status !== 'completed'`), and returns `in-flight`
→ `skipped` → `decideAlert` → `{action:'none'}` → no ALERT flag at
`workflow-heartbeat.mjs:112`.

Proven by construction (the workflow is not yet registered, so this cannot be
observed live — stated rather than overclaimed):

```
yesterday startup_failure    live-run-in-list=true  -> in-flight / skipped / none
yesterday startup_failure    live-run-in-list=false -> unhealthy / startup_failure / create
yesterday DROPPED (no run)   live-run-in-list=true  -> in-flight / skipped / none
yesterday DROPPED (no run)   live-run-in-list=false -> missing   / failure / create
schedule disabled 60d ago    live-run-in-list=true  -> in-flight / skipped / none
schedule disabled 60d ago    live-run-in-list=false -> missing   / failure / create
```

The `live-run-in-list=false` column is the only world the tests exercise. The
author's own code proves the premise: `:128` exists precisely because the API
returns non-completed runs.

**The CANNOT-do test is the repo's named defect shape.**
`__tests__/ci/heartbeatDecision.test.ts:244` asserts
`scheduled.map(s => s.file)).toContain('workflow-heartbeat.yml')` — membership
in the watch list. It never calls `assessWorkflow` on the self case. It
exercises the **visitor** and infers a property of the **decider**; that is
`Q-103`'s positive-control defect, recorded in
`guard_reachability_lesson.md`, reappearing in the package that cites it.

The commit's "four watched workflows assessed correctly" is five workflows minus
the one nobody has ever seen it assess. My live dry run confirms: the fifth line
is `unregistered`, not a verdict.

**Fix:** exclude the probe's own `GITHUB_RUN_ID` from its self-assessment, or
exclude runs newer than `due + graceMs` (which C1's fix does anyway).

---

## H2 — HIGH: a scheduled workflow `extractCrons` cannot see is dropped, not flagged

`scripts/ci/workflow-heartbeat.mjs:59-63` filters `w.crons.length > 0` **before**
`assessWorkflow` is ever called. So the `crons.length === 0 → 'unparseable'`
branch at `heartbeatDecision.mjs:75-77` — the fail-closed branch the docstring at
`cronSchedule.mjs:27-38` boasts about — **has zero reachable instances in
production**. It is reachable only from the unit test that hands it a literal
empty array.

Valid YAML that GitHub accepts, `actionlint` passes, and `extractCrons` returns
`[]` for:

```
flow style      schedule: [{cron: '0 1 * * *'}]   -> []
flow seq        schedule:\n  - {cron: '0 1 * * *'} -> []
quoted key      - "cron": '0 1 * * *'             -> []
block (control) - cron: '0 1 * * *'               -> ["0 1 * * *"]
```

**Demonstrated end to end.** I added `.github/workflows/zz-mutation-probe.yml`
declaring `schedule: [{cron: '0 3 * * *'}]`. Two guards fired — `Q107-O2`'s
`scheduled-alerts.test.ts:134` (unwired) and `Q107-O4`'s composite-name set —
and both are satisfied by edits the author's own comments sanction ("adding one
is a deliberate edit here"). After making those two sanctioned edits:

- **361/361 tests pass**, including A22's own reachability test
- the probe's live dry run reports `watched 5 scheduled workflow(s)` and never
  mentions `zz-mutation-probe.yml`

A scheduled workflow, fully wired, fully green, completely unwatched.

**The reachability guard can only fail in the safe direction.**
`__tests__/ci/heartbeatDecision.test.ts:43-46` asserts a hardcoded 5-element
array. If `extractCrons` *finds* a new workflow the test fails (safe); if it
*misses* one, the array still matches and the test passes. That is the same
hardcoded-count defect the commit message claims to have fixed two files over
("Was `toBe(6)` … Now a property"), reintroduced as a hardcoded list.

**Two disagreeing definitions of "scheduled" now exist.**
`__tests__/architecture/scheduled-alerts.test.ts:31` uses `/^\s*schedule:/m`;
this package introduces the narrower `extractCrons`. Nothing asserts they agree,
so the O2 wiring set and the A22 watch set can diverge silently.

Tree restored; baseline 359 green.

---

## H3 — HIGH: the issue lookup regressed against the sibling it claims to share with

`scripts/ci/workflow-heartbeat.mjs:123-125`:

```js
const openIssues = await gh(`/repos/${repo}/issues?state=open&per_page=100`)
const findIssue = (title) =>
  openIssues.find((i) => i.title === title && (i.body ?? '').includes(ALERT_MARKER)) ?? null
```

`scripts/ci/notify-scheduled-failure.mjs:41-75` — the same author, the same
package family, the mechanism this file explicitly reuses — solves both hazards
and **documents them as verified against this repo**:

- *"`/issues` RETURNS PULL REQUESTS. … right now every open item on this
  repository is a PR. They are filtered explicitly; relying on the title+marker
  pair to exclude them would work by luck rather than by rule."* The new lookup
  has no `!i.pull_request` filter.
- *"One page is not all pages. Capped at 100, a busy backlog would hide the
  existing alert and the runner would open a duplicate every week."* The new
  lookup fetches one page, with no bound warning.

This directly falsifies the commit's claim that *"both mechanisms share ONE
issue per workflow via alertDecision's title+marker dedupe"*. They share a
`decideAlert`; they do **not** share a lookup, and the new one can fail to find
what the old one finds — producing a duplicate issue **every day** (the probe is
daily) rather than every week.

Currently latent: measured 1 open item, 0 PRs. Latent is not fixed, and the
sibling's own note says the PR-dominated state is the normal one here.

---

## H4 — HIGH: `actions: read` is not granted, and the verification did not use the workflow token

`.github/workflows/workflow-heartbeat.yml:37-39` grants `contents: read` and
`issues: write`. The comment three lines above (`:34-36`) states the rule
correctly — *"naming a permissions block zeroes every scope not listed"* — and
then omits the one scope the probe exists for. `workflow-heartbeat.mjs:76` calls
`/repos/{repo}/actions/workflows/{file}/runs`, which is governed by the
`actions` permission. `scheduled-failure-alert.yml` is not a precedent: its
runner touches only `/issues`.

The dry run in the commit body used `GITHUB_TOKEN="$(gh auth token)"` — a
full-scope user PAT. The workflow token has a strictly smaller permission set,
so **"verified against the real repository" does not cover the credential the
probe will actually run with**. Unauthenticated read of this endpoint returns
200 on this public repo, which is not the same question: the probe sends
`Authorization: Bearer`, and GitHub applies the token's permissions.

Both outcomes are bad and neither has been observed:

- **404** → the handler at `:86` classifies all five workflows as
  `unregistered` → `failure` → **five false issues opened** (the writes succeed;
  `issues: write` is granted).
- **403** → rethrown at `:86`, job exits non-zero, alert job opens an issue. The
  probe never works.

This is also the honest answer to review item 9: the realistic `-> 404` misfire
is a permissions 404 being read as "GitHub has no record of this workflow", not
a contrived body string. I could not construct a plausible misfire from the
string match itself.

**Fix:** add `actions: read`, and re-run the dry run with a token scoped to the
workflow's permission set before claiming verification.

---

## H5 — HIGH: `too-early` is silence, and a passing test ratifies it

`heartbeatDecision.mjs:98-104` returns `too-early` when `previousFire` yields
`null`. `toAlertConclusion` maps it to `'skipped'` → `INCONCLUSIVE` → `none`; no
ALERT flag; `unhealthy` counter not incremented; exit 0.

After the shift-back, `previousFire` returns `null` **only** for a cron that
never fires within `MAX_LOOKBACK_DAYS = 400`. So `too-early` has zero legitimate
instances and is reachable only from genuinely broken cadences:

```
cron '0 0 30 2 *' (fires never) -> too-early / skipped / decideAlert=none / console="     "
cron '0 0 31 4 *' (fires never) -> too-early / skipped / decideAlert=none / console="     "
cron '0 0 31 2 *' (fires never) -> too-early / skipped / decideAlert=none / console="     "
```

A leap-day cron (`0 0 29 2 *`) also returns `null` in a non-leap 400-day window —
confirmed: `null` at 2027-03-01, correct `2028-02-29` at 2028-03-01.

GitHub accepts these expressions and simply never fires them. The detail string
is actively misleading: *"has not yet been due longer ago than the 18h grace
window"* for a cadence that will never be due.

`__tests__/ci/heartbeatDecision.test.ts:147-154` is titled **"a cron that can
never fire is not silently treated as healthy"** and asserts
`toAlertConclusion(r.state)).toBe('skipped')` — which is exactly silence. Per
`Q-100` round 3: *a passing test that ratifies a bug is worse than no test.* It
also contradicts `cronSchedule.mjs:27-38`'s fail-closed docstring, which promises
that an unwatchable cadence becomes a violation rather than a skip.

**Fix:** `previousFire === null` is `unparseable` (or a new `never-fires`
state), mapping to `failure`.

---

## MEDIUM

**M1 — `cancelled` / `skipped` print ALERT and write nothing.**
`heartbeatDecision.mjs:134-145` returns `unhealthy`; `toAlertConclusion` passes
the raw conclusion through (`:180`); `alertDecision.mjs:52,83` treats both as
INCONCLUSIVE → `{action:'none'}`. But `workflow-heartbeat.mjs:112` flags them
`ALERT` and increments the counter. Console and issue system disagree.

```
run concluded 'cancelled' -> unhealthy / cancelled / decideAlert=none / console="ALERT"
run concluded 'skipped'   -> unhealthy / skipped   / decideAlert=none / console="ALERT"
```

Not hypothetical: `stryker-weekly` 2026-07-12 concluded `cancelled` (1 of 118
real scheduled runs). A workflow cancelled on every run — concurrency-group
cancellation is the realistic cause — is permanently silent while logging ALERT
to a log nobody reads.

**M2 — multi-cron workflows are half-unwatched, and the `< 24h` bound is a magic
literal.** `heartbeatDecision.mjs:105-106` keeps only the max due; the comment
*"the most recent one is what is owed"* is wrong — each cron is owed.
Demonstrated: `crons: ['0 2 * * *','0 14 * * *']`, 02:00 fire missed, 14:00 fire
green → **`healthy`**. Meanwhile `heartbeatDecision.test.ts:174-178` asserts
`GRACE_HOURS < 24` against a hardcoded 24 with nothing derived from the tree, so
adding a second cron 12h apart makes the docstring claim at `:34-38` false while
the test stays green. The property version computes the minimum inter-fire gap
across every cron in `.github/workflows/`. *Confirming review item 2: no cadence
gap shorter than 18h exists in the tree today — the claim is true now and
unguarded against becoming false.*

**M3 — `eventName: 'schedule'` is hardcoded.** `workflow-heartbeat.mjs:141`,
while `.yml:32` declares `workflow_dispatch:` and the sibling reads the real
event (`notify-scheduled-failure.mjs:20`). `GITHUB_EVENT_NAME` is a default
Actions variable, available and unread. Scheduled runs only execute the default
branch; a manual dispatch runs **any** branch, and the probe reads cadences from
the checked-out tree while reading runs from the default-branch schedule. A
branch that edits a cron (e.g. nightly → `0 6 * * 0`) produces a different due,
can reach `healthy`, and **closes a live outage issue** — precisely what
`alertDecision.mjs:66-69` was written to prevent.

**M4 — phantom cron from a `run:` block.** `cronSchedule.mjs:152-170` tracks no
indentation and no parent key. A shell heredoc writing a crontab or a k8s
CronJob manifest inside a `run:` step yields a cron for a **push-only**
workflow:

```
extractCrons(push-only workflow with a crontab heredoc) -> ["0 3 * * *"]
assessWorkflow(...) -> missing        (permanent false alert, healthy repo)
```

`event=schedule` returns nothing for such a workflow, so it reports `missing`
forever and opens a real issue.

**M5 — exactly one due is judged per probe run, and nothing asserts the probe is
fast enough.** `heartbeatDecision.mjs:89` picks a single `due`. If the probe's
own cadence is slower than a watched cadence, the intervening dues are judged by
nothing. Today `0 14 * * *` vs a weekday daily is adequate; changing the probe
to weekly would leave 4 of 5 nightly fires unjudged with no test failing.
Compounds with H1: a probe run that fails to start skips a due permanently, and
the probe cannot report its own miss. The commit measures four startup failures
per 60 runs across this repo's workflows, so a skipped probe run is a live rate,
not a thought experiment.

**M6 — the direct signal is ignored.** `/repos/{repo}/actions/workflows` returns
`state` per workflow (`active` / `disabled_inactivity` / `disabled_manually` /
`disabled_fork`). I confirmed it is populated on this repo. The probe never
reads it, so the 60-day-disable case — the stated reason for the due-time
framing — is detected only via `missing`, i.e. up to ~8 days late for the three
weekly workflows and (per C1) not at all for the daily one until the schedule
stops entirely. Worse, the `missing` detail at `:120-123` *asserts* the
inactivity cause it never checked, which is wrong operator guidance when the
real cause is `disabled_manually` or a single dropped fire.

**M7 — the probe and its own alert job fight over one issue in the same run.**
`workflow-heartbeat.mjs:107` includes `workflow-heartbeat.yml` in `results`, so
the probe may open "Scheduled workflow failing: workflow-heartbeat.yml"
(`unregistered` → `failure`). The probe then exits 0 (only `unparseable` exits
1, `:173-176`), so `needs.heartbeat.result` is `success` and the `alert` job at
`.yml:62-76` immediately **closes** the issue the probe just opened. Certain on
every branch dispatch and on the first post-merge run if registration lags.

---

## LOW

**L1 — the dow 7/0 fold is inconsistent, and one form guesses.**
`cronSchedule.mjs:73-74` folds `lo`/`hi` independently:

```
'0 8 * * 0-7' -> dow {0}          (crontab: EVERY DAY — silently narrowed 7x)
'0 8 * * 1-7' -> THROWS           (legitimate Mon-Sun)
'0 8 * * 5-7' -> THROWS
'0 8 * * 7'   -> dow {0}          correct
'0 5/10 * * *'-> hour {5}         (Vixie: 5,15,25,35,45,55)
```

The throwing cases are fail-closed and acceptable; `0-7` is the one that
**guesses**, and it guesses to a 7x-longer cadence, so a daily workflow would be
judged weekly. That contradicts `cronSchedule.mjs:22-25` ("Anything else is
REFUSED rather than guessed").

**L2 — `unregistered` opens a real issue for a healthy workflow.**
`workflow-heartbeat.mjs:86-94` maps a 404 to `failure`. A manual dispatch from a
branch that adds a scheduled workflow 404s that file and opens
"Scheduled workflow failing: X" for a workflow that is fine. The crash became an
alert; it is still a false positive.

**L3 — the issue-writing loop is unguarded.** `workflow-heartbeat.mjs:129-168`
has no `try`/`catch`. A secondary-rate-limit or permission failure on one write
aborts every alert after it in the same run; already-written ones stay. Retried
next run, but the run is silent about what it did not write.

---

## Categories that yielded nothing — stated, not padded

**Review item 1 — the lateness claim survives independent re-measurement, and
this is the strongest part of the diff.** I recomputed due times with my own
calculator (no import of `cronSchedule.mjs`, deliberately — using their parser
to validate their threshold would inherit any parser bug) over **118** scheduled
runs against the author's 65, pulling the full available history back to
2026-05-03 rather than 2026-08/09:

| workflow | n | max late | median | p95 |
|---|---|---|---|---|
| nightly-backtest | 76 | **11.85h** | 2.95h | 5.55h |
| refresh-data | 19 | 2.19h | 0.94h | 1.47h |
| a11y-axe | 9 | 5.53h | 3.43h | 5.53h |
| stryker-weekly | 14 | 5.69h | 2.34h | 4.04h |
| **all** | **118** | **11.85h** | — | 5.53h |

Zero runs above 12h; zero above 18h. The wider window does not move the max, so
the period was not chosen after seeing results. `run_attempt` is 1 for every
run in the tail, so re-runs are not inflating anything. The nightly *median*
does not reproduce (2.95h over full history vs the doc's 1.13h over Aug–Sep) —
window-dependent and not load-bearing; the max, which the threshold rests on, is
identical to the digit. `GRACE_HOURS = 18` is well calibrated, and an 87-day
replay of the probe over real history produced **zero** false `missing` for any
workflow.

**Review item 4 — `previousFire` boundary arithmetic is correct.** Year
boundary, month boundary, leap day 2028-02-29, `MAX_LOOKBACK_DAYS` at 364 and
401 days back, Sunday-as-7, hour/minute set interaction (`30 6,18 * * *` at
18:15 → 06:30, correct), `now` exactly on a fire, and sub-minute `now` all
return the right instant. The descending hour × descending minute scan with
`when <= now` is correct. The only defects in this module are H5 (null handling
downstream) and L1 (the dow fold).

**Review item 10 — rate limits yield nothing.** 6 API calls per run plus ≤3 per
alert, against 1000/hour for `GITHUB_TOKEN`. Not a concern. Partial failure is
L3. `issues: write` denial is loud (rethrow → non-zero exit → alert job).

**Review item 9 — the `-> 404` string match itself.** I could not construct a
plausible non-404 error whose body contains that substring. The real misfire is
H4 (a permissions 404 read as "unregistered"), which is a permissions defect,
not a string-matching one.

**Review item 2 — no sub-18h cadence gap exists in this tree.** The weekday
`0 6 * * 1-5` gap across a weekend is 72h, not shorter; the minimum over all
five scheduled workflows is 24h. The claim is true today. It is unguarded (M2)
and, per C1, being true is not sufficient — the 18h grace still opens a window
that spans two fires.

**Not re-reported:** the `describe('Q107-A22 — what this probe CANNOT do')`
block correctly declares the permanent-watchman gap, the hung-vs-slow run
limitation, non-scheduled workflows, "green run ≠ correct work", and detection
latency. Those are honest and are excluded above. H1 is in scope because that
block claims the *intermittent* half is covered, and it is not.

---

## Suggested order of work

1. **C1** — bound the run window to the judged period. Add a test that presents
   a run belonging to a *later* fire and asserts the earlier fire is still
   judged. Without this the probe's headline capability does not exist.
2. **H4** — add `actions: read`; re-verify with a workflow-scoped token.
3. **H1** — exclude the probe's own run; replace the membership assertion with a
   real `assessWorkflow` call on the self case.
4. **H5** — `previousFire === null` must map to `failure`; retitle or delete the
   test that ratifies the current behaviour.
5. **H2** — flag `crons.length === 0` on a file whose source matches
   `/^\s*schedule:/m` instead of filtering it out; derive the watch-list
   assertion from the same detector `scheduled-alerts.test.ts:31` uses.
6. **H3** — reuse `findOpen` from `notify-scheduled-failure.mjs` rather than
   reimplementing it.
