# sre-devops inbox — Q-107 rectification wave (2026-08-29)

Territory: `.github/workflows/`, `package.json`, `workspace/VERCEL_OPERATIONS.md`,
`vitest.config.ts`, `stryker.conf.*`. Ids reserved: `Q107-O1`…`Q107-O19`.
Read-only throughout — no source/workflow/settings edits, no mutating `gh api` calls.

**Headline, read this first:** Q-097 and the free sweep converge on one story.
`refresh-data.yml` is **currently broken in production** — its first live run after
`Q-102` shipped failed, has stayed failed for a week, and nothing told anyone.
Turning on branch protection cannot make that worse today, but it *will* make it
permanently unfixable by the bot's current mechanism unless the push path is
addressed in the same change. See Q107-O1/O2/O3 — they are one defect, not three.

---

## 1. `Q-097` — branch protection runbook

### 1.1 Verified state (read-only, 2026-08-29)

```
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/branches/main
```
`protected: false`, `protection.enabled: false`,
`protection.required_status_checks: {enforcement_level: "off", contexts: [], checks: []}`.

```
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/rulesets
```
`[]` — no rulesets either. **CONFIRMED still true**, matches `CLAUDE.md` I7 exactly.

### 1.2 Check names — verified against real commits, not guessed

I checked both a **push-to-main** commit and **two PR head SHAs** (PR heads matter —
required status checks are evaluated on the PR head, not the merge commit):

| Name | Verified on | Producer |
|---|---|---|
| `typecheck` | push `8b3d7cd`, PR #168 head `af1e52c`, PR #166 head `e0018cc` | `.github/workflows/ci.yml:15-27` |
| `test` | same three | `ci.yml:29-41` |
| `coverage` | same three | `ci.yml:44-57` |
| `benchmark` | same three | `ci.yml:61-101` — **see Q107-O4, name collision** |
| `smoke` | same three | `ci.yml:103-118` |
| `Vercel` | same three (commit **status**, not a check-run — `context: "Vercel"`) | Vercel GitHub App |

Exact commands used:
```bash
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/pulls/168 --jq '.head.sha'
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/commits/<SHA>/status --jq '.statuses[].context'
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/commits/<SHA>/check-runs --jq '.check_runs[].name'
```
Repeated on PR #166's head independently — same six names both times. **CONFIRMED.**

One correction to `VERCEL_OPERATIONS.md`: §1/§3/§8 call it "Vercel – quantan" in
prose. The actual API context string is exactly `Vercel` (no suffix). Use `Vercel`
verbatim in the required-checks list — a required check with the wrong string
never resolves and blocks every PR forever (the exact foot-gun flagged in the
task brief). There is also a `Vercel Preview Comments` check-run on PR heads
(the bot-comment feature) — **do not require this one**, it is decoration, not
the deploy gate.

### 1.3 What breaks — sequence this or you brick the weekly refresh

**CONFIRMED (not a guess): the weekly refresh is already broken**, independent of
branch protection. Latest run:

```
gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/actions/workflows/refresh-data.yml/runs?per_page=8
→ run 32670176978, 2026-08-23T22:18Z, conclusion: failure
```
Job log, step "Refresh backtest data from Yahoo Finance":
```
Done. Success: 20 | Failed: 36
FAIL: 36 instrument(s) did not refresh cleanly
##[error]Process completed with exit code 1.
```
Every one of the 36 failures is the same shape: a **volume-only** change on a bar
that is a *week or more* old (e.g. `[NFLX] REFUSED to save NFLX: VENDOR
RESTATEMENT: 1 existing bar(s) changed value (1786714200 volume 26705100 ->
26751000)` — bar `1786714200` = 2026-08-14 13:30 UTC, the open of the session the
*prior* successful run (2026-08-16) had already captured). Root cause (outside my
territory, read for context only — cross-check with `data-integrity`):
`scripts/lib/dataVintage.mjs:45-49`'s `near()` uses a `1e-9` relative tolerance on
**every** OHLCV field including `volume`, and `scripts/fetchBacktestData.mjs:128-141`
fails closed on any mismatch. Yahoo routinely finalizes a session's consolidated
volume days to weeks after the session — this is expected vendor behaviour, not a
restatement — so the guard added by `Q-102` (`a79344e`, 2026-08-21) trips on
**every** ticker whose volume Yahoo has since finalized. This is structural, not a
fluke: **the first live run after the guard shipped failed**, and the mechanism
that produced the failure will very likely reproduce it on the next scheduled run
(tomorrow, 2026-08-30) and every run after, until a tolerance is added for
`volume` specifically (OHLC-price restatement is the case I4 actually cares about;
treating a same-magnitude-as-noise volume revision identically is the bug).

**Consequence nobody has seen yet:** the fetch step fails *before* the "Assert
fixture freshness" step runs (it shows `skipped` in the job), so the one check
built to quantify staleness never fires in the failure mode that produces
staleness. `scripts/backtestData/` is now **15 days stale** (newest committed bar
2026-08-14, today 2026-08-29) with nothing surfacing that number anywhere a human
looks. → **Q107-O1.**

**Why this matters for sequencing, precisely:** because the push step already
never runs today (the job dies two steps earlier), **enabling branch protection
right now changes nothing about the refresh's current failure mode** — it is
already fully broken. But the inverse is the trap: if someone fixes the
volume-tolerance bug *first*, the refresh will start reaching
`git push origin HEAD:main` (`refresh-data.yml:137`) again, and *that* is where
required status checks bite. Required-status-check protection rejects a direct
push whose tip commit has no passing check results for that exact SHA — and it
cannot have any, because `ci.yml`'s `push:` trigger only fires *after* a
successful push (chicken-and-egg). **PLAUSIBLE, not confirmed** — this is
predicted from documented GitHub branch-protection semantics
("commits must first be pushed to another branch... before a branch protected by
required status checks"), not something I can trigger read-only. Expected failure
mode: `git push` returns non-zero with `GH006: Protected branch update failed`
and a line naming the first missing required check. **Do the two fixes in the
same change, or whoever lands the tolerance fix will watch the refresh go green
for real and then immediately "regress" when protection lands the following
week, and will spend a session chasing a phantom caused by their own fix.**

Two ways to keep the bot push alive once protection is on — present both, owner
decides:

**(a) Retarget the bot to a PR-based flow** (workflow edit, out of my remit —
queue as backlog): `refresh-data.yml` pushes to a branch and opens/updates a PR
instead of `HEAD:main`; the PR then goes through normal required checks and the
owner (or an auto-merge rule scoped to that one workflow) merges it. Correct
long-term fix, matches I7's "work on branches" directly, costs one workflow edit.

**(b) Use a Ruleset with a bypass actor** (no workflow edit; owner-only, UI):
GitHub Rulesets (the repo has none — `rulesets: []`, greenfield) support a
**bypass list** that can name a specific GitHub App, including
`github-actions`, so the bot's direct push is exempted from the ruleset's
required-checks rule while every human/PR path still enforces it.
`Settings → Rules → Rulesets → New branch ruleset` (steps in 1.4). Faster to turn
on, but keeps a live "checks don't apply to this actor" exception — document it
loudly next to the ruleset so a future audit doesn't read the bypass as a gap.

### 1.4 Exact owner steps

**Recommended path: Rulesets, not classic branch protection** — same effect,
adds the bypass-list escape hatch (a) doesn't need and classic protection can't
give as precisely (classic only has an all-or-nothing "include administrators"
toggle, not a per-app bypass).

1. **First** — fix or explicitly accept the refresh-data.yml break (§1.3). Do not
   skip this step; it determines whether the bot push needs a bypass actor at all
   *this week*.
2. GitHub → repo **Settings → Rules → Rulesets → New branch ruleset**.
3. Name: `main-protection`. Enforcement status: **Active**.
4. Target branches: `Include default branch` (resolves to `main`).
5. Rules to enable:
   - **Require status checks to pass** → add checks by exact name:
     `typecheck`, `test`, `Vercel`. (Not `coverage`, not `smoke`, not `benchmark`
     yet — see tiering below.)
   - Leave **"Require branches to be up to date before merging" OFF** initially
     (`strict: false`). With five parallel agents landing PRs and a weekly bot
     push, `strict: true` invalidates every open PR on each merge and serializes
     the whole queue — turn it on later once merge cadence is calmer, not on
     day one.
   - Do **NOT** enable "Require pull request reviews" — this is a single-owner
     repo; a required second approval locks the owner out of their own merges.
     Out of scope for Q-097 anyway (Q-097 is about CI gates, not code review).
6. **Bypass list** (only if going with option (b) above): add the
   `github-actions` GitHub App, scoped to "push" bypass only if the UI offers
   granularity — otherwise document that this bypass is broad and revisit once
   (a) lands.
7. Save. Then **verify without merging anything**:
   ```bash
   gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/rulesets --jq '.[].name'
   gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/branches/main --jq '.protection'
   ```
8. Open a throwaway PR (e.g. a one-line comment change) and confirm the required
   checks actually show as "Required" in the PR's checks UI before relying on it
   — a required check with a name that doesn't resolve shows as permanently
   "Expected", not red, and is easy to miss on a first look.

**Tiering — require these first, add the rest after one clean week:**

| Check | Require now? | Why |
|---|---|---|
| `typecheck` | Yes | Fast, deterministic, zero false-fail history found |
| `test` | Yes | Same — but see Q107-O6, it doesn't enforce the 798-test floor it cites |
| `Vercel` | Yes | Only gate that catches Next.js route-config errors (static-analysis can't) |
| `coverage` | After 1 clean cycle | `test:coverage` enforces thresholds (80/80/70/80, `vitest.config.ts:83-88`) — real, but confirm no live red streak first |
| `smoke` | After 1 clean cycle | Depends on `typecheck`+`test` (`ci.yml:105`) — see Q107-O5, a dependency failure shows as *skipped*, which a required check reads as "waiting forever," not "failed" |
| `benchmark` | **No** | Two independent reasons, both cited: (1) `scripts/lib/dataVintage.mjs:34-36` records the primary edge gate sits "0.10pp above its floor" — a routine data refresh can trip it, and a required `benchmark` turns a data event into a total merge freeze, including the revert PR that would fix it; (2) **name collision**, Q107-O4 |

### 1.5 Rollback drill (Q-097 acceptance criterion)

**No rollback procedure is defined anywhere in the repo.**
`grep -rn -i rollback workspace/ reviews/` returns exactly one hit:
`workspace/VERCEL_OPERATIONS.md:351` — *"Do not run without explicit request:
`vercel deploy --prod`, `vercel promote`, `vercel rollback`."* That line is an
**agent** prohibition (correctly, so an agent never self-authorizes a prod
mutation) — it is not a documented owner procedure, and nothing else fills the
gap.

**The good news: branch protection and rollback speed are unrelated if the
rollback path is Vercel-side, not git-side.** Vercel keeps every prior deployment
as an immutable build; "rollback" means pointing the `quantan.vercel.app` alias at
a previous deployment, which requires **no push to `main` at all**. That makes it
fully decoupled from whatever branch protection is doing — the drill does not
get slower once Q-097 lands, which directly answers the "does the owner brick
themselves" half of the question for rollback (as opposed to the weekly-refresh
half, which does interact, per §1.3).

**Proposed drill, for the owner to run and time (not performed here — Vercel
mutations are explicitly out of scope for this agent):**
1. `vercel deployments list --project quantan | head -20` — confirm the previous
   production deployment's ID.
2. Note the current wall-clock time (T0 = "decision to roll back").
3. `vercel rollback <previous-deployment-url-or-id> --project quantan` **or**
   Vercel Dashboard → Deployments → previous entry → "Promote to Production".
4. `curl -sI https://quantan.vercel.app` until the response changes (or check
   the dashboard's "Current" marker move) — note T1 ("prod confirmed serving
   prior build").
5. Record T1−T0 in `VERCEL_OPERATIONS.md` as the measured time-to-restore. A
   drill that isn't timed is a procedure, not a drill, and Q-097's acceptance
   criterion asks for the latter.
6. Propose (do not perform) adding a short **owner-only** "Incident: rollback"
   section to `VERCEL_OPERATIONS.md`, separate from and not replacing the
   existing agent prohibition at line 351 — the two audiences need different
   text in the same file.

---

## 2. `Q-093` — the lint gap

**Verified still true, precisely:**
- `package.json` scripts: no `lint` key (`grep -n '"lint"' package.json` → no hit).
- No config on disk: `.eslintrc*`, `eslint.config.*` → no matches.
- Not installed as a project dependency: zero `eslint` entries in
  `devDependencies`/`dependencies`.
- **Correction to avoid a false claim of my own:** `package-lock.json` DOES
  contain `eslint` — 10 hits. These are **transitive/peer references pulled in by
  `next`'s own dependency tree**, not a root devDependency and not a runnable
  local install; `npx eslint` would still need to resolve and install a
  compatible version. Stating "zero eslint anywhere" without this line is exactly
  the kind of claim this repo's own review history has been burned by (grep the
  wrong file, state a clean negative, get falsified next round) — so: **no lint
  script, no tracked config, no root dependency, zero workflow references. Verify
  with the same four greps above.**
- Zero workflow references: confirmed via `grep -rn "eslint\|lint" .github/workflows/*.yml` (see §3 sweep grep, no hits).

**Recommendation: (b) — but it's "finish deleting," not "delete."**
`CLAUDE.md`'s `WHAT "DONE" MEANS` section already has the clause struck through:
*"Tests pass · types check · ~~lint clean~~ · ..."*, with a paragraph directly
below explaining why, and the I7 tier's "Related:" note already agrees with that
strikethrough — both sections of the constitution have, in prose, already chosen
direction (b). **What hasn't closed is procedural, not textual:** `Q-093` is
still open in the backlog with no resolution recorded, so anyone who reads only
`workspace/IMPROVEMENT_BACKLOG.json` (not the `CLAUDE.md` prose) sees an open
question that the prose already answered. **Propose:** close `Q-093` in
`workspace/IMPROVEMENT_BACKLOG.json` as "resolved by deletion, matches `WHAT DONE
MEANS`'s existing strikethrough" rather than leaving it open as if the decision
were still pending — a backlog row and a doc that disagree about whether a
question is settled is a small instance of the project's recurring
two-sources-of-truth failure mode. (Backlog edit is not mine to make — outside my
one output file.)

**Why not (a) here:** given as ONE MORE recommendation, not a re-litigation —
adding ESLint now, unowned by any territory in this wave, with an unknown but
plausibly large pre-existing violation count (I did not run `npx eslint` to
count — that needs a network install and touches `node_modules`/lockfile state,
out of bounds for a read-only sweep, and the count doesn't change the
recommendation either way), risks landing exactly the failure pattern this
project keeps re-discovering: a gate shipped with `continue-on-error` to dodge
the violation count (advisory dressed as enforcing — precisely what task 3 asks
me to hunt for) or a gate that immediately blocks every PR and gets
learned-ignored. If a future session takes direction (a) instead, land it as
`--max-warnings=0` scoped to `git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx'`
(lint only changed files) rather than the whole tree, so day one is green without
a baseline-suppression file that silently exempts 500 pre-existing lines forever.

---

## 3. Free sweep — advisory-as-gating, silent failure, scheduled work

### Q107-O1 — `refresh-data.yml` is currently broken (CONFIRMED)
See §1.3 in full. `.github/workflows/refresh-data.yml:31` (fetch step) has failed
on its last scheduled run (`32670176978`, 2026-08-23) and every run since
`Q-102` shipped (`a79344e`, 2026-08-21) is at risk of the same failure, because
`scripts/lib/dataVintage.mjs:45-49`'s zero-tolerance `near()` treats routine
Yahoo volume finalization as a restatement. `scripts/backtestData/` is 15 days
stale as of 2026-08-29 and getting staler every unfixed week. Root-cause fix is
outside my territory (`scripts/lib/dataVintage.mjs`) — flagging for
`data-integrity`'s territory, cross-referenced here because the *symptom*
(a scheduled workflow silently red) is squarely mine.

### Q107-O2 — no scheduled workflow alerts on failure (CONFIRMED)
None of the four scheduled workflows (`a11y-axe.yml`, `stryker-weekly.yml`,
`nightly-backtest.yml`, `refresh-data.yml`) opens an issue, sends a notification,
or does anything beyond leaving a red run in the Actions tab on failure. This is
*why* Q107-O1 sat unnoticed for a week and appears nowhere in
`workspace/SESSION_STATE.json` or `MEMORY_LOG.md` — GitHub's default email
notification for a scheduled-workflow failure goes to whoever is watching the
repo, is easy to miss, and is not a machine-readable record. This is exactly the
standing recommendation in `CLAUDE.md`'s "Automation is the highest leverage"
section (*"a scheduled data-quality scorecard... that opens an issue on
failure"*) — unimplemented across all four jobs, not just the data-quality one
that section names. Cheap, generic fix: a single reusable step —
```yaml
- if: failure()
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.create({
        owner: context.repo.owner, repo: context.repo.repo,
        title: `${context.workflow} failed on ${context.sha.slice(0,7)}`,
        body: `Run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
        labels: ['ci-failure']
      })
```
appended to each of the four workflows would close this in one PR. Workflow edit,
queue as backlog, not performed here.

### Q107-O3 — Q-097 sequencing hazard (PLAUSIBLE, argued in full in §1.3)
Fixing Q107-O1's tolerance bug and enabling branch protection must land together
or in the right order, or a future session will misattribute the second failure
to the first fix.

### Q107-O4 — `benchmark` job-name collision across two workflows (CONFIRMED name collision; PLAUSIBLE as a bypass vector)
`ci.yml:61` and `nightly-backtest.yml:20` both declare a job literally named
`benchmark`, and GitHub Actions check-run names default to the job name with no
workflow prefix. Verified directly: commit `8b3d7cd` carries **two** check-runs
named `benchmark` — one from CI run `33183897446` (push-triggered), one from
Nightly Benchmark run `33196587966` (schedule-triggered, `event: schedule`,
`created_at` two hours later). Today this is cosmetic (nightly-backtest.yml has
no `pull_request` trigger, so it can't satisfy a required check on a PR head in
the normal course). But `nightly-backtest.yml` does have `workflow_dispatch`,
which accepts a `ref` — dispatching it against a feature branch would produce a
check-run named `benchmark` on that branch's tip commit **without ci.yml's
benchmark ever having run**, and if `benchmark` were later added as a required
check, that dispatch would satisfy it. **PLAUSIBLE, not exploited or tested** —
flagging as an argument for renaming one of the two jobs (e.g.
`nightly-benchmark`) independent of whether `benchmark` is ever required.

### Q107-O5 — `smoke`'s dependency makes "skipped" look like "pending forever" (CONFIRMED mechanism, PLAUSIBLE UX confusion)
`ci.yml:105` — `smoke` has `needs: [typecheck, test]`. If either upstream job
fails, `smoke` reports `skipped`, not `failure`. Under required-status-checks, a
skipped required check does not turn the merge box red — it shows "Expected —
waiting for status," identical to a check that simply hasn't started yet. A
reviewer scanning for red will see one clear failure (`typecheck` or `test`) and
one ambiguous grey one, which reads as "still running" rather than "blocked by
the failure above." Worth a one-line note in the runbook, not a code change.

### Q107-O6 — the `test` job's "798 tests" floor is a comment, not a gate (CONFIRMED)
`ci.yml:42` — `# Floor: 798 tests (per reviews/invariants-baseline.md §3...)` sits
directly above `run: npm run test`, which is `vitest run` with no count
assertion anywhere. Grepped `.github/workflows/`, `scripts/*.mjs`, `scripts/*.ts`
for `798` — the only hit is that comment. A PR that deletes hundreds of tests
while keeping the remainder passing produces a **green `test` check**, silently
regressing the baseline floor in `reviews/invariants-baseline.md` with nothing
in CI enforcing it. This is a "green check doesn't mean what a reader would
assume" instance for task 3. Cheap fix (not performed — workflow edit): add a
`--reporter=json` count assertion analogous to the freshness/WR-floor checks
already used elsewhere in these workflows.

### Q107-O7 — `CLAUDE.md`'s lint clause: backlog vs. prose disagree on whether it's settled (see §2)
Not a code defect — a documentation-consistency gap. Propose closing `Q-093` in
`workspace/IMPROVEMENT_BACKLOG.json` to match the prose decision already made in
`WHAT "DONE" MEANS`. Not performed here (single output file).

### Q107-O8 — `refresh-data.yml` pins older action versions (CONFIRMED, low priority)
`refresh-data.yml:16,19` use `actions/checkout@v4` / `actions/setup-node@v4`;
every other workflow (`ci.yml`, `a11y-axe.yml`, `nightly-backtest.yml`,
`stryker-weekly.yml`) uses `@v5`. No known behavioural difference found; flagging
as drift worth folding into whichever PR next touches this file rather than a
standalone change.

### Confirmed-clean, no new finding
- `a11y-axe.yml:20` `continue-on-error: true`, schedule + `workflow_dispatch`
  only, no `pull_request` trigger — matches `CLAUDE.md`'s "schedule-only AND
  advisory" description exactly. Also fires on schedule per run history (last:
  2026-08-24, success) — not a silent-never-runs case.
- `stryker-weekly.yml` — no `continue-on-error` (removed per its own header
  comment, `:7-11`); confirmed via grep. Not triggered on `pull_request` —
  matches "Stryker does not run on PRs." Last four scheduled runs (through
  2026-08-23) all `success`, all four shards green — the gate is firing and
  passing, not just configured.
- `nightly-backtest.yml` — hard `process.exit(1)` on floor breach, no
  `continue-on-error`; it cannot gate PRs (no `pull_request` trigger) and isn't
  claimed to.
- Only one `continue-on-error` in the entire `.github/workflows/` tree
  (`a11y-axe.yml:20`); only one `|| true` / silent-exit pattern
  (`refresh-data.yml:133`, and that one is the *intended* no-diff-is-not-a-failure
  branch, correctly gated behind the freshness assertion above it — not a
  silent-failure smell on its own).

---

## Ranked list

**Owner action (GitHub/Vercel settings — exact steps above, not executable by any agent):**
1. **Fix-then-protect sequencing (§1.3/1.4).** Do not enable branch protection
   before deciding how `refresh-data.yml`'s push survives it (option (a) PR-flow
   or (b) ruleset bypass). This is the P0 — skipping it either bricks the weekly
   refresh a second, more confusing way, or the owner enables protection, sees
   the refresh "still broken," and never realizes protection is now also a factor.
2. **Enable a Ruleset on `main`** per §1.4, tiered checks (`typecheck`, `test`,
   `Vercel` first; `coverage`/`smoke` after one clean cycle; **not** `benchmark`).
3. **Run and time the rollback drill (§1.5)** — Vercel-side, decoupled from (2),
   can happen independently and immediately.
4. **Revoke/rotate the credential at `start-universal.sh:12`** — already flagged
   in `CLAUDE.md` under `Q-100`/`I8`, restated here only because it is the single
   most urgent item in the repo and this sweep touched the same file family.

**Implement now (code — queue as backlog, not performed by this agent):**
1. **Q107-O1** — add a `volume`-specific tolerance to `scripts/lib/dataVintage.mjs`'s
   `near()` (or drop `volume` from the restated-field check entirely and log it
   informationally) so the weekly refresh stops failing on routine Yahoo
   volume finalization. Time-sensitive: the next scheduled run is 2026-08-30 and
   will very likely fail identically. Cross-file with `data-integrity`.
2. **Q107-O2** — add an `if: failure()` issue-opening step to all four scheduled
   workflows. One small, high-leverage PR; template given above.
3. **Q107-O4** — rename `nightly-backtest.yml`'s `benchmark` job to something
   distinct (e.g. `nightly-benchmark`) to remove the name collision before it
   matters.
4. **Q107-O6** — add a numeric test-count floor assertion to the `test` job,
   matching the pattern already used for the WR floor and fixture freshness
   elsewhere in these same workflows.
5. **Q107-O7** — close `Q-093` in the backlog to match the decision already made
   in `CLAUDE.md` prose (delete-direction), so the two stop disagreeing about
   whether the question is open.
6. **Q107-O8** — bump `refresh-data.yml`'s action versions to `@v5` for
   consistency (low priority, fold into the next touch of this file).

**Not recommended:** adding ESLint (`Q-093` direction (a)) as a standalone piece
of this wave — see §2 for the full reasoning (unowned territory, unknown
violation count, high risk of landing as either advisory-dressed-as-gating or an
immediately-ignored red gate, both of which are exactly the failure pattern this
wave exists to close, not add).
