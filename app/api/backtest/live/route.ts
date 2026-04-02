/**
 * GET /api/backtest/live
 * Returns CURRENT regime + signal for all 56 instruments using the latest
 * available daily close from locally pre-fetched data files.
 * No external API calls — works in any environment.
 * Cached for 60 seconds.
 */

import { NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import { loadStockHistory, loadBtcHistory, availableTickers } from '@/lib/backtest/dataLoader'
import {
  regimeSignal,
  rsi,
  macdFn,
  atr,
  bollinger,
} from '@/lib/backtest/signals'
import type { OhlcBar } from '@/lib/quant/technicals'

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache: { data: unknown; timestamp: number } | null = null
const CACHE_TTL_MS = 60 * 1000 // 60 seconds

// ─── Types ───────────────────────────────────────────────────────────────────

interface InstrumentSignal {
  ticker: string
  sector: string
  price: number
  changePct: number | null
  zone: string
  dipSignal: string
  deviationPct: number | null
  slopePct: number | null
  slopePositive: boolean | null
  rsi14: number | null
  atr14: number | null
  macdHist: number | null
  bbPctB: number | null
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  regimeColor: string
  candles: number
  lastDate: string | null
}

// ─── Compute signal for one stock ────────────────────────────────────────────

function stockSignal(ticker: string, sector: string): InstrumentSignal | null {
  const rows = loadStockHistory(ticker)
  if (rows.length < 200) return null

  const closes = rows.map((r) => r.close)
  const bars: OhlcBar[] = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
  const price = closes[closes.length - 1]
  const prevPrice = closes[closes.length - 2]
  const changePct = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : null

  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast = atrVals[atrVals.length - 1]
  const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]

  const reg = regimeSignal(price, closes, Number.isFinite(rsi14) ? rsi14 : undefined)

  const bullishCount =
    (Number.isFinite(rsi14) && rsi14 < 40 ? 1 : 0) +
    (Number.isFinite(macdHist) && macdHist > 0 ? 1 : 0) +
    (Number.isFinite(bbPctB) && bbPctB < 0.20 ? 1 : 0)

  const confidence = Math.min(100, reg.confidence + Math.round((bullishCount / 3) * 20))

  let action: 'BUY' | 'HOLD' | 'SELL' = reg.action
  if (confidence < 60 && action !== 'SELL') action = 'HOLD'

  let kelly = 0.10
  if (action === 'BUY' && reg.dipSignal === 'STRONG_DIP') kelly = 0.25
  else if (action === 'BUY') kelly = 0.15
  else if (action === 'SELL') kelly = 1.0

  const colorMap: Record<string, string> = {
    EXTREME_BULL: '#ef4444', EXTENDED_BULL: '#f97316', HEALTHY_BULL: '#22c55e',
    FIRST_DIP: '#84cc16', DEEP_DIP: '#eab308', BEAR_ALERT: '#f97316',
    CRASH_ZONE: '#ef4444', INSUFFICIENT_DATA: '#64748b',
  }

  const lastDate = rows.length > 0
    ? new Date(rows[rows.length - 1].time * 1000).toISOString().split('T')[0]
    : null

  return {
    ticker, sector, price, changePct,
    zone: reg.zone, dipSignal: reg.dipSignal,
    deviationPct: reg.deviationPct, slopePct: reg.slopePct, slopePositive: reg.slopePositive,
    rsi14: Number.isFinite(rsi14) ? rsi14 : null,
    atr14: Number.isFinite(atrLast) ? atrLast : null,
    macdHist: Number.isFinite(macdHist) ? macdHist : null,
    bbPctB: Number.isFinite(bbPctB) ? bbPctB : null,
    action, confidence, KellyFraction: kelly,
    regimeColor: colorMap[reg.zone] ?? '#64748b',
    candles: closes.length,
    lastDate,
  }
}

// ─── Compute signal for BTC ──────────────────────────────────────────────────

function btcSignal(): InstrumentSignal | null {
  const rows = loadBtcHistory()
  if (rows.length < 200) return null

  const closes = rows.map((r) => r.close)
  const bars: OhlcBar[] = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
  const price = closes[closes.length - 1]
  const prevPrice = closes[closes.length - 2]
  const changePct = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : null

  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast = atrVals[atrVals.length - 1]
  const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]

  const reg = regimeSignal(price, closes, Number.isFinite(rsi14) ? rsi14 : undefined)

  const bullishCount =
    (Number.isFinite(rsi14) && rsi14 < 40 ? 1 : 0) +
    (Number.isFinite(macdHist) && macdHist > 0 ? 1 : 0) +
    (Number.isFinite(bbPctB) && bbPctB < 0.20 ? 1 : 0)

  const confidence = Math.min(100, reg.confidence + Math.round((bullishCount / 3) * 20))

  let action: 'BUY' | 'HOLD' | 'SELL' = reg.action
  if (confidence < 60 && action !== 'SELL') action = 'HOLD'

  let kelly = 0.10
  if (action === 'BUY' && reg.dipSignal === 'STRONG_DIP') kelly = 0.25
  else if (action === 'BUY') kelly = 0.15
  else if (action === 'SELL') kelly = 1.0

  const colorMap: Record<string, string> = {
    EXTREME_BULL: '#ef4444', EXTENDED_BULL: '#f97316', HEALTHY_BULL: '#22c55e',
    FIRST_DIP: '#84cc16', DEEP_DIP: '#eab308', BEAR_ALERT: '#f97316',
    CRASH_ZONE: '#ef4444', INSUFFICIENT_DATA: '#64748b',
  }

  const lastDate = rows.length > 0
    ? new Date(rows[rows.length - 1].time * 1000).toISOString().split('T')[0]
    : null

  return {
    ticker: 'BTC', sector: 'Crypto', price, changePct,
    zone: reg.zone, dipSignal: reg.dipSignal,
    deviationPct: reg.deviationPct, slopePct: reg.slopePct, slopePositive: reg.slopePositive,
    rsi14: Number.isFinite(rsi14) ? rsi14 : null,
    atr14: Number.isFinite(atrLast) ? atrLast : null,
    macdHist: Number.isFinite(macdHist) ? macdHist : null,
    bbPctB: Number.isFinite(bbPctB) ? bbPctB : null,
    action, confidence, KellyFraction: kelly,
    regimeColor: colorMap[reg.zone] ?? '#64748b',
    candles: closes.length,
    lastDate,
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers')
  const specificTickers = tickersParam
    ? tickersParam.split(',').map((t) => t.trim().toUpperCase())
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
