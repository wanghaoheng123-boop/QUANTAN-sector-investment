# Q-079 — Design invariant I7 audit: "Main is always deployable"

**Audited:** 2026-08-17
**Auditor:** Claude Code (read-only GitHub; `gh api` GET only)
**Repo:** `wanghaoheng123-boop/QUANTAN-sector-investment` (public, default branch `main`)
**Worktree:** `.claude/worktrees/sweet-dubinsky-4e07b2`, synced to `origin/main`
**Scope:** I7 only. No files changed except this one. No GitHub state changed.

---

## VERDICT

| | |
|---|---|
| **CURRENT TIER (CLAUDE.md, inferred 2026-08-15)** | **ENFORCED** |
| **PROPOSED TIER** | **VIOLATED** |

**One-sentence justification:** There is no branch protection, no ruleset and no
required status check of any kind on `main` (`"protected": false`,
`contexts: []`, `rulesets: []`), so nothing can block a merge — and a *live,
recurring* path (`.github/workflows/refresh-data.yml:137`) pushes commits
directly to `main` every Sunday with zero CI, auto-deploying them to
production, which is the exact opposite of what I7 prohibits.

### Why not PARTIAL

PARTIAL would be correct if the only counter-evidence were the two historical
human direct pushes (`3f27ef2`, `f6672cf`). It is not. The bot push path is
scheduled, still firing (last: `2d71ceb`, 2026-08-16), and by design bypasses
every quality job. Anticipated counter-argument: *"the refresh has a freshness
gate (`refresh-data.yml:52-113`), so the push is sanctioned."* That gate
validates the **data fixtures**, not that the application typechecks, tests
green, or builds against them; and a sanctioned violation is still a violation
under this vocabulary. Two further empirical facts independently break the
"CI must be green before merge" clause (PR #120; `e49b1d1`), so even setting
the bot path aside the ENFORCED claim is falsified.

### Clause-by-clause (I7 is a composite claim)

| I7 clause | Tier | Evidence anchor |
|---|---|---|
| "Work on branches" | PARTIAL | 35/40 recent first-parent commits are PR merges; 5 are direct pushes |
| "NEVER commit directly to main" (DEPLOY PROTOCOL) | **VIOLATED** | `refresh-data.yml:137`; `3f27ef2`, `f6672cf` have no associated PR |
| "CI must be green before merge" | **VIOLATED** | PR #120 merged 49s after `coverage: failure` |
| "Never push a broken `main`" | **VIOLATED** | `e49b1d1`: `test: failure` on main, deployed to production |
| "Merging the PR **is** the deploy" | ACCURATE (factual claim, not a rule) | GitHub Deployments API shows `env=Production` per main SHA |
| "Never leave the repo mid-refactor" | UNVERIFIED | Not mechanically checkable; no gate exists for it |

The composite label is **VIOLATED**: the vocabulary is strictly applied, and a
live path actively does the opposite.

---

## 1. BRANCH PROTECTION — RAW RESULTS

### 1a. The endpoint the task asked for (returned 503, four times)

```
$ gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/branches/main/protection
HTTP/2.0 503 Service Unavailable
X-Github-Request-Id: C4F0:1FE79:269C94:27F693:6A8318E8
Date: Mon, 17 Aug 2026 14:21:29 GMT

{"message": "No server is currently available to service your request. Sorry about that. Please try resubmitting your request and contact us if the problem persists."}
gh: ... (HTTP 503)
```

Attempted 4×, ~10 minutes apart, always HTTP 503. I never obtained the
canonical `404 {"message":"Branch not protected"}`. **This is a named blind
spot** — see §7. Three other endpoints corroborate the answer unambiguously.

### 1b. `GET /branches/main` — AUTHORITATIVE, and it answers the question

```
$ gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/branches/main \
    --jq '{name,protected,protection,protection_url}'
{"name":"main",
 "protected":false,
 "protection":{"enabled":false,
   "required_status_checks":{"checks":[],"contexts":[],"enforcement_level":"off"}},
 "protection_url":"https://api.github.com/repos/.../branches/main/protection"}
```

`protected: false` · `enabled: false` · `contexts: []` · `enforcement_level: "off"`.

### 1c. Rulesets — none

```
$ gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/rulesets
[]

$ gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment/rules/branches/main
[]
```

`/rules/branches/main` is the definitive "what rules actually apply to this
branch" endpoint (it aggregates org + repo rulesets). It returns `[]`.

### 1d. Plan availability — protection is available and simply unconfigured

```
$ gh api repos/wanghaoheng123-boop/QUANTAN-sector-investment
  "private": false,
  "visibility": "public",
  "owner": {"login":"wanghaoheng123-boop","type":"User"},
  "default_branch": "main",
  "permissions": {"admin":true,...},
  "allow_auto_merge": false,
  "delete_branch_on_merge": false,
  "security_and_analysis": {"secret_scanning":{"status":"enabled"},
                            "secret_scanning_push_protection":{"status":"enabled"}}
```

The repo is **public**, so branch protection and required status checks are
available on the free plan at no cost. The free-private-repo caveat in the task
brief does **not** apply. Protection is **unconfigured, not unavailable** —
there is no plan-based excuse.

**Plain answer:** *There is no branch protection on `main`. None. Not via the
classic protection API, not via rulesets. Nothing on GitHub prevents a direct
push to `main`, and no status check is required to merge a PR.*

---

## 2. WORKFLOW INVENTORY — the true blocking set

Directory: `.github/workflows/` — five files, complete list.

| # | Workflow (file) | Trigger(s) | Jobs | `continue-on-error`? | Runs on PR? | **Required (blocking)?** |
|---|---|---|---|---|---|---|
| 1 | `ci.yml` | `push: [main]` (`:9-10`), `pull_request: [main]` (`:11-12`) | `typecheck`, `test`, `coverage`, `benchmark`, `smoke` | **No** — grep for `continue-on-error` returns zero hits in this file | Yes | **NO** — `contexts: []` |
| 2 | `a11y-axe.yml` | `workflow_dispatch` (`:12`), `schedule 0 1 * * 1` (`:13-15`) | `axe` | **YES**, job-level `continue-on-error: true` at `:20` | **No** | **NO** |
| 3 | `stryker-weekly.yml` | `schedule 0 8 * * 0` (`:37-38`), `workflow_dispatch` (`:39`) | `stryker` × 4 shards | No (removed 2026-08-02, per header `:7-11`) | **No** — no `pull_request` trigger | **NO** |
| 4 | `nightly-backtest.yml` | `schedule 0 6 * * 1-5` (`:15-16`), `workflow_dispatch` (`:17`) | `benchmark` | No | **No** | **NO** |
| 5 | `refresh-data.yml` | `schedule 0 22 * * 0` (`:5-6`), `workflow_dispatch` (`:7`) | `refresh` (`permissions: contents: write`, `:9-10`) | No | **No** | **NO** — *and it WRITES to main*, `:137` |

Plus one non-Actions check, observed on PR head SHAs:

| Check | Source | Required? |
|---|---|---|
| `Vercel` (commit **status**, `state=success`) | Vercel GitHub integration | **NO** — `contexts: []` |
| `Vercel Preview Comments` (check-run) | Vercel GitHub integration | **NO** |

### The true blocking set

**EMPTY.** Zero checks are required. Every check on this repo is advisory in
the merge sense, because `required_status_checks.contexts` is `[]` and no
ruleset exists. A PR can be merged with every job red.

### Known traps — each verified individually

| Claimed trap | Verdict | Evidence |
|---|---|---|
| a11y workflow is schedule-only | **CONFIRMED** | `a11y-axe.yml:11-15` — only `workflow_dispatch` + `schedule '0 1 * * 1'`. No `pull_request`, no `push`. |
| a11y workflow is advisory (`continue-on-error`) | **CONFIRMED**, and worse than stated | `a11y-axe.yml:20` `continue-on-error: true` at **job** level. Empirically: 6 most recent runs all report **run conclusion `success`**, while the `axe` **check-run** conclusion was `failure` on 4 of the head SHAs (`0c25245`, `a12ff7d`, `84ec79a`, `f6672cf`). The badge is green while the job is red. Most recent run (`31987486022`, sha `2d71ceb`, 2026-08-17) is genuinely `axe:success`. |
| Stryker does not run on PRs | **CONFIRMED** | `stryker-weekly.yml:36-39` — no `pull_request` trigger. Last 6 runs: `event=schedule` ×4, `event=workflow_dispatch` ×2, zero `pull_request`. It gates *its own workflow* (`continue-on-error` removed 2026-08-02) but gates **no merge**. |
| `npm run check:ci` is required | **REFUTED** | `grep -rn 'check:ci' .github/workflows/` → **zero hits**. No workflow ever runs `check:ci`. |
| `npm run benchmark` is required | **PARTIALLY REFUTED** | It *runs* on PRs (`ci.yml:73`) with a real WR floor gate (`ci.yml:74-101`), but it is not a *required* check, so a red benchmark does not block a merge. |

### Scheduled-work verification (per standing orders: check run history, not config)

| Workflow | Configured cadence | Actually fired? |
|---|---|---|
| `stryker-weekly.yml` | Sundays 08:00 UTC | **YES** — `event=schedule` 2026-08-16, 08-09, 08-02, 07-26, all `success` |
| `a11y-axe.yml` | Mondays 01:00 UTC | **YES** — `event=schedule` 2026-08-17, 08-10, 08-03, 07-27 |
| `refresh-data.yml` | Sundays 22:00 UTC | **YES** — produced `2d71ceb` (2026-08-16), `0c25245` (08-09), `a12ff7d` (08-02), `84ec79a` (07-26) |
| `nightly-backtest.yml` | Mon–Fri 06:00 UTC | **YES** — multiple `benchmark` check-runs attached to each main head SHA |

None of these are silent. That is the one part of the ops story that holds up.

---

## 3. DIRECT-PUSH HISTORY — CAN IT HAPPEN? IT DOES.

Structurally: yes, trivially — `protected: false` and `permissions.admin: true`
for the owner account. Empirically, from
`git log --first-parent --oneline -40 origin/main`:

**Five of the 40 most recent first-parent commits on `main` have no associated
pull request.** Verified per-SHA with
`gh api repos/.../commits/<sha>/pulls` → literal output `NO ASSOCIATED PR`.

| SHA | Author | Date | Subject | PR? | CI (`ci.yml`) ran? |
|---|---|---|---|---|---|
| `2d71ceb` | `github-actions[bot]` | 2026-08-16 | `chore(data): weekly backtest data refresh (2026-08-16)` | **NO ASSOCIATED PR** | **NO** |
| `0c25245` | `github-actions[bot]` | 2026-08-09 | `chore(data): weekly backtest data refresh (2026-08-09)` | **NO ASSOCIATED PR** | **NO** |
| `a12ff7d` | `github-actions[bot]` | 2026-08-02 | `chore(data): weekly backtest data refresh (2026-08-02)` | **NO ASSOCIATED PR** | **NO** |
| `84ec79a` | `github-actions[bot]` | 2026-07-26 | `chore(data): weekly backtest data refresh (2026-07-26)` | (bot, same path) | **NO** |
| `0e4f9de` | `github-actions[bot]` | 2026-07-19 | `chore(data): weekly backtest data refresh (2026-07-19)` | (bot, same path) | **NO** |
| **`3f27ef2`** | `wanghaoheng123-boop` | 2026-08-14 | `docs(vercel): the ops runbook listed 3 linked projects; only 1 has been building` | **NO ASSOCIATED PR** | Yes (post-hoc, `push` trigger) |
| **`f6672cf`** | `wanghaoheng123-boop` | 2026-08-14 | `chore(records): ship wave 2026-08-14 — #138 merged and deployed` | **NO ASSOCIATED PR** | Yes (post-hoc, `push` trigger) |

### 3a. The commit the task flagged: `3f27ef2`

```
$ gh api repos/.../commits/3f27ef2/pulls --jq '...'
NO ASSOCIATED PR
```

**Confirmed a direct push to `main` by the owner account**, in violation of
CLAUDE.md's "NEVER commit directly to main". `f6672cf` is a second instance,
same day, same account. Both are docs/records-only, so blast radius was low —
but the *rule* is unenforced, and the same mechanism accepts a source change.
CI did run on both (the `push: [main]` trigger fired) and passed — but that is
**post-hoc verification of an already-live production deploy**, not a gate.

### 3b. The systematic path: `refresh-data.yml` pushes to `main` with zero CI

```yaml
# .github/workflows/refresh-data.yml
  9  permissions:
 10    contents: write
...
136        git commit -m "chore(data): weekly backtest data refresh ($(date -u +'%Y-%m-%d'))"
137        git push origin HEAD:main
```

`ci.yml:9-10` declares `push: branches: [main]`, so one would expect CI to run.
It does not. Check-runs attached to those SHAs:

```
$ gh api repos/.../commits/2d71ceb/check-runs
total=2 | benchmark:success, axe:success
$ gh api repos/.../commits/0c25245/check-runs
total=6 | benchmark:success ×5, axe:failure
$ gh api repos/.../commits/a12ff7d/check-runs
total=6 | benchmark:success ×5, axe:failure
```

Those `benchmark` entries are the **scheduled** `nightly-backtest.yml` runs and
`axe` is the **scheduled** a11y run — both attach to whatever is at the head of
`main`. There is **no `typecheck`, no `test`, no `coverage`, no `smoke`** on any
of them. Cross-checked against the workflow-run index: none of `2d71ceb`,
`0c25245`, `a12ff7d`, `84ec79a`, `0e4f9de` appear in the 100 most recent
`ci.yml` runs on `main`.

**Cause:** GitHub does not trigger workflow runs for pushes authenticated with
the default `GITHUB_TOKEN` (documented loop-prevention behaviour). The workflow
uses the default token (`permissions: contents: write`, `:9-10`, no PAT).

**Consequence:** every Sunday, a commit that changes the canonical backtest
fixtures lands on `main` with **zero** typecheck, **zero** tests, **zero**
coverage gate, **zero** smoke — and auto-deploys to production. Confirmed
deployed:

```
$ gh api repos/.../deployments?per_page=8
id=5936054979 env=Production sha=2d71ceb created=2026-08-16T22:19:18Z
$ gh api repos/.../deployments/5936054979/statuses
state=success env=Production url=https://quantan-9ug8ko6t9-...vercel.app
```

The only rear-guard is `nightly-backtest.yml` (Mon 06:00 UTC), which checks the
WR floor **~8 hours after** the code is live to users, and checks nothing else.

---

## 4. IS "ALWAYS DEPLOYABLE" ACTUALLY VERIFIED?

### 4a. Is CI-green-before-merge observed in practice? **NO — proven.**

Scan of the **30 most recent merged PRs**, checking each head SHA for a
non-success, non-skipped, non-neutral check-run. Exactly one hit — and it is
decisive:

```
$ gh api repos/.../pulls/120
number=120 title=test(backtest): Q-075 wave 2 — aggregatePortfolio golden suite + dividend-accrual pins
merged=true merged_at=2026-07-17T04:36:45Z head=f3c31fe merge_commit=10309b0

$ gh api repos/.../commits/f3c31fe/check-runs
  Vercel Preview Comments: success  completed=2026-07-17T04:36:02Z
  smoke:     success  completed=2026-07-17T04:36:27Z
  benchmark: success  completed=2026-07-17T04:35:34Z
  coverage:  FAILURE  completed=2026-07-17T04:35:56Z   <-- red
  typecheck: success  completed=2026-07-17T04:35:31Z
  test:      success  completed=2026-07-17T04:35:52Z
```

`coverage` went red at **04:35:56Z**. The PR was merged at **04:36:45Z** —
**49 seconds later**, into a branch that auto-deploys to production. This is
the single cleanest refutation of the ENFORCED tier: "CI must be green before
merge" is not merely unenforced, it has been **observed violated**, and the
merge went straight to production.

### 4b. Was `main` ever actually broken? **YES — proven.**

Scan of the **100 most recent `ci.yml` runs on `main`**: exactly one non-success.

```
$ gh api repos/.../actions/workflows/ci.yml/runs?branch=main&per_page=100
e49b1d1 event=push concl=failure 2026-07-17T04:40:23Z | Merge pull request #121 ...

$ gh api repos/.../actions/runs/29555420864/jobs
job=test concl=failure steps: Run vitest

$ gh api repos/.../commits/e49b1d1/check-runs
  smoke:     skipped  @2026-07-17T04:41:16Z   (needs: [typecheck, test])
  test:      FAILURE  @2026-07-17T04:41:16Z
  coverage:  success  @2026-07-17T04:41:21Z
  benchmark: success  @2026-07-17T04:41:07Z
  typecheck: success  @2026-07-17T04:41:02Z
```

The PR that produced it was **fully green on its own head**:

```
$ gh api repos/.../commits/bfbb7a3/check-runs   # PR #121 head
  smoke:success  typecheck:success  coverage:success  test:success  benchmark:success
```

Green PR + green main → **red merge result.** This is merge skew, and it is
precisely what the branch-protection option "require branches to be up to date
before merging" exists to prevent. That option is not enabled (there is no
protection at all). The next commit, `300a894`, was green, so `main` was red for
roughly four minutes — but during that window `main` was live in production.

### 4c. Did the broken `main` deploy? **YES.**

```
$ gh api repos/.../commits/e49b1d1/status
state=success Vercel=success
```

Vercel's build does not run vitest, so `main` deployed to production carrying a
commit whose own test suite was failing. The Vercel status is orthogonal to CI —
a green `Vercel` proves the app **builds**, not that it **works**.

### 4d. Is the production deploy verified after merge? **BUILD yes; FUNCTION no.**

- **Build:** automatically verified. GitHub Deployments show `env=Production`
  per main SHA with `state=success` (§3b output). Vercel also posts a `Vercel`
  commit status on the merged SHA.
- **Function:** **not verified by anything automatic.** The production HTTP
  probe (`scripts/smoke-production.mjs`) is invoked by **no workflow**:
  `grep -rn 'check:ci\|check:smoke' .github/workflows/` returns **zero hits**.
  It exists only as a manual command in the runbook
  (`workspace/VERCEL_OPERATIONS.md:348`:
  `SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke`).
  Verification of the deployed *behaviour* depends entirely on a human
  remembering to type it.

### 4e. The "CI smoke hits production" trap — **REFUTED as stated, real in a different place**

The task brief states CI's smoke test hits production rather than the branch.
That is **not true of `ci.yml`**:

```yaml
# .github/workflows/ci.yml
103  smoke:
105    needs: [typecheck, test]
115      - name: Verify scripts (logic + indicators + btc)
116        run: npm run verify:data
117      # Note: full check:smoke (production HTTP probes) is run on deploy, not on PR.
```

The CI `smoke` job runs `verify:data` = `verify:logic && verify:indicators &&
verify:btc && verify:integrity` (`package.json:21`) — all local, all against the
checked-out branch. No HTTP. The job name is misleading, but the behaviour is
correct.

**However, the underlying hazard is real one level up, in the constitution's own
prescribed gate.** CLAUDE.md's "Verify gates" says to run `npm run check:ci`:

```
package.json:23   "check:ci": "npm run verify:data && npm run check:smoke",
package.json:10   "check:smoke": "node scripts/smoke-production.mjs",
scripts/smoke-production.mjs:8
   const base = (process.env.SMOKE_BASE_URL || 'https://quantan.vercel.app').replace(/\/$/, '')
```

So the pre-push gate the constitution names **probes the already-deployed
production site by default** — i.e. the *old* code — and will pass regardless of
what is in the branch under test. A developer running `npm run check:ci` on a
branch that breaks every route still gets a green result. And since no workflow
runs `check:ci`, this gate exists only as a local habit with a misleading
default target.

### 4f. Route config: is the Vercel build a required check? **NO.**

CLAUDE.md and `MEMORY.md` both record that Next.js route config is
static-analysis-only — `tsc` and `vitest` cannot catch it, and only the Vercel
build can. The Vercel build **does** run on PRs (observed as the `Vercel` commit
status and `Vercel Preview Comments` check-run on every recent PR head). But
`required_status_checks.contexts` is `[]`, so **the one gate that can catch a
route config error is not required**, and a PR whose Vercel build failed could
be merged straight to production. This is the highest-consequence instance of
the missing-required-checks finding.

---

## 5. ROLLBACK — documented? tested? automated?

**Automation: none.** `ls scripts/ | grep -iE 'rollback|deploy|promote'` →
no matches. No workflow performs or assists a rollback. `git ls-files` shows no
rollback script anywhere.

**Documentation: effectively absent, and its one mention points the other way.**
`workspace/VERCEL_OPERATIONS.md` is 405 lines. Searching
`rollback|promote|revert|redeploy` yields four hits, and only one concerns
rollback:

```
VERCEL_OPERATIONS.md:144  **Then redeploy** — env var changes do not apply to existing deployments.
VERCEL_OPERATIONS.md:248  1. Redeploy production (env vars apply at build/runtime ...)
VERCEL_OPERATIONS.md:315  - [ ] Vercel → `quantan` → Production env: set QUANTAN_FRED_PREWARM=1 → redeploy
VERCEL_OPERATIONS.md:351  **Do not run without explicit request:** `vercel deploy --prod`, `vercel promote`, `vercel rollback`.
```

Line 351 is a **prohibition**, not a procedure. There is no documented sequence
for "production is broken, restore the last good deployment": no instruction to
`vercel rollback`, no note on promoting a prior deployment from the dashboard,
no `git revert` + re-merge runbook, no named last-known-good deployment, no
owner-vs-agent decision boundary, no time budget.

CLAUDE.md's DEPLOY PROTOCOL says **"ROLLBACK FIRST, diagnose second."** The only
operational guidance in the runbook says an agent must not roll back without an
explicit request. Under an outage those two instructions conflict, and the
runbook's version wins by being the more specific and more recent. In practice
rollback is an owner-only, undocumented, manual dashboard action.

**Tested: no.** No drill, no rehearsal record, no dated rollback entry anywhere
in `workspace/VERCEL_OPERATIONS.md`. An untested rollback path is an assumption,
not a control.

---

## 6. ADJACENT FACT (recorded only — NOT fixed, NO linter adopted)

**Q-093 — "no lint exists" — CONFIRMED.** CLAUDE.md's "WHAT DONE MEANS" requires
"lint clean". Four independent checks, all negative:

1. **No script.** `package.json:5-42` lists 37 scripts. There is no `lint`
   script. `grep -n -i 'lint\|eslint' package.json` → **no match** (this also
   covers `dependencies` and `devDependencies`: no `eslint`, `prettier` or
   `biome` package is declared).
2. **No config.** `git ls-files | grep -iE 'eslintrc|eslint.config'` → **no
   tracked eslint config**. No `.eslintrc*` / `eslint.config.*` at repo root.
3. **No workflow step.** `grep -rn -i 'lint' .github/workflows/` → **zero hits**
   across all five workflows.
4. **Not even implicitly via `next build`.** `ls -d node_modules/eslint` →
   **not installed** (direct observation); `grep -i eslint next.config.js` → no
   `eslint` key (direct observation). *Inference, flagged as such:* Next.js
   skips lint during build when ESLint is not installed, so the `npm run build`
   steps in `a11y-axe.yml:28` and the Vercel build are expected not to lint
   either. This is documented framework behaviour, not something I observed in
   this repo's build logs — same class of claim as blind spot 4. Checks 1–3 are
   direct observations and already carry the conclusion without it.

**Conclusion:** no linter exists in this repository, has never run on any PR,
and cannot run. **The constitution names a gate that does not exist.** This
bears directly on I7: part of the stated definition of a mergeable change is
unfalsifiable.

---

## 7. WHAT I CHECKED

| Question | Method | Command / file:line |
|---|---|---|
| Branch protection present? | 4 endpoints | `/branches/main/protection` (503 ×4), `/branches/main` (`protected:false`), `/rulesets` (`[]`), `/rules/branches/main` (`[]`) |
| Protection available on plan? | repo metadata | `/repos/...` → `"private":false`, `"visibility":"public"` |
| Which checks are required? | required-checks list | `required_status_checks.contexts: []`, `enforcement_level:"off"` |
| Full workflow inventory | read all five files with line numbers | `.github/workflows/*.yml` |
| `continue-on-error` anywhere | full-text grep + per-file read | hit only at `a11y-axe.yml:20` |
| a11y advisory in practice | run conclusion vs check-run conclusion, 6 runs | run `success` while `axe` check-run `failure` on 4 SHAs |
| Stryker on PRs? | trigger block + 6-run event history | `stryker-weekly.yml:36-39`; events `schedule`/`workflow_dispatch` only |
| `check:ci` / `benchmark` required? | grep workflows + required-checks list | `check:ci` zero hits; `benchmark` runs (`ci.yml:73`) but not required |
| Direct pushes to main? | first-parent log + per-SHA PR association | `git log --first-parent -40 origin/main`; `/commits/<sha>/pulls` → `NO ASSOCIATED PR` ×4 confirmed |
| Bot pushes skip CI? | check-runs per bot SHA + 100-run CI index | no `typecheck`/`test`/`coverage`/`smoke` on any bot SHA |
| PR merged red? | 30 most recent merged PRs, head-SHA check-runs | PR #120: `coverage:failure` 04:35:56Z, merged 04:36:45Z |
| Main ever red? | 100 most recent `ci.yml` runs on main | `e49b1d1` `conclusion=failure`; failing step "Run vitest" |
| Broken main deployed? | commit status + Deployments API | `e49b1d1` `Vercel=success`; `2d71ceb` `env=Production state=success` |
| Post-merge production verification? | grep workflows for the smoke command | zero hits; manual only, `VERCEL_OPERATIONS.md:348` |
| CI smoke targets production? | read job + script default | `ci.yml:103-117` runs `verify:data`; `smoke-production.mjs:8` default is prod |
| Rollback documented/automated? | runbook grep + scripts listing | `VERCEL_OPERATIONS.md:351` (prohibition); no script matches |
| Lint exists? | 4 checks | see §6 |
| Scheduled jobs actually fire? | run history per workflow | all four scheduled workflows have real recent `event=schedule` runs |

---

## 8. WHAT WOULD HAVE SHOWN "ENFORCED" — the falsification list

For I7 to have earned ENFORCED, **all** of the following would have had to be
true. Each was checked; each is false. (Stated as the positive evidence that was
sought and not found, per the requirement that compliant findings need evidence
too.)

| # | Would have shown ENFORCED | Actual |
|---|---|---|
| 1 | `GET /branches/main/protection` returns a body with `required_status_checks.contexts` naming e.g. `typecheck`, `test`, `Vercel` | `protected:false`, `contexts:[]`, `enforcement_level:"off"` |
| 2 | A non-empty ruleset targeting `refs/heads/main` with a `required_status_checks` rule | `/rulesets` `[]`; `/rules/branches/main` `[]` |
| 3 | `enforce_admins: true` (owner cannot bypass) | No protection object exists to carry it |
| 4 | `required_pull_request_reviews` present (no direct push) | Absent |
| 5 | Zero commits in `git log --first-parent -40 origin/main` lacking an associated PR | 7 found (5 bot + 2 human) |
| 6 | No merged PR in the last 30 whose head SHA carried a non-success check-run | PR #120 merged 49s after `coverage: failure` |
| 7 | No `ci.yml` run on `main` with `conclusion != success` in the last 100 | `e49b1d1` = `failure` (`test` job) |
| 8 | Every commit on `main` carries the full `ci.yml` job set | 5 bot commits carry none of it |
| 9 | A workflow that probes production after merge and fails loudly | None exists; manual command only |
| 10 | A documented, dated, exercised rollback procedure | Only a prohibition at `VERCEL_OPERATIONS.md:351` |

Item 6 alone is sufficient to reject ENFORCED. Items 1–3 make the rejection
structural rather than incidental.

---

## 9. BLIND SPOTS

1. **`/branches/main/protection` returned HTTP 503 on all four attempts**, never
   the canonical `404 {"message":"Branch not protected"}`. I did not obtain the
   literal 404 the task anticipated. Three corroborating endpoints
   (`/branches/main` → `protected:false`; `/rulesets` → `[]`;
   `/rules/branches/main` → `[]`) agree unanimously, and the token has
   `admin:true`, so a permissions-masking explanation is ruled out. I record the
   503 rather than paraphrase it as a 404.
2. **Both empirical scans are windowed.** The red-merge scan covers the **30
   most recent merged PRs**; the red-main scan covers the **100 most recent
   `ci.yml` runs on `main`**. "One red merge, one red main" is a **floor, not a
   count** — the true historical totals over ~150 PRs are almost certainly
   higher and were not enumerated.
3. **Vercel-side configuration was not inspected.** I did not query the Vercel
   API (no read-only credential in this session, and the task is GitHub-scoped).
   Whether the `quantan` project has a deployment-protection or
   ignored-build-step setting, and whether preview builds use production env
   vars, is **UNVERIFIED**. `VERCEL_OPERATIONS.md` has been wrong before, so its
   claims about project linkage are not treated as evidence here.
4. **The `GITHUB_TOKEN`-does-not-trigger-workflows explanation for §3b is an
   inference** from GitHub's documented loop-prevention behaviour. The
   *observation* — no CI check-runs on any bot SHA, and no bot SHA in the 100
   most recent `main` CI runs — is direct and does not depend on the
   explanation. The precise mechanism is UNVERIFIED but immaterial to the
   finding.
5. **`e49b1d1`'s `test` failure was not root-caused.** I did not download the
   job log to determine whether it was a genuine regression or a flake. Either
   way `main`'s own CI was red and production deployed from it, which is the
   finding; the distinction would matter only for a remediation.
6. **"Never leave the repo mid-refactor at session end"** is not mechanically
   checkable and is rated **UNVERIFIED**, not compliant.
7. **Older history (pre-#111, before 2026-07-16) was not audited** for direct
   pushes. The 40-commit first-parent window was the task's specified scope.

---

## 10. FINDINGS NOT FIXED

Ledger-shaped rows for whoever owns `reviews/findings-ledger.csv`. **This audit
did not write to the ledger** (out of scope, per instruction).

| ID | Severity | One-line risk-register description | Anchor |
|---|---|---|---|
| I7-F1 | **CRITICAL** | `main` auto-deploys to production with **no branch protection, no ruleset and zero required status checks** — any PR, including one with every CI job red, can be merged straight to production by anyone with push access. | `/branches/main` → `protected:false`, `contexts:[]`; `/rulesets` → `[]` |
| I7-F2 | **CRITICAL** | The Vercel build is the **only** gate that can catch a Next.js route-config error and it is not a required check, so a PR whose build fails merges anyway — production then silently keeps serving the previous deployment while `main` is broken. Because nothing reads production deployment status (see I7-F7), the ship simply does not happen and **no alarm fires**; the divergence surfaces only when a human notices prod is stale. | `required_status_checks.contexts:[]` vs `Vercel` status observed on PR heads; no workflow consumes the Deployments API |
| I7-F3 | **HIGH** | A scheduled bot pushes commits **directly to `main` every Sunday** with zero typecheck/test/coverage/smoke, auto-deploying unverified fixture changes to production. | `refresh-data.yml:137` (`git push origin HEAD:main`); no CI check-runs on `2d71ceb`/`0c25245`/`a12ff7d`/`84ec79a`/`0e4f9de` |
| I7-F4 | **HIGH** | PR #120 was merged **49 seconds after** its `coverage` check went red, deploying to production — "CI must be green before merge" is observed violated, not merely unenforced. | `coverage:failure` @04:35:56Z; `merged_at` 04:36:45Z |
| I7-F5 | **HIGH** | `main` has shipped to production with a **failing test suite**: merge commit `e49b1d1` was red (`test` job, "Run vitest") while its source PR head was fully green — merge skew with no "require branches up to date" rule to catch it. | run `29555420864` `conclusion=failure`; `e49b1d1` `Vercel=success` |
| I7-F6 | **HIGH** | The constitution's prescribed pre-push gate `npm run check:ci` runs `check:smoke`, which **defaults to probing production** (`https://quantan.vercel.app`) rather than the branch under test — it can pass while the branch is entirely broken, and no workflow runs it. | `package.json:23`, `package.json:10`, `smoke-production.mjs:8`; `grep check:ci .github/workflows/` → 0 hits |
| I7-F7 | **HIGH** | Nothing verifies production **behaviour** after a merge: the deploy's build success is auto-reported, but the production smoke exists only as a manual command a human must remember to run. | no workflow invokes `check:smoke`; `VERCEL_OPERATIONS.md:348` |
| I7-F8 | **MEDIUM** | No rollback procedure and no rollback automation. The runbook's only mention of `vercel rollback` **forbids** running it without owner request — close to the inverse of CLAUDE.md's "ROLLBACK FIRST, diagnose second". Never rehearsed. | `VERCEL_OPERATIONS.md:351`; no matching script in `scripts/` |
| I7-F9 | **MEDIUM** | CLAUDE.md's definition of "done" requires "lint clean", but **no linter exists**: no script, no config, not installed, no workflow step, and `next build` skips lint because ESLint is absent. The gate is unfalsifiable. (= Q-093, CONFIRMED.) | `package.json` (no `lint`), `git ls-files` (no config), `grep -i lint .github/workflows/` → 0, `node_modules/eslint` absent |
| I7-F10 | **MEDIUM** | Two human direct pushes to `main` (`3f27ef2`, `f6672cf`, both 2026-08-14, both `NO ASSOCIATED PR`) against an explicit "NEVER commit directly to main" rule — low blast radius this time, but the same path accepts a source change. | `/commits/3f27ef2/pulls` → `NO ASSOCIATED PR`; ditto `f6672cf` |
| I7-F11 | **LOW** | The a11y workflow reports **run conclusion `success` while its `axe` check-run conclusion is `failure`** (job-level `continue-on-error`), so the badge is green while the job is red. Advisory by design and already documented; recorded here as verified. | `a11y-axe.yml:20`; `axe:failure` on `0c25245`, `a12ff7d`, `84ec79a`, `f6672cf` vs `RUNconcl=success` on all 6 runs |
| I7-F12 | **LOW** | CLAUDE.md's I7 tier line asserts ENFORCED, which this audit falsifies — the constitution's single strongest claim is currently decoration. (Tier correction is the recommended follow-up; not made here, as this audit edits no file but its own.) | CLAUDE.md, I7 tier marker |

### What would move I7 to a true ENFORCED (not done here)

Enable branch protection or a ruleset on `main` with `typecheck`, `test`,
`coverage`, `benchmark`, `smoke` and the Vercel build as **required** contexts;
enable "require branches to be up to date" (would have caught `e49b1d1`);
enable `enforce_admins`; and route the weekly data refresh through a PR (or an
app/PAT token so CI actually runs on its push). Each is an owner action on
GitHub settings, not a code change — and all are free on this public repo.

---

*Audit performed read-only. No GitHub state was modified: no protection change,*
*no PR created or merged, no workflow dispatched, no push. Only `gh api` GET*
*requests were issued. The only file created is this one.*
