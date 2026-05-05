# R7 — Security & Compliance Review (Phase 13 S1)

**Reviewer:** R7 — CISSP + US securities-data compliance
**Sprint:** S1 (read-only)
**Date:** 2026-05-05
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | Read |
|------|------|
| `lib/auth.ts` | full |
| `app/api/prices/route.ts` | full (R4 overlap) |
| `app/api/fundamentals/[ticker]/route.ts` | head + input-validation only |
| `app/api/search/route.ts` | head + input-validation only |
| `app/api/backtest/route.ts` | head only |
| `app/api/trading-agents/[ticker]/route.ts` | head only |
| `app/api/crypto/btc/route.ts` | input-validation only |
| `lib/data/bloomberg/bridgeClient.ts` | env-var handling only |
| `lib/api/rateLimit.ts`, `reliability.ts` | full (R4 overlap) |
| `next.config.js` | not read (CSP audit deferred) |
| `.env.example` | not read |
| `lib/auth.ts` JWT callbacks | partial (lines 1-80) |

**Disclosure:** Did not read every API route end-to-end. R7 second pass required for full coverage.

---

## Findings

### F7.1 [HIGH] — Production NEXTAUTH_SECRET fallback is fail-secure but creates poor UX & no observability

**Location:** `lib/auth.ts:34-58`

**Evidence:** When `NEXTAUTH_SECRET` is missing in production:
- Code generates a per-instance random secret (cryptographically OK)
- Logs a `console.warn` (not `console.error`)
- No alerting/monitoring; no OpenTelemetry span
- Sessions invalidate on every cold start

The intent (fail-secure rather than fail-open) is correct, but operators have no visibility unless they tail Vercel logs. Phase 13 plan S4 calls for OpenTelemetry; this is a candidate.

**Citation:** OWASP ASVS 4.0 V7 (Security Logging) — security events must be logged with at least WARNING level + alerted.

**Patch sketch:**
```ts
if (!_generatedSecret) {
  _generatedSecret = crypto.randomBytes(32).toString('hex')
  console.error(  // ← elevated from warn
    JSON.stringify({
      event: 'auth.secret_missing',
      severity: 'critical',
      message: 'NEXTAUTH_SECRET unset; generated ephemeral secret. Sessions will rotate on cold starts.',
    })
  )
  // Optionally: trigger Sentry / Datadog alert
}
```
Add a CI gate: `next build` fails on Vercel deployment if `NEXTAUTH_SECRET` env var is unset (using a build-time check).

**Acceptance test:** Force missing env in Vercel preview; verify Sentry/Datadog event raised.

**Severity:** High — production stability + observability gap.

---

### F7.2 [HIGH] — Error responses leak internal details (CWE-209)

**Location:** `app/api/prices/route.ts:79`, `lib/api/reliability.ts:50`, multiple other routes (assumed pattern)

**Evidence:** `String(error)` and `details: details ?? null` propagate raw exception strings to the client. Exception messages can include:
- File system paths (`/var/task/...`)
- yahoo-finance2 internal URL fragments (potentially with user-agent or session params)
- TypeScript line numbers / stack frames
- Bloomberg bridge auth header strings if accidentally interpolated

**Citation:** CWE-209 (Information Exposure Through Error Messages); OWASP API Security Top 10 (2023) API8.

**Patch sketch:** Centralize error sanitization (already in F4.8):
```ts
// lib/api/sanitize.ts
export function publicErrorMessage(err: unknown, isProd = process.env.NODE_ENV === 'production'): string {
  if (!isProd) {
    return err instanceof Error ? err.message : String(err)
  }
  // Production: never reveal internals
  return 'An internal error occurred. Reference: ' + crypto.randomUUID()
}
```
Log full error server-side with the same UUID for correlation; return only the UUID + safe message client-side.

**Acceptance test:** Force errors in 5 API routes; assert client response contains no path strings, no `at ` stack frames, no env-var values.

**Severity:** High — security misconfiguration exposed on every error path.

---

### F7.3 [HIGH] — User-supplied tickers flow to yahoo-finance2 without strict validation; theoretical SSRF/abuse vector

**Location:** `app/api/prices/route.ts:25-32`, `app/api/chart/[ticker]/route.ts:36`, `app/api/options/[ticker]/route.ts:13`, `app/api/fundamentals/[ticker]/route.ts:26`

**Evidence:** `prices/route.ts` accepts `?tickers=A,B,C,...` and passes to `yahooFinance.quote(tickers)`. The only validation: `decodeURIComponent`, trim, uppercase, plus the `^VIX` special case. No length cap, no character whitelist, no blacklist. yahoo-finance2 may construct URLs that include the user input verbatim.

If yahoo-finance2 (or similar libraries) ever vulnerable to URL-injection (e.g., a ticker like `AAPL?range=max&intra=`), users can manipulate upstream queries. Even today, an attacker can pass 10,000-character strings or 1,000+ comma-separated tickers to amplify backend load (DoS amplification). Per F4.3, rate-limit is per-process.

**Citation:**
- CWE-918 (Server-Side Request Forgery).
- OWASP ASVS 4.0 V12 (Files and Resources) — strict whitelist validation for any user input flowing to upstream URL construction.

**Patch sketch:**
```ts
const TICKER_REGEX = /^[\^]?[A-Z][A-Z0-9.\-=]{0,9}$/  // e.g. AAPL, BRK.A, ^VIX, ES=F
const MAX_TICKERS = 200

const tickers = (queryTickers ?? '').split(',')
  .map(t => decodeURIComponent(t.trim()).toUpperCase())
  .map(t => t === 'VIX' ? '^VIX' : t)
  .filter(t => TICKER_REGEX.test(t))
  .slice(0, MAX_TICKERS)

if (tickers.length === 0) return errorResponse('invalid_tickers', '...', undefined, 400)
```
Apply identically across every route accepting `[ticker]` or `?tickers=`.

**Acceptance test:** Fuzz the API with 1,000-character ticker strings, special chars (`<script>`, `; rm`, `?intra=`, file paths). Assert all return 400 with no upstream call fired.

**Severity:** High — defense-in-depth against upstream library vulnerabilities; DoS amplification.

---

### F7.4 [HIGH] — No CSRF protection on state-changing API routes (need POST audit)

**Location:** `app/api/trading-agents/[ticker]/route.ts:157-272` (POST); presumably `app/api/backtest/route.ts` POST (header-only read)

**Evidence:** trading-agents POST accepts a JSON body and forwards to the upstream Python sidecar at `TRADING_AGENTS_BASE`. NextAuth's session JWT is checked (assumed; need to verify). Even with auth, there is no explicit CSRF token validation. A malicious site could embed `<form action="https://quantan.vercel.app/api/trading-agents/AAPL" method="POST">` and exfiltrate user-authenticated calls.

**Citation:** OWASP CSRF Prevention Cheat Sheet (2023). NextAuth v4 documentation on `csrfToken`.

**Patch sketch:**
- For state-changing routes (POST/PUT/DELETE), require `Origin` header matches the deployment origin OR a CSRF token from `getCsrfToken()`.
- Add a `csrfGuard()` middleware in `lib/api/`.

**Acceptance test:** Synthesize a cross-origin POST request to `/api/trading-agents/AAPL`; assert 403 returned.

**Severity:** High — depends on whether routes are state-changing. If trading-agents POST commits a position, this is HIGH; if read-only, MEDIUM.

---

### F7.5 [MEDIUM] — Bloomberg bridge secret handling — confirm timing-safe comparison upstream

**Location:** `lib/data/bloomberg/bridgeClient.ts:148, 57`

**Evidence:** `BLOOMBERG_BRIDGE_SECRET` is sent as authorization to the Python bridge. Need to verify the bridge (`server_options.py` or similar) compares using timing-safe equality (e.g., `hmac.compare_digest`) — non-timing-safe comparison enables timing attacks for secret discovery.

**Citation:** Brumley & Boneh (2005). "Remote Timing Attacks Are Practical." *USENIX Security*.

**Patch sketch:** Audit Python bridge code; if using `==` directly, replace with `hmac.compare_digest`. Document in `docs/architecture.md` that secrets must use timing-safe comparisons.

**Severity:** Medium — academic but real attack class; standard hardening.

---

### F7.6 [MEDIUM] — No Content-Security-Policy / Strict-Transport-Security headers (assumed; verify next.config.js)

**Location:** `next.config.js` (not read in this pass)

**Evidence:** Standard hardening: every modern web app should set CSP, HSTS, X-Frame-Options (or frame-ancestors in CSP), X-Content-Type-Options, Referrer-Policy. `next.config.js` `headers()` block configures these.

**Citation:** OWASP Secure Headers Project; Mozilla Observatory baseline.

**Patch sketch:**
```js
// next.config.js
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: "default-src 'self'; img-src 'self' data:; ..." },
    ]
  }]
}
```

**Severity:** Medium — defense-in-depth; verify what's already there before claiming missing.

---

### F7.7 [MEDIUM] — Rate-limit gap (per-process buckets, F4.3) is a security issue too

**Location:** `lib/api/rateLimit.ts` (F4.3 cross-reference)

**Evidence:** Per F4.3, the in-memory bucket allows attackers across multiple Vercel instances or cold starts to bypass rate limits. From a security perspective, this is a DoS vector against:
1. The deployment itself (yahoo-finance2 quota exhaustion → service degradation)
2. Yahoo Finance (origin abuse — possible legal/ToS escalation)

**Citation:** OWASP API Security Top 10 (2023) API4 (Lack of Resources & Rate Limiting).

**Patch sketch:** see F4.3 (Vercel KV / Upstash).

**Severity:** Medium when viewed as security; HIGH when viewed as data engineering. Severity tier shared.

---

### F7.8 [MEDIUM] — Yahoo Finance commercial-use compliance (cross-ref F4.5)

**Location:** Every API route consuming yahoo-finance2

**Evidence:** Yahoo Finance ToS prohibits commercial redistribution. Institutional users on the platform receive Yahoo data — non-compliant. Cross-reference to F4.5.

**Citation:** Yahoo Finance ToS §2 (linked in F4.5).

**Patch sketch:** see F4.5; I3 must sign before commercial launch.

**Severity:** Medium when viewed as security/compliance; HIGH when viewed as commercial blocker. Tier shared.

---

### F7.9 [MEDIUM] — JWT callback at `lib/auth.ts:73-80` accepts profile fields without validation

**Location:** `lib/auth.ts:74-80`

**Evidence:**
```ts
async jwt({ token, user, account, profile }) {
  if (user) {
    token.email = user.email
    token.name = user.name
    token.picture = user.image
  }
  if (account && profile) {
    token.name = (profile as { name?: string }).name ?? token.name
    token.picture = (profile as { image?: string; avatar_url?: string }).image
    ...
  }
}
```
Profile fields are written into the token without validation (length, content, encoding). A malicious OAuth provider response could pollute the token with oversized fields → DOS via cookie-size limits, or attempt persistent XSS if `name` is rendered in HTML.

**Citation:** OWASP ASVS V5 (Validation, Sanitization, Encoding); NextAuth security guide.

**Patch sketch:** Add bounded field validation:
```ts
function safeName(s: unknown, max = 200): string | undefined {
  return typeof s === 'string' && s.length > 0 && s.length <= max ? s.trim() : undefined
}
token.name = safeName(profile.name) ?? safeName(user.name) ?? token.name
```

**Severity:** Medium — defense-in-depth.

---

### F7.10 [LOW] — Default 5s SWR polling without authenticated context — confirm `/api/prices` is intentionally public

**Location:** `app/api/prices/route.ts:19-32`

**Evidence:** `/api/prices` is unauthenticated — anyone polls 5s for the full sector slate. This is intentional for the public dashboard, but cross-reference with F4.5 (compliance): unauthenticated public distribution worsens the Yahoo TOS argument.

**Patch sketch:** Document this explicitly in `app/api/prices/route.ts` header comment. Decide: should authenticated users get 5s, public users get 30s?

**Severity:** Low — design clarification, not a bug.

---

## Cross-domain handoffs

- **R4:** F7.2, F7.7, F7.8 are shared findings (data engineering perspective).
- **I3:** F7.8 is the primary I3 sign-off blocker for commercial launch.
- **R8:** F7.3 needs a fuzz-test suite — handoff to R8.

---

## Self-dissent

I did NOT read `next.config.js` (F7.6 is hypothetical), the trading-agents POST handler beyond head (F7.4 may be already mitigated by NextAuth), or `.env.example` (env-var hygiene). R7 second pass required.

F7.1 (NEXTAUTH_SECRET fallback) — debatable severity. The code IS fail-secure and the cold-start invalidation is documented. Operators reading docs will set the env var. Could be downgraded to MEDIUM if Vercel deployment runbook explicitly requires NEXTAUTH_SECRET.

F7.4 (CSRF) — claim depends on whether the POST routes are actually state-changing. If trading-agents POST is just a "research run" that doesn't commit anything to a database or external broker, CSRF risk is low. Need to read upstream Python sidecar.

---

## Findings summary table

| ID | Severity | Loc | One-line |
|----|----------|-----|----------|
| F7.1 | HIGH | auth.ts:34-58 | NEXTAUTH_SECRET fallback OK but no alerting |
| F7.2 | HIGH | reliability.ts:50, prices:79 | error responses leak internals |
| F7.3 | HIGH | prices:25-32, chart, options, fundamentals | tickers flow to yahoo without validation |
| F7.4 | HIGH | trading-agents POST, backtest POST | no CSRF protection (need verify) |
| F7.5 | MEDIUM | bloomberg bridge upstream | timing-safe secret comparison (need verify) |
| F7.6 | MEDIUM | next.config.js | CSP/HSTS headers (need verify) |
| F7.7 | MEDIUM | rateLimit.ts | rate-limit ineffective (cross-ref F4.3) |
| F7.8 | MEDIUM | (every yahoo route) | yahoo commercial use (cross-ref F4.5) |
| F7.9 | MEDIUM | auth.ts:74-80 | JWT callback fields not validated |
| F7.10 | LOW | prices:19 | unauthenticated public API noted |

Total: 10 (0 Critical, 4 High, 5 Medium, 1 Low).

---

**Reviewer signature:** R7
**Cross-checked by:** R4 — pending
**Inspector spot-check:** I3 — pending; F7.8 is sign-off blocker
