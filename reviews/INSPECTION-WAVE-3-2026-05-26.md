# Inspection Wave 3 — 2026-05-26

**Scope:** Dead-code prune (scripts duplicate loader), URL/Vercel SSOT, GitHub branch for rectification merge.  
**Prior:** [INSPECTION-WAVE-2-2026-05-26.md](./INSPECTION-WAVE-2-2026-05-26.md)

## Vercel consolidation

| Project | URL | Action |
|---------|-----|--------|
| **quantan** (KEEP) | https://quantan.vercel.app | Canonical production; env vars here |
| quantan-sector-investment | https://quantan-sector-investment.vercel.app | Owner: delete/archive in dashboard |
| quantan-release-work | https://quantan-release-work.vercel.app | Owner: delete/archive in dashboard |

Repo SSOT: `lib/appUrl.ts`, `scripts/smoke-production.mjs`, README, `workspace/VERCEL_OPERATIONS.md` §12.

## Code / doc fixes (wave 3)

| ID | Issue | Fix |
|----|-------|-----|
| W3-001 | README/DEPLOY still cited antigravity-sectors.vercel.app | Updated to quantan.vercel.app + project name `quantan` |
| W3-002 | Duplicate `scripts/backtest/dataLoader.ts` | Removed; enhanced benchmark uses `lib/backtest/dataLoader` |
| W3-003 | Three Vercel projects per PR | Documented single-project policy + owner delete steps |
| W3-004 | AGENTS.md referenced deleted `benchmark-signals.mjs` | → `benchmark-signals.ts` |

## Verify (wave 3)

See `workspace/RECTIFICATION_LOG.md` wave 3 table (filled by agent run).

## Wave 4 addendum (charts) — FIXED 2026-05-26

| ID | Issue | Fix |
|----|-------|-----|
| W4-001 | K-line charts hit ChartErrorBoundary: `data must be asc ordered by time` | `sortChartCandles`, sorted markers, stricter incremental updates in `KLineChart.tsx` |

## Still open (owner)

- Delete/archive extra Vercel projects in dashboard
- `QUANTAN_FRED_PREWARM=1` on **quantan** Production
- `BLOCKER-ROOT-GIT-DRIFT` — merge PR `fix/rectification-wave-3`
- Q-057 Next.js security uplift
