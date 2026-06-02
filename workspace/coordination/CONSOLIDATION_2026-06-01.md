# QUANTAN — Parallel Team Rectification: Consolidation & Resume Plan — 2026-06-01

**Coordinator:** Claude Code (Opus 4.8). **Builds on:** `workspace/coordination/TEAM_RECTIFICATION_2026-06-01.md`
+ `workspace/INSPECTION_PROGRAM_2026-05-30.md` (the 52-finding D1–D5 inspection).

> **Honest status.** All 5 sub-agents were terminated by a SHARED session limit (resets 02:10
> Asia/Shanghai) at the END of their runs. Their self-reported summaries are NOT reliable; this doc
> records what is **durable on disk**, verified by the coordinator after they returned. Two agents
> landed nothing; one agent's commit message overclaims what it committed.

---

## What actually landed (verified, not self-reported)

| WS | Deliverable | Durable? | Verified state |
|----|-------------|----------|----------------|
| **WS1** security | branch `fix/ws1-api-security` @ `32506bd` | ⚠️ PARTIAL / BROKEN DRAFT | Commit has ONLY 3 files: `lib/auth/apiKey.ts`, `__tests__/api/trading-agents-auth.test.ts`, `__tests__/api/route-rate-limit.test.ts`. **The commit message is INACCURATE** — it claims the route was wired, `.env.example` updated, and analytics/fundamentals rate-limited, but **none of those files are in the commit** (worktree is clean — they were never written). The auth test imports `POST` from the UNMODIFIED route and asserts new fail-closed behavior → **the test will FAIL**. Gates never run (agent said sandbox couldn't). NO report written. |
| **WS2** quant | `workspace/coordination/reports/WS2.md` (~53 KB, 46 sections) | ✅ DONE | Substantive read-only remediation spec for D2-1/2/5/6/7. Read-only mandate honored (no edits, no branch). |
| **WS3** architecture | branch `fix/ws3-structure-safe` @ `d4e409e` | ✅ RECOVERED INLINE | Original agent lost everything; coordinator re-did the SAFE part after the limit reset: deleted the 5 dead mockData exports (−291 LOC, deletion-only), tsc clean, vitest 979/17. D1-1/D1-5/D1-6 remain SPECS (see resume plan below). |
| **WS4** frontend | `workspace/coordination/reports/WS4.md` (~23 KB) | ✅ DONE | Substantive decomposition blueprint for D3-2/8/9 with measured LOC. Read-only honored. |
| **WS5** docs/tracker | branch `fix/ws5-tracker-reconcile` @ `9834ed5` | ✅ RECOVERED INLINE (code part) | Original agent lost everything; coordinator re-did the D2-4 regimeSignal docstring fix (comment-only, matches code zones), tsc clean, vitest 979/17. The tracker-JSON reconciliations (Q-008/019/037/035/005, F1.11) are NOT yet done — still open (see resume plan). |

**Net durable yield (after coordinator recovery):** 2 solid spec/blueprint docs (WS2, WS4); 2 SAFE
code fixes recovered + committed + verified (WS3 mockData prune, WS5 docstring); 1 reusable security
helper that needs its route wiring finished + tests fixed (WS1); 1 remaining doc task (WS5 tracker-JSON
reconciliations — see resume plan).

**UPDATE 02:2x (post limit-reset):** coordinator recovered WS3 + WS5 inline rather than re-dispatching
(both are small, deterministic, fully pre-verified — re-spawning would just risk the same limit). Both
committed, tsc-clean, vitest 979/17 (baseline unchanged → behavior-identical).

---

## WS1 — exact remediation needed to make the draft real & green

The helper `lib/auth/apiKey.ts` is GOOD (fail-closed; hashes both sides to fixed-width SHA-256 before
`timingSafeEqual`, so a short probe key can't throw a 500 or leak length; never logs secrets). To finish:

1. **Wire the route** (NOT yet done): in `app/api/trading-agents/[ticker]/route.ts` POST (~164–180),
   replace the "any non-null `x-api-key` passes" check with: authorize iff `isValidApiKey(header)` OR an
   authenticated admin session. This file is NOT in any open PR — safe to edit on the WS1 branch.
2. **Fix/verify the tests:** `trading-agents-auth.test.ts` imports `POST` and needs the route change
   above to pass. `route-rate-limit.test.ts` likely imports analytics/fundamentals routes that the
   commit never modified → either add the rate-limit wiring (D4-3) or scope the test to the limiter.
3. **Run gates** from the worktree (the agent never did): symlink node_modules, then
   `node node_modules/typescript/bin/tsc --noEmit` and `node node_modules/vitest/dist/cli.js run`.
4. **Rewrite the commit message** to match reality (currently overclaims).
5. **Bucket B → OWNER decision** before any merge: provision `QUANTAN_API_KEY` (+ this helper) vs
   require-session-only. Fail-closed means that until a secret is set, the POST rejects all API-key
   callers — confirm that's the intended posture for the trading-agents endpoint.

---

## Re-run specs for the LOST streams (everything pre-verified — safe to execute)

### WS3 (architecture) — branch `fix/ws3-structure-safe`
- **D1-3 (SAFE, DO):** delete 5 DEAD exports from `lib/mockData.ts` — `generateCandles`,
  `generateQuote`, `generateSignals`, `generateSparkline`, `BRIEFS` (each verified 0 importers; note
  `generateSignals` also names an UNRELATED function at `lib/quant/btc-indicators.ts:222` — not a
  mockData import). KEEP the 3 live: `generateDarkPoolPrints`, `generateDarkPoolMarkers`,
  `getNewsForSector`. Remove helpers orphaned by the deletions. tsc+vitest green, identical behavior.
- **D1-5 (SPEC, blocked):** technicals.ts wrapper removal — importers include engine.ts (#28) +
  ma-deviation route (#31) → sequence after those merge.
- **D1-1 (SPEC, blocked):** extract `backtestInstrument` to `lib/backtest/core.ts` to break
  engine↔walkForward cycle (engine.ts in #28).
- **D1-6 (SPEC + audit):** eslint not installed; audit 4 `exhaustive-deps` suppressions
  (app/page:175, KLineChart:637, WalkForwardPanel:39, useLiveQuotes:229) for real stale-closure bugs.

### WS5 (docs/tracker) — branch `fix/ws5-tracker-reconcile`
- **D2-4 (CODE):** fix `regimeSignal` docstring in `lib/backtest/signals.ts` ~219–221 to match code
  zone bounds at ~271/281/290 (comment-only).
- Mark findings-ledger **F1.11 FIXED** (piecewiseRsiScore implemented, signals.ts ~35–41).
- Reconcile `workspace/IMPROVEMENT_BACKLOG.json` (NOT invariants-baseline.md — it's in #28):
  close **Q-037** (Bloomberg timing-safe done), **Q-008** (QuantLabPanel decomposed), **Q-019**
  (backtest page decomposed); mark **Q-035** partial (fixed-by-#32); note **Q-005** still per-process.
- Note D3-11 DarkPoolPanel `fetchedAt` residual fixed on `fix/darkpool-fetchedat-freshness` (`6b371d1`).

---

## PRs MERGED 2026-06-01 (owner authorized "merge"; CI green; production smoke PASS)

main advanced 8d56955 → **6a01949** via 3 merges (each = a Vercel production deploy):
- **#37** `fix/ws3-structure-safe` → main @ eb1fde7 — D1-3 dead mockData prune.
- **#38** `fix/ws5-tracker-reconcile` → main @ f8b81e5 — D2-4 docstring + backlog reconciliation.
- **#36** `fix/ws1-api-security-fixed` → main @ 6a01949 — D4-1 fail-closed auth + D4-3 rate limits.
- Post-deploy smoke: `/`=200, `/api/sector-rotation`=200, `/api/analytics/AAPL`=200.
- Broken draft `fix/ws1-api-security` deleted (local + origin), superseded by #36.

**STILL OPEN:**
- **#39** `fix/darkpool-fetchedat-freshness` → **fix/a11y-sweep** (stacked on #32) — D3-11. Cannot
  reach main until #32 merges. Owner: merge #32, then #39 (or retarget #39 to main since its 1-file
  change is now independent).

## ⚠️ Pre-existing bug found during #36 merge review (NOT introduced by these PRs)
The browser LLM "Run" POST in `components/stock/quantlab/hooks/useQuantLabLlm.ts:101` sends only
`Content-Type` — no `x-quantan-csrf` header. `middleware.ts` issues the CSRF *cookie* but nothing
echoes it as the required header (double-submit). So `POST /api/trading-agents/[ticker]` from the UI
returns **403 csrf_invalid on main today**. Present before #36; #36 is behavior-neutral here
(both old `!apiKeyHeader` and new `!isValidApiKey(null)` hit the same CSRF gate). Fix = client reads
the `quantan_csrf` cookie and sends it as `x-quantan-csrf` on the POST. Separate follow-up.

## OWNER actions (env / remaining merges = production deploys = owner-only)

0. **Set `QUANTAN_API_KEY` in Vercel** (e.g. `openssl rand -hex 32`) to ENABLE the X-API-Key
   server-to-server path now that #36 is merged. Until set, that path stays fail-closed (safe); the
   browser flow is unaffected. Agent will not generate/set secrets.
1. **Existing PR backlog merge order** (from inspection §2, unchanged): **#30 → #27 → #25 → #28 →
   #29 → #26 → #24 (REWORK FIRST**: drop 223 artifacts + reintroduced dataLoader.ts; rebase pkg.json).
   Stale **#8/#9** (CONFLICTING) — recommend close.
2. **New A-bucket PRs already open from yesterday:** #31 (API reliability), #32 (a11y) — review/merge.
3. **WS1 security draft** — decide auth posture (above) before it becomes a PR. HIGH severity (unauth
   LLM-credit burn) — worth prioritizing.
4. **Stacked fix** `fix/darkpool-fetchedat-freshness` (`6b371d1`) folds onto #32 by fast-forward.

## Resume checklist (after session limit resets ~02:10)
- [x] Re-run WS3 (mockData prune) — DONE inline, committed `d4e409e`, tsc+vitest green.
- [x] Re-run WS5 code part (regimeSignal docstring) — DONE inline, committed `9834ed5`, tsc+vitest green.
- [ ] **WS5 remainder (doc-only, safe):** tracker-JSON reconciliations in `workspace/IMPROVEMENT_BACKLOG.json`
      — close Q-008/Q-019/Q-037, mark Q-035 partial (fixed-by-#32), note Q-005 per-process; mark
      findings-ledger F1.11 FIXED. (Verify each claim before flipping status.)
- [x] **WS1 (Bucket B):** DONE on branch `fix/ws1-api-security-fixed` @ `01b3267` (supersedes the
      broken `fix/ws1-api-security`). Route auth wired to fail-closed `isValidApiKey`; analytics +
      fundamentals rate-limited; 2 tests rewritten (vi.hoisted) against the real surface. tsc clean;
      full vitest 992 pass/17 skip/0 fail. **Owner chose "provision QUANTAN_API_KEY"** → env-var NAME
      documented in `.env.example` + README (no secret value committed; owner sets it in Vercel).
      Still NOT pushed/PR'd. Full detail: `WS1_FIX_PLAN_2026-06-01.md`.
- [x] **WS5 tracker reconciliation:** DONE on `fix/ws5-tracker-reconcile` @ `1f6e01c`. Q-008/Q-019
      → done, Q-035 → partial, F1.11 → fixed (Q-037/Q-005 already done). JSON re-validated.
- [ ] Assemble `workspace/TEAM_RECTIFICATION_PLAN_2026-06-01.md` master plan from WS2/WS4 specs + the above.
- [ ] Advisor checkpoint before greenlighting any Bucket-B code (WS1, WS2 items).
