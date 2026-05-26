# QUANTAN Expert Team & Commercialization Program

**Status:** Active (2026-05-26)  
**Canonical code:** `.claude/worktrees/competent-wu-a84629` (branch `chore/expert-team-program` @ `5922bca`; `main` @ `2ee18e3` post P0 merges)  
**Coordinator artifacts:** this file, `workspace/DEVELOPMENT_PLAN_2026-05-26.md`, `workspace/CONTINUOUS_IMPROVEMENT_LOOP.md` § Commercialization track

---

## What this program is

A cross-functional **virtual expert team** (quant, data, full-stack, risk/compliance, GTM) that runs **inspection waves**, closes backlog items with VERIFY gates, and advances QUANTAN from research MVP toward **paid / institutional** tiers—without marketing fluff until M3+ compliance gates pass.

Prior session (`e13e4fa2`): executed P0 development plan (merge verification, canonical worktree docs).  
Expert Team wave (`5922bca`): inspection docs, OSS benchmark, Taylor scenario P&L, factor `rSquared: null`, Next 14.2.35, nightly CI, QuantLab partial extract, smoke → quantan.

---

## Expert team roles

| Role | Focus | Primary artifacts |
|------|--------|-------------------|
| **Quant lead** | Signal WR ≥ 55% floor; WFA; scenario math | `lib/backtest/`, `reviews/invariants-baseline.md` |
| **Data engineer** | Loader SSOT, FRED RFR, provider compliance | `lib/backtest/dataLoader.ts`, F4.5 / `ComplianceBanner` |
| **Full-stack** | App Router, decomp, CVE patches | `app/`, `components/`, Q-053/Q-054/Q-057 |
| **Risk / compliance** | Yahoo ToS, experimental labels, CSRF/CSP | `reviews/R4`, `reviews/R7`, Q-040/Q-055 |
| **GTM / ops** | Vercel prod, smoke, URL consolidation | `workspace/VERCEL_OPERATIONS.md`, `lib/appUrl.ts` |

---

## Commercialization phases

| Phase | Offering | Gate |
|-------|----------|------|
| **MVP (now)** | Free research desk @ quantan.vercel.app | M1 reproducible core ✅ |
| **Pro** | Auth + saved layouts + alerts | M3 security baseline; Stripe TBD |
| **API** | Read-only signals/prices API keys | Rate limits (Q-010), OpenAPI |
| **Institutional** | Polygon/Refinitiv data path, SLA | F4.5 resolved; factor/GARCH stubs replaced |

Milestone table (live): `workspace/CONTINUOUS_IMPROVEMENT_LOOP.md` § Commercialization track.

---

## 90-day execution (aligned to codebase)

| Window | Milestone | Backlog / plan |
|--------|-----------|----------------|
| **Days 0–14** | P0 on `main`; inspection wave 1 | `reviews/INSPECTION-WAVE-1-2026-05-26.md`, DEVELOPMENT_PLAN P0 ✅ |
| **Days 15–30** | Next.js CVE closure (14.2.35+); CSP enforce schedule | Q-057-NEW, Q-040-NEW |
| **Days 31–60** | QuantLab decomp ≤500 LOC shell | Q-053-NEW, Q-058 snapshots |
| **Days 61–90** | Phase 8 loops documented; nightly WR guard | P3 in DEVELOPMENT_PLAN; `nightly-backtest.yml` |
| **Parallel** | Honest analytics (no fake R² / stub HMM as prod) | W1-005, R9-C-1/C-2 disclaimers |
| **Parallel** | Production URL SSOT | Q-065-NEW → `lib/appUrl.ts` |

**Owner-only (not code):** `QUANTAN_FRED_PREWARM=1` on Vercel Production (Q-004).

---

## Inspection & backlog linkage

| Doc | Purpose |
|-----|---------|
| `reviews/INSPECTION-WAVE-1-2026-05-26.md` | Module matrix + W1 findings |
| `reviews/OSS-BENCHMARK-2026-05-26.md` | Competitive gap vs OSS quant stacks |
| `reviews/INSPECTION-RULES.md` | Wave cadence |
| `workspace/IMPROVEMENT_BACKLOG.json` | Q-001–Q-058+ task SSOT |
| `reviews/PHASE-15-PLAN.md` | Institutional analytics sprint summary |
| `workspace/FUTURE_IMPROVEMENT_PLAN.md` | Long-horizon phases A/B/C |

---

## Next actions (priority)

1. **Merge `chore/expert-team-program`** → `main` (or cherry-pick `lib/appUrl` + briefs fix if already partial on branch).
2. **Owner:** Vercel `QUANTAN_FRED_PREWARM=1` + redeploy.
3. **Q-053-NEW:** QuantLabPanel decomposition (dedicated session).
4. **README / DEPLOY_ADVISORY:** replace remaining `antigravity-sectors` URLs (docs-only).
5. **F4.5:** Polygon migration plan before any paid tier.

---

## VERIFY cadence

Every wave: `npm run typecheck` · `npm run test` · `npm run benchmark` (if signals touched) · `SMOKE_BASE_URL=https://quantan.vercel.app npm run check:smoke`

Log to `workspace/MEMORY_LOG.md` and `workspace/SESSION_STATE.json` → `last_inspection`.

---

## Audit Log

### 2026-05-26 — Full-stack verification wave (Cursor subagent, parent mandate)

**Tree:** canonical `.claude/worktrees/competent-wu-a84629` @ `5922bca` (`chore/expert-team-program`); Drive root code synced; git HEAD at root still `3870751` on `main` (BLOCKER-ROOT-GIT-DRIFT).

| Check | Result |
|-------|--------|
| typecheck | **PASS** (worktree + root) |
| test | **982 / 982** (78 files); root was 965+17 skipped until `npm rebuild better-sqlite3` |
| build | **PASS** (`next@14.2.35`) |
| benchmark (canonical) | **57.26%** WR (≥ 55% floor) |
| benchmark:enhanced | **52.84%** — flagged non-production (Q-009) |
| smoke (quantan.vercel.app) | **PASS** (20 checks) |
| Core libs on disk | `lib/portfolio/*`, `lib/data/providers/*`, `SectorRotationPanel`, `SafeAuth` — present |
| API routes | 27 `route.ts` — imports resolve; no dead `AuthNav` refs |

**Fixes this wave (no commit):**

- `app/briefs/page.tsx` — `appBaseUrl()` for sector list fetches (Q-065 / W1-001; sector page already used `appBaseUrl`)
- Drive root — `npm rebuild better-sqlite3` (NODE_MODULE_VERSION mismatch → warehouse suite skipped)

**Open (agent vs owner):**

| ID | Owner | Item |
|----|-------|------|
| Q-053-NEW | Agent | `QuantLabPanel.tsx` ~1410 LOC — partial `quantlab/` extract; tab components remain |
| Q-004 | Owner | `QUANTAN_FRED_PREWARM=1` on Vercel Production |
| BLOCKER-ROOT-GIT-DRIFT | Owner | Align `main` HEAD with expert-team branch / merge PR |
| Phase 8 loops | Agent | `optimize:grid` / `portfolio:backtest` scripts — infrastructure exists; runs not executed this wave |
| README/docs | Agent | Legacy `antigravity-sectors` URLs in README/DEPLOY_ADVISORY (docs-only) |

### 2026-05-26 — Inspection wave 1 close + Q-053 (Cursor subagent)

**Tree:** worktree `5922bca` · uncommitted Q-053 synced to Drive root (no commit per mandate).

| Item | Status |
|------|--------|
| W1-001 briefs `appBaseUrl` | **FIXED** |
| W1-002 QuantLab LOC gate | **FIXED** — shell **148 LOC**; `quantlab/tabs/*` + hooks |
| W1-003 Next CVE | **FIXED** — `next@14.2.35` |
| F5.2 ledger | **FIXED-Q-053-2026-05-26** |
| VERIFY | 982 tests · WR **57.26%** · build · smoke PASS |
| Phase 8 | Documented `workspace/PHASE8_OPTIMIZATION.md` — grid not run (long-running) |

**Merge prep:** `chore/expert-team-program` → `main` via PR; owner FRED prewarm unchanged.
