# PLATFORM EXCELLENCE PROGRAM — 2026-08-15

**Owner directive (verbatim intent):** assemble a coordinated expert team to improve the
interface, algorithms, UI, UX, API, data fetching, trading view, and function inputs. Current
user experience is judged bad; many improvements needed. Run a review → edit → audit loop the
way a world-class team builds a platform for professional traders/investors. Data quality and
the algorithms processing it must be **live**, with improved **quality, accuracy, frequency**.
Fable 5 plans/coordinates/judges; Opus 5 executes coding — to optimize token yield.

Branch: `claude/investment-platform-overhaul-cc514b` (worktree `sweet-dubinsky-4e07b2`).
Baseline: main @ `b3773b6` (post-#141), prod = quantan.vercel.app, auto-deploy on merge to main.

---

## 1. Operating model (token-yield policy)

| Role | Model | Responsibilities |
|---|---|---|
| **Coordinator** (this session) | Fable 5 | Program plan, task briefs, triage/judgement, source-verification of every elevated finding, wave sequencing, integration, gates, records. Does NOT do bulk code reading or bulk coding. |
| **Domain experts** (subagents) | Opus 5 | Deep review passes and all code execution/editing. Each gets a self-contained brief, a durable report path, and disjoint scope. |

Rules distilled from prior waves (do not re-learn these the hard way):
1. **Durable incremental writes are mandatory** — experts write findings to their report file
   every 3–5 files inspected. Sub-agents share the session limit with the coordinator; agents
   that die pre-first-write lose everything.
2. **Coordinator source-verifies every P0/P1 before it enters the fix queue** — prior fleets
   produced false-positive P0s (auth regex, factorAttribution, "timer leaks", "dead code").
3. **Edit agents work in isolated worktrees on DISJOINT file sets; cherry-pick their commits**
   onto the integration branch; coordinator re-reviews every agent diff (AlphaVantage
   0-coercion was caught only by re-review).
4. **Commit early/often** in edit waves; after any agent returns, verify durable artifacts
   (branch/commits/report), never trust its self-summary.
5. Gates on this machine: `node node_modules/typescript/bin/tsc --noEmit` +
   `node node_modules/vitest/dist/cli.js run` (the `@` in the worktree path breaks npm-script
   ESM resolution). jsdom suites DO run locally (08-14 correction). Full CI on the PR is the
   final gate; stryker does not run on PRs.
6. Next.js route segment config (`maxDuration` etc.) is static-analysis-only — the Vercel build
   is the gate; tsc+vitest both pass on broken exports.

## 2. The loop (one wave = one full cycle)

```
R  REVIEW   Opus experts, read-only, parallel, durable reports  → findings w/ evidence
J  JUDGE    Fable coordinator: source-verify, kill false positives, rank by user yield,
            build disjoint edit assignments, write wave manifest (§5 status board)
E  EDIT     Opus coders in isolated worktrees, disjoint files, commit early,
            per-change gates (tsc + targeted vitest)
A  AUDIT    Coordinator: re-review every diff, cherry-pick, integration gates
            (tsc + full vitest + build if route config touched), open PR, CI green
V  VERIFY   After merge (merge = prod deploy): prod smoke + Vercel runtime-errors sweep +
            verify the CLAIM not the checkmark (probe the actual behavior changed)
REC RECORD  workspace records + memory + this file's status board; queue next wave
```

Exit criteria per wave: every shipped finding has (a) evidence it existed, (b) a gate that
would catch regression, (c) a live-verified fix. Findings that fail J are recorded with the
reason (false positive / won't-fix / owner-gated) so no future wave re-flags them.

## 3. Wave 1 scope — three review domains (running now)

| Expert | Report | Scope |
|---|---|---|
| UX / interface / trading view | `ux-interface.md` | All 16 pages on prod as a professional trader: workflows, hierarchy, chart usability, function inputs/controls, states, mobile, latency perception |
| Data quality / API / fetching | `data-api.md` | Provider layer, caching/freshness/frequency, SSE, all API routes, validation, error shapes, live-data gaps |
| Algorithms live-path | `algorithms-live.md` | Live computation quality/accuracy/frequency; fixture-vs-live gap (weekly Saturday refresh is the current cadence); recompute cadence upgrades |

## 4. Do-not-relitigate register (seeded into every brief)

- **Closed quant decisions:** D1–D7 menu closed; engine default hold H=60 (4/4 pre-registered
  acceptance); stops/panic/profit-take/SELL-exit retired; D3 rotation REJECTED; Q-077
  score-ranked selection REJECTED 2/4; engine WR (60d) ≠ label WR (20d) — never compare.
- **Stale ledger:** the F1.x–F8.x block is a stale early wave — do not re-flag.
- **Known open, owner-gated (do NOT rediscover):** auth env entirely unset in prod
  (NEXTAUTH_SECRET + OAuth creds — feature-enable, not outage); Redis/KV provisioning
  (activates Q-005 rate-limit + Q-067 shadow log); `vercel` devDependency major bump; CSP
  enforce flip (self-gating); Sharadar PIT data purchase (D7).
- **Recently shipped (don't re-propose):** nav SSOT + orphan-page CI guard, mobile header
  57px, contrast 0-fail on `/`, prefers-reduced-motion, SSE multiplex 13→1 (#138); axe
  violations 0 (#139); auth env-var naming fix + `verify:auth` (#140/#141); stream 300s
  budget SSOT (#134).

## 5. Status board (coordinator-maintained SSOT)

| Wave | Phase | State | Notes |
|---|---|---|---|
| 1 | R (review) | **RUNNING** 2026-08-15 | 3 Opus experts dispatched |
| 1 | J/E/A/V | pending | — |

Findings ledger for this program lives in the three report files + `TRIAGE.md` (written at J).
