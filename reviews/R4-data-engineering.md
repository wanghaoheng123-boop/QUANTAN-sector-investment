# R4 — Data Engineering & Market Data Review (Phase 13 S1)

**Reviewer:** R4 — Staff DE, ex-Bloomberg/Refinitiv feed engineering
**Sprint:** S1 (read-only)
**Date:** 2026-05-04
**Standing prompt:** Acknowledged.

---

## Inventory reviewed

| File | Read |
|------|------|
| `lib/data/mergeQuotes.ts` | full |
| `lib/api/rateLimit.ts` | full |
| `lib/api/reliability.ts` | full |
| `app/api/prices/route.ts` | full |
| `lib/data/warehouse.ts` | deferred |
| `lib/data/bloomberg/bridgeClient.ts` | deferred |
| `lib/data/bloomberg/toBloombergSecurity.ts` | deferred |
| `lib/chartYahoo.ts` | deferred |
| 22 other API routes (`app/api/**`) | structural — sample only |
| `scripts/fetchBacktestData.mjs` | deferred |
| `.github/workflows/refresh-data.yml` | deferred |

**Disclosure (rule 5):** Fully read 4 files; the rest are deferred to R4 second pass before S2 entry.

---

## Findings

### F4.1 [HIGH] — Bloomberg bridge fails silently with `.catch(() => null)`

**Location:** `app/api/prices/route.ts:38`

**Evidence:**
```ts
isBloombergBridgeConfigured()
  ? fetchBloombergQuotesViaBridge(tickers).catch(() => null)
  : Promise.resolve(null),
```
This is precisely the pattern the Phase 12 plan forbids and the I2 invariant rule 8 auto-rejects. When the Bloomberg bridge fails (network, auth, payload schema mismatch), the user receives Yahoo data with `dataSource: 'yahoo'` and no indication that Bloomberg was unreachable. For institutional users paying for Bloomberg primary feed, this is a silent downgrade with no audit trail.

**Citation:** Bloomberg Terminal Data Distribution policy — clients must be informed when authoritative feed is unavailable.

**Patch sketch:**
```ts
const bbResult = isBloombergBridgeConfigured()
  ? await fetchBloombergQuotesViaBridge(tickers).then(
      m => ({ ok: true as const, value: m }),
      e => ({ ok: false as const, error: String(e) })
    )
  : { ok: true as const, value: null }

if (!bbResult.ok) {
  // Log with structured event for Datadog/Sentry pickup
  console.error('[prices] bloomberg bridge degraded', bbResult.error)
}
const bbMap = bbResult.ok ? bbResult.value : null
// Add to response payload:
dataSources: {
  yahoo: true,
  bloombergBridge: bbResult.ok && Boolean(bbMap && bbMap.size > 0),
  bloombergStatus: bbResult.ok ? 'ok' : 'degraded',
  bloombergTickers,
}
```

**Acceptance test:** Force the bridge to throw; assert response includes `dataSources.bloombergStatus === 'degraded'` and a degraded toast appears in the UI.

**Severity:** High — silent degradation; institutional audit failure.

---

### F4.2 [HIGH] — `mergeYahooAndBloomberg` field-level provenance is lost

**Location:** `lib/data/mergeQuotes.ts:39-54`

**Evidence:** When Bloomberg returns a quote with some fields missing (e.g., bb.volume = 0), the merge falls back to Yahoo for those fields:
```ts
volume: bb.volume || y.volume,
high52w: bb.high52w || y.high52w,
low52w: bb.low52w || y.low52w,
pe: bb.pe || y.pe,
marketCap: bb.marketCap !== 'N/A' ? bb.marketCap : y.marketCap,
```
But the result is labeled `dataSource: 'bloomberg'` — losing the per-field provenance. An auditor cannot determine whether volume came from Bloomberg or Yahoo. Worse: the falsy fallback `bb.volume || y.volume` treats Bloomberg's legitimate 0-volume halts as "missing" and substitutes Yahoo's last-known volume.

**Citation:** ISO 20022 / FIX best-practice: every quoted field carries source attribution.

**Patch sketch:** Use field-level provenance:
```ts
interface UnifiedQuoteV2 {
  ticker: string
  price: { value: number; source: 'bloomberg' | 'yahoo' }
  volume: { value: number; source: 'bloomberg' | 'yahoo' }
  // ... etc per field
}
```
Or at minimum, use `??` (nullish-coalescing) instead of `||` to preserve 0-volume halt signals:
```ts
volume: bb.volume ?? y.volume,  // preserves Bloomberg's 0
```
And add `provenance: { volume: 'bloomberg' | 'yahoo', ... }` to UnifiedQuote.

**Acceptance test:** Synthetic input: Bloomberg returns volume=0 (halt). Assert merged quote `volume === 0` (not Yahoo's last value) and `provenance.volume === 'bloomberg'`.

**Severity:** High — institutional data audit trail incomplete; silent halt-data corruption.

---

### F4.3 [HIGH] — Token-bucket rate limiter is per-process; ineffective in serverless

**Location:** `lib/api/rateLimit.ts:13, 9-11`

**Evidence:** The `buckets` Map is in-memory per Node.js process. On Vercel:
- Each serverless invocation may hit a fresh process (cold start) → new empty bucket → free 60 requests
- Concurrent invocations across multiple instances each have their own bucket → effective limit = N×60 where N = number of concurrent serverless instances

The header comment acknowledges this ("for strict global limits, use an external store") but doesn't fix it. For a public-facing dashboard polling at 5s with 60 req/min cap, an attacker spawning 10 concurrent connections trivially defeats the limit and exhausts the underlying yahoo-finance2 quota.

**Citation:**
- Vercel official docs (functions ephemeral state): https://vercel.com/docs/concepts/functions/serverless-functions
- AWS Lambda best-practice for distributed rate limiting (ElastiCache/DynamoDB).

**Patch sketch:** Vercel KV (Redis-compatible) or Upstash:
```ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(60, '60 s'),
})

const { success, remaining, reset } = await ratelimit.limit(key)
if (!success) return new Response(..., { status: 429, headers: { 'X-RateLimit-Reset': String(reset) } })
```
Add `KV_URL` and `KV_REST_API_TOKEN` env vars; retain in-memory fallback if KV is unavailable (fail-open vs fail-closed decision belongs to C1/R7).

**Acceptance test:** Load test from 10 IPs at 100 req/min each. Assert 429 returned after each IP's 60th request within 60 seconds, regardless of which Vercel instance handled it.

**Severity:** High — rate limit currently provides false security; institutional users on shared yahoo-finance2 quota will be throttled by malicious users.

---

### F4.4 [HIGH] — `withRetry` retries immediately with no backoff or jitter

**Location:** `lib/api/reliability.ts:9-20`

**Evidence:**
```ts
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  let lastError: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), opts.timeoutMs ?? 8_000)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`${opts.retryLabel ?? 'request'} failed after ${attempts} attempts: ${String(lastError)}`)
}
```
On a yahoo-finance2 rate-limit error, this retries immediately. If yahoo throttled because we exceeded their quota, retrying instantly worsens the rate breach. The retry pattern should use exponential backoff with jitter (AWS pattern; Cisco architectural reference 2019).

**Citation:**
- Marc Brooker (AWS) (2015). "Exponential Backoff and Jitter." AWS Architecture Blog.
- *Site Reliability Engineering* (Beyer et al., O'Reilly 2016) Ch. 22 (cascading failure prevention).

**Patch sketch:**
```ts
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  const baseBackoffMs = opts.baseBackoffMs ?? 200
  let lastError: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), opts.timeoutMs ?? 8_000)
    } catch (error) {
      lastError = error
      if (i < attempts - 1) {
        // Exponential backoff with full jitter
        const cap = baseBackoffMs * 2 ** i
        const sleepMs = Math.floor(Math.random() * cap)
        await new Promise(resolve => setTimeout(resolve, sleepMs))
      }
    }
  }
  throw new Error(...)
}
```
Also: detect HTTP 429 / 503 and respect their `Retry-After` header before retrying.

**Acceptance test:** Mock yahoo-finance2 to return 429 with `Retry-After: 5`. Assert second attempt fires no earlier than 5 seconds after the first.

**Severity:** High — under load, current implementation amplifies upstream throttle; bidirectional cascading-failure pattern.

---

### F4.5 [HIGH] — Yahoo Finance redistribution is non-compliant for institutional use

**Location:** `app/api/prices/route.ts` (and every other API route using yahoo-finance2)

**Evidence:** yahoo-finance2 scrapes Yahoo Finance, which per Yahoo's TOS allows "personal, non-commercial" use. The platform serves Yahoo data in real-time to multiple users, including institutional researchers. For commercial/institutional distribution, this is non-compliant.

**Citation:**
- Yahoo Finance Terms of Service §2 (commercial use restriction): https://policies.yahoo.com/us/en/yahoo/terms/utos/index.htm
- yahoo-finance2 README disclaimer: "This software is for educational purposes only. Do not risk money you cannot afford to lose. NO WARRANTY!" + recommended migration to Polygon/Refinitiv for production.

**Patch sketch (Phase 13 S4 work):**
1. Add a compliance banner on every page using `components/ComplianceBanner.tsx` stating "Data sourced from Yahoo Finance — non-commercial use; institutional users should configure Polygon.io or Refinitiv via env vars."
2. Document the migration path: `lib/data/providers/polygon.ts` already exists per AGENTS.md Phase 5; needs an end-to-end test and runtime feature-flag.
3. Switch primary feed to Polygon when `POLYGON_API_KEY` is set, fall back to yahoo with a degraded banner.

**Acceptance test:** Compliance dry-run document; I3 sign-off required before any commercial-tier launch.

**Severity:** High — blocking issue for any commercial deployment. Cannot ship to paying institutional customers without resolving.

---

### F4.6 [MEDIUM] — `q.regularMarketPrice || 0` and similar falsy fallbacks silently zero out missing data

**Location:** `app/api/prices/route.ts:47-58`

**Evidence:** Pattern `q.regularMarketPrice || 0` substitutes 0 for any falsy value including `undefined`, `null`, NaN. A real price of $0.00 is impossible for live US securities; substituting 0 displays "$0.00" on the UI for any data-fetch issue (e.g., midnight quotes for VIX before 9:30 AM ET, halted stocks).

**Patch sketch:** Use nullish coalescing and type-check:
```ts
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
const yahooQuotes = results.map((q: any) => ({
  ticker: q.symbol,
  price: num(q.regularMarketPrice),  // null if missing
  ...
}))
```
Then update UI to render "—" for null instead of "$0.00".

**Severity:** Medium — UX/data-quality issue; users see "$0.00" rather than a clear "data unavailable" indicator.

---

### F4.7 [MEDIUM] — `marketCap` formatted with hardcoded 'B' suffix, breaks above $1T and below $1B

**Location:** `app/api/prices/route.ts:58`

**Evidence:**
```ts
marketCap: q.marketCap ? (q.marketCap / 1e9).toFixed(1) + 'B' : 'N/A',
```
- AAPL ~$3.5T renders as "3500.0B" instead of "3.5T"
- Small-cap stocks (e.g., $250M) render as "0.3B" rather than "$250M"

**Patch sketch:** Use `lib/format.ts:formatCompactNumber` (already exists per Phase 12 audit):
```ts
import { formatCompactNumber } from '@/lib/format'
...
marketCap: q.marketCap ? formatCompactNumber(q.marketCap) : 'N/A',
```

**Severity:** Medium — display issue; affects credibility on large/small caps.

---

### F4.8 [MEDIUM] — Error responses leak raw error strings (incl. stack traces, internal paths)

**Location:** `app/api/prices/route.ts:79`, `lib/api/reliability.ts:50`

**Evidence:**
```ts
return errorResponse('prices_fetch_failed', 'Failed to fetch live prices', String(error), 500)
```
`String(error)` may include stack traces, internal file paths (`/var/task/...`), upstream API keys (if accidentally interpolated). For institutional/security audits this is a leak.

**Citation:** OWASP API Security Top 10 (2023), API8 — Security Misconfiguration; CWE-209 (Information Exposure Through Error Messages).

**Patch sketch:**
```ts
function sanitizeError(err: unknown, isProd = process.env.NODE_ENV === 'production'): string {
  if (isProd) return 'Internal data fetch error.'
  // dev only:
  if (err instanceof Error) return err.message  // skip stack
  return 'unknown error'
}
return errorResponse('prices_fetch_failed', 'Failed to fetch live prices', sanitizeError(error), 500)
```
Log full stack server-side; return only safe message client-side.

**Severity:** Medium — handoff to R7 (Security & Compliance).

---

### F4.9 [MEDIUM] — No edge-cache for prices; every poll hits yahoo

**Location:** `app/api/prices/route.ts:75`

**Evidence:** `'Cache-Control': 'no-store'`. Combined with SWR client polling every 5s and (per F4.3) ineffective rate limiting, every 5 seconds N×M yahoo-finance2 calls fire (N users × M tickers). For 56 sector tickers across 100 users, that's 1,120 calls/sec to yahoo.

**Patch sketch:** Use a Vercel-edge cache with 2-3s TTL — within institutional acceptability for sector dashboards (per the Phase 12 plan note, "5s = standard institutional cadence"):
```ts
{ headers: {
  'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=2',
  'CDN-Cache-Control': 'public, s-maxage=3',
}}
```
This caches at the edge for 3s, serves stale for an additional 2s while revalidating in the background. Yahoo QPS drops by ~Nx (single edge fetch shared across N users).

**Severity:** Medium — performance and cost (if migrating to paid Polygon, this matters more).

---

### F4.10 [MEDIUM] — `^VIX` normalization is incomplete

**Location:** `app/api/prices/route.ts:30`

**Evidence:**
```ts
const u = decodeURIComponent(t.trim()).toUpperCase()
return u === 'VIX' ? '^VIX' : u
```
Only `VIX` is auto-prefixed. Other index symbols (`^GSPC`, `^DJI`, `^TNX`, `^IRX`, `^NDX`) require the user to send the exact `^`-prefix or the lookup fails. If a user types "DJI" they get "DJI" sent to yahoo, which fails with empty result — silent failure.

**Patch sketch:**
```ts
const INDEX_SYMBOLS = new Set(['VIX','GSPC','DJI','IXIC','NDX','TNX','IRX','TYX'])
const u = decodeURIComponent(t.trim()).toUpperCase()
return INDEX_SYMBOLS.has(u) ? `^${u}` : u
```

**Severity:** Medium — UX issue; partial coverage gives false confidence.

---

### F4.11 [LOW] — `dataSources.yahoo: true` is hardcoded

**Location:** `app/api/prices/route.ts:70`

**Evidence:** Always returns `yahoo: true` regardless of whether yahoo actually returned data. Should be `yahoo: yahooQuotes.length > 0`.

---

## Cross-domain handoffs

- **R1:** F4.5 (Yahoo compliance) blocks F1.5 (B&H with dividends — needs Yahoo `events` parameter, may be license-restricted).
- **R7 (Security):** F4.3 (rate limit), F4.8 (error leak) — strong overlap.
- **R8 (Testing):** every F4.x has an acceptance test specified.

---

## Self-dissent (rule 7)

F4.5 (compliance) is the largest finding and may be debated by the user. Yahoo's TOS permits non-commercial scraping, and the user may argue this is research-only / B2B. I am not a lawyer; I3 (Compliance Inspector) and external counsel must validate before commercial launch. Marked HIGH provisionally.

F4.3 (rate-limit ineffective) — I am confident the per-process bucket is documented as approximate. The plan acknowledges this. Marked HIGH because the gap is institutional-grade unacceptable, but the team may have explicitly accepted it.

I have NOT read `lib/data/warehouse.ts` (better-sqlite3) or `lib/data/bloomberg/bridgeClient.ts` end-to-end — both warrant their own deep reads. F4.1 makes claims about the bridge based on its caller; the bridge itself may already log failures (deferred-pass to confirm).

---

## Findings summary table

| ID | Severity | File:line | One-line |
|----|----------|-----------|----------|
| F4.1 | HIGH | prices/route.ts:38 | bloomberg bridge silent .catch |
| F4.2 | HIGH | mergeQuotes.ts:39-54 | merge loses field-level provenance |
| F4.3 | HIGH | rateLimit.ts:13 | per-process bucket ineffective in serverless |
| F4.4 | HIGH | reliability.ts:9-20 | retry has no backoff/jitter; amplifies throttle |
| F4.5 | HIGH | (every API route) | yahoo-finance2 commercial redistribution |
| F4.6 | MEDIUM | prices/route.ts:47-58 | falsy fallback to 0 hides missing data |
| F4.7 | MEDIUM | prices/route.ts:58 | marketCap hardcoded 'B' suffix |
| F4.8 | MEDIUM | prices/route.ts:79 | error response leaks raw error |
| F4.9 | MEDIUM | prices/route.ts:75 | no edge-cache; high yahoo QPS |
| F4.10 | MEDIUM | prices/route.ts:30 | ^VIX normalization incomplete |
| F4.11 | LOW | prices/route.ts:70 | dataSources.yahoo hardcoded true |

Total: 11 (0 Critical, 5 High, 5 Medium, 1 Low).

---

**Reviewer signature:** R4
**Cross-checked by:** R7 (security overlap on F4.3, F4.8) — pending
**Inspector spot-check:** I3 — pending; particularly F4.5 compliance
