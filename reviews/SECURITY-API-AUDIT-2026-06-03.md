# QUANTAN Security & API Reliability Audit — 2026-06-03

**Scope:** Inspection program D4/D5 focus areas vs current `app/api/` + `WS1_FIX_PLAN_2026-06-01.md`  
**Repo:** `/Users/haohengwang/Library/CloudStorage/GoogleDrive-wanghaoheng123@gmail.com/My Drive/QUANTAN-sector-investment`  
**Baseline:** Inspection program 2026-05-30; WS1 resolved on `fix/ws1-api-security-fixed`

---

## Executive summary

| Metric | Count |
|--------|-------|
| **Critical** | **0** |
| **High** | **0** |
| Medium | 6 |
| Low | 4 |
| Info / owner-deferred | 3 |

**Safe to proceed with full inspection?** **Yes.** The blocking HIGH (D4-1 X-API-Key bypass) is remediated in code; `QUANTAN_API_KEY` is provisioned in Production per `workspace/OWNER_ACTIONS_2026-06-02.md`. Remaining gaps are MEDIUM/LOW or owner/infra actions.

---

## Findings by focus area

### D4-1 — `QUANTAN_API_KEY` + `timingSafeEqual` on trading-agents POST

| | |
|---|---|
| **Severity** | ~~HIGH~~ → **RESOLVED** |
| **Status** | Fixed in current tree |
| **Owner vs code** | Code done; owner provisioned key (Production) |

**Evidence:** `lib/auth/apiKey.ts` implements fail-closed validation with SHA-256 + `timingSafeEqual`. `app/api/trading-agents/[ticker]/route.ts` uses `isValidApiKey()` for both CSRF bypass and auth gate:

```172:193:app/api/trading-agents/[ticker]/route.ts
  const apiKeyHeader = req.headers.get('x-api-key')
  const apiKeyValid = isValidApiKey(apiKeyHeader)
  if (!apiKeyValid && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'csrf_invalid', message: 'Missing or invalid CSRF token. Reload the page and retry.' },
      { status: 403 },
    )
  }
  // ...
  const session = await getServerSession(getAuthOptions())
  if (!session?.user && !apiKeyValid) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Authentication required. Sign in or provide a valid X-API-Key header.' },
      { status: 401 }
    )
  }
```

**WS1 alignment:** Matches `WS1_FIX_PLAN` exactly. Tests exist in `__tests__/api/trading-agents-auth.test.ts` (helper + route gate).

**Residual:** Preview envs without `QUANTAN_API_KEY` are fail-closed (session-only) — intentional.

---

### CSRF — `x-quantan-csrf` on browser POSTs

| | |
|---|---|
| **Severity** | **PASS** (was weakened by D4-1; now intact) |
| **Owner vs code** | Code complete |

**Server:** `middleware.ts` issues `quantan_csrf` cookie; `lib/api/csrf.ts` validates header/cookie match. Guarded routes:
- `POST /api/trading-agents/[ticker]` — CSRF unless valid API key
- `POST /api/backtest` — CSRF always

**Client:** `lib/api/csrfClient.ts` exports `csrfHeaders()`; wired in `components/stock/quantlab/hooks/useQuantLabLlm.ts` for trading-agents POST.

**Gap (LOW):** No UI caller for `POST /api/backtest` today (page uses GET only). Guard is server-side ready; any future recompute button must spread `csrfHeaders()`.

---

### Q-005 — Rate limiting (per-process vs KV)

| | |
|---|---|
| **Severity** | **MEDIUM** |
| **Owner vs code** | **Owner:** provision `KV_REST_API_URL` + `KV_REST_API_TOKEN`; **Code:** optional hardening on unprotected routes |

**Implementation:** `lib/api/rateLimit.ts` — KV when env set, else in-memory Map with fallback on KV errors. **20/27** API routes use `applyRateLimit`.

**Routes without rate limit** (external or fan-out):

| Route | Risk |
|-------|------|
| `app/api/ma-deviation/route.ts` | **MEDIUM** — parallel Yahoo chart fan-out (~13 tickers), no limit |
| `app/api/crypto/btc/metrics/route.ts` | LOW — 5s cache, Bybit/OKX |
| `app/api/crypto/btc/quote/route.ts` | LOW — single CoinGecko call |
| `app/api/crypto/btc/liquidations/route.ts` | LOW — OKX, 10s cache |
| `app/api/trading-agents/health/route.ts` | LOW — 8s timeout, no auth |
| `app/api/bloomberg-bridge/health/route.ts` | LOW — config probe only |

**WS1:** D4-3 analytics/fundamentals limits **implemented**; `__tests__/api/route-rate-limit.test.ts` validates 30→429.

---

### Auth — SafeAuth, middleware

| | |
|---|---|
| **Severity** | **PASS** (with INFO notes) |
| **Owner vs code** | Owner: confirm `NEXTAUTH_SECRET` in Vercel |

**SafeAuth** (`components/SafeAuth.tsx`): Client `useSession` + error boundary; no secrets in UI.

**Middleware:** Does **not** enforce auth globally — only CSP nonce (opt-in) + CSRF cookie. Auth is **route-scoped** (trading-agents POST).

**`lib/auth.ts`:** JWT field bounds + control-char rejection (F7.9); generates per-instance secret with `console.error` if `NEXTAUTH_SECRET` missing in prod — **owner should verify env is set** (not marked DONE in owner checklist).

---

### CSP — Report-Only vs enforce

| | |
|---|---|
| **Severity** | **MEDIUM** (deferred P0 Q-040-NEW) |
| **Owner vs code** | **Owner:** set `QUANTAN_CSP_ENFORCE=1` after 7d clean Report-Only |

**`next.config.js`:** `Content-Security-Policy-Report-Only` with `'unsafe-inline' 'unsafe-eval'`.

**`middleware.ts`:** Enforcing CSP only when `QUANTAN_CSP_ENFORCE === '1'` (nonce-based, stricter script-src).

Matches inspection D4-4; owner action PENDING in `OWNER_ACTIONS_2026-06-02.md`.

---

### API error hygiene — D5-3, D5-4, D5-7 (+ D4-2, D4-6)

| ID | Severity | Status | Notes |
|----|----------|--------|-------|
| **D5-3** | MED | **FIXED** | `backtest/live` cache gated on `!specificTickers` (read + write) |
| **D5-4** | MED | **FIXED** | `withRetry({timeoutMs})` on sector-rotation, ma-deviation, chart, `lib/options/chain.ts` |
| **D5-7** | LOW | **FIXED** | Chart filters finite O/H/L/C |
| **D4-2** | MED | **FIXED** | `btc/metrics` `_errors[]` uses `sanitizeError()` |
| **D4-6** | LOW | **PARTIAL** | 5 routes still use `sanitizeError(x) ?? null` (emits `"details": null` in prod) |

**D4-6 remaining (code fix):**
- `app/api/options/[ticker]/route.ts:93`
- `app/api/darkpool/[ticker]/route.ts:282`
- `app/api/briefs/route.ts:216`
- `app/api/backtest/route.ts:146,173`
- `app/api/trading-agents/[ticker]/route.ts:105` (GET upstream)

**Good patterns:** chart, sector-rotation use `...(sanitizeError(e) ? { details: ... } : {})`; trading-agents POST upstream errors sanitized (dev-only detailText).

**D5-4 minor residual:** `options/[ticker]/route.ts` inner `yahooFinance.quote()` for dividend yield has no `withRetry` wrapper (fail-open to q=0).

---

### D5-1 — Warehouse OHLC filter in dataLoader

| | |
|---|---|
| **Severity** | ~~MED~~ → **FIXED** |
| **Owner vs code** | Code |

**Evidence:** `lib/backtest/dataLoader.ts:56–74` mirrors JSON path non-finite guard; test in `__tests__/backtest/dataLoader.test.ts` ("D5-1").

---

## Comparison to WS1_FIX_PLAN

| WS1 item | Plan status | Current tree |
|----------|-------------|--------------|
| D4-1 `isValidApiKey` wiring | Required | **Done** |
| D4-3 analytics/fundamentals rate limit | Required | **Done** + tests |
| `trading-agents-auth.test.ts` rewrite | Required | **Done** |
| `route-rate-limit.test.ts` rewrite | Required | **Done** |
| Bucket B push/PR | Owner decision | API key provisioned; CSP/KV still pending |

---

## Severity-rated open items

### Medium (6)

1. **Q-005 / F4.3** — Distributed rate limit not active unless KV env set (per-process bypass across Vercel instances).
2. **Q-040-NEW / D4-4** — CSP still Report-Only with `unsafe-inline`/`unsafe-eval` in production default.
3. **D4-3 residual** — `ma-deviation` unprotected Yahoo parallel fan-out.
4. **Next.js CVE debt (Q-057)** — `next@14.2.35`; middleware/CSP advisories deferred (infra, not app logic bug).
5. **Preview env** — No `QUANTAN_API_KEY` on Preview → X-API-Key path disabled (acceptable; document if intentional).
6. **Options route** — Dividend `quote()` call lacks timeout wrapper (low blast radius due to fail-open).

### Low (4)

1. **D4-6** — `?? null` error envelope in 5 routes.
2. **Backtest POST** — CSRF guard without client wiring (no current UI caller).
3. **BTC sub-routes** — metrics/quote/liquidations without rate limits (mitigated by cache).
4. **trading-agents/health** — Unauthenticated, no rate limit.

### Info / owner-only (3)

1. **`QUANTAN_CSP_ENFORCE=1`** — after monitoring window.
2. **`KV_REST_API_URL` + `KV_REST_API_TOKEN`** — enable distributed rate limiting.
3. **Verify `NEXTAUTH_SECRET`** in Vercel Production (not explicitly in owner DONE table).

---

## Triage: owner-only vs code fixes

| Action | Type |
|--------|------|
| Set `KV_REST_API_*` in Vercel | **Owner** |
| Set `QUANTAN_CSP_ENFORCE=1` after 7d clean Report-Only | **Owner** |
| Confirm `NEXTAUTH_SECRET` in Production | **Owner** |
| Next.js 15 upgrade (Q-057) | **Owner decision + code** |
| Add `applyRateLimit` to `ma-deviation` | **Code** |
| Fix D4-6 `?? null` → omit key pattern | **Code** |
| Wrap options dividend `quote()` in `withRetry` | **Code** |
| Rate-limit BTC sub-routes / TA health (optional) | **Code** |
| Wire `csrfHeaders()` if backtest POST UI added | **Code** |

---

## Counts & recommendation

| | |
|---|---|
| **Critical** | **0** |
| **High** | **0** |
| **Proceed with full inspection?** | **Yes** |

The inspection program’s only HIGH security item (D4-1) is closed in code and backed by owner key provisioning. PR-A1 reliability items (D5-3, D5-4, D5-7, D4-2, D5-1) are largely landed. Remaining work is MEDIUM hygiene (KV, CSP, ma-deviation limit, error envelope cleanup) and deferred infra (Next.js upgrade).
