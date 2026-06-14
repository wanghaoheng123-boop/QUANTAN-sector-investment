# API / Security Review — 2026-06-10 Full Review

**Reviewer:** API/security area agent (OWASP-minded, Next.js App Router)
**Baseline:** main @ 6945e34 (post PR #53/#54/#55 merge — 2026-06-04 inspection remediation merged)
**Date:** 2026-06-10/11

## Scope

- `app/api/**` (~27 route files), `middleware.ts`
- `lib/auth.ts`, `lib/auth/apiKey.ts`
- `lib/api/**` — csrf.ts, csrfClient.ts, rateLimit.ts, sanitize.ts, reliability.ts, marketHours.ts
- `lib/featureFlags.ts`, `lib/security/urlValidation.ts`
- `next.config.js` (headers/CSP), `package.json` deps (uuid override, npm audit)
- `lib/data/providers/**`, `lib/data/warehouse.ts` (server-side data layer)

## Mission

1. Verify PR #53 remediation claims are *correct* (not just present) in current source:
   atomic KV rate limit, briefs allSettled, validation-before-rate-limit ordering, backtest
   cache+lock, max_debate/risk_rounds POST clamp, sanitizeError 30/30, CSRF gate ordering,
   uuid override, isValidApiKey fail-closed.
2. Verify 2026-06-04 data-layer remediation: provider fetch timeouts, AlphaVantage
   non-finite skip (not 0-coercion), polygon ns-vs-ms trade timestamps, warehouse prepared
   statements + OHLC non-finite filter.
3. Hunt NEW issues (SSRF, path traversal, injection, authZ, DoS, info leak).

Severity: P0 (exploitable/critical) · P1 (serious) · P2 (moderate) · P3 (minor/hygiene).
Each finding cites file:line + confidence.

---

## Findings

(appended incrementally below)

### Batch 1 — core security infra + PR #53 flagship routes

#### V-1. Rate-limit KV atomicity (PR #53 claim 1) — MOSTLY CORRECT, residual race remains
**File:** `lib/api/rateLimit.ts:79-114` · **Severity: P2** · **Confidence: high (logic), medium (practical exploitability)**

The `SET rl:<key> 1 EX <window> NX` + fallback-`INCR` design (lines 92-108) correctly fixes
the original INCR-then-EXPIRE bug: a key can no longer be *created* without a TTL by the SET
path. However a smaller residual race re-introduces the exact failure mode the comment says
was eliminated: if the key expires **between** the SET-NX (returns null, key existed) and the
subsequent INCR (line 104), the INCR re-creates the key **with no TTL**. From then on every
window does SET-NX→no-op, INCR→count grows forever → that IP is permanently 429'd until
manual KV cleanup (self-inflicted DoS, the original bug's blast radius, just a far narrower
trigger window — ms-scale race at window boundary under sustained traffic). Canonical fixes:
`EXPIRE <key> <window> NX` after INCR (Redis ≥7 / Upstash supports the NX flag), or check
`TTL`= -1 after INCR, or a single Lua/pipeline transaction.
Also: `retryAfter` on the KV path is always the **full** `windowSeconds` (line 110), not the
remaining TTL — over-reports wait time (P3, cosmetic).

#### V-1b. KV vs memory fallback semantics differ
**File:** `lib/api/rateLimit.ts:51-73 vs 79-114` · **Severity: P3** · **Confidence: high**
KV path = fixed window (burst of `maxRequests`, hard reset); memory path = continuous-refill
token bucket. On KV error the limiter silently switches semantics mid-stream (and the memory
bucket won't know about tokens consumed via KV). Limits are roughly equivalent in magnitude;
behavior is not identical as PR #53 implies. Acceptable, but tests asserting "same behavior"
would be asserting something false — see test recheck in Batch 4.

#### V-1c. Rate-limit key trusts client-controllable headers off-Vercel
**File:** `lib/api/rateLimit.ts:116-127` · **Severity: P3** · **Confidence: high**
Non-Vercel deployments key on `x-real-ip` (client-spoofable without a trusted reverse proxy)
→ trivial limiter bypass by rotating header values, plus per-key bucket churn (bounded by
MAX_BUCKETS=50k + evictHalfByAge, so memory exhaustion is contained). On Vercel the platform
overwrites `x-forwarded-for`, so the primary deployment is fine.

#### V-2. briefs outer Promise.allSettled (PR #53 claim 2) — CORRECT
**File:** `app/api/briefs/route.ts:153-194` · **Confidence: high**
Outer fan-out is `allSettled`; rejected sector workers are logged and skipped (184-187);
inner per-ticker fan-out is also `allSettled` with per-call 4s timeout; `degraded:true` when
>50% calls fail, with shortened CDN cache (s-maxage=30) on degraded payloads. Partial-failure
behavior is correct. NEW minor bug found here (B-1 below).

#### B-1 (NEW). briefs `id` is non-unique — base64 of first 12 bytes of the URL
**File:** `app/api/briefs/route.ts:96` · **Severity: P3 (functional, not security)** · **Confidence: high**
`Buffer.from(link).toString('base64').slice(0, 16)` = base64 of the first 12 bytes of the
link — i.e. `"https://www."` for nearly every item, so nearly all briefs share the same `id`.
Dedup is by link so the payload is fine, but any client keying on `id` (React lists) gets
collisions. Hash the whole link (e.g. sha1/sha256 hex slice) instead.

#### V-3. Validation-before-rate-limit ordering (PR #53 claim 3) — CONFIRMED for stream + TA GET
**Files:** `app/api/stream/[ticker]/route.ts:77-95`, `app/api/trading-agents/[ticker]/route.ts:60-71` · **Confidence: high**
Both validate `normalizeTicker` first, 400 before any bucket consumption. Note: TA **POST**
intentionally orders CSRF(178) → rate-limit(186) → auth(191) → ticker validation(199); an
invalid-ticker POST with valid CSRF does consume a token, which is fine (the request already
cost a CSRF round-trip; rate-limiting before the expensive `getServerSession` is the right
call). Full per-route ordering recount in the coverage matrix (Batch 5).

#### V-4. backtest GET Cache-Control + compute lock (PR #53 claim 4) — CORRECT
**File:** `app/api/backtest/route.ts:141-163` · **Confidence: high**
`s-maxage=3600, swr=7200` on both cache-hit and computed paths. In-flight lock: `computing =
runBacktest().finally(() => { computing = null })` — `.finally` clears on both resolve and
reject, so **no lock leak on throw**; concurrent cold callers all await the same promise; a
rejected run 500s all waiters and the next request retries cleanly. Two minor notes:
- P3: POST (line 189) bypasses the `computing` lock — a POST racing concurrent cold GETs runs
  a second full computation. Bounded by POST's 3/min limit; cosmetic CPU waste only.
- P3: POST sets `cache = null` (187) *before* recompute; on failure the GET cache stays cold —
  acceptable (fresh data preferred over stale after explicit recompute request).

#### V-5. max_debate/risk rounds clamped in BODY too (PR #53 claim 5) — CORRECT
**File:** `app/api/trading-agents/[ticker]/route.ts:285-315` · **Confidence: high**
`clampRound` (1..5, integer, finite) feeds both queryParams (292-294) and `upstreamBody`
(314-315) from the same clamped locals; invalid values are omitted, never forwarded. The raw
`body.max_*` values cannot reach the sidecar. Claim verified.

#### B-2 (NEW). TA POST forwards unbounded `deep_think_llm`/`quick_think_llm`/`trade_date`/`data_vendor` strings upstream
**File:** `app/api/trading-agents/[ticker]/route.ts:258-316` · **Severity: P3** · **Confidence: high**
These fields are `String(...)`-coerced but not length-capped or pattern-checked, then placed
in the upstream URL query AND JSON body. URLSearchParams encoding prevents injection, but an
authenticated (or API-key) caller can ship multi-MB strings → oversized URL to the Python
sidecar (may 414/502 or burn memory). Cap length (e.g. 64 chars) and pattern-check model ids
the same way provider is allow-listed. `api_key` likewise has a min length (8) but no max.

#### V-9 (partial). isValidApiKey fail-closed (claim 9) — CORRECT
**File:** `lib/auth/apiKey.ts:25-43` · **Confidence: high**
Unset/empty `QUANTAN_API_KEY` rejects all callers; sha256-digest-then-timingSafeEqual avoids
the length-mismatch throw and length-timing leak. TA POST uses it for both the CSRF bypass
and the auth gate (`apiKeyValid`, lines 176-197) — the D4-1 bypass is properly closed.

#### Infra notes (no finding)
- `middleware.ts:75-95` issues `quantan_csrf` (SameSite=Strict, Secure in prod, httpOnly:false
  by design for double-submit); re-issues only when absent. CSP enforce is env-gated
  (`QUANTAN_CSP_ENFORCE=1`), Report-Only header lives in `next.config.js:43-55`.
  **Security headers ARE present** in `next.config.js:20-56` (HSTS, XCTO, XFO DENY,
  Referrer-Policy, Permissions-Policy) on `/:path*` — prior fleet claim of absence is a
  confirmed false positive.
- `lib/api/csrf.ts:26` uses non-constant-time `header === cookie`; irrelevant here (both
  values are attacker-invisible cross-site; double-submit doesn't rely on secrecy from the
  legitimate client). No Origin-header backstop, but SameSite=Strict covers modern browsers — P3-informational.
- `lib/auth.ts:35-74` getSecret: random per-instance secret + structured `auth.secret_missing`
  log when NEXTAUTH_SECRET missing in prod — fail-safe (sessions die on cold start rather
  than forgeable). JWT field gates (`safeStringField`/`safeUrlField`, lines 119-135) bound
  size and strip control chars / non-http avatar URLs. NOTE (P3-hygiene): the control-char
  regex at line 124 embeds RAW bytes 0x00-0x1f,0x7f in source (verified via hexdump —
  functionally correct, but invisible in editors and easy to break in refactors; should be
  written `/[\x00-\x1f\x7f]/`).
- `next.config.js:81-89` image remotePatterns allow-list (no `**`) — SSRF-amplification fix intact.
- `app/api/stream/[ticker]/route.ts`: SSE unauthenticated, 10 conn/min/IP, 9-min soft close
  with warn — up to ~90 concurrent function-slots per IP sustained (P3 cost note, design choice).

### Batch 2 — data layer remediation, deps, rate-limit tests

#### V-6. sanitizeError coverage recount (claim 6) — effectively clean; "30/30" is the wrong denominator
**Confidence: high**
Current source has **27 route files** (29 exported handlers incl. backtest POST + TA POST; the
nextauth catch-all delegates to NextAuth). Recount of error-detail emission:
- 22/27 route files call `sanitizeError` directly on every error-detail path (incl. the
  liquidations route, `app/api/crypto/btc/liquidations/route.ts:150` — the fix is in place).
- `bloomberg-bridge/health/route.ts:27` returns `h.error`, which is sanitized **inside**
  `lib/data/bloomberg/bridgeClient.ts:182` (`sanitizeError(e) ?? 'bridge unreachable'`) — covered indirectly.
- `search/route.ts:101` returns a static `'search_unavailable'` envelope — nothing to sanitize. Clean.
- `crypto/btc/route.ts:277-338` returns static `btc_data_unavailable` envelopes — clean.
- `backtest/live/route.ts` and `briefs/[sector]/route.ts` have **no try/catch at all** — an
  unexpected throw (fs error, Yahoo schema drift at line ~177 of briefs/[sector]) becomes a
  framework-default 500. In production Next.js emits a generic body, so **no CWE-209 leak**,
  but the JSON error-envelope contract breaks and there is no route-level console.error.
  **P3 (resilience/consistency), confidence high.**
Net: no production error-detail leak found on any route. Claim substance holds.

#### V-7. CSRF wiring (claim 7) — verified, no orphan POST routes
**Confidence: high**
POST surface = `backtest` (validateCsrf at route.ts:178), `trading-agents/[ticker]`
(validateCsrf at :178 with valid-API-key bypass), `auth/[...nextauth]` (NextAuth's own CSRF).
No new POST route exists that misses the guard. Gate ordering: CSRF → rate-limit → auth —
cheap local check first; sensible. Client side: `lib/api/csrfClient.ts` echoes the cookie —
callers verified in Batch 3.

#### V-8. uuid override + npm audit (claim 8) — override intact; 13 NEW prod-graph vulns (5 high)
**File:** `package.json:70-72` · **Severity: P2 (aggregate)** · **Confidence: high (audit output), medium (runtime exposure)**
`"overrides": { "uuid": "^11.1.1" }` still present; no uuid advisory in audit output — cleared.
`npm audit --omit=dev` now reports **13 vulnerabilities (8 moderate, 5 high)**, all NEW since
the 2026-05-25 audit doc:
- HIGH `@babel/plugin-transform-modules-systemjs` (GHSA-fv7c-fp4j-7gwp) — fix via `npm audit fix`
- HIGH `fast-uri` path traversal/host confusion (GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc) — fixable
- HIGH `lodash` <=4.17.23 `_.template` code injection + proto pollution (GHSA-r5fr-rjxr-66jc) — fixable
- HIGH `picomatch` ReDoS/method injection — fixable
- HIGH `serialize-javascript` <=7.0.4 RCE/DoS via `@rollup/plugin-terser` → `workbox-build` →
  `@ducanh2912/next-pwa` — fix requires next-pwa downgrade per npm (build-time-only exposure)
- MODERATE: ajv ReDoS, brace-expansion hang, postcss <8.5.10 (bundled inside `next`)
Context: most sit in the PWA/workbox **build-time** chain (classified prod because next-pwa is
a prod dep), so runtime blast radius is low — but `npm audit fix` clears the majority without
breaking changes and should be run. The postcss one rides inside `next` and waits on a Next
upgrade.

#### V-1d. Rate-limit KV test (claim 1, test half) — asserts command shape, not the residual race
**File:** `__tests__/api/rateLimit.kv.test.ts:55-91` · **Confidence: high**
Tests assert: first request issues `SET .../EX/60/NX` with **no** separate INCR/EXPIRE;
subsequent requests INCR without EXPIRE; 429 + Retry-After on overflow; memory fallback on
KV 500/network error/missing env. That is a solid regression guard for the original bug.
It does NOT (and cannot, with this stub) exercise the V-1 residual race (key expiring between
SET-NX and INCR re-creating a TTL-less key). If V-1 is fixed with `EXPIRE NX` after INCR, add
a stub asserting the extra call.

#### V-10. Data-layer remediation (2026-06-04) — ALL FOUR CLAIMS VERIFIED
**Confidence: high**
1. Fetch timeouts: `alphavantage.ts:13,56,98`, `polygon.ts:14,28`, `fred.ts:22,70,89` — all
   fetches use `AbortSignal.timeout(8_000)`. Confirmed.
2. AlphaVantage non-finite: `parseFiniteOrNull` (`alphavantage.ts:21-24`) → bars with any
   non-finite OHLC are **skipped** (`:77`), quote with non-finite price returns null (`:104-105`).
   No 0-coercion on price fields; volume/change use benign 0-fallback as documented. Confirmed.
3. Polygon ns-vs-ms: `/v2/last/trade` `t/1_000_000` with year-plausibility guard (2000-2100)
   + warn + now() fallback (`polygon.ts:74-86`); aggs `t` used as ms directly (`:57`). Confirmed.
4. Warehouse prepared statements: every read/write in `lib/data/warehouse.ts` uses `?`
   placeholders (`:120,145,176,197,215,230,240`); the only interpolation is `addIfMissing`
   DDL with hardcoded column names (`:89-100`) — not injectable. OHLC non-finite read guard
   in `lib/backtest/dataLoader.ts:67-71,86-90`. Confirmed.

#### B-3 (NEW). Polygon fetchDaily does not finite-check OHLC on ingest
**File:** `lib/data/providers/polygon.ts:56-59` · **Severity: P3** · **Confidence: high**
`r.o/h/l/c/v` map straight into DailyBar with no `Number.isFinite` check (JSON can carry
`null`, and schema drift could surface it). AlphaVantage got the strict treatment; Polygon
did not. Downstream is defended on the warehouse READ path (dataLoader D5-1 guard) and a null
would violate the SQLite NOT NULL on write (throwing inside `upsertCandles`'s transaction —
an unhandled throw in ingest scripts). Cheap fix: apply the same skip-bar filter. Same note
for `yahoo.ts:36-43` which `??`-falls back to `q.close` but never checks `Number.isFinite(q.close)`
beyond `> 0` (NaN > 0 is false → filtered; Infinity passes the `> 0` check — edge case only).

#### B-4 (NEW). Provider fetches put API keys in URL query strings
**Files:** `lib/data/providers/alphavantage.ts:55,97`, `polygon.ts:27`, `fred.ts:88` · **Severity: P3** · **Confidence: high**
`apikey=`/`apiKey=`/`api_key=` ride the URL. Both vendors require this (no header alternative
for AV/FRED; Polygon supports `Authorization: Bearer`), but URLs leak into any fetch-level
error/log line. Polygon could move to the Authorization header. Hygiene only — current code
does not log these URLs (the crypto fetchWithTimeout logs URLs, but those are keyless).
