/**
 * GET /api/backtest
 * Returns full backtest results for all 56 instruments (55 sector stocks + BTC).
 * Reads from locally pre-fetched JSON data files (scripts/backtestData/).
 * Cached for 1 hour. Filter with ?tickers=AAPL,NVDA
 *
 * POST /api/backtest — recompute (clears cache)
 */

import { NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import { loadStockHistory, loadBtcHistory, availableTickers } from '@/lib/backtest/dataLoader'
import { backtestInstrument, aggregatePortfolio } from '@/lib/backtest/engine'
import { validateCsrf } from '@/lib/api/csrf'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'

const MAX_FILTER_TICKERS = 100

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Fix (api-resilience): in-flight promise guard prevents concurrent cold GET
// requests from each spawning an independent full backtest computation. Without
// this, N simultaneous requests each pay the full compute cost and the last one
// to finish wins — wasting CPU and potentially returning stale data for most
// callers. With the guard, all concurrent cold requests await the same Promise.
let computing: ReturnType<typeof runBacktest> | null = null

// ─── Run backtest ────────────────────────────────────────────────────────────

async function runBacktest(filterTickers?: string[]): Promise<{
  runId: string
  computedAt: string
  dataSource: 'local'
  instruments: { ticker: string; sector: string; candles: number }[]
  results: ReturnType<typeof backtestInstrument>[]
  portfolio: {
    avgReturn: number
    avgAnnReturn: number
    bnhAvg: number
    alpha: number
    sharpeRatio: number | null
    sortinoRatio: number | null
    maxPortfolioDd: number
    winRate: number
    profitFactor: number
    avgTradeReturn: number
    totalTrades: number
    totalInstruments: number
    sectorSummary: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
    initialCapital: number
    finalCapital: number
    excludedTickers: string[]
  }
}> {
  const instruments: { ticker: string; sector: string; candles: number }[] = []
  const results: ReturnType<typeof backtestInstrument>[] = []

  // Check what's available locally
  const localTickers = availableTickers()
  const available = new Set(localTickers.map(t => t.toUpperCase()))

  for (const sector of SECTORS) {
    for (const ticker of sector.topHoldings) {
      if (filterTickers && !filterTickers.includes(ticker)) continue
      if (!available.has(ticker.toUpperCase())) {
        instruments.push({ ticker, sector: sector.name, candles: 0 })
        continue
      }
      const rows = loadStockHistory(ticker)
      instruments.push({ ticker, sector: sector.name, candles: rows.length })
      if (rows.length >= 100) {
        results.push(backtestInstrument(ticker, sector.name, rows))
      }
    }
  }

  // BTC
  if (!filterTickers || filterTickers.includes('BTC')) {
    const btcRows = loadBtcHistory()
    instruments.push({ ticker: 'BTC', sector: 'Crypto', candles: btcRows.length })
    if (btcRows.length >= 100) {
      results.push(backtestInstrument('BTC', 'Crypto', btcRows))
    }
  }

  const portfolio = aggregatePortfolio(results, 100_000)

  // Reshape to what the frontend expects. bnhAvg now comes from the aggregator so
  // it stays consistent with `alpha` (both averaged over the same combinable set,
  // excluding < 252-bar stubs) instead of being recomputed over all results.
  return {
    runId: `run_${Date.now()}`,
    computedAt: new Date().toISOString(),
    dataSource: 'local',
    instruments,
    results,
    portfolio: {
      avgReturn: portfolio.totalReturn,
      avgAnnReturn: portfolio.annualizedReturn,
      bnhAvg: portfolio.bnhAvg,
      alpha: portfolio.alpha,  // FIX C2: True portfolio alpha from combined equity
      sharpeRatio: portfolio.sharpeRatio,
      sortinoRatio: portfolio.sortinoRatio,
      maxPortfolioDd: portfolio.maxDrawdown,
      winRate: portfolio.winRate,
      profitFactor: portfolio.profitFactor,
      avgTradeReturn: portfolio.avgTradeReturn,
      totalTrades: portfolio.totalTrades,
      totalInstruments: portfolio.totalInstruments,
      sectorSummary: portfolio.sectorReturns,
      initialCapital: portfolio.initialCapital,
      finalCapital: portfolio.finalCapital,
      excludedTickers: portfolio.excludedTickers,
    },
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Rate limit: 30 req/min per IP
  const rateLimitResponse = await applyRateLimit(request, 'backtest', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers')
  // Phase 13 S2 (F7.3): validate + cap each ticker. Drop invalid tokens
  // silently — fail-closed style. Cap total to avoid amplification.
  const filterTickers = tickersParam
    ? tickersParam
        .split(',')
        .map((t) => normalizeTicker(t))
        .filter((t): t is string => t != null)
        .slice(0, MAX_FILTER_TICKERS)
    : undefined

  // Fix (api-resilience): add Cache-Control to match the 1-hour cache TTL intent.
  // Previously success paths returned no cache headers, so CDN/proxies would not
  // cache the response even though the module-level `cache` gates recomputes.
  const CACHE_HEADERS = { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' }

  // Serve from cache for full (unfiltered) runs
  if (!filterTickers && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data, { headers: CACHE_HEADERS })
  }

  try {
    let data: Awaited<ReturnType<typeof runBacktest>>
    if (!filterTickers) {
      // Coalesce concurrent cold requests onto one computation.
      if (!computing) {
        computing = runBacktest().finally(() => { computing = null })
      }
      data = await computing
      cache = { data, timestamp: Date.now() }
    } else {
      data = await runBacktest(filterTickers)
    }
    return NextResponse.json(data, { headers: CACHE_HEADERS })
  } catch (e) {
    console.error('[api/backtest] error:', e)
    const message = sanitizeError(e)
    return NextResponse.json(
      { error: 'Backtest failed', ...(message ? { message } : {}) },
      { status: 500 },
    )
  }
}

// Phase 13 S2 (DoS hardening): POST clears the 1-hour cache and triggers a
// full recompute. Tighter rate limit than GET — anyone hitting POST forces
// expensive aggregation across 56 instruments. Rate-limited at 3 req/min.
export async function POST(request: Request) {
  if (!validateCsrf(request)) {
    return NextResponse.json({ error: 'csrf_invalid' }, { status: 403 })
  }
  const rateLimitResponse = await applyRateLimit(request, 'backtest-recompute', {
    maxRequests: 3,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  cache = null
  try {
    const data = await runBacktest()
    cache = { data, timestamp: Date.now() }
    return NextResponse.json({ status: 'ok', computedAt: data.computedAt })
  } catch (e) {
    console.error('[api/backtest POST] recompute failed:', e)
    const message = sanitizeError(e)
    return NextResponse.json(
      { error: 'Recompute failed', ...(message ? { message } : {}) },
      { status: 500 },
    )
  }
}
