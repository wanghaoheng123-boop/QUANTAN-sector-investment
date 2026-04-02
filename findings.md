# QUANTAN v2.0 — Commercial Review Round 2 Findings

## Executive Summary

This document consolidates findings from a comprehensive multi-disciplinary review covering **API security**, **authentication architecture**, **quantitative correctness** (previously completed), **UI/UX quality**, and **operational concerns**. All P0/P1 bugs from the first round have been fixed. This round identifies remaining issues that must be addressed before commercial launch.

---

## CRITICAL Issues (Must Fix Before Launch)

### API Security

#### C1: ALL API Routes Are Public — No Authentication
Every single API route in the application is unauthenticated:
- `/api/backtest` — exposes institutional-grade strategy results and backtest performance
- `/api/trading-agents/[ticker]` — exposes LLM agent analysis and trading signals
- `/api/ma-deviation` — exposes proprietary regime classification data
- `/api/bloomberg-bridge/health` — exposes internal infrastructure
- `/api/backtest/live` — exposes live regime signals for all 56 instruments

**Impact:** Any user on the internet can access all data without authentication. A competitor could scrape all backtest results, trading signals, and regime data.

**Fix:** Add a simple bearer token check to all API routes:
```typescript
// In each route:
const authHeader = request.headers.get('authorization')
if (authHeader !== `Bearer ${process.env.API_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

---

#### C2: POST /api/backtest Has No Auth — Enables DoS Attack
Anyone can POST to `/api/backtest` to:
1. Clear the 1-hour cache
2. Force a full recompute of 56 backtest instruments (expensive CPU operation)

**Impact:** An attacker can repeatedly POST to force constant recomputation, causing CPU exhaustion and potential billing spike on Vercel.

**Fix:** Require API_SECRET bearer token on POST requests.

---

#### C3: In-Memory Caches Are Serverless-Incompatible
- `_chartCache` in `/api/chart/[ticker]` — module-level, non-durable
- `cache` in `/api/backtest` — module-level, non-durable
- 1-hour TTL only works within a single warm Lambda/container

On Vercel serverless, each cold start gets a fresh process. Cached data is lost on cold start. This causes:
- First user after cold start gets uncached (expensive) response
- Multiple concurrent cold starts each recompute independently
- Cache poisoning risk when warm instances coexist with cold ones

**Fix:** Use Vercel KV (`@vercel/kv`) or Redis for durable caching:
```typescript
import { kv } from '@vercel/kv'
const cached = await kv.get('backtest:full')
if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
```

---

#### C4: Ticker Input Validation Missing on All API Routes
`/api/prices`, `/api/backtest`, `/api/chart/[ticker]`, `/api/darkpool/[ticker]` all accept ticker parameters without validation.

Example attack on `/api/backtest?tickers=AAPL,BTC,XYZ`:
- Invalid tickers cause `loadStockHistory()` to return empty arrays
- Empty arrays still go through the full backtest engine
- With enough unique invalid tickers, this causes memory pressure

**Fix:** Strict allowlist validation:
```typescript
const VALID_TICKER = /^[A-Z.^]{1,10}$/
for (const t of tickers) {
  if (!VALID_TICKER.test(t)) throw new Error('Invalid ticker')
}
```

---

#### C5: Bloomberg Bridge Secret Is Optional — Allows Unauthenticated Access
If `BLOOMBERG_BRIDGE_SECRET` is set but the bridge server doesn't validate it, anyone can query the bridge.

**Fix:** Require the secret to be set and validate it on every request to the bridge:
```typescript
if (!process.env.BLOOMBERG_BRIDGE_SECRET) {
  throw new Error('BLOOMBERG_BRIDGE_SECRET not configured')
}
```

---

#### C6: Raw Error Messages Sent to Clients on All API Routes
Both `/api/backtest` and `/api/prices` forward raw error messages to clients:
```typescript
return NextResponse.json({ error: '...', message: e instanceof Error ? e.message : String(e) })
```
This can expose internal paths, library names, and infrastructure details.

**Fix:** Log errors server-side, return sanitized message to client:
```typescript
console.error('[api/backtest] error:', e) // Full details server-side
return NextResponse.json({ error: 'Backtest computation failed' }, { status: 500 })
```

---

### Authentication Architecture

#### C7: No Middleware — All Routes Are Public by Default
No `middleware.ts` exists. This means:
- No route-level authentication enforcement
- No way to protect specific pages
- Auth is opt-in per page (not enforced)

If you want a commercial product where some features require login (e.g., saved watchlists, personalized alerts), you need route protection.

**Fix:** Create `middleware.ts`:
```typescript
export function middleware(request: NextRequest) {
  const token = request.cookies.get('next-auth.session-token')
  // Protect routes that require auth
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!token) return NextResponse.redirect('/auth/signin')
  }
}
```

---

#### C8: NEXTAUTH_SECRET Fallback Is a Security Anti-Pattern
```typescript
return process.env.NEXTAUTH_SECRET ?? 'NOT-CONFIGURED-BUILD-TIME-PLACEHOLDER'
```
If `NEXTAUTH_SECRET` is not set, JWT tokens are signed with a **publicly known placeholder string**. If NextAuth has any vulnerability related to token verification, this secret would be trivial to exploit.

**Fix:** Fail the build if `NEXTAUTH_SECRET` is not set in production:
```typescript
if (!process.env.NEXTAUTH_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('NEXTAUTH_SECRET must be set in production')
}
```

---

#### C9: Shared Guest Watchlist Key
All unauthenticated users share the same `ag-watchlist-guest` LocalStorage key. Actions by one guest affect what another guest sees.

**Fix:** Generate a random guest ID per browser session:
```typescript
const GUEST_KEY = `ag-watchlist-guest-${sessionStorage.getItem('guestId') ?? uuid()}`
// Store guestId on first visit
if (!sessionStorage.getItem('guestId')) sessionStorage.setItem('guestId', uuid())
```

---

### Quantitative / Data

#### C10: Yahoo Finance API Has No Rate Limiting
`/api/prices` and `/api/chart/[ticker]` make unthrottled calls to Yahoo Finance public APIs. Yahoo's terms of service prohibit abuse, and they may rate-limit or IP-ban the server.

**Fix:** Implement per-minute rate limiting using `@upstash/ratelimit`:
```typescript
import { Ratelimit } from '@upstash/ratelimit'
const ratelimit = new Ratelimit({ redis: kv, limiter: Ratelimit.slidingWindow(30, '1 m') })
const { success } = await ratelimit.limit(ip)
if (!success) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
```

---

## HIGH Priority Issues

### UX / UI

#### H1: Missing robots.txt and sitemap.xml
No SEO infrastructure exists. For a commercial product that users might discover via search, this is essential.

**Fix:** Create `app/robots.txt` and `app/sitemap.xml`.

---

#### H2: Compliance Banner Not Persistent
`ComplianceBanner` is shown on every page load. Once dismissed, the user sees it again on every navigation. This is annoying and reduces trust.

**Fix:** Store dismissed state in LocalStorage:
```typescript
const [dismissed, setDismissed] = useState(
  () => typeof window !== 'undefined' && localStorage.getItem('complianceDismissed')
)
```

---

#### H3: KLineChart Has No Error Boundary
`KLineChart` is dynamically imported with `ssr: false`, but only the BTC chart has `CryptoChartBoundary`. The sector chart (`/sector/[slug]`) has no error boundary — a chart crash would bring down the entire page.

**Fix:** Wrap the sector chart in an error boundary:
```typescript
<ErrorBoundary fallback={<ChartFallback ticker={ticker} />}>
  <Suspense fallback={<ChartSkeleton />}>
    <KLineChart ... />
  </Suspense>
</ErrorBoundary>
```

---

#### H4: Backtest Data Not Refreshed Automatically
`scripts/backtestData/` contains pre-fetched JSON files. These become stale over time. There's no mechanism to refresh them on a schedule.

**Fix:** Add a Vercel Cron job to refresh data weekly:
```json
// vercel.json
{ "crons": [{ "path": "/api/backtest", "schedule": "0 2 * * 0" }] }
```

---

#### H5: Bloomberg Bridge Has No Timeout
`fetchBloombergQuotesViaBridge()` in `lib/data/bloomberg/bridgeClient.ts` has no timeout. If the bridge is unreachable, the request hangs indefinitely.

**Fix:** Add a 3-second timeout:
```typescript
const controller = new AbortController()
setTimeout(() => controller.abort(), 3000)
const res = await fetch(url, { signal: controller.signal, ... })
```

---

## MEDIUM Priority Issues

### API / Data

#### M1: Yahoo Finance Response Typed as `any[]`
`yahooFinance.quote(tickers) as Promise<any[]>` — if Yahoo changes their API response format, the app silently breaks or returns garbage.

**Fix:** Validate the response with Zod:
```typescript
const quoteSchema = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number().nullable(),
  regularMarketChange: z.number().nullable(),
  // ... other fields
})
const results = quoteSchema.array().parse(rawResults)
```

---

#### M2: Bloomberg Bridge Failure Is Silent
When the Bloomberg bridge returns an error, the response says `dataSources.bloombergBridge = false` with no indication that Bloomberg *should* be connected. Operators may not notice the bridge is down.

**Fix:** Add a `status` field to `dataSources`:
```typescript
dataSources: {
  yahoo: true,
  bloombergBridge: bbMap !== null,
  bloombergBridgeStatus: bbMap ? 'connected' : 'disconnected'
}
```

---

#### M3: No Pagination on Live Signals Table
`LiveSignalsPanel` renders up to 200 rows. For 56 instruments this is fine now, but limits future scalability.

---

#### M4: `slopePct` Display Bug (Already Found)
```tsx
{(inst.slopePct * 100).toFixed(4)}  // slopePct is already in decimal (0.00087)
```
Should be `(inst.slopePct * 100).toFixed(4)` — this is correct.

Wait, slopePct is stored as a fraction (0.00087 = 0.087%), so multiplying by 100 gives 0.087%. But the UI shows 0.0087% — let me recheck.

Actually looking at `signals.ts`:
```typescript
slopePct: slope  // raw numeric slope: e.g. 0.00087 = +0.087%/bar
```
This is the slope as a decimal fraction (0.00087 = 0.087%). The display code:
```tsx
{(inst.slopePct as number * 100).toFixed(4)}
```
This shows `0.0087` (4 decimal places = 0.0087%). The actual value `0.00087` would be displayed as `0.0087%` which is correct for "0.087%/bar" — but the precision might be confusing. Not a bug, just unclear formatting.

---

#### M5: `watchlistButton` Uses Untyped Props
`WatchlistButton` spreads props onto a `button` element without formal TypeScript typing, potentially accepting arbitrary HTML attributes without validation.

---

### UX / UI

#### M6: No Loading State on Desk Page Refresh Buttons
`app/desk/page.tsx` has refresh buttons but no loading indicator while fetching.

---

#### M7: No Empty State Design on Briefs Page
If `BRIEFS` is empty or the external API fails, no friendly empty state is shown.

---

#### M8: PWA Icons Are Generic
The app icon (`icon-192x192.png`, `icon-512x512.png`) appears to be a generic placeholder. For a commercial product, a distinctive branded icon is needed.

---

## Already Fixed (Confirmations)

| Issue | Status | Notes |
|-------|--------|-------|
| Sortino denominator bug | FIXED | Now divides by N, not neg.length |
| Same-day execution | FIXED | Executes at next-day open + 2bps slippage |
| TX cost double-counting | FIXED | Clarified 11bps per side |
| technicals.ts ATR Wilder | FIXED | Now uses Wilder smoothing |
| technicals.ts RSI Wilder | FIXED | Now uses Wilder smoothing |
| Portfolio aggregation | FIXED | Uses combined equity curve |
| Trailing stop ATR | FIXED | Uses entry ATR |
| ATR stop floor 5%→3% | FIXED | Better for low-vol instruments |
| Sortino/Sortino MAR consistency | FIXED | Both use 4% rf |

---

## Commercial Launch Checklist

### Must Have (P0)
- [ ] Add API_SECRET bearer token to all sensitive API routes
- [ ] Add rate limiting to Yahoo Finance API calls
- [ ] Replace in-memory cache with Vercel KV / Redis
- [ ] Add ticker input validation (strict regex allowlist)
- [ ] Sanitize all error messages before sending to client
- [ ] Set NEXTAUTH_SECRET in all environments (fail build if missing)
- [ ] Add middleware.ts for route protection
- [ ] Fix Bloomberg bridge secret enforcement
- [ ] Add timeout to Bloomberg bridge fetch

### Should Have (P1)
- [ ] Add robots.txt and sitemap.xml
- [ ] Make compliance banner persistent (localStorage)
- [ ] Add error boundary around KLineChart on sector pages
- [ ] Set up Vercel Cron for backtest data refresh
- [ ] Validate Yahoo Finance responses with Zod
- [ ] Add bloombergBridgeStatus to dataSources response
- [ ] Generate unique guestId per browser session

### Nice to Have (P2)
- [ ] Add pagination to live signals table
- [ ] Loading states on desk refresh buttons
- [ ] Empty state design on briefs page
- [ ] Branded PWA icons
- [ ] Add SWR for client-side data fetching/caching
- [ ] Add dark/light mode toggle
