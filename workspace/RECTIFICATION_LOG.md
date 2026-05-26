# Platform Rectification Log

**Started:** 2026-05-26  
**Scope:** Drive root `QUANTAN-sector-investment` — module-by-module audit/fix per systematic rectification mandate.

| Module | Issue | Fix | Verify |
|--------|-------|-----|--------|
| **A. Backtest & signals** | CI floor 55.85% measured legacy ~57% inline signal, not SSOT | Re-baseline net WR floor 53.29%; `invariants-baseline.md` §1b; `benchmark-signals.ts` exits on net | `npm run benchmark` PASS |
| **A. Backtest & signals** | `engine.ts` duplicated TX_COST constants vs `executionModel.ts` | Engine imports `costBpsPerSide(DEFAULT_EXECUTION_COSTS)` | `__tests__/backtest/executionModel.test.ts` |
| **A. Backtest & signals** | Live API diverged from engine (historical) | Already on `liveSignal.ts` → `resolveBacktestSignal` | `signalParity.test.ts` |
| **A. Backtest & signals** | Portfolio sim used enhanced directly (historical) | Already on `resolveBacktestSignal` | `portfolioBacktest.test.ts` |
| **A. Backtest & signals** | `benchmark-signals.mjs` third signal path | `.mjs` is thin wrapper to `.ts` SSOT | `npm run benchmark` |
| **B. API routes** | Signal generation outside SSOT | Grep: no `regimeSignal`/`bullishCount` in `app/api` | Manual grep clean |
| **B. API routes** | `/api/backtest/live` | Uses `buildLiveInstrumentSignal` | `live/route.ts` |
| **C. Quant lib** | Duplicate indicator math | `indicators.ts` canonical; tests 984 pass | `npm run test` |
| **D. Options** | Greeks/GEX tests | No changes this wave | options/*.test.ts pass |
| **E. Portfolio & risk** | Files missing at stale root (historical) | All `lib/portfolio/*` present on Drive root | Glob verified |
| **F. Data** | Provider files deleted (historical) | `lib/data/providers/*` + `dispatcher.ts` present | Glob verified |
| **G. Optimize** | Grid search not SSOT (documented) | Comment + `SIGNAL_SSOT.md` note | N/A (research path) |
| **G. Optimize** | `optimize-grid.ts` | Present at `scripts/optimize-grid.ts` | Not run (long job) |
| **H. App pages** | AuthNav / SectorRotationPanel missing | `SafeAuth.tsx`; `SectorRotationPanel.tsx` exists | Grep clean |
| **I. Components** | QuantLab monolith | Decomposed under `components/stock/quantlab/` | typecheck PASS |
| **J. CI / scripts** | Benchmark CI would fail honest WR | Net floor in `ci.yml` | CI config updated |
| **K. Tests & quality** | Skips | 0 skipped (984/984); warehouse uses conditional skip only when no DB | `npm run test` |

## Verify matrix (2026-05-26)

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run test` | PASS (984) |
| `npm run build` | (see session) |
| `npm run benchmark` | PASS — gross 54.77%, net 53.79% |
| `npm run benchmark:enhanced` | (see session) |
| `npm run check:smoke` | Owner/Vercel (not run locally) |

## Modules rectified this session

**Count:** 11 checklist areas touched; **6** had code/doc changes (A, J, K partial, G doc, critique appendix, invariants).

## Wave 2 — 2026-05-26 (prune + browser + honest copy)

| Item | Fix | Verify |
|------|-----|--------|
| Briefs SSR hit production in local dev | `appBaseUrl()` → `127.0.0.1:$PORT` when `NODE_ENV=development` | `__tests__/lib/appUrl.test.ts` |
| Misleading 200EMA / 57% UI copy | `app/page.tsx`, `app/backtest/page.tsx` | Browser + snapshot |
| `benchmark-signals.mjs` wrapper | Deleted (SSOT: `benchmark-signals.ts`) | `npm run benchmark` |
| Stale `CLAUDE_CODE_REVIEW_HANDOFF.md` | Deleted (use `HANDOFF.md`) | — |
| Signals doc "institutional-grade WR" | `lib/backtest/signals.ts` comment | — |

### Browser QA (localhost, post-fix)

| Route | Result |
|-------|--------|
| `/` | PASS |
| `/stock/AAPL` | PASS (options API 200) |
| `/backtest` | PASS (~20s load) |
| `/heatmap`, `/commodities`, `/crypto/btc`, `/portfolio`, `/ma-deviation` | PASS (HTTP 200) |
| `/briefs`, `/briefs/sector/technology` | PASS after dev `.next` restart |

**Note:** Running `npm run build` while `npm run dev` is active can corrupt `.next` (missing chunk `1682.js`). Restart dev or `rm -rf .next` after build.

### Wave 2 verify

| Check | Result |
|-------|--------|
| Tests | 991 passed |
| Benchmark | gross 54.77%, net 53.79% |
| Smoke | PASS quantan.vercel.app |
| Inspection doc | `reviews/INSPECTION-WAVE-2-2026-05-26.md` |

## Wave 3 — 2026-05-26 (prune + Vercel single project + GitHub)

| Item | Fix | Verify |
|------|-----|--------|
| Legacy `antigravity-sectors` URLs in README/DEPLOY | → `quantan.vercel.app`, Vercel project **`quantan`** | grep clean in user-facing deploy docs |
| Duplicate `scripts/backtest/dataLoader.ts` | Deleted; `benchmark-enhanced.ts` imports `@/lib/backtest/dataLoader` | typecheck |
| `LlmDeployAssistant` default path | `QUANTAN-sector-investment` | — |
| `sync-to-local-build.ps1` temp dir | `quantan-sector-build` | — |
| Triple Vercel projects | Documented §12 in `VERCEL_OPERATIONS.md`; CLI `vercel link --project quantan` | `vercel project ls` |
| `AGENTS.md` benchmark path | `.mjs` → `.ts` SSOT | — |

### Wave 3 verify

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run test` | PASS (991 / 81 files) |
| `npm run build` | PASS (Next 14.2.35) |
| `npm run benchmark` | PASS — gross 54.77%, net 53.79% |
| `npm run check:smoke` | PASS quantan.vercel.app |

**Inspection:** `reviews/INSPECTION-WAVE-3-2026-05-26.md`  
**Git:** branch `fix/rectification-wave-3` → PR to `main`

## Wave 4 — 2026-05-26 (K-line / lightweight-charts)

| Item | Fix | Verify |
|------|-----|--------|
| Candlestick charts crash (`data must be asc ordered by time`) | `lib/sortChartCandles.ts`; sort in `/api/chart`; safer `touchLast` in `KLineChart`; sort dark-pool + news markers before `setMarkers` | Browser `/stock/AAPL`, `/sector/technology` — 28 canvases, no error boundary |
| Incremental `update()` on out-of-order last bar | Only `update` when same timestamp or strictly newer bar; `setData` fallback on throw | `__tests__/lib/sortChartCandles.test.ts` |

## Wave 5 — 2026-05-26 (charts re-check + prod deploy)

| Item | Fix | Verify |
|------|-----|--------|
| `sortChartCandles` not on `main` (PR #22 open) | Commit `0873428` + wave-5 UX on `fix/rectification-wave-3`; prod deploy after merge or `vercel deploy --prod` | `lib/sortChartCandles.ts` absent on `main`; present on branch |
| Duplicate KLine timeframe row (1D/1W/1M) ignored parent `1m`/`4H` toolbar | `hideTimeframeSelector` on stock/sector/BTC pages; built-in row only when `onTimeframeChange` set | Browser: single range toolbar on `/stock/AAPL` |
| Silent chart fetch failures | `chartError` + Retry on stock & sector pages | Manual fail path / empty API |
| BTC normalize drift from equity sort | `normalizeBtcCandles` delegates to `sortChartCandles` | `__tests__/lib/sortChartCandles.test.ts` (5 tests) |
| Prod browser QA (pre-deploy) | — | `/stock/AAPL` 28 canvases; `/sector/technology` 28 canvases; no ChartErrorBoundary text |

**Prod missing prior fix:** yes (`sortChartCandles.ts` not in `main`; lightweight-charts client sort + stricter `touchLast` only on branch).

## Wave 6 — 2026-05-26 (full-platform QA)

| Item | Fix | Verify |
|------|-----|--------|
| Sector rotation API empty scores | `fetchCloses` uses 2yr history; min 253 bars | Local API: 11 scores; `sector-rotation.test.ts` |
| Rotation panel blank UI | Empty-state copy + `excludedSectors` hint | Component render |
| Heatmap legend mobile clip | `overflow-x-auto` on legend | Visual / narrow viewport |
| Full QA doc | `workspace/FULL_PLATFORM_QA_2026-05-26.md` | Teams Browser/Quant/UX/Fix |

### Wave 6 verify

| Check | Result |
|-------|--------|
| Tests | 996 passed |
| Benchmark | gross 54.77%, net 53.79% |
| Build | PASS |
| Inspection | `reviews/INSPECTION-WAVE-4-2026-05-26.md` |

## Deferred (owner / next session)

- F1.4 FRED RFR in engine Sharpe (Q-004)
- F1.5 B&H dividends full accuracy (Q-021)
- F4.3 distributed rate limit (KV)
- `regimeSignal` OOS tuning without overfit
- `npm run optimize:grid` overnight + Phase 8
- BLOCKER-ROOT-GIT-DRIFT merge
- CPCV / deflated Sharpe (critique P1)
