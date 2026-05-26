# Inspection Wave 2 — 2026-05-26

**Scope:** Dead-code prune, browser E2E on localhost:3000, honest-metrics copy, `appBaseUrl` dev fix.  
**Prior:** [INSPECTION-WAVE-1-2026-05-26.md](./INSPECTION-WAVE-1-2026-05-26.md)

## Browser QA matrix (localhost dev)

| Route | HTTP | UI | Notes |
|-------|------|-----|-------|
| `/` | 200 | PASS | Sector grid, backtest CTA; news may show loading until `/api/briefs` returns |
| `/stock/AAPL` | 200 | PASS | Chart + tabs; Options tab can show Next.js dev overlay on hydration — API `/api/options/AAPL` 200 |
| `/backtest` | 200 | PASS | Loads after ~20s full 56-instrument run; spinner copy updated |
| `/heatmap` | 200 | PASS | (HTTP only; visual not blocked) |
| `/briefs` | 200 | PASS | SSR uses `127.0.0.1` in dev via `appBaseUrl()`; restart dev if `.next` stale after `npm run build` |
| `/briefs/sector/technology` | 200 | PASS | Slug is lowercase (`technology`, not `Technology`) |
| `/commodities` | 200 | PASS | |
| `/crypto/btc` | 200 | PASS | |
| `/portfolio` | 200 | PASS | |
| `/ma-deviation` | 200 | PASS | |

**Production smoke:** `npm run check:smoke` → all checks PASS on https://quantan.vercel.app

## API cross-check

| Endpoint | Status | SSOT |
|----------|--------|------|
| `/api/backtest/live?tickers=AAPL` | 200 | `buildLiveInstrumentSignal` → HOLD @ ~64% conf |
| `/api/backtest` | 200 (~19s) | `resolveBacktestSignal` via engine |
| `/api/options/AAPL` | 200 | Yahoo chain + greeks |

## Code / doc fixes (wave 2)

| ID | Issue | Fix |
|----|-------|-----|
| W2-001 | Briefs SSR fetched production when `NEXT_PUBLIC_APP_URL` unset in dev | `lib/appUrl.ts` → `http://127.0.0.1:$PORT` in development |
| W2-002 | UI claimed "200EMA + 10% stop" / implied 57% accuracy | Honest SSOT copy on `app/page.tsx`, `app/backtest/page.tsx` |
| W2-003 | Deprecated `benchmark-signals.mjs` wrapper still on disk | Deleted; `npm run benchmark` → `.ts` only |
| W2-004 | Stale `CLAUDE_CODE_REVIEW_HANDOFF.md` (wrong worktree) | Deleted; use `HANDOFF.md` |
| W2-005 | Misleading "institutional-grade win rate" in signal comment | `lib/backtest/signals.ts` docstring |

## Verify (wave 2)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run test` | PASS (991) |
| `npm run build` | PASS |
| `npm run benchmark` | PASS — gross 54.77%, net 53.79% |
| `npm run benchmark:enhanced` | PASS — ~52.8% (research) |
| `npm run benchmark:oos` | PASS — wrote `workspace/optimization-runs/oos-validation.json` |
| `npm run check:smoke` | PASS |

## Still open (owner)

- `BLOCKER-ROOT-GIT-DRIFT` — merge worktree → Drive root
- `QUANTAN_FRED_PREWARM=1` on Vercel (Q-004)
- Backtest UX: consider server cache or progressive load (19s cold)
- CPCV / deflated Sharpe, shadow signal log (critique P1)
- `optimize:grid` overnight run
