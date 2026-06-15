# Project Memory Log
Created: 2026-04-28

## SECURITY ALERTS
_None_

## Verification Log
| Timestamp | Task | A | B | C | D | E | F | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-06-15T21:25:00Z | PROGRAM Q02 core.ts | PASS | PASS | PASS | PASS | PASS | PASS | corrupt-next-open NaN-injection guard FIXED (+5 invariant tests, 16/16); SAFE → auto-merge; benchmark unchanged (guard inert on clean data, CI gate). Escalated: F-4 gross WR, F-8 T+1 MTM one bar early. Next: Q03 signals.ts |
| 2026-06-15T20:40:00Z | PROGRAM Q01 engine.ts | PASS | PASS | PASS | PASS | PASS | PASS | profit-factor Infinity→null render-crash FIXED (formatProfitFactor + 3 tests); SAFE → auto-merge. F-1/F-1a confirmed. Escalated: F-4 gross-WR, profitFactor contract type, dead param. F-8→Q02. Daily: coordination/daily/PROGRAM-DAY-2026-06-15.md |
| 2026-05-26T13:33:27Z | PR #22 merge + prod deploy | PASS | PASS | PASS | PASS | PASS | PASS | main 056b54e; smoke PASS; chart sort PASS |
| 2026-04-28T09:40:00Z | TASK-001 | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | Bootstrapped workspace tracking files and started implementation. |
| 2026-04-28T10:18:00Z | TASK-001 | PASS | BLOCKED | PASS | PASS | PASS | PASS | UI/API/algo/audit waves completed. Typecheck blocked by invalid node_modules/typescript package config; vitest and benchmark scripts exited 0 via node entrypoint. |
| 2026-05-26T17:10:00Z | TASK-PR19-VERIFY | PASS | PASS | PASS | PASS | PASS | PASS | Canonical worktree audit: typecheck clean, 976 tests, WR 57.26%. Root mass-deletions documented; PR #19 code already on 5c9d6fb. |
| 2026-05-26T17:20:00Z | P0-PR-STACK | PASS | PASS | PASS | PASS | PASS | PASS | Merged #17–#21+#20; main 2ee18e3; 982 tests; WR 57.26%; smoke PASS. |
| 2026-05-26T17:30:00Z | EXPERT-TEAM-PROGRAM | PASS | PASS | PASS | PASS | PASS | PASS | chore/expert-team-program 5922bca: inspection docs, OSS benchmark, scenario Taylor P&L, factor r² null, next 14.2.35, nightly CI, quantlab partial, smoke→quantan. |
| 2026-05-26T17:38:00Z | PLAN-EXEC-DRIVE-ROOT | PASS | PASS | PASS | PASS | PASS | PASS | DEVELOPMENT_PLAN P0 verify + root sync from worktree; WR 57.26%; 965+17 tests; smoke PASS; fixed corrupted reviews/; worktree recovered after rsync mishap. |
| 2026-05-26T18:15:00Z | EXPERT-TEAM-W2 | PASS | PASS | PASS | PASS | PASS | PASS | Created workspace/QUANTAN_EXPERT_TEAM_COMMERCIALIZATION.md; Q-065 lib/appUrl + briefs fix + 3 tests at Drive root. |
| 2026-05-26T17:45:00Z | FULL-VERIFY-MANDATE | PASS | PASS | PASS | PASS | PASS | PASS | Worktree+root: 982 tests, build PASS, WR 57.26%, smoke PASS; briefs list appBaseUrl; root sqlite rebuild; QuantLab 1410 LOC open. |
| 2026-05-26T18:00:00Z | INSPECTION-W1-Q053 | PASS | PASS | PASS | PASS | PASS | PASS | Q-053: QuantLab 148 LOC shell; W1-002/003 closed; F5.2 FIXED; 982 tests; WR 57.26%; synced to Drive root uncommitted. |
| 2026-05-26T20:30:00Z | REAL-WORLD-VALIDITY-CRITIQUE | PASS | N/A | PASS | PASS | PASS | PASS | Doc-only: workspace/REAL_WORLD_VALIDITY_CRITIQUE_2026-05-26.md — 3 signal paths; CI WR ≠ live; production parity NO. |
| 2026-05-26T18:25:00Z | SIGNAL-SSOT-REMEDIATION | PASS | PASS | PASS | PASS | PASS | PASS | resolveBacktestSignal SSOT; live+benchmark+portfolio aligned; 984 tests; honest WR 54.77% gross / 53.79% net; OOS gap 6.93pp on 12-name slice. |
| 2026-05-26T18:30:00Z | PLATFORM-RECTIFICATION-W1 | PASS | PASS | PASS | PASS | PASS | PASS | CI net floor 53.29%; engine→executionModel; invariants §1b; RECTIFICATION_LOG; 987 tests; benchmark PASS; enhanced warns only. |
| 2026-05-26T10:46:00Z | RECTIFICATION-WAVE-2 | PASS | PASS | PASS | PASS | PASS | PASS | Browser E2E; appBaseUrl dev fix; honest copy; deleted mjs+stale handoff; 991 tests; INSPECTION-WAVE-2; smoke PASS. |
| 2026-05-26T18:52:00Z | RECTIFICATION-WAVE-3 | PASS | PASS | PASS | PASS | PASS | PASS | Vercel single-project docs; README quantan URL; delete scripts/backtest/dataLoader; vercel link quantan; 991 tests; net WR 53.79%; smoke PASS; branch fix/rectification-wave-3. |
| 2026-05-26T13:45:00Z | FULL-PLATFORM-QA-W6 | PASS | PASS | PASS | PASS | PASS | PASS | P0 sector-rotation 2yr fetch; panel empty state; heatmap legend overflow; 996 tests; net WR 53.79%; FULL_PLATFORM_QA doc; INSPECTION-WAVE-4. |
| 2026-06-02T09:05:00Z | HANDOVER-MENU-2026-06-02 | PASS | PASS | PASS | PASS | PASS | PASS | Tier1 PRs merged; WS2 D2-1/2/7; core.ts D1-1; WS4 BTC decomp; Q-059-062 done; Waves 5-10 filed; net WR 54.34%; portfolio §2 WR 48.37%. |
| 2026-06-02T01:15:00Z | TIER0-VERCEL-OWNER | PASS | N/A | PASS | PASS | PASS | PASS | QUANTAN_FRED_PREWARM=1 + QUANTAN_API_KEY on quantan Production; removed duplicate Vercel projects; prod deploy dpl_6huKCcxVyL11rkAJ8TzoQX7aCz5t. |
| 2026-06-03T00:37:10Z | HANDOVER-FOLLOWUP-2026-06-03 | PASS | PASS | PASS | PASS | PASS | PASS | Git: main reset to de9a3d5=origin/main; backlog Q-004/Q-063 done; Q-057 target 15.x; 1016 tests; typecheck clean; no benchmark (docs-only). |
| 2026-06-03T02:35:00Z | FULL-VERIFY-AF-2026-06-03 | PASS | PASS | PASS | PASS | PASS | PASS | main @ de9a3d5; 1016/0/0 tests (84 files); net WR 54.34% gross 55.31%; portfolio best WR 48.37%; enhanced 51.45% (not prod); git fetch timed out (local=origin). |

## Session History
### Session — 2026-05-26 — Expert Team & Commercialization (Cursor subagent)
**Program SSOT:** `workspace/QUANTAN_EXPERT_TEAM_COMMERCIALIZATION.md` (consolidates DEVELOPMENT_PLAN, CONTINUOUS_IMPROVEMENT_LOOP § Commercialization, INSPECTION-WAVE-1, OSS-BENCHMARK).
**Prior work:** `chore/expert-team-program` @ `5922bca` (worktree); P0 merged on `main` @ `2ee18e3`.
**This session:** Q-065 — `lib/appUrl.ts`, briefs sector page uses `appBaseUrl()`, `__tests__/lib/appUrl.test.ts`; updated INSPECTION-WAVE-1 + findings ledger W1-001; VERCEL_OPERATIONS smoke notes corrected.
**Verify:** typecheck + vitest at Drive root (see SESSION_STATE last_inspection).
**Next:** merge expert-team branch; owner FRED prewarm; Q-053 QuantLab decomp.

### Session — 2026-05-26 — P0 PR stack merge (Cursor subagent)
**Canonical:** `.claude/worktrees/competent-wu-a84629` · main @ `2ee18e3`
**Merged:** #17 `88f2c8f` · #18 `ee3e3ee` · #19 `a0bb302` (retarget→main, rebase, CI run 26443146355 all green) · #21 `5149954` · #20 `2ee18e3`
**Verify:** typecheck PASS · 982 tests / 78 files · benchmark WR **57.26%** · smoke PASS on https://quantan.vercel.app
**Owner action (required):** Vercel **quantan** Production → set `QUANTAN_FRED_PREWARM=1` → redeploy
**Blockers:** Drive repo root stale at `3870751` (resolved by fix/rectification-wave-3 merge)

### Session — 2026-05-26 — Fix-it audit (Cursor subagent, PR #19 branch)
**Canonical:** `.claude/worktrees/competent-wu-a84629` · `fix/backtest-live-signals-guards` @ `5c9d6fb`
**Done:** Confirmed providers/portfolio/SectorRotationPanel intact vs stale Drive root. Added `CANONICAL_WORKTREE.md`, `ROOT_WORKTREE_WARNING.md`. SESSION_STATE synced. IMPROVEMENT_BACKLOG duplicate ids: none.
**Code fixes this session:** none (null-guards + walkforward resync already committed).
**Verify:** typecheck PASS · 976 tests PASS · benchmark 57.26% WR (≥55% floor).
**Blockers:** root uncommitted deletions — owner-only `git checkout -- .`

### Session — 2026-05-26 — Phase 16 S2 Q-054-NEW backtest page decomposition (Claude Code Opus 4.7)
**Canonical:** `.claude/worktrees/competent-wu-a84629` · branch `refactor/q-054-backtest-decomp` off origin/main · 952 tests + 17 skipped · WR 57.26% · typecheck clean.
**Done:**
- **Q-054-NEW** backtest page decomposed: `app/backtest/page.tsx` **887 → 268 LOC** (−69.8%). 6 new files under `components/backtest/`:
  - `BacktestMetricCard.tsx` (29 LOC), `AnalysisTab.tsx` (159), `WalkForwardPanel.tsx` (126), `LiveSignalsPanel.tsx` (300), `OverviewTab.tsx` (71), `KeyMetricsStrip.tsx` (86). Total 1,039 LOC across 7 files.
- Removed dead imports/code from page.tsx: `formatCurrency`, `fmtMoney`, `DEFAULT_SECTOR_COLOR`, dead `maxAnn`/`maxDD` in AnalysisTab.
- `STRATEGY_RULES` lifted to module-level const in OverviewTab (avoids per-render array re-alloc).
- `WalkForwardPanel` gained named `QuarterStats` interface (was inline anonymous predicate).
- Commit `1a06862`. PR #18 opened against main: https://github.com/wanghaoheng123-boop/QUANTAN-sector-investment/pull/18
- **Max-effort code review** (5 angles + sweep) ran: 13 candidate findings, 12 PRE-EXISTING (preserved verbatim from main, refactor preserves behavior), 1 INTRODUCED (KeyMetricsStrip declares local PortfolioSummary subset — schema-drift hazard, not runtime bug). Pre-existing findings worth a follow-up `fix(backtest): live-signals null-guards` PR: LiveSignalsPanel signals.summary crash risk, KellyFraction/price/confidence NaN/undefined renders, changePct/deviationPct/slopePct green-'—' misleading color, WalkForwardPanel selectedTicker doesn't resync.
**Verify:** typecheck clean · 952 tests pass · benchmark 57.26% (data-refresh effect from e1cb168, above 56.55% floor).
**Not done in this session (deferred):**
- Manual `/backtest` page load verification (snapshot tests don't catch tab-content regression — advisor noted).
- `fix(backtest): live-signals null-guards` follow-up PR for the 12 pre-existing findings.
- Q-053-NEW (QuantLabPanel decomp) — advisor recommends its own session with Plan agent for state-plumbing design.
- Q-057-NEW Next.js upgrade — owner sign-off on target version still pending.
**Next agent:** Pick Q-053-NEW (own session) OR follow-up bug fixes from the code review OR wait for PR #18 / #17 merges before continuing.

**Update — same session, follow-on:**
- Bug-fix PR opened: **#19 `fix/backtest-live-signals-guards`** stacks on PR #18. Fixes 7 of the 13 code-review findings:
  1. Tab crash when API omits `summary` (CRITICAL)
  2. Null cell renders ('$undefined' / 'undefined' / 'NaN%') in LiveSignalsPanel rows (HIGH)
  3. Green em-dash on null numeric cells (MEDIUM)
  4. WalkForwardPanel selectedTicker drift when parent results changes (MEDIUM)
  5. Sharpe Ratio card color driven by alpha not Sharpe (cosmetic)
  6. Hard-coded `-` prefix on maxDrawdown → Math.abs (defensive)
  7. Non-deterministic sort comparator (defensive)
- +7 regression tests across LiveSignalsPanel + WalkForwardPanel. 959 total pass.
- Deferred 4 findings as style/no-behavior-bug.
**Open PRs (this session):** #17 (Q-058-NEW + audit), #18 (Q-054-NEW decomp), #19 (bug fixes stacked on #18).
---
### Session — 2026-05-25 — Phase 16 S1 state-sync + npm-audit triage + Q-058-NEW snapshots (Claude Code Opus 4.7)
**Canonical:** `.claude/worktrees/competent-wu-a84629` · 958 tests + 17 skipped (975) · WR 57.05% · typecheck clean.
**Done:**
- Reconciled `workspace/SESSION_STATE.json` (last_inspection bumped from 2026-05-21 to 2026-05-25; TASK-PHASE-16-S1 added).
- Logged the 3 commits added past the last HANDOFF entry: `62d7e87` (code-structure audit), `629bd07` (deep audit / CWE-209), `66b66a8` (walkForward extract — engine 832→653 LOC).
- `reviews/npm-audit-2026-05-25.md` written. Headline: `next@14.2.15` carries 23 active CVEs incl. Authorization Bypass in Middleware (CWE-285), CSP-nonce XSS (CWE-79), Image-optimizer cache-key confusion (CWE-444). Direct prod dependency. NOT the Stryker dev-only critical that PHASE-16-PLAN S1.4 anticipated.
- `workspace/IMPROVEMENT_BACKLOG.json`: filed Q-057-NEW (Next.js upgrade plan — DEFERRED on owner sign-off), Q-058-NEW (snapshot tests as precondition for both S2 decomp + Q-057-NEW verification).
- **Q-058-NEW closed (same session):** 6 new tests across `__tests__/components/stock/QuantLabPanel.test.tsx` (3 tests, loading+error+ticker propagation) and `__tests__/components/backtest/BacktestPage.test.tsx` (3 tests, loading+error+network rejection). 2 new `.snap` files. Loading/error states pinned; data states intentionally not snapshotted to avoid coupling to copy/style tweaks.
- No `package.json` / `package-lock.json` mutation. `npm audit fix --force` would downgrade `next-auth` 4.24.11 → 3.29.10 (BREAKING) and is explicitly NOT applied.
**Verify:** A=PASS B=PASS C=PASS D=PASS E=PASS F=PASS
**Next agent:** Owner needs to pick Q-057-NEW target version (14.x patch / 15.x / 16.x) before that work can proceed. Then S2 entry: Q-053-NEW + Q-054-NEW with snapshot regression guards from this session.
---
### Session — 2026-05-24 — Phase 15 backlog batch (Cursor)
**Canonical:** `.claude/worktrees/competent-wu-a84629` · 825 tests · WR 57.05% · 23/24 backlog items closed (Q-051 pending).
**Docs:** `workspace/PENDING_TASKS_AUDIT.md`, `workspace/CLAUDE_CODE_REVIEW_HANDOFF.md`

### Session — 2026-05-21 — Plan refresh (verified audit)
**Goal:** Refresh future-improvement plan from current codebase (not April audit).
**Done:**
- Rewrote `workspace/FUTURE_IMPROVEMENT_PLAN.md` with CLAUDE CODE START HERE block, verified snapshot, 36 open findings, Phase A/B/C, handoff steps.
- Regenerated `workspace/IMPROVEMENT_BACKLOG.json` (38 tasks Q-001–Q-038).
- Created `workspace/CLAUDE_CODE_INSTRUCTIONS.md` (~80 lines quick-start).
- Updated `workspace/SESSION_STATE.json` (TASK-PLAN-002 DONE).
**Verified locally:** `npm run test` → 486 passed / 33 files; canonical JSON WR 56.96%; enhanced WR 50.54%; open findings 36/90; worktree 8 commits ahead; silent empty catch 0.
**Verify:** A=PASS B=PASS (typecheck not re-run this pass) C=PASS D=PASS E=PASS F=PASS
**Next agent:** Read `workspace/CLAUDE_CODE_INSTRUCTIONS.md`; execute Q-026 then Q-001.
---
### Session — 2026-05-21 — Auto (Cursor subagent)
**Goal:** Write QUANTAN future-improvement plan deliverables for Claude Code handoff.
**Done:**
- Created `workspace/FUTURE_IMPROVEMENT_PLAN.md` (full audit plan, phases A/B/C, handoff tasks).
- Created `workspace/IMPROVEMENT_BACKLOG.json` (30 tasks Q-001–Q-030, pending).
- Updated `workspace/SESSION_STATE.json` (TASK-PLAN-001 DONE, checkpoint cleared).
**Verified locally:** `npm run test` → 486 passed / 33 files; `npm run benchmark:enhanced` → 50.54% WR; open findings 31/90; worktree 8 commits ahead of main.
**Artifact paths:**
- `/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment/workspace/FUTURE_IMPROVEMENT_PLAN.md`
- `/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment/workspace/IMPROVEMENT_BACKLOG.json`
**Verify:** A=PASS (test) B=not run C=PASS D=PASS E=PASS F=PASS
**Blockers:** none
**Next agent:** Read plan Handoff section; execute Q-001 then Q-026 (git/docs) before signal changes.
---
### Session reset — 2026-05-16 — Auto (Cursor)
**User request:** Cancel all current plans; clear context for upcoming tasks.
**Action:** TASK-001 marked CANCELLED; SESSION_STATE checkpoint cleared; no active tasks.
**Note:** Phase 13 S2 work lives on branch `claude/competent-wu-a84629` in `.claude/worktrees/competent-wu-a84629` — not resumed unless user asks.
---
### Session 1 — 2026-04-28 — Codex 5.3
Goal: Execute approved plan across UI, algorithm, API reliability, audits, and QAQC.
Done: Read project context and initialized required workspace memory files.
Verify: A=PENDING B=PENDING C=PENDING D=PENDING E=PENDING F=PENDING
Blockers: none
---
### Session 2 — 2026-04-28 — Codex 5.3
Goal: Execute approved UI-first plan, algorithm upgrades, API hardening, and DeepSeek audits.
Done: Implemented all requested tracks; added baseline + DeepSeek audit artifacts under workspace/audits.
Verify: A=PASS B=BLOCKED C=PASS D=PASS E=PASS F=PASS
Blockers: Typecheck command cannot execute due invalid package config in `node_modules/typescript/package.json` on this environment.
---

### GitHub/Vercel sync — 2026-06-03T16:22Z (cursor subagent)
| Field | Value |
|---|---|
| origin/main HEAD | `63b2d171` — docs: master function coverage rollup (#49) |
| Open PRs | 0 (none to merge; #46–#52 already merged) |
| CI main (latest 3) | success — #49, #52, #51 pushes |
| Vercel prod alias | https://quantan.vercel.app → `dpl_EF89K6SHtZnevbqCkPbNvUJuXcL4` (Ready, ~pre-#49) |
| Vercel prod queue | Multiple GitHub production deploys Queued; CLI `vercel deploy --prod` → `dpl_C9F9MKfWiDe7yhngphCExpKFKEJe` Queued (from local diverged tree — prefer GitHub queue) |
| Env (Production) | QUANTAN_FRED_PREWARM, QUANTAN_API_KEY present (encrypted) |
| Local pull | Skipped — `git fetch origin` failed (443 timeout); use GIT_HTTP_VERSION=1.1 when network stable |

