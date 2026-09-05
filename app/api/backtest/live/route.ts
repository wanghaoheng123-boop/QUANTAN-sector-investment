/**
 * GET /api/backtest/live
 * Returns CURRENT regime + signal for all 56 instruments using the latest
 * available daily close from locally pre-fetched data files.
 * No external API calls — works in any environment.
 * Cached for 60 seconds.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import { canonicalSecurityId } from '@/lib/data/securityId'
import { loadStockHistory, loadBtcHistory, availableTickers } from '@/lib/backtest/dataLoader'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'
import { buildLiveInstrumentSignal, type LiveInstrumentSignal } from '@/lib/backtest/liveSignal'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker as strictNormalizeTicker } from '@/lib/api/sanitize'
import { recordShadowSignals } from '@/lib/shadowLog'

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 1000 // 60 seconds
// A1/F-A1-2: cap the `tickers` filter so a huge param can't amplify the
// per-instrument `.includes()` membership check. Mirrors MAX_FILTER_TICKERS
// in the sibling /api/backtest route.
const MAX_FILTER_TICKERS = 100

// ─── Types ───────────────────────────────────────────────────────────────────

type InstrumentSignal = Omit<LiveInstrumentSignal, 'signalReason'>

function toApiSignal(s: LiveInstrumentSignal): InstrumentSignal {
  const { signalReason: _reason, ...rest } = s
  return rest
}

function stockSignal(ticker: string, sector: string): InstrumentSignal | null {
  const rows = loadStockHistory(ticker) as OhlcvRow[]
  const s = buildLiveInstrumentSignal(rows, ticker, sector)
  return s ? toApiSignal(s) : null
}

function btcSignal(): InstrumentSignal | null {
  const rows = loadBtcHistory() as OhlcvRow[]
  const s = buildLiveInstrumentSignal(rows, 'BTC', 'Crypto')
  return s ? toApiSignal(s) : null
}

// ─── Route handler ─────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Phase 14 wave 27: rate limit. This route does NOT call upstream Yahoo
  // (all data is local pre-fetched JSON) so the limit can be more permissive,
  // but unbounded polling still wastes Lambda CPU on the in-memory cache
  // miss path. 60 req/min/IP matches /api/prices.
  const rl = await applyRateLimit(request, 'backtest-live', { maxRequests: 60, windowSeconds: 60 })
  if (rl) return rl

  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers')
  // Phase 14 wave 27: strict per-token validation. The previous permissive
  // upcase-trim allowed arbitrary characters into the comparison against
  // local availableTickers(), which couldn't cause harm in THIS route
  // (the localSet check filters out anything not in our data files), but
  // making this strict keeps the parameter-handling convention uniform
  // across the API surface and prevents future contributors from copy-
  // pasting this loose pattern into a route that DOES forward upstream.
  // I6 (Q110-P1, 2026-09-05) — identity goes through the SSOT, once.
  // `?tickers=BRK-B` returned `instruments: []` with a 200 and no error, while
  // `?tickers=BRK.B` returned the row: the universe writes `BRK.B`, the fixture
  // on disk is `BRK-B.json`, and this route compared the raw token against
  // `sector.topHoldings` with no canonicalisation. `lib/data/securityId.ts` is
  // the SSOT that `Q-080` built for exactly this, and ZERO routes under
  // `app/api/` imported it — I6 was consistent everywhere except the layer the
  // public actually calls.
  const specificTickers = tickersParam
    ? tickersParam
        .split(',')
        .slice(0, MAX_FILTER_TICKERS)
        .map((t) => strictNormalizeTicker(t))
        .filter((t): t is string => t !== null)
        .map((t) => canonicalSecurityId(t))
        .filter((t): t is string => t !== null)
    : null

  // Serve from cache for full (unfiltered) runs only — a filtered request must
  // not read from or write to the shared module-level cache, otherwise a
  // filtered response would poison the cache for unfiltered callers for 60s.
  // I2 (Q110-P2, 2026-09-05) — a stored copy must say it is one. This route
  // served `_cache` verbatim with nothing in the payload marking it, so a
  // value up to the TTL old was indistinguishable from a live one. It was
  // invisible to the I2 guard because that guard's producer set was "routes
  // that already set `_cached`" — the violation defined itself out of scope.
  if (!specificTickers && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ ...(cache.data as object), _cached: true, _cachedAt: cache.timestamp }, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    })
  }

  const results: InstrumentSignal[] = []
  const localTickers = availableTickers()
  const localSet = new Set(localTickers.map((t) => t.toUpperCase()))

  for (const sector of SECTORS) {
    for (const ticker of sector.topHoldings) {
      if (specificTickers && !specificTickers.includes(canonicalSecurityId(ticker) ?? ticker)) continue
      if (!localSet.has(ticker.toUpperCase())) continue
      const s = stockSignal(ticker, sector.name)
      if (s) results.push(s)
    }
  }

  if (!specificTickers || specificTickers.includes('BTC')) {
    const s = btcSignal()
    if (s) results.push(s)
  }

  // I2 (Q110-P1, 2026-09-05) — "Missing data displays as MISSING". A filter that
  // matched nothing returned `instruments: []` with a 200 and no explanation, so
  // the caller could not tell "no signals today" from "I did not recognise that
  // symbol". That is fail-SILENT, which the invariant names first. This is the
  // half of Q110-P1 that canonicalisation alone does not fix: `?tickers=ZZZZ` is
  // still empty, and now it says why.
  const unmatchedTickers = specificTickers
    ? specificTickers.filter((t) => !results.some((r) => r.ticker === t))
    : []

  // Sort: BUY first, then HOLD, then SELL; within each group by confidence desc
  const actionOrder = { BUY: 0, HOLD: 1, SELL: 2 }
  results.sort((a, b) => {
    const d = actionOrder[a.action] - actionOrder[b.action]
    if (d !== 0) return d
    return b.confidence - a.confidence
  })

  const data = {
    computedAt: new Date().toISOString(),
    dataSource: 'local',
    instruments: results,
    summary: {
      buySignals: results.filter((r) => r.action === 'BUY').length,
      holdSignals: results.filter((r) => r.action === 'HOLD').length,
      sellSignals: results.filter((r) => r.action === 'SELL').length,
    },
    ...(unmatchedTickers.length > 0 ? { unmatchedTickers } : {}),
  }

  // Only cache the full (unfiltered) response — same guard as the read path.
  if (!specificTickers) {
    cache = { data, timestamp: Date.now() }
    // Q-067 shadow signal log: record what the live path actually served
    // (full uncached computations only — at most one write per cache window).
    // recordShadowSignals is fail-closed: no-op without a sink, never throws.
    await recordShadowSignals(
      results.map((r) => ({ ticker: r.ticker, action: r.action, confidence: r.confidence })),
    )
  }

  return NextResponse.json({ ...data, _cached: false, _cachedAt: Date.now() }, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  })
}
