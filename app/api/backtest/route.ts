/**
 * GET /api/backtest
 * Returns full backtest results for all 56 instruments (55 sector stocks + BTC).
 * Reads from locally pre-fetched JSON data files (scripts/backtestData/).
 * Cached for 1 hour. Filter with ?tickers=AAPL,NVDA
 *
 * POST /api/backtest — recompute with custom config and/or tickers
 * Body: { tickers?: string[], config?: Partial<StrategyConfig>, lookbackDays?: number }
 * Custom tickers are fetched live from Yahoo Finance.
 */

import { NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import { loadStockHistory, loadBtcHistory, availableTickers } from '@/lib/backtest/dataLoader'
import {
  backtestInstrument,
  aggregatePortfolio,
  walkForwardAnalysis,
  walkForwardSummary,
  type WalkForwardSummary,
} from '@/lib/backtest/engine'
import type { StrategyConfig } from '@/lib/strategy/strategyConfig'
import { mergeStrategyConfig, toBacktestConfig } from '@/lib/strategy/strategyConfig'
import { newTraceId, buildRunAudit, configHashFromObject, logRunEvent } from '@/lib/infra/runAudit'
import { clientKeyFromRequest, rateLimitHit } from '@/lib/infra/rateLimit'
import YahooFinance from 'yahoo-finance2'
import type { OhlcvRow } from '@/lib/backtest/engine'

const yahooFinance = new YahooFinance()

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// ─── Live Yahoo Finance ticker fetcher ───────────────────────────────────────

async function fetchLiveOhlcv(ticker: string, lookbackDays: number = 1260): Promise<OhlcvRow[]> {
  const end = new Date()
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
  const result = await yahooFinance.chart(ticker, {
    period1: Math.floor(start.getTime() / 1000),
    period2: Math.floor(end.getTime() / 1000),
    interval: '1d',
  })
  if (!result?.quotes || result.quotes.length === 0) return []
  return result.quotes.map((q) => ({
    time: (q as { timestamp?: number }).timestamp ?? 0,
    open: (q as { open?: number }).open ?? 0,
    high: (q as { high?: number }).high ?? 0,
    low: (q as { low?: number }).low ?? 0,
    close: (q as { close?: number }).close ?? 0,
    volume: (q as { volume?: number }).volume ?? 0,
  }))
}

// ─── Run backtest ────────────────────────────────────────────────────────────

async function runBacktest(
  filterTickers?: string[],
  config?: Partial<StrategyConfig>,
  lookbackDays: number = 1260,
  isLiveRun: boolean = false,
): Promise<{
  runId: string
  traceId: string
  computedAt: string
  dataSource: 'local' | 'live'
  audit: ReturnType<typeof buildRunAudit>
  instruments: { ticker: string; sector: string; candles: number }[]
  results: ReturnType<typeof backtestInstrument>[]
  walkForward: Array<{ ticker: string; sector: string; summary: WalkForwardSummary }>
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
  }
}> {
  const traceId = newTraceId('bt')
  const instruments: { ticker: string; sector: string; candles: number }[] = []
  const results: ReturnType<typeof backtestInstrument>[] = []
  const walkForward: Array<{ ticker: string; sector: string; summary: WalkForwardSummary }> = []

  // Convert StrategyConfig → BacktestConfig for the engine
  const backtestConfig = config ? toBacktestConfig(config) : undefined
  const wfConfig = backtestConfig ?? {}

  const MIN_WF_BARS = 315 // 252 train + 63 test (walkForwardAnalysis also requires min train/test lengths)

  function pushWalkForward(ticker: string, sector: string, rows: OhlcvRow[]) {
    if (rows.length < MIN_WF_BARS) return
    const summary = walkForwardSummary(walkForwardAnalysis(ticker, sector, rows, 252, 63, wfConfig))
    if (summary.windows.length > 0) walkForward.push({ ticker, sector, summary })
  }

  // Determine which tickers are "custom" (not in the local dataset)
  const localTickers = availableTickers()
  const localSet = new Set(localTickers.map(t => t.toUpperCase()))
  const customTickers = filterTickers
    ? filterTickers.filter(t => !localSet.has(t.toUpperCase()))
    : []
  const localFiltered = filterTickers
    ? filterTickers.filter(t => localSet.has(t.toUpperCase()))
    : undefined

  // ── Local instruments (from pre-fetched data) ───────────────────────────────
  const localInstruments: { ticker: string; sector: string; candles: number }[] = []
  for (const sector of SECTORS) {
    for (const ticker of sector.topHoldings) {
      if (localFiltered && !localFiltered.includes(ticker)) continue
      if (!localSet.has(ticker.toUpperCase())) {
        localInstruments.push({ ticker, sector: sector.name, candles: 0 })
        continue
      }
      const rows = loadStockHistory(ticker)
      localInstruments.push({ ticker, sector: sector.name, candles: rows.length })
      if (rows.length >= 100) {
        results.push(backtestInstrument(ticker, sector.name, rows, backtestConfig))
        pushWalkForward(ticker, sector.name, rows)
      }
    }
  }

  // BTC
  if (!localFiltered || localFiltered.includes('BTC')) {
    const btcRows = loadBtcHistory()
    localInstruments.push({ ticker: 'BTC', sector: 'Crypto', candles: btcRows.length })
    if (btcRows.length >= 100) {
      results.push(backtestInstrument('BTC', 'Crypto', btcRows, backtestConfig))
      pushWalkForward('BTC', 'Crypto', btcRows)
    }
  }

  // ── Live instruments (fetched from Yahoo Finance) ───────────────────────────
  const liveInstruments: { ticker: string; sector: string; candles: number }[] = []
  for (const ticker of customTickers) {
    try {
      const rows = await fetchLiveOhlcv(ticker, lookbackDays)
      liveInstruments.push({ ticker, sector: 'Custom', candles: rows.length })
      if (rows.length >= 100) {
        results.push(backtestInstrument(ticker, 'Custom', rows, backtestConfig))
        pushWalkForward(ticker, 'Custom', rows)
      }
    } catch {
      liveInstruments.push({ ticker, sector: 'Custom', candles: 0 })
    }
  }

  // Merge instrument lists
  instruments.push(...localInstruments, ...liveInstruments)

  // If no instruments, return empty result
  if (instruments.length === 0) {
    const mergedCfg = config ? mergeStrategyConfig(config) : mergeStrategyConfig()
    const empty = {
      runId: traceId,
      traceId,
      computedAt: new Date().toISOString(),
      dataSource: 'live' as const,
      audit: buildRunAudit({
        runId: traceId,
        traceId,
        configHash: configHashFromObject(mergedCfg),
        dataSource: 'live',
        iterationsRun: 0,
      }),
      instruments: [],
      results: [],
      walkForward: [],
      portfolio: {
        avgReturn: 0, avgAnnReturn: 0, bnhAvg: 0, alpha: 0, sharpeRatio: null,
        sortinoRatio: null, maxPortfolioDd: 0, winRate: 0, profitFactor: 0,
        avgTradeReturn: 0, totalTrades: 0, totalInstruments: 0,
        sectorSummary: {}, initialCapital: 100_000, finalCapital: 100_000,
      },
    }
    return empty
  }

  const portfolio = aggregatePortfolio(results, 100_000)
  const bnhAvg = results.length > 0
    ? results.reduce((s, r) => s + r.bnhReturn, 0) / results.length
    : 0

  const mergedCfg = config ? mergeStrategyConfig(config) : mergeStrategyConfig()
  let firstBarUnix: number | undefined
  let lastBarUnix: number | undefined
  if (!isLiveRun && results.length > 0) {
    const t = results[0].ticker
    const rows =
      t === 'BTC'
        ? loadBtcHistory()
        : availableTickers().includes(t.toUpperCase())
          ? loadStockHistory(t)
          : []
    if (rows.length > 1) {
      firstBarUnix = rows[0].time
      lastBarUnix = rows[rows.length - 1].time
    }
  }

  const audit = buildRunAudit({
    runId: traceId,
    traceId,
    configHash: configHashFromObject(mergedCfg),
    dataWindow:
      firstBarUnix != null && lastBarUnix != null ? { firstBarUnix, lastBarUnix } : undefined,
    iterationsRun: results.length,
    dataSource: isLiveRun ? 'live' : 'local',
  })

  logRunEvent('info', 'backtest_complete', {
    traceId,
    runId: traceId,
    iterationsRun: results.length,
    dataSource: audit.dataSource,
  })

  return {
    runId: traceId,
    traceId,
    computedAt: new Date().toISOString(),
    dataSource: isLiveRun ? 'live' : 'local',
    audit,
    instruments,
    results,
    walkForward,
    portfolio: {
      avgReturn: portfolio.totalReturn,
      avgAnnReturn: portfolio.annualizedReturn,
      bnhAvg,
      alpha: portfolio.alpha,
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

export async function POST(request: Request) {
  if (rateLimitHit(`backtest:${clientKeyFromRequest(request)}`, 8, 60_000)) {
    return NextResponse.json({ error: 'Too many backtest requests — try again shortly.' }, { status: 429 })
  }
  cache = null
  try {
    let config: Partial<StrategyConfig> | undefined
    let tickers: string[] | undefined
    let lookbackDays = 1260

    try {
      const body = await request.json()
      config = body.config
      tickers = body.tickers
      lookbackDays = body.lookbackDays ?? 1260
    } catch {
      // No body provided — use defaults
    }

    const hasCustomTickers = tickers && tickers.length > 0
    const data = await runBacktest(tickers, config, lookbackDays, hasCustomTickers)
    if (!hasCustomTickers) cache = { data, timestamp: Date.now() }
    // Return full BacktestData so the unified page can display results immediately
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: 'Recompute failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
