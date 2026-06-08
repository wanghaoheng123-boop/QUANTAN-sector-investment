# Data / Provider Layer Review — 2026-06-04

Reviewer: senior backend/data engineer
Scope: lib/data/**, provider adapters, backtest dataLoader, caching layers, freshness/staleness, number normalization
Branch reviewed: chore/master-coverage-2026-06-03

---

## Severity Key
- **P0** — wrong-data / injection / privacy leak (must fix before next prod deploy)
- **P1** — resilience, staleness, race conditions (fix within a sprint)
- **P2** — code-quality / hardening (fix when touching the file)

---

## P0 Findings

### P0-1 — OKX liquidation error body leaks raw upstream text in HTTP-error path
**File:** `app/api/crypto/btc/liquidations/route.ts:60`
**Diagnosis:**
When OKX returns a non-2xx response, the route slices the raw response body (`text.slice(0, 200)`) and sends it directly as the `error` field of the JSON response (status 200). This is a CWE-209 information exposure: OKX error responses can contain internal server messages, upstream IP addresses, or error codes that fingerprint the infrastructure.
```ts
error: text.slice(0, 200),  // line 60 — raw upstream text reaches the wire
```
The `catch` block at line 132 was already fixed (uses `sanitizeError`), but this non-2xx HTTP branch is NOT sanitized.
**Fix:** Replace `error: text.slice(0, 200)` with `userMessage` only, or route through `sanitizeError`. Do not include raw upstream body text in production responses.

---

## P1 Findings

### P1-1 — Module-level `_cache` in liquidations and metrics routes: not scoped per request, NOT reset across serverless warm starts; cold-start race
**Files:**
- `app/api/crypto/btc/liquidations/route.ts:9-10`
- `app/api/crypto/btc/metrics/route.ts:9-10`

**Diagnosis:**
Both routes use a module-level `let _cache: { data: ...; expiresAt: number } | null = null`. In Next.js serverless/edge deployments each instance has its own module scope, so this is process-local — fine for CDN-side caching but it creates a subtle **stale-on-warm-start race**: the very first request after a warm serverless container restarts gets `_cache = null` and hits OKX/Bybit; simultaneous requests before the first write completes will also all miss the cache and each fire their own upstream call. With 30-req/min rate limit across 10 concurrent warm invocations this is benign, but worth noting.

More importantly: `_cache` is never reset on error — if a successful response is cached and OKX subsequently starts returning error data, the stale success will be served until TTL expires. But the bigger issue is that the `metrics` route at line 141 only caches when `t` (Bybit tickers) is present AND at least one of `fundingRate`/`openInterest` is non-null:
```ts
if (t && (fundingRate != null || openInterest != null)) {
  _cache = { data: result, expiresAt: now + CACHE_TTL_MS }
}
```
This means a *partial* response where `openInterest=null` and `fundingRate=null` is served uncached indefinitely — each client poll fires a fresh upstream request. Under rate limiting this is unlikely to cascade, but under the current 30/min cap with many users it could exhaust the budget.

**Fix:** Either always cache (including partial) with a shorter TTL, or document the non-cache condition explicitly.

### P1-2 — Polygon timestamp epoch unit ambiguity: `r.t` is milliseconds but divided by 1_000_000
**File:** `lib/data/providers/polygon.ts:69`
**Diagnosis:**
In `fetchQuote`, the last trade timestamp `t` from Polygon is in **nanoseconds** per the Polygon API docs (the `v2/last/trade` endpoint's `t` field is Unix nanoseconds). The code divides by `1_000_000`:
```ts
updatedAt: new Date(data.results.t / 1_000_000).toISOString(),
```
`t / 1_000_000` converts nanoseconds → milliseconds, which is correct for `new Date(ms)`. However in `fetchDaily`, the aggregate bar timestamp `r.t` is in **milliseconds** (Polygon aggregate API uses ms). The code does:
```ts
date: new Date(r.t).toISOString().slice(0, 10),
```
This is correct for aggregates. These two different treatment paths are not documented. If Polygon changes the `v2/last/trade` endpoint to return ms (as some newer v3 endpoints do), this will produce dates ~1000 years in the future (2970 AD) silently, because `new Date(ns)` returns a valid-but-wrong date with no error.

**Fix:** Add an explicit comment at each usage documenting the expected unit. Add a sanity check: if the computed date is more than 1 day in the future or more than 5 years in the past, warn and fall back to `new Date().toISOString()`.

### P1-3 — AlphaVantage `fetchDaily` has no timeout; all fetch calls in alphavantage.ts are unguarded
**File:** `lib/data/providers/alphavantage.ts:27,62`
**Diagnosis:**
Both `fetchDaily` (line 27) and `fetchQuote` (line 62) call `fetch(url)` with no `signal: AbortSignal.timeout(...)`, no `withRetry`, no timeout wrapper of any kind. Alpha Vantage is a third-party API with highly variable latency. A single hung request will hold the Next.js serverless function open until the platform's max execution timeout (typically 10–60s), blocking a worker and potentially causing downstream timeouts for the calling route.

By contrast, Yahoo (via `withRetry` in route handlers), Bloomberg bridge (line 82 in bridgeClient.ts), Polygon (uses `rateLimitedFetch` but also no timeout there — see below), and all crypto routes use explicit `AbortSignal.timeout` or `withRetry`.

**Fix:** Add `signal: AbortSignal.timeout(8000)` to both `fetch` calls in alphavantage.ts.

### P1-4 — Polygon `rateLimitedFetch` also has no timeout
**File:** `lib/data/providers/polygon.ts:16-21`
**Diagnosis:**
```ts
async function rateLimitedFetch(url: string, apiKey: string): Promise<Response> {
  // ... rate limiting delay ...
  return fetch(`${url}...`)  // no signal/timeout
}
```
Same class of issue as P1-3: no AbortSignal. Polygon's public endpoints occasionally stall (GCP load balancer 504 events). A stalled `fetch` will hold the serverless worker indefinitely.

**Fix:** Add `signal: AbortSignal.timeout(10_000)` to the `fetch` call.

### P1-5 — FRED `_fetchViaCsv` and `_fetchViaApi` have no timeout
**File:** `lib/data/providers/fred.ts:67,85`
**Diagnosis:**
Both `_fetchViaCsv` and `_fetchViaApi` call `fetch(url)` / `fetch(url)` with no timeout signal. FRED's CSV endpoint and API endpoint are external; during FRED maintenance windows or network blips these hang silently.

**Fix:** Add `signal: AbortSignal.timeout(12_000)` to each `fetch` call.

### P1-6 — `riskFreeRate.ts` FRED fetch uses Next.js `next: { revalidate: 86400 }` cache hint without a timeout
**File:** `lib/quant/riskFreeRate.ts:70`
**Diagnosis:**
```ts
const res = await fetch(url, { next: { revalidate: 86400 } } as RequestInit)
```
The `next.revalidate` hint is a Next.js-specific ISR caching directive — it only works inside a Server Component or Route Handler render context. In worker threads, scripts, or test environments it is silently ignored. More importantly: no `AbortSignal.timeout` is set. A hung FRED fetch here blocks the options pricing path (which calls `getRiskFreeRate` at startup) for up to the platform's process timeout.

Additionally, this function directly constructs the FRED URL string:
```ts
const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${from.toISOString().slice(0, 10)}`
```
`seriesId` originates from the internal `SERIES_BY_TENOR` constant (hardcoded safe strings), so no injection risk here. But the lack of input validation means future callers using `getRiskFreeRate` with a custom series ID would be unguarded.

**Fix:** Add `signal: AbortSignal.timeout(8_000)` to the fetch. Validate `seriesId` format (alphanumeric only) before embedding in URL.

### P1-7 — `chart/[ticker]/route.ts` cache key does not include the `interval` parameter, only `range`
**File:** `app/api/chart/[ticker]/route.ts:52`
**Diagnosis:**
```ts
const cacheKey = `${ticker}:${range}`
```
The `interval` variable is derived from the `range` switch-case but is set differently for ranges that produce the same key (e.g., `'4H'` range uses `interval = '1h'`, and `'1H'` range also uses `interval = '1h'`). Since the cache key uses only `range`, not `interval`, there is no collision here for the current code. However, the `range` → `interval` mapping is non-injective in some cases and could produce wrong-interval data if the mapping is ever revised.

The bigger concern is: the cache stores `range` and `interval` in the value but uses only `ticker:range` as the key. If the default interval for a range is changed in code, the new interval won't take effect until the 30-second TTL expires — a silent wrong-data window. This is minor but worth noting.

**Fix:** Include `interval` in the cache key: `${ticker}:${range}:${interval}`.

### P1-8 — `normalizedChangePercent` heuristic-based decimal-vs-percent detection can misclassify
**File:** `lib/yahooQuoteFields.ts:14-18`
**Diagnosis:**
```ts
if (Math.abs(r) < 0.5 && Math.abs(implied) > 1.5) return implied
if (Math.abs(r) >= 0.5 || Math.abs(implied) < 0.01) return r
return Math.abs(r) < 1 && Math.abs(implied) > 5 ? implied : r
```
This heuristic assumes that if `|raw| < 0.5` the value is a decimal (0.016 = 1.6%), and `|raw| >= 0.5` is a percent (1.6). But a stock with a genuine intraday move of 0.3% (raw=0.3, implied=0.3) would pass the `Math.abs(r) >= 0.5` false branch and return `r=0.3` correctly. However a stock with a genuine 0.2% move after hours, where Yahoo returns `0.2` as a percent, would fall into the `Math.abs(r) < 0.5 && Math.abs(implied) > 1.5` branch only if the implied is also > 1.5 — which it wouldn't be for a 0.2% move. So the heuristic largely works except for the ambiguous zone 0.01 < |r| < 0.5.

**The real bug**: When `raw` is in the decimal form `0.003` (0.3% move) and `implied` is also `0.3`, the condition `Math.abs(r) < 0.5 && Math.abs(implied) > 1.5` is false (implied ~0.3 < 1.5), so it falls to `Math.abs(r) >= 0.5` which is also false (r=0.003 < 0.5), so it reaches the last branch: `Math.abs(r) < 1 && Math.abs(implied) > 5` → also false → returns `r = 0.003`. This would display as `0.003%` instead of `0.3%`, causing UI to show near-zero change for small percentage moves in Yahoo's decimal format.

**Fix:** Standardize on a single representation by checking if `|raw| < 0.1` and `|implied| is in [0.01, 50]` as the disambiguation threshold. Or better: use the canonical `implied` computation consistently when both `change` and `price` are available.

---

## P2 Findings

### P2-1 — `lib/data/providers/index.ts` `fetchDailyWithFallback` has no logging when providers fail
**File:** `lib/data/providers/index.ts:27-40`
**Diagnosis:** The fallback chain silently swallows provider failures with no structured log. Operators cannot distinguish "Yahoo was tried and returned empty" from "Yahoo threw an exception that was caught internally". Both result in the next provider being tried. Compare to `fundamentals/route.ts` which added explicit `.catch()` diagnostic logging.
**Fix:** Log per-provider outcomes at the debug level: `provider.name`, result length, or caught error.

### P2-2 — `warehouse.ts` addIfMissing uses string interpolation in ALTER TABLE
**File:** `lib/data/warehouse.ts:91`
**Diagnosis:**
```ts
db.exec(`ALTER TABLE quotes ADD COLUMN ${name} ${decl}`)
```
The `name` and `decl` values come from hardcoded constants in `createSchema()` (always `'change_val'`, `'REAL NOT NULL DEFAULT 0'`, etc.) and are never user-supplied. There is **no SQL injection risk** in the current code. However the pattern is structurally identical to injectable code — a future developer adding a dynamic column name could inadvertently create a real injection point.
**Fix:** Replace with a static whitelist check or use parameterized DDL via a helper that validates column names against `[a-z_]+`.

### P2-3 — `lib/data/providers/yahoo.ts` `fetchDaily` swallows all errors silently
**File:** `lib/data/providers/yahoo.ts:46`
**Diagnosis:** The catch block is empty:
```ts
} catch {
  return null
}
```
No logging. Operators cannot tell whether Yahoo is returning malformed data, throwing rate-limit errors, or failing authentication. This is the same silent-swallow pattern flagged in prior reviews.
**Fix:** Log the error at `console.warn` with `sanitizeError(e)` to avoid CWE-209 in production while still surfacing the cause in dev.

### P2-4 — `lib/data/providers/yahoo.ts` `updatedAt` always set to `new Date().toISOString()` (wall-clock, not quote time)
**File:** `lib/data/providers/yahoo.ts:63`
**Diagnosis:**
```ts
updatedAt: new Date().toISOString(),
```
This is the **server's wall-clock time at the moment of the API call**, not Yahoo's actual quote time. For after-hours/pre-market quotes this can differ from the actual quote time by hours. The `QuoteSnapshot.updatedAt` field is used in `formatFreshness` to display "X minutes ago" — if the snapshot was fetched from the cache, the `updatedAt` reflects fetch time, not market data time. This means freshness indicators are actually measuring "time since last server fetch" rather than "time since market data was produced".

Yahoo's `regularMarketTime` is the actual quote time and is available in the quote response. The `isoQuoteTime` helper in `prices/route.ts` already extracts it correctly.
**Fix:** Use `parseQuoteTime(q.regularMarketTime) ?? new Date().toISOString()` for `updatedAt` in `YahooProvider.fetchQuote`.

### P2-5 — `mergQuotes.ts` Bloomberg-only branch still emits `provenance.volume = 'bloomberg'` even when `bb.volume = 0`
**File:** `lib/data/mergeQuotes.ts:167-178`
**Diagnosis:**
In the Bloomberg-only branch (ticker not in Yahoo), the warning is emitted but provenance is still uniformly set to `'bloomberg'` for all fields — including `volume`, `high52w`, `low52w`, `pe`. The warning says "audit code may be misled" but the provenance object contradicts it by still claiming Bloomberg. This is the exact inconsistency the warning is about.

The dual-source branch (lines 106-116) correctly marks `volume: bb.volume ? 'bloomberg' : 'yahoo'`. The Bloomberg-only branch cannot fall back to Yahoo (no Yahoo row), so there is no data fix available — but the provenance should reflect `'bloomberg (sentinel)'` or use `null` to signal unreliability rather than `'bloomberg'`.
**Fix:** Add a sentinel marker: `volume: bb.volume ? 'bloomberg' : 'bloomberg_sentinel'` (requires `QuoteProvenance` type extension) or use `null | FieldSource`.

### P2-6 — `sortChartCandles.ts` dedupe strategy "last row wins" may silently prefer stale data in merge scenarios
**File:** `lib/sortChartCandles.ts:53-57`
**Diagnosis:**
When two rows share the same timestamp, the last one wins:
```ts
if (lastKey !== null && key === lastKey) {
  out[out.length - 1] = row
}
```
In `normalizeBtcCandles.ts`, the input array is constructed by mapping raw rows in-order. If multiple sources (CoinGecko + Kraken fallback) were merged before calling `normalizeBtcCandles`, the last source's bar would silently overwrite the first. This is the intended behavior, but there is no warning emitted when a dedupe occurs, making it invisible in logs.
**Fix:** Add a `DEBUG`-level log when a row is deduped so operators can detect source conflicts.

### P2-7 — `alphavantage.ts` `fetchQuote` does not validate parsed numbers for NaN before returning
**File:** `lib/data/providers/alphavantage.ts:68-71`
**Diagnosis:**
```ts
price: parseFloat(q['05. price']),
change: parseFloat(q['09. change'] ?? '0'),
changePct: parseFloat((q['10. change percent'] ?? '0%').replace('%', '')),
volume: parseInt(q['06. volume'] ?? '0', 10),
```
If Alpha Vantage returns `q['05. price'] = 'N/A'` (which it does for some tickers), `parseFloat('N/A')` returns `NaN`. Unlike Bloomberg's `num()` helper (which guards with `Number.isFinite`), these raw `parseFloat` / `parseInt` results flow directly into the `QuoteSnapshot` without any finite check. `NaN` in `price` then flows to `upsertQuote` in the warehouse (stored as NaN → SQLite stores as NULL which is at least safe), or flows into the quant layer.
**Fix:** Wrap each field with `parseFloat(x)` then check `Number.isFinite(result) ? result : 0`.

Similarly in `fetchDaily`:
```ts
open:   parseFloat(values['1. open']),
high:   parseFloat(values['2. high']),
...
```
If any OHLC field is `'N/A'` or missing, it becomes NaN and would pass through to `upsertCandles` — the warehouse does not validate OHLC for finiteness before storage. The `dataLoader.ts` D5-1 guard only applies when reading back from the warehouse, not on ingest. So NaN rows could be written to SQLite.

### P2-8 — `chartYahoo.ts` not reviewed (aggregateMinuteQuotesToN function)
**Note:** This file was referenced but not fully read. `aggregateMinuteQuotesToN` is called in `chart/[ticker]/route.ts:89` and produces OHLC aggregates from 1-minute Yahoo data. It should be reviewed for NaN handling during the aggregation process (min/max of NaN-containing arrays produce NaN). Flagged for follow-up.

---

## SQL Safety (Warehouse)

**Result: SAFE for all user-controlled inputs. One structural concern.**

All warehouse read/write operations use `better-sqlite3` **prepared statements** with parameterized placeholders (`?`):

- `getCandles`: `'SELECT ... WHERE ticker = ?'` — parameterized ✓
- `getCachedQuote`: `'SELECT ... WHERE ticker = ?'` — parameterized ✓
- `warehouseTickers`: no user input ✓
- `upsertCandles`: `INSERT OR REPLACE ... VALUES (?, ?, ?, ?, ?, ?, ?)` — parameterized ✓
- `upsertQuote`: `INSERT OR REPLACE ... VALUES (?, ?, ?, ?, ?, ?, ?)` — parameterized ✓
- `getMeta` / `setMeta`: `'SELECT ... WHERE key = ?'` / `INSERT ... VALUES (?, ?)` — parameterized ✓

The only string-interpolated SQL is in `createSchema` → `addIfMissing`:
```ts
db.exec(`ALTER TABLE quotes ADD COLUMN ${name} ${decl}`)
```
`name` and `decl` are **hardcoded constants** in `createSchema()`, never user-supplied. No injection risk today. See P2-2 for the structural recommendation.

**`lib/data/warehouse.ts` line 91: structurally-injectable DDL pattern, but hardcoded values only — no live injection risk.**

---

## Cache Correctness

| Cache | Location | TTL | Key Design | Error-caching? | Bounded? | Notes |
|---|---|---|---|---|---|---|
| `_chartCache` | `chart/[ticker]/route.ts:12` | 30s | `ticker:range` (not `interval`) | No | Yes (500 entries, evict-oldest) | Key missing `interval` — P1-7 |
| `_cache` (liquidations) | `btc/liquidations/route.ts:9` | 10s | module-level singleton | No | N/A (one slot) | Warm-start race — P1-1 |
| `_cache` (metrics) | `btc/metrics/route.ts:9` | 5s | module-level singleton | No | N/A (one slot) | Partial-response non-cache — P1-1 |
| RFR FRED cache | `riskFreeRate.ts:53` | 24h | `Map<seriesId, entry>` | No | Yes (4 series max) | Good; see P1-6 for timeout |
| Rate-limit buckets | `rateLimit.ts:9` | 15min stale, max 50k | `routeName:ip` | N/A | Yes (50k + evict-half) | Clean |

**No module-level cache stores error responses as success (good).**
**No unbounded Map growth risks found** (all Maps are bounded or purpose-limited).

---

## Number / NaN Integrity

| Path | Entry point | Guard? | Risk |
|---|---|---|---|
| Bloomberg bridge `num()` | `bridgeClient.ts:44-51` | Yes — `Number.isFinite` | Safe; fallback 0 |
| `lib/api/sanitize.ts` `num()` | SSOT | Yes — `Number.isFinite` | Safe |
| Yahoo `prices/route.ts` `num()` | Local copy, correct | Yes | Safe |
| AlphaVantage `fetchDaily` / `fetchQuote` | `alphavantage.ts:44-71` | **No** | NaN can enter warehouse — P2-7 |
| FRED CSV parse | `fred.ts:76` | `val?.trim() === '.'` guarded | Safe — returns `null` for missing |
| FRED API parse | `fred.ts:96` | `o.value === '.'` guarded | Safe |
| Polygon `fetchDaily` OHLC | `polygon.ts:48` | **No** — raw typed-as `number` from API | Trusts JSON type; safe if Polygon schema is consistent |
| Polygon `fetchQuote` price | `polygon.ts:63` | **No** — `data.results.p` | Trusts JSON; no NaN guard |
| `normalizedChangePercent` | `yahooQuoteFields.ts` | Partial — heuristic | Potential misclassification P1-8 |
| DataLoader warehouse path | `dataLoader.ts:62-74` | Yes — D5-1 `isFinite` guards | Safe on read |
| DataLoader JSON path | `dataLoader.ts:83-92` | Yes — D5-1 guards | Safe on read |
| Stochastic `calcStochastic` | `crypto.ts:127` | `hh === ll ? 50 : ...` | Safe for flatline |
| `formatFreshness` | `format.ts:52-62` | `isFinite(ts)` check | Safe |

---

## Freshness / Staleness

`formatFreshness` (`format.ts:55`) computes `Date.now() - ts` in milliseconds, then divides into seconds/minutes/hours. This is correct for wall-clock relative display. However:

1. **DST correctness**: JavaScript `Date.now()` returns UTC milliseconds; `new Date(iso).getTime()` also returns UTC ms. DST does not affect UTC-based arithmetic. No issue here.

2. **`updatedAt` semantics**: `YahooProvider.fetchQuote` sets `updatedAt = new Date().toISOString()` (server fetch time). When this quote snapshot is stored in the SQLite warehouse via `upsertQuote`, then later retrieved via `getCachedQuote`, the `updatedAt` field still reflects the **original fetch time** — correct and fresh-indicator-safe.

3. **Stale-while-revalidate (`SWR`) + CDN caching**: The `prices` route sets `s-maxage=3, stale-while-revalidate=5`. CDN may serve a 3-second-old quote as "live" to the browser. `formatFreshness` on a 3-second-old `fetchedAt` returns `'live'` (threshold < 30s). Consistent and correct.

4. **No `fetchedAt` propagation from BTC OHLC routes**: `btc/route.ts` returns no `fetchedAt` field. The candles array contains `time` (Unix seconds per bar). Browser freshness indicators have no server timestamp to base on. Minor — the `no-store` Cache-Control header means the browser always re-fetches, so the candles are always fresh.

---

## Files Inspected

| File | Lines |
|---|---|
| `lib/data/bloomberg/bridgeClient.ts` | 184 |
| `lib/data/mergeQuotes.ts` | 198 |
| `lib/data/warehouse.ts` | 242 |
| `lib/data/providers/yahoo.ts` | 72 |
| `lib/data/providers/polygon.ts` | 78 |
| `lib/data/providers/fred.ts` | 108 |
| `lib/data/providers/alphavantage.ts` | 82 |
| `lib/data/providers/types.ts` | 72 |
| `lib/data/providers/dispatcher.ts` | 44 |
| `lib/data/providers/index.ts` | 58 |
| `lib/backtest/dataLoader.ts` | 144 |
| `lib/api/reliability.ts` | 128 |
| `lib/api/sanitize.ts` | 87 |
| `lib/api/rateLimit.ts` | 132 |
| `lib/crypto.ts` | 255 |
| `lib/format.ts` | 131 |
| `lib/normalizeBtcCandles.ts` | 23 |
| `lib/sortChartCandles.ts` | 62 |
| `lib/darkpool.ts` | 34 |
| `lib/yahooQuoteFields.ts` | 22 |
| `lib/quant/riskFreeRate.ts` | 174 |
| `app/api/crypto/btc/route.ts` | 340 |
| `app/api/crypto/btc/liquidations/route.ts` | 156 |
| `app/api/crypto/btc/metrics/route.ts` | 178 |
| `app/api/crypto/btc/quote/route.ts` | 65 |
| `app/api/prices/route.ts` | 204 |
| `app/api/chart/[ticker]/route.ts` | 264 |
| `app/api/darkpool/[ticker]/route.ts` | 290 |
| `app/api/fundamentals/[ticker]/route.ts` | 175 |
| **Total** | **~4,006 LOC** |

---

## What I Did NOT Cover

- `lib/chartYahoo.ts` (`aggregateMinuteQuotesToN`) — referenced but not fully read; NaN handling in aggregation window not verified
- `app/api/briefs/`, `app/api/analytics/`, `app/api/ml/`, `app/api/regime/`, `app/api/stream/` routes
- `lib/quant/buildFundamentalsPayload.ts` — called from fundamentals route but not reviewed for NaN propagation
- `lib/options/` — options chain, flow, GEX, Greeks modules
- WebSocket hooks (`useBtcKlineWs.ts`, `useBtcPriceWs.ts`) — client-side, out of scope for server-side data layer review
- The `scripts/fetchBacktestData.mjs` data ingestion script — not reviewed

---

*File written incrementally by data-layer review agent — 2026-06-04*
*Branch: chore/master-coverage-2026-06-03*
