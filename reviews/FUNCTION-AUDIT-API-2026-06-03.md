# QUANTAN API Function Audit — Rate Limit Manifest

**Date:** 2026-06-03  
**Subagent:** `8fdd3fc9` (read-only)  
**Branch:** `fix/rectification-wave-12-2026-06-03`  
**Scope:** Every exported HTTP handler under `app/api/` — `applyRateLimit` presence, upstream fan-out, remediation on FAIL rows.

---

## Executive summary

| Metric | Count |
|--------|------:|
| Handlers audited | 30 |
| PASS (rate limit present) | 21 |
| FAIL (missing rate limit) | 6 |
| SKIP (framework / out of scope) | 3 |

**Remediation (this wave):** All 6 FAIL handlers now call `applyRateLimit` before upstream work. Fan-out route `GET /api/ma-deviation` uses **10 req/min** (13 parallel Yahoo charts). Simple external/health routes use **30 req/min**, matching analytics/fundamentals and `GET /api/crypto/btc`.

**Post-fix coverage:** **27/27** application routes (excluding NextAuth) enforce per-IP rate limits.

---

## Audit criteria

| Check | PASS | FAIL | SKIP |
|-------|------|------|------|
| `applyRateLimit` at handler entry | Yes | No | N/A (NextAuth) |
| Limit before cache miss triggers upstream | Yes | — | — |
| Fan-out Yahoo routes ≤10/min | Yes | Missing on ma-deviation | — |

Implementation SSOT: `lib/api/rateLimit.ts` (in-memory bucket; KV when `KV_REST_API_URL` + `KV_REST_API_TOKEN` set).

---

## Full handler manifest

| # | Method | Route | Upstream / notes | Limit (pre-fix) | Verdict | Limit (post-fix) |
|---|--------|-------|------------------|-----------------|---------|------------------|
| 1 | GET | `/api/analytics/[ticker]` | Yahoo quote + modules | 30/min | PASS | 30/min |
| 2 | GET | `/api/backtest` | Cached portfolio JSON | 30/min | PASS | 30/min |
| 3 | POST | `/api/backtest` | CSRF + recompute | 3/min | PASS | 3/min |
| 4 | GET | `/api/backtest/live` | Live signal engine | 60/min | PASS | 60/min |
| 5 | GET | `/api/bloomberg-bridge/health` | Optional bridge probe | — | **FAIL** | **30/min** |
| 6 | GET | `/api/briefs` | Multi-sector brief cache | 6/min | PASS | 6/min |
| 7 | GET | `/api/briefs/[sector]` | Per-sector brief | 30/min | PASS | 30/min |
| 8 | GET | `/api/chart/[ticker]` | Yahoo chart | 60/min | PASS | 60/min |
| 9 | GET | `/api/conditional-vol/[ticker]` | Computed vol surface | 30/min | PASS | 30/min |
| 10 | GET | `/api/crypto/btc` | Aggregated BTC desk | 30/min | PASS | 30/min |
| 11 | GET | `/api/crypto/btc/quote` | CoinGecko simple price | — | **FAIL** | **30/min** |
| 12 | GET | `/api/crypto/btc/metrics` | Bybit + OKX (3 fetches) | — | **FAIL** | **30/min** |
| 13 | GET | `/api/crypto/btc/liquidations` | OKX liquidations | — | **FAIL** | **30/min** |
| 14 | GET | `/api/darkpool/[ticker]` | Dark pool feed | 30/min | PASS | 30/min |
| 15 | GET | `/api/fundamentals/[ticker]` | Yahoo fundamentals | 30/min | PASS | 30/min |
| 16 | GET | `/api/ma-deviation` | **13× Yahoo chart fan-out** | — | **FAIL** | **10/min** |
| 17 | GET | `/api/ml/[ticker]` | ML inference | 30/min | PASS | 30/min |
| 18 | GET | `/api/news/[sector]` | News aggregation | 30/min | PASS | 30/min |
| 19 | GET | `/api/news/ticker/[ticker]` | Ticker news | 30/min | PASS | 30/min |
| 20 | GET | `/api/options/[ticker]` | Options chain | 30/min | PASS | 30/min |
| 21 | GET | `/api/prices` | Batch price quotes | 60/min | PASS | 60/min |
| 22 | GET | `/api/regime/[ticker]` | Regime classifier | 30/min | PASS | 30/min |
| 23 | GET | `/api/search` | Symbol search | 30/min | PASS | 30/min |
| 24 | GET | `/api/sector-rotation` | 11× Yahoo chart fan-out | 10/min | PASS | 10/min |
| 25 | GET | `/api/stream/[ticker]` | SSE proxy | 10/min | PASS | 10/min |
| 26 | GET | `/api/trading-agents/[ticker]` | TA backend read | 10/min | PASS | 10/min |
| 27 | POST | `/api/trading-agents/[ticker]` | TA backend + auth | 10/min | PASS | 10/min |
| 28 | GET | `/api/trading-agents/health` | TA `/health` probe | — | **FAIL** | **30/min** |
| 29 | GET | `/api/auth/[...nextauth]` | NextAuth session | — | SKIP | — |
| 30 | POST | `/api/auth/[...nextauth]` | NextAuth callbacks | — | SKIP | — |

---

## FAIL remediation detail

| Route | Bucket key | `maxRequests` | `windowSeconds` | Rationale |
|-------|------------|---------------|-----------------|-----------|
| `GET /api/ma-deviation` | `ma-deviation` | 10 | 60 | Critical: 11 sector ETFs + SPY + QQQ parallel `yahooFinance.chart` |
| `GET /api/crypto/btc/quote` | `crypto-btc-quote` | 30 | 60 | Single CoinGecko REST call |
| `GET /api/crypto/btc/metrics` | `crypto-btc-metrics` | 30 | 60 | Bybit/OKX; 5s server cache |
| `GET /api/crypto/btc/liquidations` | `crypto-btc-liquidations` | 30 | 60 | OKX public liquidations; 10s cache |
| `GET /api/bloomberg-bridge/health` | `bloomberg-bridge-health` | 30 | 60 | Config probe only |
| `GET /api/trading-agents/health` | `trading-agents-health` | 30 | 60 | 8s timeout upstream health |

Pattern reference: `app/api/sector-rotation/route.ts` (fan-out 10/min), `app/api/analytics/[ticker]/route.ts` (simple 30/min).

---

## SKIP rationale

| Handler | Reason |
|---------|--------|
| `GET/POST /api/auth/[...nextauth]` | NextAuth framework handler; rate limiting owned by session/OAuth providers, not app `applyRateLimit` |

---

## Verification

- `npm run typecheck`
- `npm run test` — includes `__tests__/api/route-rate-limit.test.ts` (analytics/fundamentals 30→429); optional extension for `ma-deviation` fan-out bucket
- Regression: existing route tests mock `applyRateLimit` where Yahoo/network is stubbed

---

## Related documents

- `reviews/SECURITY-API-AUDIT-2026-06-03.md` — D4/D5 security context (Q-005 rate limiting)
- `workspace/coordination/WS1_FIX_PLAN_2026-06-01.md` — house test patterns

---

*Generated from subagent `8fdd3fc9` manifest; FAIL rows remediated on `fix/rectification-wave-12-2026-06-03`.*

## D4-6 — omit null details/message

All five routes **FIXED** in Wave 12 follow-up.
