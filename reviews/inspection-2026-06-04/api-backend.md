# API/Backend Review — 2026-06-04

## Severity legend
- **P0** — security/correctness: exploitable, data loss, auth bypass, secret leak
- **P1** — resilience: uncapped resource use, wrong HTTP semantics, cache poisoning
- **P2** — cleanup: minor type-safety, inconsistency, style

---

## P0 Findings

*(populated as inspection progresses — see bottom for checkpoint status)*

### [P0-1] `app/api/crypto/btc/liquidations/route.ts:61` — Upstream error text forwarded verbatim to client in degraded response

**Location:** `app/api/crypto/btc/liquidations/route.ts` lines 55-64

**Issue:** When the OKX HTTP call returns a non-2xx status, the handler reads the raw response body with `res.text().catch(() => '')` and writes it *directly* into the JSON response field `error: text.slice(0, 200)` — no sanitization via `sanitizeError`, no production-vs-dev gate. This text can contain OKX API error payloads, internal server error messages, or other upstream metadata that should not reach the browser.

```ts
const text = await res.text().catch(() => '')
return NextResponse.json(
  {
    ...
    error: text.slice(0, 200),   // ← raw upstream body, no sanitizeError()
  }, ...
```

All other routes sanitize upstream error text through `sanitizeError(e)` (which returns `undefined` in production). This is the lone exception and violates the project-wide CWE-209 policy.

**Fix:** Replace `error: text.slice(0, 200)` with `...(process.env.NODE_ENV !== 'production' ? { error: text.slice(0, 200) } : {})` or route through `sanitizeError`.

---

### [P0-2] ❌ FALSE POSITIVE — WITHDRAWN (verified by coordinator 2026-06-04 via Python `repr()` of raw bytes)

> **CORRECTION:** This finding is INCORRECT and is the exact documented false positive in `workspace/CURSOR_PROMPT.md` STEP 3. The real bytes of `lib/auth.ts:124` are `/[\x00-\x1f\x7f]/` (canonical OWASP control-char class: NUL–US + DEL), confirmed via `python3` `repr()` reading the raw file bytes: `b'if (/[\x00-\x1f\x7f]/.test(trimmed)) return undef'`. The regex correctly **accepts** `"John Smith"` (space = 0x20, above the range) and `"Mary-Jane"` (hyphen = 0x2D), and rejects only true control characters. The Read tool renders the raw control bytes 0x00–0x1F (which include 0x0A) as a visual that *looks like* `[ -]` (space-hyphen). **No fix needed. The code is correct.** Do NOT include in the master report as a finding.

---

#### Original (incorrect) finding, retained for audit trail:
### [P0-2] `lib/auth.ts:124` — Regex in `safeStringField` rejects ALL non-empty strings (inverted character class)

**Location:** `lib/auth.ts` line 124

**Issue:** The regex `/[ -]/` used to reject "ASCII control chars" is inverted — it uses a character *range* `[ -]` (space through hyphen, ASCII 0x20–0x2D), which rejects any string containing a space or a hyphen. This means:
- Names with a space (e.g. `"John Smith"`) → rejected → `undefined`
- Names with a hyphen (e.g. `"Mary-Jane"`) → rejected → `undefined`
- Possibly most real user names → `undefined`

The intent was `[\x00-\x1F]` (control characters), but the current form silently clears most OAuth `name` tokens, so `session.user.name` is always `undefined` for most users. This is a logic bug in the JWT callback, not a security escalation per se, but it constitutes incorrect auth behaviour that could cause subtle authorization failures in code that trusts `session.user.name !== null`.

```ts
// lib/auth.ts:124
if (/[ -]/.test(trimmed)) return undefined   // ← rejects space and hyphen range!
```

**Fix:** Replace with `/[\x00-\x1F\x7F]/.test(trimmed)` to reject only actual control characters.

---

### [P0-3] `app/api/trading-agents/[ticker]/route.ts` — CSRF check runs AFTER rate-limit in POST handler (ordering: CSRF before rate-limit is violated for the POST path only)

**Location:** `app/api/trading-agents/[ticker]/route.ts` lines 174–185

**Issue:** The project memory and prior audit (D4-1) explicitly states "CSRF gate precedes auth" and the handler comment says "CSRF guard before any other work". The current POST ordering is:

1. CSRF check (line 176) ✓ correct
2. Rate limit (line 184) — BUT after CSRF

The problem is the **reverse**: rate-limit fires *after* CSRF, meaning an unauthenticated browser attacker who passes CSRF (which they can, if they have the cookie) can hammer the rate-limit bucket without being rejected at CSRF first. This is a minor ordering concern, not a full bypass, because CSRF still gates before auth. The rate-limit bucket is exhausted by legitimate CSRF-passing requests from the same IP before even reaching the auth check. For the GET handler, rate-limit is first (correct). Inconsistency creates confusion.

More critically: the POST handler's CSRF bypass for API-key callers (line 176: `if (!apiKeyValid && !validateCsrf(req))`) means a caller can exhaust the rate-limit for an IP, then reconnect from the same IP with a valid API key and bypass the bucket — because the rate-limit key is per-IP and both valid-API-key and CSRF paths share the same bucket.

**Severity:** P0 because the CSRF-bypass+rate-limit interaction means an API-key holder (QUANTAN_API_KEY) can consume the rate-limit token on behalf of any IP, then switch to a different path to effectively circumvent that limit for the token bucket they just filled. In practice this is limited by QUANTAN_API_KEY being secret, but it is a correctness issue.

---

## P1 Findings

### [P1-1] `app/api/backtest/route.ts` — Shared module-level cache not protected against concurrent recompute

**Location:** `app/api/backtest/route.ts` lines 133–169

**Issue:** The in-memory cache `let cache = null` at module level is mutated inside a `try` block in both GET and POST handlers without any mutex or compare-and-swap. Under Vercel serverless this is a single-instance non-issue because requests run serially per instance, but if the process is configured with multiple concurrent workers (Node 18+ edge, self-hosted), two simultaneous GET requests on a cold start can both see `cache === null`, trigger two full recomputes concurrently (56-instrument CPU-heavy), and race to write `cache`. The write is a simple object assignment (not a TOCTOU that causes data corruption), but the double-compute wastes resources and can cause a 429 cascade on Yahoo upstreams.

**Fix:** Wrap with a `let computing = false` flag / promise-lock pattern, or document that Vercel's single-invocation model makes this safe.

---

### [P1-2] `app/api/stream/[ticker]/route.ts` — Rate limit fires before `normalizeTicker`, so an attacker can exhaust the rate bucket with invalid ticker inputs and then block legitimate consumers

**Location:** `app/api/stream/[ticker]/route.ts` lines 79–89

**Issue:** The rate-limit check on line 79 uses the key `'stream'` (route-scoped, per IP). The ticker validation happens on line 85, *after* the rate bucket is consumed. This means an attacker from one IP can send 10 `GET /api/stream/../../../../etc/passwd` requests per minute — each one consuming a token from the IP's stream bucket before being rejected at `normalizeTicker`. Legitimate same-IP SSE clients are then rate-limited. 

The standard hardening pattern used by other routes (e.g. trading-agents GET) checks the ticker first and returns 400 without consuming rate tokens. With SSE connections being long-lived, losing 10 tokens/minute per IP to invalid-ticker probing is significant.

**Note:** The ticker regex prevents any real injection; the issue is rate-token consumption only.

---

### [P1-3] `app/api/crypto/btc/metrics/route.ts` — `_errors` field exposes raw upstream error strings (not gated by `sanitizeError`) in partial-failure path

**Location:** `app/api/crypto/btc/metrics/route.ts` lines 122–124

**Issue:**
```ts
const errors = [tickRes.error, ratioRes.error, lsrRes.error]
  .filter(Boolean)
  .map((e) => sanitizeError(e) ?? 'fetch_failed')
```

`sanitizeError` expects an `Error | unknown` but receives a `string | null`. When `e` is already a string (which `safeFetchJson` returns as `{ error: string | null }`), `sanitizeError` checks `e instanceof Error` (false for a plain string) and falls through to `String(error)` in development, or `undefined` in production. In production `sanitizeError` returns `undefined`, so the mapping yields `'fetch_failed'` — masking the real error for diagnosis. In development it returns the raw error string (which may contain `HTTP 403: {"message": "...full upstream error...", "retCode": ...}`) which is fine for debug but not ideal. The deeper issue is the semantic mismatch: passing a `string` to `sanitizeError` designed for `Error | unknown`. **In production `_errors` will always be `['fetch_failed', ...]`** losing diagnostic value.

**Fix:** Pass the error strings directly (they're already stripped to 300 chars by `safeFetchJson`) in dev/test, or pass the original caught `unknown` through to `safeFetchJson`'s caller.

---

### [P1-4] `app/api/briefs/route.ts:149` — Outer `Promise.all` over sector map not using `allSettled` — one sector throwing can reject the whole payload

**Location:** `app/api/briefs/route.ts` line 149

**Issue:**
```ts
const newsBySector = await Promise.all(      // ← NOT allSettled
  sectorEntries.map(async ([slug, config]) => {
    ...
    const settled = await Promise.allSettled(  // inner allSettled (per ticker)
```

The inner per-ticker calls correctly use `Promise.allSettled`, but the outer map over sectors uses `Promise.all`. If one sector's async callback throws an *unhandled* exception (not a ticker-level fetch failure, but a runtime error in the data processing, e.g. in `sectorNews.push(...r.value)` if `r.value` throws), the entire outer `Promise.all` rejects and the route falls into the catch block returning 502. This should use `Promise.allSettled` to match the resilience contract.

**Fix:** Change `Promise.all(sectorEntries.map(...))` to `Promise.allSettled(...)` and flatten only fulfilled results.

---

### [P1-5] `app/api/trading-agents/[ticker]/route.ts` POST — User-supplied `api_key` forwarded to Python upstream without redaction in logs

**Location:** `app/api/trading-agents/[ticker]/route.ts` line 325

**Issue:** The handler validates that `api_key` is a non-empty string of length >= 8, strips it from the forwarded body `_clean`, but then re-adds it to `upstreamBody.api_key` and POSTs it to the Python server. If the Python server logs its incoming request body (common in dev/Flask debug mode), the user's LLM API key appears in Python server logs. This is not a QUANTAN server-side log issue but is a deployment risk if the Python server's logs are aggregated. Additionally, if the `console.warn` on a POST upstream failure (line 104 in GET path) fires, it could log the URL containing the ticker only (not the key), so this is acceptable. The risk is entirely on the Python side.

**Severity:** P1 (design risk, not a QUANTAN-codebase bug). Flag for documentation.

---

### [P1-6] `lib/api/rateLimit.ts` — KV path has a race on `count === 1` EXPIRE: window resets on any first-in-window request, not on true TTL start

**Location:** `lib/api/rateLimit.ts` lines 82–86

**Issue:**
```ts
if (count === 1) {
  await fetch(`${base}/expire/${encodeURIComponent(bucketKey)}/${config.windowSeconds}`, ...)
}
```

The `INCR + conditional EXPIRE` pattern has a classic race: if two requests arrive simultaneously when the key is absent, both see `count === 1` (Upstash/Redis INCR is atomic, so only one will actually get count=1, the other gets count=2). Actually Upstash Redis is atomic on INCR, so count=1 fires only once. However, the `EXPIRE` call is fire-and-forget (`await` is there, but if it throws the catch falls back to memory — so EXPIRE may not be set). More critically: if INCR succeeds but EXPIRE fails (e.g. network blip), the key *never expires*, permanently blocking that IP until someone manually deletes it from KV. This is a permanent rate-limit denial-of-service via network instability.

**Fix:** Use Redis `SET key 0 EX windowSeconds NX` as the initialization step, or wrap EXPIRE in a retry.

---

### [P1-7] `middleware.ts` — No host/Origin allowlist; no `X-Frame-Options` or `X-Content-Type-Options` security headers

**Location:** `middleware.ts`

**Issue:** The middleware only handles CSP (opt-in) and CSRF cookie issuance. It does not set:
- `X-Frame-Options: DENY` (clickjacking protection)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`

These are typically set in `next.config.js` headers config, but they're absent from the middleware and there's no indication they're set elsewhere. (Not verified in next.config.js yet — flagged for cross-check.)

---

### [P1-8] `app/api/backtest/route.ts` — GET response missing `Cache-Control` header on the cached and non-cached paths

**Location:** `app/api/backtest/route.ts` lines 136–149

**Issue:** The GET handler's cold-start path (cache miss, line 141) returns:
```ts
return NextResponse.json(data)
```
No `Cache-Control` header. This allows CDN/proxy layers to cache an uncacheable compute-heavy response by default, or conversely to never cache it (CDN default is "do not cache" for 200 without explicit header). The cached path (line 137) also has no explicit header:
```ts
return NextResponse.json(cache.data)
```
The POST handler explicitly uses `no-store` (via `degradedResponse`) but the GET handler has no header at all. Compare with `/api/backtest/live` which correctly sets `s-maxage=60, stale-while-revalidate=120`.

**Fix:** Add `'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200'` on the GET success paths to match the 1-hour TTL intent.

---

## P2 Findings

### [P2-1] `app/api/ma-deviation/route.ts:87` — `(c: any)` cast used twice; type-safe equivalent available

**Location:** `app/api/ma-deviation/route.ts` lines 71, 87

Two `(c: any)` casts remain where the chart quote shape is well-understood. Not a bug, but inconsistent with the project's stated `as any` cleanup wave (Phase 14 wave 29).

---

### [P2-2] `app/api/briefs/[sector]/route.ts:18` — `require()` fallback instead of ES import

**Location:** `app/api/briefs/[sector]/route.ts` line 18

```ts
const YahooFinance = require('yahoo-finance2').default
```

A CommonJS `require()` is used with a comment `// eslint-disable-next-line @typescript-eslint/no-require-imports`. Other routes use ES `import YahooFinance from 'yahoo-finance2'`. This should be unified to the ES import pattern.

---

### [P2-3] `app/api/trading-agents/[ticker]/route.ts` POST — `max_debate_rounds` / `max_risk_discuss_rounds` also forwarded in `upstreamBody` raw (lines 303-304) bypassing the `clampRound` validation applied to `queryParams`

**Location:** `app/api/trading-agents/[ticker]/route.ts` lines 290–305

The body sent to the Python server on lines 301-308 includes:
```ts
max_debate_rounds: body.max_debate_rounds,      // raw, un-clamped
max_risk_discuss_rounds: body.max_risk_discuss_rounds,  // raw, un-clamped
```

The `clampRound` function validates the values before placing them in `queryParams`, but the body sent to the Python server uses the *original* `body.max_debate_rounds` values, not the clamped ones. If Python reads from the JSON body (rather than query params), the hostile input (e.g. 1,000,000) reaches the Python sidecar. The URL query params ARE clamped, but the POST body is not.

**Fix:** Replace `body.max_debate_rounds` in `upstreamBody` with `mdr` (the clamped value, or `undefined` if null).

---

### [P2-4] `app/api/crypto/btc/liquidations/route.ts:59-64` — Missing `no-store` header on the error degraded path

The non-ok OKX response handler (lines 49-64) returns `{ 'Cache-Control': 'no-store' }` correctly, but the error field `error: text.slice(0, 200)` (covered in P0-1) is also sent without redaction.

---

### [P2-5] `lib/api/rateLimit.ts` — KV `checkRateLimitKv` is defined and referenced but `applyRateLimit` always calls `checkRateLimitMemory` when KV is NOT configured. The exported `checkRateLimit` (line 35-39) is sync and only ever calls `checkRateLimitMemory`, making the KV path dead code for any caller using the direct `checkRateLimit` export.

**Location:** `lib/api/rateLimit.ts` line 35-39 vs 105-129

`checkRateLimit` (the sync export) always calls memory. `applyRateLimit` (the recommended helper) correctly dispatches to KV when configured. Any caller using `checkRateLimit` directly instead of `applyRateLimit` silently bypasses KV. The export should be removed or made async to avoid confusion.

---

## Files inspected

| File | LOC | Status |
|------|-----|--------|
| `lib/api/csrf.ts` | 37 | Read |
| `lib/api/csrfClient.ts` | 45 | Read |
| `lib/api/rateLimit.ts` | 132 | Read |
| `lib/api/reliability.ts` | 128 | Read |
| `lib/api/sanitize.ts` | 87 | Read |
| `lib/auth.ts` | 136 | Read |
| `lib/auth/apiKey.ts` | 44 | Read |
| `middleware.ts` | 103 | Read |
| `app/api/trading-agents/[ticker]/route.ts` | 396 | Read |
| `app/api/stream/[ticker]/route.ts` | 243 | Read |
| `app/api/backtest/route.ts` | 180 | Read |
| `app/api/backtest/live/route.ts` | 122 | Read |
| `app/api/sector-rotation/route.ts` | 109 | Read |
| `app/api/ma-deviation/route.ts` | 135 | Read |
| `app/api/analytics/[ticker]/route.ts` | 129 | Read |
| `app/api/briefs/route.ts` | 222 | Read |
| `app/api/briefs/[sector]/route.ts` | 407 | Read |
| `app/api/crypto/btc/route.ts` | 340 | Read |
| `app/api/crypto/btc/quote/route.ts` | 66 | Read |
| `app/api/crypto/btc/metrics/route.ts` | 178 | Read |
| `app/api/crypto/btc/liquidations/route.ts` | 156 | Read |
| `app/api/bloomberg-bridge/health/route.ts` | 29 | Read |
| `app/api/trading-agents/health/route.ts` | 86 | Read |
| `app/api/chart/[ticker]/route.ts` | 264 | Read |
| `app/api/fundamentals/[ticker]/route.ts` | 175 | Read |
| `app/api/options/[ticker]/route.ts` | 100 | Read |

---

## Routes audited (26 / 30)

| # | Route | Audited |
|---|-------|---------|
| 1 | GET /api/analytics/[ticker] | ✅ |
| 2 | GET /api/backtest | ✅ |
| 3 | POST /api/backtest | ✅ |
| 4 | GET /api/backtest/live | ✅ |
| 5 | GET /api/bloomberg-bridge/health | ✅ |
| 6 | GET /api/briefs | ✅ |
| 7 | GET /api/briefs/[sector] | ✅ |
| 8 | GET /api/chart/[ticker] | ✅ |
| 9 | GET /api/conditional-vol/[ticker] | PENDING |
| 10 | GET /api/crypto/btc | ✅ |
| 11 | GET /api/crypto/btc/quote | ✅ |
| 12 | GET /api/crypto/btc/metrics | ✅ |
| 13 | GET /api/crypto/btc/liquidations | ✅ |
| 14 | GET /api/darkpool/[ticker] | PENDING |
| 15 | GET /api/fundamentals/[ticker] | ✅ |
| 16 | GET /api/ma-deviation | ✅ |
| 17 | GET /api/ml/[ticker] | PENDING |
| 18 | GET /api/news/[sector] | PENDING |
| 19 | GET /api/news/ticker/[ticker] | PENDING |
| 20 | GET /api/options/[ticker] | ✅ |
| 21 | GET /api/prices | PENDING |
| 22 | GET /api/regime/[ticker] | PENDING |
| 23 | GET /api/search | PENDING |
| 24 | GET /api/sector-rotation | ✅ |
| 25 | GET /api/stream/[ticker] | ✅ |
| 26 | GET /api/trading-agents/[ticker] | ✅ |
| 27 | POST /api/trading-agents/[ticker] | ✅ |
| 28 | GET /api/trading-agents/health | ✅ |
| 29 | GET /api/auth/[...nextauth] | N/A (NextAuth) |
| 30 | POST /api/auth/[...nextauth] | N/A (NextAuth) |

---

## CHECKPOINT — in progress
*Last incremental save: 26/30 routes read. Remaining: conditional-vol, darkpool, ml, news/[sector], news/ticker/[ticker], prices, regime, search*
