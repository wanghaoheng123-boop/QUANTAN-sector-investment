# QUANTAN UI Function Audit — Route Manifest

**Date:** 2026-06-03  
**Subagent:** `3c0e778d` (read-only, production probe)  
**Branch:** `fix/rectification-wave-12-2026-06-03`  
**Scope:** 48 navigable surfaces (16 App Router pages + 32 API handlers).

---

## Executive summary

| Metric | Count |
|--------|------:|
| Surfaces audited | 48 |
| PASS | 40 |
| FAIL | 3 |
| TIMEOUT / env | 5 |

**F-04 (FIXED on Wave 12 branch):** `/portfolio` showed WR **4837%** / max DD **1520%** — JSON stores percent values (`48.37`, `15.2`) but UI multiplied by 100 again. Fix: `app/portfolio/page.tsx`.

---

## Failure register (F-01 … F-08)

| ID | Route | Issue | Status | Tracker |
|----|-------|-------|--------|---------|
| F-01 | `/monitor` | 404 — route not in app router | Expected | Q-069 (use `/desk`) |
| F-02 | `/quant-lab` | 404 — tab on `/stock/[ticker]` | Expected | Q-070 |
| F-03 | `/api/sector-rotation` | Agent probe timeout | Env | Q-071 |
| F-04 | `/portfolio` | Double percent display | **FIXED** | — |
| F-05 | `/api/ma-deviation` | Agent probe timeout | Env | Q-071 |
| F-06 | `/api/briefs` | Agent probe timeout | Env | Q-072 |
| F-07 | `/api/options/[ticker]` | Agent probe timeout | Env | Q-072 |
| F-08 | `/api/trading-agents/[ticker]` | Agent probe timeout | Env | Q-073 |

---

## Page manifest (16)

| # | Route | Page file | Verdict | Notes |
|---|-------|-----------|---------|-------|
| 1 | `/` | `app/page.tsx` | PASS | Sector grid |
| 2 | `/backtest` | `app/backtest/page.tsx` | PASS | Live signals |
| 3 | `/stock/[ticker]` | `app/stock/[ticker]/page.tsx` | PASS | QuantLab + Options |
| 4 | `/crypto/btc` | `app/crypto/btc/page.tsx` | PASS | BTC desk |
| 5 | `/portfolio` | `app/portfolio/page.tsx` | PASS* | F-04 fix on Wave 12 |
| 6 | `/sector/[slug]` | `app/sector/[slug]/page.tsx` | PASS | SSE sector view |
| 7 | `/briefs` | `app/briefs/page.tsx` | PASS | Brief hub |
| 8 | `/briefs/sector/[sector]` | `app/briefs/sector/[sector]/page.tsx` | PASS | Per-sector |
| 9 | `/crypto` | `app/crypto/page.tsx` | PASS | Crypto landing |
| 10 | `/ma-deviation` | `app/ma-deviation/page.tsx` | PASS | 200MA desk |
| 11 | `/heatmap` | `app/heatmap/page.tsx` | PASS | Heatmap |
| 12 | `/desk` | `app/desk/page.tsx` | PASS | Monitor substitute |
| 13 | `/commodities` | `app/commodities/page.tsx` | PASS | Commodities |
| 14 | `/portfolio/factor-attribution` | `app/portfolio/factor-attribution/page.tsx` | PASS | Factor OLS |
| 15 | `/risk/scenarios` | `app/risk/scenarios/page.tsx` | PASS | Stress |
| 16 | `/auth/signin` | `app/auth/signin/page.tsx` | PASS | NextAuth |

---

## API surface (32)

Full rate-limit rows: `reviews/FUNCTION-AUDIT-API-2026-06-03.md`. Probe timeouts: F-03, F-05, F-06, F-07, F-08.

*Generated from subagent `3c0e778d`; consolidated for PR #49.*
