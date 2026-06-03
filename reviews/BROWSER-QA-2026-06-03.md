# Browser QA — Production Smoke (2026-06-03)

**Target:** https://quantan.vercel.app  
**Branch filed from:** `fix/rectification-wave-12-2026-06-03`  
**Prior coverage:** Wave 12 supervision tested `/` only before MCP disconnect.

---

## Executive summary

| Metric | Value |
|--------|-------|
| Routes tested | **9 / 9** |
| PASS (route reachable, no 5xx) | **7** |
| FAIL (404 / missing route) | **2** |
| BLOCKED (tooling) | curl status codes (agent sandbox timeout); AAPL Options UI tab (browser nav error) |

**Decision:** Production HTML/API surface is **healthy** for all shipped routes. `/monitor` and `/quant-lab` are **not deployed** (404). Monitor functionality lives at **`/desk`**. Quant Lab is an in-page tab on **`/stock/[ticker]`**, not a standalone route.

No production **500** responses observed — **no app code changes required**.

---

## Methodology

| Tool | Result |
|------|--------|
| **cursor-ide-browser MCP** | Available. `/` snapshot PASS (44 refs, nav links, sector cards). `/stock/AAPL` navigation failed twice with `chrome-error://chromewebdata/` — **BLOCKED** for Options tab UI snapshot. |
| **WebFetch** | Primary verifier for HTML + API body. Explicit **404** for `/monitor`, `/quant-lab`. Inferred **200** for successful page bodies. |
| **curl -sI / curl -s** | **BLOCKED** in agent environment — all requests timed out (`HTTP 000`, exit 28) despite production being reachable via WebFetch/browser. Status codes below use WebFetch error metadata or browser navigation success unless noted. |

---

## Route matrix

| Route | Method | Status | Result | Notes |
|-------|--------|--------|--------|-------|
| `/` | Browser + WebFetch | 200† | **PASS** | Title "QUANTAN — Market Intelligence"; sector grid, backtest CTA, market breadth, news loader present. Browser snapshot: 44 a11y refs. |
| `/backtest` | WebFetch | 200† | **PASS** | Shell renders; "Loading backtest data…" + 56-instrument fetch message (~20s). |
| `/stock/AAPL` | WebFetch (+ browser blocked) | 200† | **PASS** | Page shell: Chart / Quant Lab / **Options** / Dark Pool / News tabs; chart "Connecting to Data Feed…". First WebFetch attempt timed out; retry succeeded. |
| `/crypto/btc` | WebFetch | 200† | **PASS** | BTC header, timeframe controls, chart area, Kraken/CoinGecko provenance copy. |
| `/portfolio` | WebFetch | 200† | **PASS** | Dashboard renders (vega warnings, config labels). **Data QA:** win rate displays `4837.00%` — likely formatting bug, not route failure. |
| `/monitor` | WebFetch | **404** | **FAIL** | Not in app router. Replacement: **`/desk`** ("Trading Desk — multi-asset monitor") — tested separately, **PASS**. |
| `/briefs` | WebFetch | 200† | **PASS** (degraded data) | Page loads; copy: "No briefs available. All Yahoo Finance requests failed." Route OK; upstream data empty. |
| `/quant-lab` | WebFetch | **404** | **FAIL** | No standalone route in `app/`. Quant Lab is a **tab** on `/stock/[ticker]` (see stock page tabs). |
| `/api/prices?tickers=AAPL` | WebFetch | 200† | **PASS** | JSON quotes array; AAPL price ~311.46, `dataSource: yahoo`, timestamp present. |

† Status inferred from successful body fetch (WebFetch does not always echo numeric code on 200).

---

## Supplementary checks

| Check | Method | Result | Notes |
|-------|--------|--------|-------|
| `/desk` (monitor substitute) | WebFetch | **PASS** | Full trading-desk tables (macro, GICS, commodities); refresh cadence copy. Prices show `—` in static fetch (client-hydrated). |
| `/api/options/AAPL` | WebFetch | **PASS** | Full options chain JSON (~29 KB): calls/puts, GEX, unusual flow, sentiment, `dataProvenance.provider: yahoo-finance2`. Supports Options tab lazy-load. |
| AAPL **Options tab** (UI) | Browser | **BLOCKED** | Could not navigate to `/stock/AAPL` in browser after `/` succeeded; API backend verified separately. |

---

## Browser snapshots (key pages)

### `/` — PASS

- URL: `https://quantan.vercel.app/`
- Snapshot highlights: global nav (Markets, Desk, Commodities, Crypto, Heatmap, 200MA, Briefs), "Sector Intelligence" H1, Institutional Backtest Dashboard card, 11 sector links (XLK–XLP), compliance disclaimer.

### `/stock/AAPL` Options — BLOCKED (UI)

- Browser navigation to stock detail failed (`chrome-error://chromewebdata/`).
- **API substitute verified:** `GET /api/options/AAPL` returns live chain data (underlying ~311.26, 24 expiration dates, calls/puts through 345 strike).

---

## Findings & recommendations

1. **404 routes in test plan:** Update QA checklist — use `/desk` instead of `/monitor`; treat Quant Lab as stock-page tab, not `/quant-lab`.
2. **Briefs empty state:** Production Yahoo brief fetch failing — track separately (data pipeline), not a routing defect.
3. **Portfolio win-rate display:** `4837.00%` on `/portfolio` warrants a formatting fix in a future wave (not blocking route QA).
4. **curl from CI/agent sandbox:** Local curl to Vercel timed out; use WebFetch or browser MCP for remote QA in this environment.

---

## Sign-off

| Item | Status |
|------|--------|
| All requested routes exercised | Yes (9/9) |
| Production 500 observed | No |
| App code changed | No |
| Report path | `reviews/BROWSER-QA-2026-06-03.md` |

**Tested by:** Cursor agent (Wave 12 browser QA completion)  
**Timestamp:** 2026-06-03T15:12Z (approx.)
