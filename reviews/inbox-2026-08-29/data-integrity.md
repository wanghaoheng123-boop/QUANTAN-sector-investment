# Data-integrity report — Q-107 rectification wave (2026-08-29)

Territory: `scripts/`, `.github/workflows/`, `lib/backtest/`, `lib/data/`,
`reviews/invariants-baseline.md`. Reserved ids `Q107-D1`–`Q107-D19`. No source
files edited; `npm run benchmark` was run for evidence and the resulting dirty
`scripts/benchmark-results.json` was reverted with `git checkout --` before
writing this report (`git status --porcelain` confirmed clean afterward).

---

## HEADLINE — CONFIRMED, freshly discovered

### `Q107-D1` (CRITICAL) — the Q-102 restatement guard has deadlocked the weekly refresh, silently, since 2026-08-23

**What I found, in order of discovery, all CONFIRMED against the live GitHub
Actions run history (`gh run list --workflow=refresh-data.yml`) and the run log
(`gh run view 32670176978 --log`):**

1. The most recent commit that touched `scripts/backtestData/` is
   `2d71ceb` (2026-08-16), *before* Q-102 (`05aa3be`, landed 2026-08-21 22:06).
   `scripts/backtestData/AAPL.json` on disk today has `windowStart: undefined`,
   `fingerprint: undefined`, `vintage: undefined` — it predates Q-102's own
   `saveResult()` fields entirely and its newest bar is **2026-08-14**, i.e.
   **15 days stale** as of today (2026-08-29).
2. `gh run list` shows the **first refresh run after Q-102 shipped**
   (`2026-08-23T22:18`, run `32670176978`) is the only run in the visible
   history that FAILED (45s, `completed failure`). Every run before it, back to
   2026-05-17, succeeded.
3. The log shows why: 36 of 56 tickers were `REFUSED` with
   `VENDOR RESTATEMENT: 1 existing bar(s) changed value` — **35 of them on the
   same equity bar, `1786714200` = 2026-08-14 13:30 UTC, every one a
   `volume` field**, e.g. `NVDA ... volume 75504000 -> 75680900` (a 0.23%
   change); plus **one BTC bar** (`1786838400` = 2026-08-16) with
   `open 63024.63671875 -> 63023.421875` (0.0019%). That split is, if
   anything, stronger evidence for the consolidation-noise reading: two
   different vendor surfaces (equity final-tape volume settling, a crypto feed
   still micro-revising two days later) both trip the same 1e-9 tolerance
   independently. `scripts/fetchBacktestData.mjs` line 288-291:
   `if (failed > 0) { ...; process.exit(1); }` — the run exits 1, and
   `refresh-data.yml`'s "Assert fixture freshness" / "Commit & push" steps are
   gated `if: success()` (`:119`, `:125`), so **none of them ran** — including
   for the 20 tickers that had zero problems. The whole week's refresh was
   discarded, not just the 36 flagged ones.

**Root cause, `file:line`:** `near()` in `scripts/lib/dataVintage.mjs:45-49`
uses a relative tolerance of `Math.abs(a-b) <= max(1e-9, abs(b)*1e-9)` — for
NVDA's `was` volume of 75,504,000 that is a tolerance of **~0.0755**, against
an actual, completely ordinary vendor revision of **176,900**. The guard is
over-tripped by a factor of roughly **2.3 million**. In practice the tolerance
is zero: `near()` treats final-tape volume consolidation on the most recent 1-2
trading days — a well-known, benign vendor behaviour (off-exchange and
dark-pool prints settle into the official daily total after the close, and
crypto feeds keep revising for a day or two after) — as an existential "vendor
restated 2023 data" event. It is the wrong null. Q-102's own module comment
(`dataVintage.mjs:14-16`) describes the restatement it was built to catch as
*"the vendor revised a 2023 close"* — a genuinely old, settled bar changing.
What actually happened is the newest bar being provisional, which is not that
event, and the code has no way to tell them apart.

**Why this is a deadlock, not a one-off failure — this is the P0 part.** A
REFUSED ticker keeps its **stale, pre-revision** on-disk value for that bar.
Next Sunday, Yahoo returns its now-settled 08-14 volume figure again (it does
not revert), `assessRefresh` compares it against the *same unchanged on-disk
file*, and it is REFUSED again — permanently, with no automated recovery path.
Once a ticker trips this it stays quarantined every week forever, and because
the *whole batch* aborts on any single refusal (see below), one perpetually
disagreeing bar can starve all 56 fixtures indefinitely. Six days have already
passed with the workflow red and the tracked fixtures aging past
`MAX_STALE_DAYS: 5` (`refresh-data.yml:54`) with **zero human notification** —
no Slack/issue/email step exists anywhere in `refresh-data.yml`; the only
signal is a red check in the Actions tab that nobody is watching (I7: no
required checks, no branch protection, advisory only).

**Compounding defect — batch abort, not per-ticker quarantine.**
`scripts/fetchBacktestData.mjs:258-291` (`main()`) folds every ticker's outcome
into one `failed` counter and one process exit code. `saveResult()` already
writes each ticker's file to the runner's local disk as it succeeds, but
`refresh-data.yml:119,125` (`if: success()`) means a single REFUSED ticker
discards the 20 tickers that had no problem at all, every single week, on an
ephemeral runner (the good writes are never committed, never seen again).

**Recommended fix shape — a plan, not a diff, both halves needed together:**

1. **Age-dependent materiality on `near()` / `assessRefresh`.** Bars inside a
   short trailing window (e.g. the last 2-3 trading sessions) are provisional:
   allow a real tolerance band on `volume` (basis points, not 1e-9) and a
   tick-level epsilon on OHLC, to absorb final-tape settlement. Bars older than
   that window keep the current zero-tolerance behaviour — that is the actual
   restatement case Q-102 was built for, and it must not be weakened. **A
   blanket epsilon on `near()` would silently re-open exactly the
   silent-absorption hole Q-102 closed — do not do that.** The fix is "recent
   bars get slack because they are provisional," not "all bars get slack."
2. **Per-ticker quarantine, not whole-batch abort.** Change the exit-code
   semantics: when failures are *only* quarantines (restated/missing, not a
   genuine fetch error), write the clean tickers' files, commit and push them,
   emit a machine-readable quarantine report (which tickers, which bars, by
   how much) as a workflow artifact, and only then fail the run so the check
   stays RED and visible. Leaving the flagged ticker's file untouched *is*
   fail-closed for that ticker — it does not need the other 55 files held
   hostage too. **This changes what "the refresh workflow is red" means and
   needs explicit owner sign-off**, not a silent behavior change.
3. Add a failure-notification step (issue comment, Slack webhook, whatever the
   team already has) — right now a red weekly cron is invisible by design.

**Ordering matters — fix (1) is what unblocks; fix (2) alone accomplishes
nothing.** If only the batch-abort decoupling (2) lands and the tolerance (1)
does not, the next run still exits with `failed > 0` only for genuine
restatements — but the 36 currently-quarantined tickers keep re-tripping the
same over-tight tolerance on the same disputed 2026-08-14 bar every week, so
`main()` still reports `failed > 0`, `refresh-data.yml`'s freshness step
(`:52-113`) still never runs (those same tickers' newest bar is now well past
`MAX_STALE_DAYS: 5` too), and the "commit the clean subset" behaviour from (2)
never gets exercised because the workflow still halts one step earlier. (1)
is the fix that actually unblocks the pipeline; (2) only bounds future
collateral damage once (1) is in place. Land (1) first, or land them together
— landing (2) alone will look like progress and change nothing observable.

**Blast radius today:** `npm run benchmark` (I ran it — see `Q107-D5` below)
reads `scripts/backtestData/*.json` directly in this environment (no SQLite
warehouse is tracked; `lib/data/warehouse.ts:29` creates an empty DB on a fresh
checkout, so `lib/backtest/dataLoader.ts:58-114` always falls through to the
JSON fixtures in CI). `ci.yml`'s `benchmark` job runs on every PR against
whatever is currently checked into `scripts/backtestData/` — which, right now,
is **15-day-stale data**, silently, because nothing in the PR-facing pipeline
checks freshness (see `Q107-D4`).

---

## Other findings, this territory

### `Q107-D2` (HIGH) — both fixture guards fail OPEN on a parse error, contradicting their own "fail closed" design

`scripts/fetchBacktestData.mjs:107-122` (shrink guard) and `:131-146` (Q-102
vintage/restatement guard) both wrap the read-and-compare of the *existing*
fixture in `try { ... } catch (e) { if (message starts with 'REFUSED') throw;
else console.warn(...) }`. A genuine guard violation re-throws and blocks the
save (correct). But **any other exception — a truncated file, a git-merge
conflict marker left in the JSON, a `JSON.parse` failure — is swallowed**, logged
as `"vintage check skipped"` / `"existing fixture unreadable"`, and the function
falls through to an **unconditional overwrite**. This is the exact failure mode
Q-102 exists to prevent (a restatement absorbed silently), just reached through
a different door: corrupt the on-disk JSON slightly (or let it survive a bad
merge) and the guard that is supposed to catch a bad overwrite instead enables
one, silently, by design. Same shape as the "guard reachability" lesson this
project has hit three times before (Q-098/Q-103/Q-080/Q-100): the rule is
correct, the code path that should visit it is bypassed on a specific input
class nobody tested. Plan: on a parse/read failure of the *existing* file,
REFUSE (fail closed) rather than warn-and-proceed — an unreadable prior fixture
is not evidence the new data is safe to write over it.

### `Q107-D3` (MEDIUM) — a live diagnostic in `benchmark-signals.ts` now makes a false claim about Q-102

`scripts/benchmark-signals.ts:664-666` prints, whenever the primary edge gate's
headroom is thin:

```
WARN: ... The dataset is rewritten in place weekly and the universe re-anchored
to Date.now() (Q-102), so this can breach on data drift alone, with no code
change.
```

`git blame` dates this text to `d5d3a61` (2026-08-21 01:47), **before** Q-102's
actual fix (`a79344e`/`05aa3be`, same day 22:02-22:06) pinned `WINDOW_START` to
a fixed `2021-08-17` (`scripts/lib/dataVintage.mjs:39`) and made restatements
fail closed instead of silently absorbed. The re-anchoring-to-`Date.now()`
defect this text describes is **closed**; the text was never updated and is
now factually wrong about the current pipeline. This is low-severity on its
own, but it actively points a future reader (human or agent) at a resolved
defect while ~D1's much sharper, currently-live defect goes unmentioned in the
one place that would surface it at exactly the moment someone is looking (a
thin-headroom run). Plan: rewrite the WARN to describe the *current* risk
(quarantine deadlock / batch-abort staleness, D1) rather than the pre-Q-102 one.

### `Q107-D4` (HIGH) — the only fixture-freshness check lives inside the workflow that is currently broken; PR-facing CI has none

`refresh-data.yml:52-113` ("Assert fixture freshness", `MAX_STALE_DAYS: 5`) is
the **only** staleness check in the repo for `scripts/backtestData/`.
`scripts/verify-data-integrity.mjs` (120 lines, read in full) has **zero**
references to staleness, `Date.now()`, or any freshness concept — confirmed by
grep, not inference. `npm run verify:data` (which wraps it, and is what
`ci.yml`'s `smoke` job runs on every PR) therefore cannot detect that the
fixtures a PR's benchmark run is about to consume are stale. Combined with
`Q107-D1`: a PR merged right now is silently benchmarked against data whose
newest bar is 15 days old, with every gate green. Plan: add a freshness
assertion (reuse the logic already written in `refresh-data.yml:52-113`, factor
it into a script both the workflow and `verify-data-integrity.mjs` can call) to
the PR-facing path, not just the bot's own workflow.

### `Q107-D5` (owner-visible risk, not a new defect) — the frozen baseline can no longer catch a real regression, and the fix for D1 will land two weeks of bars in one unreviewed push

I ran `npm run benchmark` against the current tree (evidence only; reverted
after). `reviews/invariants-baseline.md` §1b freezes **53.79% net / 54.77%
gross** (captured 2026-05-26). Today's tree, same command, produces **56.78%
net / 57.87% gross** — a ~3pp gap in the *opposite* direction of a floor
breach, so nothing is failing, but it means the secondary WR floors are not a
binding regression guard at the resolution that matters: a real ~2-3pp
regression could land and both secondary floors would still pass. The
*primary* CI gate (edge-over-base-rate) is thinner: the benchmark's own output
prints `WARN: the PRIMARY edge gate has 0.1pp of headroom (1.91 vs floor
1.81)`. Put together with `Q107-D1`: the moment the quarantine deadlock is
fixed, the very next successful refresh will append **15+ days of pending
bars in one commit, pushed directly by a bot to an unprotected `main` that
auto-deploys** (`refresh-data.yml:137`, `git push origin HEAD:main`), against a
gate sitting 0.10pp above its floor, with the ci.yml benchmark job as the
only check and nothing blocking a red result from having already deployed.
This is not a new mechanism — it's I7 and I5's existing gaps — but it is a
concrete, dated, sequenced risk this territory's evidence produces, and
`reviews/invariants-baseline.md` is explicitly in scope here. Recommend:
fix `Q107-D1` deliberately (reviewed, not another silent Sunday auto-push),
and re-run/re-freeze §1b immediately after, since the ~3pp gap suggests it may
already be stale for reasons unrelated to D1 (signal-path changes from
Q-081/Q-085/Q-103 land in the same window).

---

## Task item 1 — `Q100-23` options, with real costs

*(This id is already recorded — `reviews/findings-ledger.csv` row `Q100-23`,
CRITICAL, and mirrored in `reviews/vendor-licence-register.json:1580-1601`. I
am not creating a duplicate id; this is the requested options analysis.)*

**Correction to the existing record:** it is **56 fixtures** (55 stocks + BTC)
plus a tracked `.gitkeep`, not "57 OHLCV files" — `git ls-files
scripts/backtestData/ | wc -l` = 57 total tracked paths, one of which is
`.gitkeep`. Immaterial to the finding, worth a one-line correction where it's
recorded.

**Confirmed facts governing every option below:**
- `gh repo view --json visibility` → `PUBLIC`.
- `gh repo view --json forkCount,isFork` → `forkCount: 0`. No GitHub-tracked
  fork exists today. This bounds (but does not eliminate — plain `git clone`
  by a third party leaves no trace GitHub can report, and the repo may already
  be indexed by scrapers/mirrors) the population that a history rewrite would
  need to chase.
- 11 weekly-refresh **commits** matching `chore(data): weekly backtest data
  refresh` are visible in `git log` (`2026-06-07` through `2026-08-16`), each
  rewriting all 56 files' full content (not a diff — every `saveResult()`
  call is a full `writeFileSync` of the entire candle array), so git objects
  already hold on the order of a dozen near-complete vintages of a 13MB tree,
  growing weekly whenever the refresh is unblocked. (`gh run list` shows
  earlier successful *runs* back to 2026-05-17 that produced no matching
  commit — no-diff runs, per the workflow's own "No data changes — skipping
  commit" branch at `refresh-data.yml:131-134` — so the run history is longer
  than the commit history and the two should not be conflated.)
- `npm run benchmark` in this environment reads `scripts/backtestData/*.json`
  directly (no warehouse DB is tracked; confirmed by running it).
  `ci.yml`'s `benchmark` job does the same on every PR.

**(a) Leave it and license it.**
*What it requires:* a redistribution licence from Yahoo (or whoever the
underlying exchange-data rightsholder is) that explicitly covers storing and
re-publishing historical OHLCV in a public git repository, retained
permanently.
*What is known, stated as known and nothing more, because I cannot verify
vendor terms from this repo:* no licence, account agreement, or vendor
confirmation of any kind is visible anywhere in this repository for Yahoo;
`reviews/vendor-licence-register.json` records zero confirmations for any
vendor (I8(a) is UNVERIFIED, not resolved); `yahoo-finance2` is an unofficial
client against an undocumented endpoint, not a contracted commercial feed —
which makes "ask Yahoo for a redistribution licence through this channel" a
different, harder ask than licensing a normal commercial data feed. **I am not
asserting this option is infeasible — that is a legal conclusion about an
off-repo document I cannot see, and asserting it would be exactly the failure
mode I8 exists to prevent.** Route to counsel with the facts above.
*What breaks if pursued and it fails:* nothing changes technically; the
exposure and the clock both continue.
*Preserves Q-102's work:* trivially yes — nothing about the data or pipeline
changes.

**(b) Stop refreshing.**
*Mechanics:* disable `refresh-data.yml` (pause the schedule, or just the push
step) with the fixtures left exactly as they are.
*What breaks:* nothing in CI or the benchmark — `dataLoader.ts` and
`benchmark-signals.ts` read whatever is on disk regardless of age.
*What it does NOT do:* it does not touch the 13MB already tracked, nor the
dozen vintages already in git history — every clone still redistributes all of
it, today, at rest. It stops the redistribution from **growing**; it does not
undo what has already happened.
*Preserves Q-102's work:* yes, and it goes further — a frozen fixture is
**byte-identical every time**, which is precisely the reproducibility gap
Q-102's own backlog note (`Q-102`, `notes_2026_08_21`) named as the one thing
it fell short of ("true reproducibility needs content-addressed snapshots per
run... not the thing itself"). Freezing achieves that by construction, as a
side effect, for free.
*Cost:* near zero — one workflow edit, no new infrastructure, no owner
provisioning needed. Available immediately as a stopgap regardless of which
other option the owner picks.

**(c) Move to private storage (Vercel Blob / private release asset / private
bucket), fetched at build/CI time; remove the fixtures from the tracked working
tree going forward.**
*Mechanics:* host the fixtures somewhere access-controlled; add a "fetch
backtest data" step to `ci.yml`'s `benchmark` job (and to local dev tooling)
before `npm run benchmark` runs; `git rm scripts/backtestData/*.json` from
HEAD going forward.
*What breaks / what it costs:*
- Requires **owner action**: provision the storage (Vercel Blob is the natural
  fit — this project already runs on Vercel per `workspace/VERCEL_OPERATIONS.md`
  — or a private bucket/release), and add a read credential as a GitHub Actions
  secret. Secrets are not available to PRs from forks (not a concern here —
  `forkCount: 0` — but worth naming as a constraint if that ever changes).
- **CI and local dev both need a new step** and a documented prerequisite;
  today `npm run benchmark` works with zero external dependency straight after
  `git clone`. That property is lost.
- Does **not** retroactively remove the 13MB / dozen vintages already sitting
  in git history — same caveat as (b). Only stops the tree from serving it
  *going forward from HEAD*; `git log` still exposes it to anyone who clones
  and walks history.
*Preserves Q-102's work:* **this is the one option that doesn't merely
preserve it — it is the completion of it.** Q-102 already writes `windowStart`,
a content `fingerprint`, and per-refresh `vintage` counts into every fixture
(`scripts/fetchBacktestData.mjs:148-160`) specifically as "the substrate for
[content-addressed snapshots] but not the thing itself" (Q-102's own backlog
note). A blob-fetch CI step is exactly the mechanism that turns that substrate
into the real thing: version/content-address each snapshot in the private
store, have the benchmark record which snapshot id it consumed, and a past run
becomes reproducible by re-fetching that exact snapshot rather than trusting
whatever happens to be on disk. (b) freezes one point in time; (c) can keep
Q-102's append-only design *and* pin exactly which vintage a given benchmark
run used, going forward, indefinitely.
*Cost:* real but bounded engineering (roughly a day: fetch script + CI step +
one-time backfill of existing vintages into the store) plus one owner decision
(where to host) and one owner action (provision + add secret).

**(d) History rewrite (BFG / `git filter-repo`, force-push `main`).**
**Do not do this lightly, and here is exactly what it costs.** This is the only
option of the four that actually removes the already-published historical
copies from the origin repository itself. Everything else (a, b, c) leaves the
existing exposure in place and only affects what happens next.
*What it destroys:* every commit SHA from the first `scripts/backtestData/`
commit forward is rewritten — which, given the fixtures have been present and
refreshed for months, is effectively **the whole visible project history**.
This repository's own audit trail is built out of citing exact SHAs as
evidence — `reviews/findings-ledger.csv` rows cite things like
`@c66c8a3`/`AT-Q100-*` test ids tied to specific commits, and `CLAUDE.md`
itself cites dozens of SHAs (`af1e52c`, `8b3d7cd`, `e49b1d1`, `d5d3a61`, etc.)
as the load-bearing evidence for invariant tiers. A rewrite invalidates every
one of those references simultaneously, in the one artifact whose entire
purpose is an auditable trail — the same failure mode `Q-100` round 3
documented happening to `file:line` citations, but done deliberately and at
full scale. It also breaks any open PR, any local clone that isn't
force-reset, GitHub Actions run logs that reference old SHAs, and any Vercel
deployment pinned to a commit.
*Whether it even achieves the goal:* `forkCount: 0` today means no
GitHub-tracked fork would retain the purged history — but a rewrite is not a
retroactive guarantee: it does not reach anyone who already `git clone`d
without forking (invisible to GitHub), does not reach third-party mirrors or
scrapers that may have already indexed the public repo, and does not purge
GitHub's own dangling-object retention window on its own. **A rewrite is
necessary-but-possibly-not-sufficient for true withdrawal, and that fact
should be part of the decision, not discovered after paying the cost.**
*Who must approve:* **owner only** (force-push to `main`) — this is exactly
the class of destructive git operation this agent's own operating rules say
never to run without explicit request — and it should be **sequenced after
counsel has said withdrawal is actually required**, not before. Doing the
expensive, trail-destroying operation and then having counsel say (a) was
actually available all along would be the worst-ordered outcome available.
*Preserves Q-102's work:* orthogonal, not directly — it doesn't touch the
*current* tip content or the pinned-window logic, only past intermediate
commits, so `WINDOW_START` and today's fixtures are unaffected. What it does
lose is the audit trail of past *vintages* (the weekly restated/appended
history Q-102's `vintage` field was designed to make visible over time) —
acceptable only if that trail is judged less important than withdrawal.

**Recommended sequencing (mine to propose, owner's to decide):** (b) now, as a
zero-cost stopgap that also happens to perfect Q-102's reproducibility gap for
free, while (a) is routed to counsel in parallel. If (a) comes back negative or
unanswerable in a reasonable time, build (c) as the durable fix — it is the
only option that keeps the data fresh, keeps the benchmark's dependency on
tracked fixtures satisfied, and closes the "going forward" half of the
exposure. Only after counsel has ruled on whether existing historical exposure
must be withdrawn (not merely stopped from growing) does (d) become a question
worth costing out for real, and it needs an explicit owner decision at that
point, informed by the `forkCount: 0` fact above and its limits.

---

## Task item 2 — is the weekly refresh still rewriting history in place, and is the benchmark still non-reproducible?

**The specific defect the audit named is CONFIRMED CLOSED.** The old
`period1: new Date(Date.now() - PERIOD_DAYS * 86400000)` — which re-anchored
the window every run and was observed dropping `totalBuySignals` 3410→3394
between two runs five days apart with no code change — is gone.
`scripts/fetchBacktestData.mjs:5,201,239` now import and use
`WINDOW_START` from `scripts/lib/dataVintage.mjs:39`, a **fixed literal**,
`'2021-08-17'`. `assessRefresh` (`dataVintage.mjs:91-112`) fails closed
(`ok: false`) on any `restated` or `missing` bar, which is what actually fired
in the `Q107-D1` incident — the mechanism is working exactly as designed, just
against the wrong materiality threshold for the newest bars. This is real,
positive progress and matches the backlog's own honest self-assessment
(`Q-102`, `status: partial`).

**What is NOT fully closed, stated precisely rather than rounded up to
"fixed":**
1. **"In place" survives at the storage layer, even though the window no
   longer slides.** `saveResult()` (`fetchBacktestData.mjs:98-162`) still calls
   a single `writeFileSync` with the **entire** candle array every time a
   ticker is (successfully) refreshed — logically append-only, but
   git-mechanically a full-file rewrite each week, so the repo keeps
   accumulating near-duplicate full vintages rather than storing deltas. This
   is the direct mechanism behind `Q100-23`'s "grows weekly, retained
   permanently" claim, confirmed by 11 weekly-refresh commits already in
   history.
2. **Byte-identical reproducibility of a *past* run is still not achieved**,
   and the backlog says so itself (`Q-102 notes_2026_08_21`): the fixture
   carries `windowStart`/`fingerprint`/`vintage`, which is the substrate, but
   nothing records *which fixture snapshot* a given historical benchmark run
   (e.g. the one that produced `reviews/invariants-baseline.md` §1b) actually
   consumed. See `Q107-D5` above for why this now matters concretely (the ~3pp
   gap between the frozen baseline and today's tree cannot currently be
   attributed to "old vs. new data" versus "old vs. new code" because no
   snapshot id was ever recorded against the frozen run.
3. **`Q107-D1` is a new, more urgent instance of the same underlying problem
   Q-102 set out to solve** (a vendor data event being handled wrong), just
   inverted: Q-102 closed "restatement silently absorbed as drift"; the
   materiality threshold it shipped with now produces "provisional noise
   treated as a restatement, forever, with the whole refresh as collateral."
   Recommend tracking `Q107-D1` as the direct continuation of `Q-102`, not a
   fresh unrelated defect, when it's filed.

---

## Task item 3 — `Q-097` (branch protection) blast radius on `refresh-data.yml`

**Confirmed today:** `gh api repos/:owner/:repo/branches/main/protection` →
`404 Branch not protected`. All 11 weekly-refresh commits are single-parent
commits authored by `github-actions[bot]`, pushed directly
(`refresh-data.yml:137`, `git push origin HEAD:main`) — verified via
`git show --no-patch --format='%H %P %an'` on the latest one (`2d71ceb`, one
parent, `github-actions[bot]`).

**The answer is conditional on exactly which branch-protection setting Q-097
enables, and both branches are real, so state both:**
- If Q-097 enables **"Require a pull request before merging"** (or a ruleset
  "restrict who can push" rule) **without** an explicit bypass entry for the
  Actions bot/app, then `git push origin HEAD:main` at
  `refresh-data.yml:137` **will start failing with `GH006: Protected branch
  update failed`** the very next Sunday it runs (or the next time it's
  unblocked from `Q107-D1`). The job will go red for a *new* reason layered on
  top of the current one, and the owner needs to know that *before* flipping
  the setting, not after watching a second consecutive red Sunday and
  wondering which of two independent defects caused it.
- If Q-097 enables **only "require status checks to pass"** with no
  require-PR / no push restriction, direct pushes are **not** blocked by that
  alone — the bot's push would keep working, and `ci.yml`'s checks would just
  run (as they already do today, post-hoc, non-blocking) against whatever the
  bot pushed.
- GitHub's newer **repository rulesets** (which `CLAUDE.md`'s I7 section
  already notes are currently empty: `rulesets is empty`) support a **bypass
  list** that can explicitly name the `github-actions` app (or a specific
  deploy key/PAT actor) to exempt automated pushes from an otherwise-enforced
  PR requirement. That is the standard, supported way to keep an automated
  data-refresh path working under branch protection.

**What must change in the workflow before (or together with) Q-097, concretely
— two options, owner's to choose:**
1. **Add the bot to the ruleset bypass list** if Q-097 uses rulesets, and
   accept that the refresh keeps merging straight to `main` with none of
   `ci.yml`'s checks blocking it beforehand (same zero-typecheck/test/coverage
   exposure I7 already documents — this fixes the push mechanics, not the
   "the platform's own gates never see this data before it deploys" problem).
2. **Convert the workflow to a PR-based flow**: push to a dated branch
   (`data/refresh-YYYY-MM-DD`), open a PR via `gh pr create`, and either
   require a human merge or use GitHub's auto-merge once required checks pass.
   This is the only option that actually closes the "bot data lands in prod
   with zero gates" gap I7 already names — at the cost of the refresh no
   longer being fully unattended, and needing `ci.yml`'s `benchmark` job to
   tolerate genuinely new data weekly (which is exactly why `Q107-D5`'s
   headroom point matters: a 0.10pp-headroom gate reviewing real weekly data
   swings needs a human glancing at it, not just a green check).

**Sequencing recommendation:** fix `Q107-D1` (or at least understand it) before
Q-097 lands, or the workflow will present two independent, differently-shaped
failures at once (a same-bar quarantine deadlock, and a rejected push) and
whoever investigates will have to disentangle them without knowing there were
ever two.

---

## Task item 4 — free sweep

**`scripts/backtestData/` vs `lib/backtest/dataLoader.ts` after `Q-080`:
CONFIRMED CONSISTENT — an affirmative negative worth recording, not just a
silent pass.** `lib/data/securityId.ts` is the SSOT
(`canonicalSecurityId`/`dataFileNameFor`/`securityIdFromFileName`), and
`dataLoader.ts:37-51` (`loadLocalData`) and `:142-155` (`availableTickers`)
both route through it. I checked the one case the module's own docstring flags
as the risk (`BRK-B` vs `BRK.B` share-class round-trip, and `BTC-USD`/`BTC`
staying untouched): `scripts/backtestData/BRK-B.json` exists on disk exactly as
`canonicalSecurityId('BRK-B') → 'BRK.B'` then `dataFileNameFor('BRK.B') →
'BRK-B'` predicts, and `scripts/fetchBacktestData.mjs`'s own `TICKERS` list
(`:24`) writes `BRK-B`, matching. No collision, no orphaned fixture, no
filename `dataLoader.ts` can't resolve. This one is fixed and stayed fixed.

**Everything else found in the sweep is filed above as `Q107-D1`–`Q107-D5`**
— the quarantine deadlock and its batch-abort compounding factor (`D1`, the
most severe thing in this report), the two fail-open catch blocks in the same
file (`D2`), a stale diagnostic string that now contradicts the code it
describes (`D3`), the missing staleness check on the PR-facing path (`D4`),
and the frozen-baseline/thin-headroom timing risk this creates once `D1` is
fixed (`D5`).

---

## Ranked list

**Implement now (mechanical, low-risk, no owner decision needed):**
1. `Q107-D1` — fix the deadlock. Two parts, both needed: age-dependent
   materiality on `near()`/`assessRefresh` for volume/OHLC on the most recent
   N trading days only (do **not** blanket the tolerance — that reopens the
   hole Q-102 closed), and decouple per-ticker quarantine from whole-batch
   abort so 20 clean tickers aren't held hostage by one disputed bar. Add a
   failure-notification step; there is currently none.
2. `Q107-D2` — make both fixture guards fail closed on a parse/read error of
   the *existing* file, not warn-and-overwrite.
3. `Q107-D4` — add the freshness assertion already written in
   `refresh-data.yml:52-113` to the PR-facing path (`verify-data-integrity.mjs`
   / `verify:data`), so a stale fixture can't merge silently.
4. `Q107-D3` — correct the stale WARN string in `benchmark-signals.ts:664-666`.
5. Option **(b)** from the `Q100-23` analysis — pause `refresh-data.yml`'s push
   (or the whole schedule) as an immediate, zero-cost stopgap while (a)/(c)/(d)
   are decided. Zero risk to CI or the benchmark; incidentally perfects
   byte-identical reproducibility for whatever is frozen at pause time.

**Owner decision:**
- `Q100-23` — choose between (b) stopgap → (c) private-store migration as the
  durable fix, sized and reasoned above; (c) needs a storage choice (Vercel
  Blob is the natural fit given existing infra) and a provisioned secret.
- `Q-097` sequencing — decide push-mechanics fix for `refresh-data.yml`
  (ruleset bypass vs. PR-based flow) before or together with enabling branch
  protection, per the two options above.
- `Q107-D5` — re-run and re-freeze `reviews/invariants-baseline.md` §1b once
  `Q107-D1` is fixed and the pending 15+ days of bars land, rather than let a
  0.10pp-headroom gate absorb two weeks of real market movement in one
  unattended bot push.

**Counsel:**
- `Q100-23` option (a) — whether a Yahoo (or underlying exchange-data)
  redistribution licence covering public, permanent, historical git storage is
  obtainable at all through an unofficial client library. I have stated the
  known facts only; I have not and cannot answer this from the repo.
- Whether existing historical exposure (11 weekly vintages, already public,
  `forkCount: 0` but not provably unreplicated) requires option (d) — a
  history rewrite — and if so, explicit written owner approval before any
  force-push to `main`, sequenced strictly after this legal question is
  answered, not before.
