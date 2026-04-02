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

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

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

  // Reshape to what the frontend expects
  const bnhAvg = results.length > 0
    ? results.reduce((s, r) => s + r.bnhReturn, 0) / results.length
    : 0
  const alpha = portfolio.totalReturn - bnhAvg

  return {
    runId: `run_${Date.now()}`,
    computedAt: new Date().toISOString(),
    dataSource: 'local',
    instruments,
    results,
    portfolio: {
      avgReturn: portfolio.totalReturn,
      avgAnnReturn: portfolio.annualizedReturn,
      bnhAvg,
      alpha,
      sharpeRatio: portfolio.sharpeRatio,
      sortinoRatio: portfolio.sortinoRatio,
      maxPortfolioDd: portfolio.maxDrawdown,
      winRate: portfolio.winRate,
      profitFactor: portfolio.profitFactor,
      avgTradeReturn: portfolio.avgTradeReturn,
      totalTrades: portfolio.totalTrades,
      totalInstruments: portfolio.totalInstruments,
      sectorSummary: portfolio.sectorReturns,
    },
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers')
  const filterTickers = tickersParam
    ? tickersParam.split(',').map((t) => t.trim().toUpperCase())
    : undefined

  // Serve from cache for full (unfiltered) runs
  if (!filterTickers && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  try {
    const data = await runBacktest(filterTickers)
    if (!filterTickers) cache = { data, timestamp: Date.now() }
    return NextResponse.json(data)
  } catch (e) {
    console.error('[api/backtest] error:', e)
    return NextResponse.json(
      { error: 'Backtest failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

export async function POST() {
  cache = null
  try {
    const data = await runBacktest()
    cache = { data, timestamp: Date.now() }
    return NextResponse.json({ status: 'ok', computedAt: data.computedAt })
  } catch (e) {
    return NextResponse.json(
      { error: 'Recompute failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
