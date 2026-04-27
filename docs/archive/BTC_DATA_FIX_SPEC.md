# BTC Data Pipeline — Fixes & Enhancements SPEC

**File**: `BTC_DATA_FIX_SPEC.md`
**Date**: 2026-04-02
**Status**: Draft
**Priority**: P0 = critical, P1 = important, P2 = nice-to-have

---

## 1. Current Architecture Summary

### Data Sources Per Timeframe

| Timeframe | REST Primary | REST Fallback Order | WS Available | REST Poll Interval | Notes |
|-----------|-------------|---------------------|--------------|--------------------|-------|
| **1m** | Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s (REST only, WS is live) | WS is real-time; REST only used on mount |
| **3m** | Kraken 1m → Coinbase 1m (aggregated) | — | **No** | 75s | Kraken WS does not support 3m. Aggregated from 1m REST. |
| **5m** | CoinGecko → Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s | WS is real-time; REST only used on mount |
| **15m** | CoinGecko → Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s | WS is real-time |
| **1h** | CoinGecko → Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s | WS is real-time |
| **4h** | CoinGecko → Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s | Kraken supports 4h (interval=240) |
| **1d** | CoinGecko → Kraken → Coinbase | — | **Yes** (Kraken WS) | 75s | WS is real-time |
| **1w** | CoinGecko (max/daily) → Kraken | — | **Yes** (Kraken WS) | 75s | CoinGecko `days=max` returns daily bars, not weekly |
| **1M** | Kraken daily (interval=1440) | Coinbase daily | **No** | 75s | Kraken does not support monthly. Uses 1-day bars from Kraken. Monthly label is synthetic. |

### Real-Time Capability Summary

- **Live WebSocket streams**: 1m, 5m, 15m, 1h, 4h, 1d, 1w — all via Kraken WS v2 (`wss://ws.kraken.com/v2`)
- **No WebSocket**: 3m (Kraken has no 3m WS — only REST aggregation), 1M (Kraken has no monthly WS — uses daily bars)
- **Spot price**: Coinbase WebSocket (`wss://ws-feed.exchange.coinbase.com`) for real-time tick; REST fallback via CoinGecko

---

## 2. Issue 1: Missing/Imperfect Timeframes — Documentation Fixes

### 2a. 3m — No WebSocket Exists

**Root cause**: Kraken WebSocket v2 does not support a 3-minute OHLC interval. The `KRAKEN_OHLC_INTERVAL_MIN` map in `page.tsx` correctly shows `'3m': null`. The server-side `route.ts` aggregates 1m bars from Kraken or Coinbase into 3m bars using `aggregateCandlesToNMinutes()`.

**Current flow**:
1. User selects 3m → `connectKlineWs('3m')` is called
2. `intervalMin = KRAKEN_OHLC_INTERVAL_MIN['3m']` = `null`
3. WS is **not opened** — function returns early at line 311–313 of `page.tsx`
4. `fetchCandles('3m')` fires via REST → calls `/api/crypto/btc?interval=3m`
5. Server calls `fetch3mFrom1mSources(limit)` which fetches 720 × 1m Kraken bars and aggregates them
6. Client polls REST every 75 seconds via the `setInterval` at line 556–559 of `page.tsx`

**Limitation**: 3m bars are only as fresh as the last REST poll (75 seconds). There is no exchange that provides a native 3m WebSocket stream for BTC/USD.

**Fix P2**: Increase REST polling to **30 seconds** specifically when `activeRange === '3m'`. This is the most delay-sensitive timeframe since it has no WS at all.

### 2b. 1M — Synthetic Monthly Bars

**Root cause**: Kraken's REST OHLC API does not support a monthly interval. The `KRAKEN_INTERVAL_MINUTES` map in `route.ts` line 18 sets `'1M': 1440` (daily). The monthly button in the UI returns daily bars labeled as monthly — this is explicitly acknowledged in the code comment: `"No native monthly bar — use daily (~720 bars max from Kraken)."`

**Impact**: The monthly chart is actually a daily chart. The "1M" label is misleading.

**Fix P2**: Add a visible disclaimer in the chart header or footer when `activeRange === '1M'` noting that monthly bars are synthesized from daily data. Alternatively, add a `?_restNote` or `note` field to the API response and display it in the UI.

### 2c. 1w — CoinGecko Returns Daily Bars

**Root cause**: When `coingeckoDaysParam('1w')` returns `'max'` (line 63 of `page.tsx`), CoinGecko's OHLC endpoint returns **daily** bars for the full historical range. The server-side `fetchCoinGeckoOhlc` also uses `days: 'max'` for both `'1w'` and `'1M'`.

**Impact**: The weekly chart shows daily-resolution bars, not true weekly OHLC bars.

**Fix P2**: Either accept this limitation with a disclaimer, or for 1w specifically, use Kraken's 1w REST endpoint (`interval=10080`) which does support true weekly bars natively.

---

## 3. Issue 2: Stale Derivatives & Liquidation Data (P1 — Fix Now)

### Problem

`BtcQuantLab` fetches `/api/crypto/btc/metrics` and `/api/crypto/btc/liquidations` **once on mount** (empty `useEffect` deps array, lines 97–111 of `BtcQuantLab.tsx`). After the initial load, these panels show completely stale data.

The server-side cache (`CACHE_TTL_MS = 5000` for metrics, `10000` for liquidations) does not help because the client never re-fetches.

### Solution: Add Polling Intervals to `BtcQuantLab`

Add two separate `useEffect` hooks with `setInterval` for metrics (30s) and liquidations (60s). Also add a `lastFetchedAt` timestamp per data type for the "Updated X:XX" display.

**File**: `components/crypto/BtcQuantLab.tsx`

**Change 1 — Add state for last-fetched timestamps** (after existing state declarations, around line 95):

```tsx
const [metricsLastFetched, setMetricsLastFetched] = useState<Date | null>(null)
const [liqLastFetched, setLiqLastFetched] = useState<Date | null>(null)
```

**Change 2 — Replace the single useEffect (lines 97–111) with three separate effects**:

```tsx
// Fetch metrics every 30 seconds
useEffect(() => {
  let cancelled = false
  const load = async () => {
    try {
      const mr = await fetchJsonSafe('/api/crypto/btc/metrics')
      if (!cancelled) {
        if (mr.ok) {
          setMetrics(mr.data as MetricsData)
          setMetricsLastFetched(new Date())
        } else {
          setDerivativesError(prev => {
            const base = prev ? prev + ' · ' : ''
            return base + `metrics: ${mr.message}`
          })
        }
      }
    } catch (e) {
      console.error('[BtcQuantLab] metrics fetch error', e)
    }
  }
  load()
  const id = setInterval(load, 30_000)
  return () => { cancelled = true; clearInterval(id) }
}, [])

// Fetch liquidations every 60 seconds
useEffect(() => {
  let cancelled = false
  const load = async () => {
    try {
      const lr = await fetchJsonSafe('/api/crypto/btc/liquidations')
      if (!cancelled) {
        if (lr.ok) {
          setLiq(lr.data as LiqData)
          setLiqLastFetched(new Date())
        }
      }
    } catch (e) {
      console.error('[BtcQuantLab] liquidations fetch error', e)
    }
  }
  load()
  const id = setInterval(load, 60_000)
  return () => { cancelled = true; clearInterval(id) }
}, [])
```

**Change 3 — Update the data source display** (MetricCard for data source at line 318–322):

```tsx
<MetricCard
  label="Data Source"
  value={metrics?.source?.includes('Unavailable') ? 'Unavailable' : (metrics?.source ?? '—')}
  sub={metricsLastFetched ? `Updated ${metricsLastFetched.toLocaleTimeString()}` : undefined}
  color="text-slate-500"
/>
```

**Change 4 — Update the liquidation metric card** (around line 346):

```tsx
<MetricCard
  label="Net Bias"
  value={liq?.netDirection ?? '—'}
  sub={liqLastFetched ? `Updated ${liqLastFetched.toLocaleTimeString()}` : undefined}
  color={liq?.netDirection === 'LONG_BIAS' ? 'text-red-400' : liq?.netDirection === 'SHORT_BIAS' ? 'text-green-400' : 'text-slate-400'}
/>
```

**Rationale**:
- Metrics (funding rate, OI, long/short ratio): 30s — these change every 8h funding cycle but the data should be fresh for display purposes
- Liquidations: 60s — OKX liquidation data updates less frequently; 1 minute is sufficient

---

## 4. Issue 3: Price Ticker Initial Delay (P1 — Fix Now)

### Problem

The price ticker hydration uses a 4-second `setTimeout` before triggering the REST fallback (line 508 of `page.tsx`). This means if the Coinbase WebSocket has not connected in 4 seconds, the user sees no price at all for up to 4 seconds.

### Solution: Reduce Initial Delay to 2 Seconds

**File**: `app/crypto/btc/page.tsx`

**Change** — Line 508:

```tsx
// BEFORE
const t = setTimeout(loadRestQuote, 4000)

// AFTER
const t = setTimeout(loadRestQuote, 2000)
```

**Also**: The REST polling interval at line 509 is already `60_000` (60s). This is acceptable. No change needed for the polling interval itself.

**Additional improvement (P2)**: Add a faster visual loading skeleton for the price header when no `btcPrice` is set and the WS has not connected. Currently the skeleton only appears in the initial render. A better experience would show a subtle pulsing placeholder immediately rather than waiting 2 seconds for the REST fallback to fire.

---

## 5. Issue 4: 3m REST Polling Interval (P2 — Fix After P1)

### Problem

The global REST poll for OHLC is 75 seconds (line 558 of `page.tsx`). For 3m specifically, this is the **only** update mechanism since no WebSocket exists. 75 seconds is too slow for what users expect from a "live" chart.

### Solution: Interval-Specific Polling

**File**: `app/crypto/btc/page.tsx`

**Change** — Replace the global 75s polling `useEffect` (lines 554–560) with a smarter version that uses 30s for 3m and 75s for everything else:

```tsx
/** Refresh OHLC on an interval. Use faster polling for 3m (no WS exists). */
useEffect(() => {
  if (activeTab !== 'chart') return
  const pollInterval = activeRangeRef.current === '3m' ? 30_000 : 75_000
  const id = setInterval(() => {
    fetchCandles(activeRangeRef.current)
  }, pollInterval)
  return () => clearInterval(id)
}, [activeTab, fetchCandles])
```

**Note**: The `activeRange` dependency is intentionally omitted — we read `activeRangeRef.current` inside the callback so the interval always uses the current timeframe without needing to re-create the interval on every timeframe change (which would reset the timer). The `activeRangeRef` is always kept in sync via the `useEffect` at lines 147–149.

---

## 6. Issue 5: CoinGecko 1m/3m Explicit Null Handling (P1 — Already Correct)

`fetchCoinGeckoOhlc` in `route.ts` (line 76) already returns `null` explicitly for 1m and 3m:

```tsx
if (binanceInterval === '1m' || binanceInterval === '3m') return null
```

This is correct and prevents accidentally falling back to CoinGecko for minute-level data. No code change needed — document for completeness.

---

## 7. File Change Summary

| File | Change | Priority |
|------|--------|----------|
| `components/crypto/BtcQuantLab.tsx` | Add `metricsLastFetched` and `liqLastFetched` state; split useEffect into two polling loops (30s metrics, 60s liquidations); update `sub` prop in MetricCard to show timestamp | P1 |
| `app/crypto/btc/page.tsx` | Reduce REST fallback delay from 4000ms to 2000ms (line 508); replace global 75s polling with interval-specific polling (30s for 3m, 75s for others) | P1 + P2 |
| `BTC_DATA_FIX_SPEC.md` (this file) | Documentation only | — |

---

## 8. Implementation Order

### Phase 1 (Do First — 30 min)
1. **`BtcQuantLab.tsx`** — Add polling for derivatives and liquidation data (Issue 2)
   - Add `metricsLastFetched` / `liqLastFetched` state
   - Split mount-only useEffect into two interval-based effects
   - Update UI to show "Updated HH:MM:SS" timestamp
2. **`page.tsx`** — Reduce price ticker delay from 4s to 2s (Issue 3)

### Phase 2 (Do Second — 15 min)
3. **`page.tsx`** — Add interval-specific polling: 30s for 3m, 75s for all others (Issue 1a)
4. **`page.tsx`** or **`BtcQuantLab.tsx`** — Add UI note when `activeRange === '1M'` that bars are synthesized from daily data (Issue 1b)

### Phase 3 (Nice to have — 20 min)
5. Fix 1w to use true weekly bars from Kraken (not CoinGecko daily) via Kraken REST `interval=10080` — requires adding a `fetchKrakenOhlc('1w', limit)` path to `route.ts` before CoinGecko, or a special case
6. Add a visible "WS LIVE" vs "REST POLLING" badge per timeframe button in the chart toolbar

---

## Appendix A: Relevant Code Locations

| Location | Line(s) | Purpose |
|----------|---------|---------|
| `page.tsx` `KRAKEN_OHLC_INTERVAL_MIN` | 28–39 | Maps timeframe → Kraken WS interval (null = no WS) |
| `page.tsx` `TIMEFRAMES` | 41–44 | All timeframe buttons |
| `page.tsx `connectKlineWs` | 298–403 | Kraken WS v2 connection; returns early for null intervals (3m, 1M) |
| `page.tsx `connectPriceWs` | 405–456 | Coinbase WS for spot price |
| `page.tsx `useEffect` price REST fallback | 459–514 | 4s timeout → REST fallback → 60s polling |
| `page.tsx `useEffect` REST poll interval | 554–560 | 75s global OHLC REST refresh |
| `route.ts` `fetchCoinGeckoOhlc` | 71–112 | Returns null for 1m/3m (line 76) |
| `route.ts` `fetch3mFrom1mSources` | 210–235 | Aggregates 1m → 3m from Kraken or Coinbase |
| `route.ts` `KRAKEN_INTERVAL_MINUTES` | 9–19 | `'1M': 1440` (daily, not monthly) |
| `route.ts` GET handler | 239–352 | Route dispatcher per interval |
| `BtcQuantLab.tsx` useEffect | 97–111 | Mount-only fetch (no polling) |
| `metrics/route.ts` `_cache` | 7 | 5s server-side cache for metrics |
| `liquidations/route.ts` `_cache` | 6 | 10s server-side cache for liquidations |
