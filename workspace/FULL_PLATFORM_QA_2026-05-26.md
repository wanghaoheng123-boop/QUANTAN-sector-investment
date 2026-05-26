# Full Platform QA — 2026-05-26

**Teams:** Browser · Quant · UX · Fix  
**Prod:** https://quantan.vercel.app · **Local:** http://127.0.0.1:3000  
**Branch at QA start:** `main` @ `056b54e`

## Executive summary

Parallel browser E2E (prod + local) and quant/API checks found **one P0 functional bug**: `/api/sector-rotation` returned empty `scores[]` because Yahoo history was fetched for **1 calendar year (~251 bars)** while `sectorScores()` requires **≥253 bars** for 12-month momentum. **Fixed in wave 6** (2-year fetch + panel empty-state copy).

Charts, backtest, options, heatmap, and core stock routes **PASS** on production. SSOT benchmark **net 53.79%** (floor safe). **996/996** unit tests pass.

---

## Team structure

| Team | Scope | Lead artifacts |
|------|--------|----------------|
| **Team Browser** | E2E routes, chart TFs, tabs, console | This doc § Browser matrix |
| **Team Quant** | `npm run test`, `benchmark`, API curls | § Quant matrix |
| **Team UX** | Loading, copy, mobile, a11y | § UX backlog |
| **Team Fix** | P0/P1 patches | `fix/qa-wave-6`, `RECTIFICATION_LOG` wave 6 |

---

## Findings

| ID | Team | Severity | Route/API | Issue | Status |
|----|------|----------|-----------|-------|--------|
| QA-001 | Quant | **P0** | `GET /api/sector-rotation` | Empty `scores` — 1yr fetch vs 253-bar gate | **FIXED** wave 6 |
| QA-002 | UX | P1 | `SectorRotationPanel` | Blank grid when scores empty (no message) | **FIXED** wave 6 |
| QA-003 | UX | P2 | `/heatmap` | Color legend can overflow narrow viewports | **FIXED** wave 6 (`overflow-x-auto`) |
| QA-004 | Browser | — | `/`, `/stock/*`, `/backtest`, `/heatmap` | PASS prod | Verified |
| QA-005 | Browser | — | `/stock/AAPL` chart TFs | 4H/1Y render; TradingView attribution; no ChartErrorBoundary | PASS |
| QA-006 | Browser | — | `/stock/AAPL` Options tab | Chain, GEX empty-state, flow scanner load | PASS |
| QA-007 | Browser | — | `/backtest` | ~20s load; spinner + “may take ~20s” copy | PASS |
| QA-008 | Browser | — | `/briefs/sector/technology` | SSR shell minimal in a11y snapshot; API returns `partial` | PASS (API) |
| QA-009 | Quant | — | `npm run test` | 996 passed / 82 files | PASS |
| QA-010 | Quant | — | `npm run benchmark` | Gross 54.77%, net 53.79% | PASS |
| QA-011 | Quant | — | `GET /api/chart/AAPL` | 251 candles, ascending | PASS |
| QA-012 | Quant | — | `GET /api/options/AAPL` | 200, chain + greeks | PASS |
| QA-013 | Quant | — | `GET /api/analytics/AAPL` | 200 | PASS |
| QA-014 | UX | P2 | Nav (a11y tree) | Duplicate “Markets” links (desktop + mobile) | Open — cosmetic in snapshot |
| QA-015 | UX | P2 | `SectorRotationPanel` | Component not wired on `/desk` or `/heatmap` | Open — Q-013 backlog |

---

## Browser matrix (production)

| Route | Result | Notes |
|-------|--------|-------|
| `/` | PASS | Sector grid, filters, news loading |
| `/stock/AAPL` | PASS | Chart + 4H TF; Options lazy tab |
| `/stock/MSFT`, `/stock/TSLA` | PASS | HTTP 200 (spot via API) |
| `/backtest` | PASS | Loads after ~20s; tabs overview/instruments/… |
| `/heatmap` | PASS | 11 sector tiles |
| `/briefs` | PASS | HTTP 200 |
| `/briefs/sector/technology` | PASS | API `partial`; client hydrates |
| `/commodities`, `/crypto/btc`, `/portfolio`, `/ma-deviation` | PASS | HTTP 200 |
| `/sector/technology` | PASS | HTTP 200 (not re-clicked all TFs) |

---

## Quant matrix

| Check | Result |
|-------|--------|
| `npm run test` | 996/996 PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run benchmark` | net **53.79%**, gross 54.77% |
| Prod `/api/chart/AAPL` | 200, asc candles |
| Prod `/api/sector-rotation` (pre-fix) | 200, **scores: 0** |
| Local `/api/sector-rotation` (post-fix) | 200, **scores: 11** |
| Prod `/api/briefs/technology` | 200, `dataQuality: partial` |

---

## UX improvement backlog (concrete)

| Priority | Component / route | Change |
|----------|-------------------|--------|
| P1 | `app/desk` or `/heatmap` | Mount `SectorRotationPanel` with OW/UW ranks (Q-013) |
| P2 | `components/Nav` | Dedupe “Markets” in accessibility tree (single visible control) |
| P2 | `LiveBriefClient` | Skeleton visible longer on slow SSR first paint |
| P3 | Chart toolbar | Collapse EMA grid behind “More EMAs” on `<md` |
| P3 | `/backtest` | Progress % or staged “loaded N/56” during long fetch |

---

## Wave 6 fixes shipped (Team Fix)

1. **`app/api/sector-rotation/route.ts`** — fetch **2 years** of daily bars; align min bars with `sectorScores()` (253).
2. **`components/SectorRotationPanel.tsx`** — empty-state message when `scores.length === 0`.
3. **`app/heatmap/page.tsx`** — legend row `overflow-x-auto` for mobile.

---

## Verification (post-fix)

| Check | Result |
|-------|--------|
| `__tests__/api/sector-rotation.test.ts` | PASS |
| Local API scores count | 11 |
| Benchmark floor | Unchanged (53.79% net) |

**Inspection:** `reviews/INSPECTION-WAVE-4-2026-05-26.md`  
**Rectification log:** `workspace/RECTIFICATION_LOG.md` wave 6
