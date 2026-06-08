# Round 2 — Deeper Sweep (2026-06-04, read-only)

Triggered by owner: "there are more issues and more things to check." Two new agents
(frontend component tree + data/provider layer) + coordinator inline verification.
Detailed agent files: `frontend-deep-sweep.md`, `data-layer.md`. No code touched.

## Source-verified (coordinator) — frontend P0 candidates from Wave 1
- **`app/ma-deviation/page.tsx:179` `SortTh`** ✅ CONFIRMED nested-in-render (closes over
  `sortKey`/`handleSort` → remount + focus loss on every sort). Real; correctly **P1** (UX, not crash).
- **`app/stock/[ticker]/page.tsx:103` `fetchChartData`** ✅ CONFIRMED no AbortController; the
  poll effect (162-169) re-fires on `activeRange` without cancelling → last-resolved-wins race.
  Real; correctly **P1**.

## NEW findings — coordinator inline
- **🆕 P2 — `components/backtest/InstrumentTable.tsx:53` `SortIcon`** nested-in-render (2nd
  instance of the SortTh class; low impact — non-focusable span, but recreated each render).
- **🆕 P1 — `npm audit`: 15 vulnerabilities (5 high, 10 moderate).** Most material:
  `next-auth` (≤4.24.14) → vulnerable **`uuid` <11.1.1** (GHSA-w5hq-g745-h8pq) — this is in the
  **runtime auth path**. Plus build-time `@ducanh2912/next-pwa` → vulnerable `workbox-build`/
  `workbox-webpack-plugin`. Action: plan `next-auth` upgrade (Auth.js v5) — `npm audit fix --force`
  would *downgrade* next-auth (wrong direction); needs a real migration. Build-chain ones are
  lower runtime risk but should be bumped.
- **✅ VERIFIED CLEAN — `hooks/useLiveQuote.ts`** (the SSE backbone for every stock page +
  dashboard): `closedManuallyRef` guards every reconnect path (lines 218/231); unmount cleanup
  (248-257) sets the flag, clears the timer, nulls the ref, closes the EventSource. This is the
  CORRECT version of the pattern `useBtcPriceWs` got wrong → confirms that leak is an isolated
  miss, not systemic.
- **✅ VERIFIED CLEAN — `middleware.ts`**: double-submit CSRF (`httpOnly:false` intentional +
  `SameSite:Strict`), per-request CSP nonce, cookie issued only-if-missing. P2 note: CSP (opt-in,
  unenforced) allows `style-src 'unsafe-inline'`. Double-submit "first POST 403s once" is by-design.

## WITHDRAWN — false positives the coordinator caught this round
- **❌ API agent P1-7 (middleware lacks X-Frame-Options / nosniff / Referrer-Policy)** — WRONG.
  `next.config.js` HAS a full OWASP `SECURITY_HEADERS` block (HSTS, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy`) applied via `async headers()`. The agent only read `middleware.ts` and
  self-flagged "not verified in next.config.js." Now cross-checked. **No action.**
- **❌ Timer "leaks" (`app/page.tsx`, `app/desk/page.tsx`, `components/stock/LlmDeployAssistant.tsx`)**
  — FALSE POSITIVES from a count heuristic that matched `setInterval`/`setTimeout` mentions in
  COMMENTS. The frontend agent independently verified ALL timer/listener usages are cleaned up in
  effect returns. **No action.**

## NEW findings — frontend agent (`frontend-deep-sweep.md`): 0 P0 · 9 P1 · 17 P2 (55 verified clean)
- **F-01 (P1)** `app/briefs/sector/[sector]/LiveBriefClient.tsx:76` — uncancelled slug-driven
  fetch (3rd instance of the AbortController race class). Stale response overwrites new slug.
- **F-12 (P1)** `components/options/GexChart.tsx` — chart math not wrapped in `ChartErrorBoundary`
  (the project HAS one; not applied here).
- **a11y cluster (P1):** `SignalCard.tsx:57,101` aria-label on role-less `<div>` (ignored by AT);
  `LiveSignalsPanel.tsx:163` sortable `<th>` missing `aria-sort`; `FrameworksTab.tsx:24` seven
  accordion triggers missing `aria-expanded`/`aria-controls`. (Matches Wave-1 a11y findings — a
  systemic disclosure/tab/sort ARIA gap across the app.)
- No `dangerouslySetInnerHTML` anywhere; no SSR/`window` hydration traps found.

## NEW findings — data agent (`data-layer.md`): 1 P0 · 8 P1 · 8 P2 (warehouse SQL = SAFE)
- **Warehouse SQL = SAFE** — `lib/data/warehouse.ts` uses `better-sqlite3` prepared statements
  (`?` placeholders) throughout; the lone interpolated SQL (`ALTER TABLE … ${name} ${decl}`, line
  91) uses hardcoded constants, not user input. P2: whitelist column names defensively.
- **P0** — re-confirms `liquidations/route.ts:60` raw error leak (3rd independent confirmation of P0-B).
- **🆕 P1 — three providers have NO fetch timeout:** `alphavantage.ts:27,62`, `polygon.ts:16`,
  `fred.ts:67,85`. A hung upstream pins the serverless worker until the platform timeout (300s).
  Bloomberg/Bybit/OKX/Yahoo all use explicit `AbortSignal.timeout`; these three were missed.
- **🆕 P1 — `lib/data/providers/polygon.ts:69`** last-trade `t` treated as ns (÷1e6) while
  `fetchDaily` treats `r.t` as ms — undocumented split; if Polygon returns ms on last-trade,
  dates silently jump to ~year 2970 with no error.
- **🆕 P1/P2 — `lib/data/providers/alphavantage.ts:44-71`** raw `parseFloat`/`parseInt` with no
  `Number.isFinite` guard; AlphaVantage returns `'N/A'` → **NaN can reach `upsertCandles`/the
  warehouse at INGEST**, before the D5-1 read-side filter. Data-integrity gap.
- **🆕 P1 — `lib/yahooQuoteFields.ts:14-18`** decimal-vs-percent heuristic for
  `regularMarketChangePercent` can misclassify small (<0.5%) moves → wrong % displayed.

## Net effect on the master report
- **Live-prod P0s unchanged at 2** (no new crashers; P0-B re-confirmed twice more).
- **New P1 backlog items:** npm-audit auth-chain vuln; 3 no-timeout providers; polygon ts; yahoo %
  heuristic; alphavantage NaN ingestion; LiveBriefClient fetch race; GexChart boundary; a11y cluster.
- **Two agent false positives withdrawn** (security headers; timer leaks) — net credibility preserved.
- **More verified-clean surface:** useLiveQuote, middleware, warehouse SQL, 55 components, all timers.
