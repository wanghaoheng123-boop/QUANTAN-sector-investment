# Inspection Wave 1 — 2026-05-26

**Branch audited:** `main` @ `2ee18e3` (post P0 PR stack)  
**Verifier:** Expert Team Program (Cursor)  
**Canonical tree:** `.claude/worktrees/competent-wu-a84629`

---

## Executive summary

| Area | Status | Notes |
|------|--------|-------|
| P0 merge stack | **PASS** | #17–#21 on main; 982 tests; WR **57.26%** |
| Walk-forward (F1.1) | **PASS** | Trade-attribution fix in `lib/backtest/walkForward.ts` |
| FRED RFR (Q-004) | **PARTIAL** | Code ready; needs `QUANTAN_FRED_PREWARM=1` on Vercel |
| CSRF (Q-055) | **PASS** | `middleware.ts` issues cookie; POST routes guarded |
| Options RFR | **PASS** | `chain.ts` uses `getRiskFreeRateSync` |
| Factor attribution | **EXPERIMENTAL** | Univariate proxy; `rSquared` not real R² |
| Scenario engine | **FIXED** (this wave) | Taylor P&L through 2nd order + vega/theta/rho |
| QuantLabPanel | **PASS** | Shell **148 LOC**; tabs/hooks under `components/stock/quantlab/` (Q-053) |
| Next.js CVE (Q-057) | **FIXED** | `next@14.2.35` on `chore/expert-team-program` |
| Enhanced signals | **FLAGGED** | 52.63% WR — do not promote (Q-009) |

---

## Module matrix

### `lib/backtest/` — PASS with notes

| Module | Correctness | Data truth | Performance |
|--------|-------------|------------|-------------|
| `signals.ts` | SSOT indicators; enhanced path gated | Yahoo split-adjusted via loader | Benchmark 57.26% canonical |
| `engine.ts` | WFA delegated; portfolio DD fixed per ledger | RFR sync when prewarm on | engine ~653 LOC post-extract |
| `walkForward.ts` | F1.1 fixed | Same as engine | O(windows × trades) |
| `portfolioBacktest.ts` | Uses `getRiskFreeRateSync(365)` | — | Informational WR ~54.66% |

**Open ledger:** F1.3 intraday stops, F1.4 partial (prewarm), F1.5 B&H dividends, F1.11 RSI piecewise.

### `lib/quant/` — PASS

| Module | Status |
|--------|--------|
| `indicators.ts` | Canonical SSOT |
| `riskFreeRate.ts` | Tenor-matched FRED + opt-in prewarm |
| `constants.ts` | Static fallbacks; TODOs superseded by riskFreeRate |

### `lib/options/` — PASS

Greeks, GEX, chain enrichment; IV sanity clamp documented.

### `lib/portfolio/` — EXPERIMENTAL

| Module | Issue | Action |
|--------|-------|--------|
| `factorAttribution.ts` | Naive univariate betas | `methodology` field + `rSquared: null` (wave 2) |
| `var.ts`, `stressTest.ts` | Historical sim — validated in Phase 15 | Monitor |

### `lib/scenarios/` — FIXED wave 2

Taylor-expansion P&L implemented; `.greeks` sums position-level Greeks without shock scaling.

### `app/` + `components/` — PARTIAL

| Item | LOC / issue |
|------|-------------|
| `QuantLabPanel.tsx` | **148 LOC shell** + `quantlab/tabs/*` (Q-053 done) |
| `app/backtest/page.tsx` | 268 — Q-054 done |
| Briefs hardcoded URL | `app/briefs/sector/[sector]/page.tsx` still points at antigravity — **backlog Q-065-NEW** |

### Security — PARTIAL

| Item | Status |
|------|--------|
| CSRF | Cookie + validate on POST |
| CSP | Report-Only unless `QUANTAN_CSP_ENFORCE=1` |
| `next` CVEs | Q-057 — bump 14.2.35 this wave |

---

## New findings (append to ledger)

| ID | Severity | File | Summary |
|----|----------|------|---------|
| W1-001 | LOW | `app/briefs/sector/[sector]/page.tsx` | Production briefs fetch uses antigravity URL |
| W1-002 | MEDIUM | `QuantLabPanel.tsx` | **FIXED** — shell 148 LOC; tabs extracted |
| W1-003 | HIGH | `package.json` | **FIXED** — `next@14.2.35` |

---

## VERIFY (2026-05-26 post-P0)

| Check | Result |
|-------|--------|
| typecheck | PASS (pre-wave) |
| test | 982 passed |
| benchmark | 57.26% WR |

Re-run **2026-05-26 (worktree `5922bca` + Q-053)**: typecheck PASS · 982 tests · WR **57.26%** · build PASS · smoke PASS.
