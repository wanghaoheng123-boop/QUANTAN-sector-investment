/**
 * GET /api/backtest/live
 * Returns CURRENT regime + signal for all 56 instruments using the latest
 * available daily close from locally pre-fetched data files.
 * No external API calls — works in any environment.
 * Cached for 60 seconds.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import { loadStockHistory, loadBtcHistory, availableTickers } from '@/lib/backtest/dataLoader'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'
import { buildLiveInstrumentSignal, type LiveInstrumentSignal } from '@/lib/backtest/liveSignal'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker as strictNormalizeTicker } from '@/lib/api/sanitize'

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

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
  const specificTickers = tickersParam
    ? tickersParam
        .split(',')
        .map((t) => strictNormalizeTicker(t))
        .filter((t): t is string => t !== null)
    : null

  // Serve from cache if fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    })
  }

  const results: InstrumentSignal[] = []
  const localTickers = availableTickers()
  const localSet = new Set(localTickers.map((t) => t.toUpperCase()))

  for (const sector of SECTORS) {
    for (const ticker of sector.topHoldings) {
      if (specificTickers && !specificTickers.includes(ticker)) continue
      if (!localSet.has(ticker.toUpperCase())) continue
      const s = stockSignal(ticker, sector.name)
      if (s) results.push(s)
    }
  }

  if (!specificTickers || specificTickers.includes('BTC')) {
    const s = btcSignal()
    if (s) results.push(s)
  }

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
  }

  cache = { data, timestamp: Date.now() }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  })
}
