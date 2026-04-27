/**
 * scripts/benchmark-enhanced.ts
 *
 * Institutional-grade benchmark using Phase 2's combinedSignal.
 * Replaces the simplified inline signal in benchmark-signals.mjs.
 *
 * Usage: npm run benchmark:enhanced
 * Output: scripts/benchmark-results-enhanced.json
 *
 * Metrics per instrument:
 *   - Win rate (20-day forward return > 0)
 *   - Avg 20-day return per signal
 *   - Sharpe ratio (annualized, from daily equity curve)
 *   - Sortino ratio
 *   - Max drawdown (equity curve)
 *   - Profit factor
 *   - Signal frequency (trades per year)
 *
 * Sector-level aggregates are also produced.
 * Walk-forward split: IS = first 70% of bars, OOS = last 30%.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// Use relative imports to avoid @/ alias issues with tsx
import { combinedSignal, DEFAULT_CONFIG } from '../lib/backtest/signals'
import type { OhlcvRow } from './backtest/dataLoader'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')

// ─── Sector universe (mirrors lib/sectors.ts & runBacktest.mjs) ──────────────

const SECTORS_MAP: Record<string, string> = {
  NVDA: 'Technology', MSFT: 'Technology', AAPL: 'Technology', AVGO: 'Technology', AMD: 'Technology',
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', EOG: 'Energy', SLB: 'Energy',
  'BRK.B': 'Financials', JPM: 'Financials', V: 'Financials', MA: 'Financials', BAC: 'Financials',
  LLY: 'Healthcare', UNH: 'Healthcare', JNJ: 'Healthcare', ABBV: 'Healthcare', MRK: 'Healthcare',
  AMZN: 'Consumer Disc.', TSLA: 'Consumer Disc.', HD: 'Consumer Disc.', MCD: 'Consumer Disc.', NKE: 'Consumer Disc.',
  GE: 'Industrials', RTX: 'Industrials', CAT: 'Industrials', UNP: 'Industrials', HON: 'Industrials',
  META: 'Communication', GOOGL: 'Communication', NFLX: 'Communication', DIS: 'Communication', T: 'Communication',
  LIN: 'Materials', APD: 'Materials', FCX: 'Materials', NEM: 'Materials', DOW: 'Materials',
  NEE: 'Utilities', SO: 'Utilities', DUK: 'Utilities', AEP: 'Utilities', PCG: 'Utilities',
  PLD: 'Real Estate', AMT: 'Real Estate', EQIX: 'Real Estate', WELL: 'Real Estate', SPG: 'Real Estate',
  PG: 'Consumer Staples', COST: 'Consumer Staples', WMT: 'Consumer Staples', PEP: 'Consumer Staples', KO: 'Consumer Staples',
  BTC: 'Crypto',
}

// ─── Data loading ─────────────────────────────────────────────────────────────

interface CandleFile {
  ticker: string
  sector?: string
  candles: OhlcvRow[]
}

function loadAllTickers(): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const raw = readFileSync(join(dataDir, f), 'utf-8')
      const data = JSON.parse(raw) as CandleFile
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const sector = SECTORS_MAP[ticker] ?? data.sector ?? 'Unknown'
      const rows: OhlcvRow[] = (data.candles ?? []).filter(
        c => Number.isFinite(c.time) && Number.isFinite(c.open) &&
             Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close),
      )
      return { ticker, sector, rows }
    })
    .filter(d => d.rows.length >= 252)
}

// ─── Convert rows to the formats signals.ts expects ──────────────────────────

function closesFromRows(rows: OhlcvRow[]): number[] {
  return rows.map(r => r.close)
}

function barsFromRows(rows: OhlcvRow[]): { open: number; high: number; low: number; close: number }[] {
  return rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
}

// ─── Per-instrument benchmark ─────────────────────────────────────────────────

interface InstrumentResult {
  ticker: string
  sector: string
  bars: number
  buySignals: number
  wins: number
  losses: number
  winRate: number | null
  avgReturn20d: number | null
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number
  profitFactor: number
  bnhReturn: number
  excessReturn: number | null
  signalsPerYear: number
  // Walk-forward split
  isWinRate: number | null
  oosWinRate: number | null
  overfitGap: number | null
}

function runInstrument(ticker: string, sector: string, rows: OhlcvRow[]): InstrumentResult {
  const closes = closesFromRows(rows)
  const bars = barsFromRows(rows)
  const bnhReturn = closes.length > 0 ? (closes[closes.length - 1] - closes[0]) / closes[0] : 0

  // Walk-forward split
  const splitIdx = Math.floor(rows.length * 0.70)

  let isBuys = 0, isWins = 0
  let oosBuys = 0, oosWins = 0
  let totalBuys = 0, totalWins = 0, totalLosses = 0
  const returns20d: number[] = []

  // Simple equity curve for Sharpe/max-drawdown
  let equity = 100_000
  let peakEquity = equity
  const equityHistory: number[] = [equity]
  const dailyReturns: number[] = []
  let openPos: { entryPrice: number; idx: number } | null = null

  for (let i = 220; i < rows.length - 21; i++) {
    const lookback = closes.slice(0, i + 1)
    const barLookback = bars.slice(0, i + 1)
    const price = closes[i]
    const date = new Date(rows[i].time * 1000).toISOString().split('T')[0]

    // Close open position at 20d
    if (openPos && i >= openPos.idx + 20) {
      const exitPrice = closes[i]
      const ret = (exitPrice - openPos.entryPrice) / openPos.entryPrice
      equity *= (1 + ret * 0.15) // 15% position size (half-Kelly approx)
      openPos = null
    }

    const sig = combinedSignal(ticker, date, price, lookback, barLookback, DEFAULT_CONFIG)

    if (sig.action === 'BUY' && !openPos) {
      const entryPrice = closes[i + 1] // next-day execution
      const exitPrice = closes[Math.min(i + 21, closes.length - 1)]
      const ret = (exitPrice - entryPrice) / entryPrice
      returns20d.push(ret)
      totalBuys++

      if (ret > 0) {
        totalWins++
        if (i < splitIdx) isWins++; else oosWins++
      } else {
        totalLosses++
      }
      if (i < splitIdx) isBuys++; else oosBuys++

      openPos = { entryPrice, idx: i + 1 }
    }

    // Track equity for Sharpe
    if (equityHistory.length > 0) {
      const prev = equityHistory[equityHistory.length - 1]
      const eq = equity
      if (prev > 0) dailyReturns.push((eq - prev) / prev)
    }
    equityHistory.push(equity)
    if (equity > peakEquity) peakEquity = equity
  }

  // Max drawdown
  let peak2 = 100_000, maxDd = 0
  for (const eq of equityHistory) {
    if (eq > peak2) peak2 = eq
    const dd = (peak2 - eq) / peak2
    if (dd > maxDd) maxDd = dd
  }

  // Win rate
  const winRate = totalBuys > 0 ? totalWins / totalBuys : null
  const avgReturn = returns20d.length > 0 ? returns20d.reduce((a, b) => a + b, 0) / returns20d.length : null

  // IS/OOS rates
  const isWinRate = isBuys > 0 ? isWins / isBuys : null
  const oosWinRate = oosBuys > 0 ? oosWins / oosBuys : null
  const overfitGap = isWinRate != null && oosWinRate != null ? isWinRate - oosWinRate : null

  // Profit factor
  const gross = returns20d.filter(r => r > 0).reduce((s, r) => s + r, 0)
  const loss = Math.abs(returns20d.filter(r => r < 0).reduce((s, r) => s + r, 0))
  const profitFactor = loss > 0 ? gross / loss : gross > 0 ? Infinity : 0

  // Sharpe
  let sharpe: number | null = null
  let sortino: number | null = null
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    if (sd > 0) {
      const rfDaily = 0.04 / 252
      sharpe = ((mean - rfDaily) / sd) * Math.sqrt(252)
    }
    const neg = dailyReturns.filter(x => x < 0)
    if (neg.length > 0) {
      const downSd = Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / neg.length)
      if (downSd > 0) {
        const rfDaily = 0.04 / 252
        sortino = ((mean - rfDaily) / downSd) * Math.sqrt(252)
      }
    }
  }

  const years = rows.length / 252
  const signalsPerYear = years > 0 ? totalBuys / years : 0
  const excessReturn = avgReturn != null ? avgReturn * 252 - bnhReturn : null

  return {
    ticker, sector, bars: rows.length,
    buySignals: totalBuys, wins: totalWins, losses: totalLosses,
    winRate, avgReturn20d: avgReturn,
    sharpeRatio: sharpe, sortinoRatio: sortino,
    maxDrawdown: maxDd, profitFactor, bnhReturn, excessReturn,
    signalsPerYear, isWinRate, oosWinRate, overfitGap,
  }
}

// ─── Main runner ─────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════')
console.log('  QUANTAN ENHANCED BENCHMARK — Phase 2 Signal')
console.log('  enhancedCombinedSignal (7-factor weighted)')
console.log('══════════════════════════════════════════════════\n')

const allData = loadAllTickers()
console.log(`Loaded ${allData.length} instruments\n`)

const results: InstrumentResult[] = []
let totalBuys = 0, totalWins = 0, totalLosses = 0

for (const { ticker, sector, rows } of allData) {
  process.stdout.write(`  [${sector.padEnd(18)}] ${ticker.padEnd(8)} `)
  const r = runInstrument(ticker, sector, rows)
  results.push(r)
  totalBuys += r.buySignals
  totalWins += r.wins
  totalLosses += r.losses

  const wr = r.winRate != null ? (r.winRate * 100).toFixed(1) + '%' : 'N/A   '
  const avg = r.avgReturn20d != null ? ((r.avgReturn20d * 100).toFixed(2) + '%').padStart(7) : '   N/A '
  const shp = r.sharpeRatio != null ? r.sharpeRatio.toFixed(2).padStart(5) : '  N/A'
  const oos = r.oosWinRate != null ? (r.oosWinRate * 100).toFixed(0) + '%' : 'N/A'
  const gap = r.overfitGap != null ? (r.overfitGap >= 0 ? '+' : '') + (r.overfitGap * 100).toFixed(0) + '%' : 'N/A'
  console.log(`WR: ${wr.padEnd(7)} AvgRet: ${avg} Sharpe: ${shp} | OOS: ${oos} Gap: ${gap} | Buys: ${r.buySignals}`)
}

// ─── Sector aggregates ────────────────────────────────────────────────────────

const sectorMap: Record<string, InstrumentResult[]> = {}
for (const r of results) {
  if (!sectorMap[r.sector]) sectorMap[r.sector] = []
  sectorMap[r.sector].push(r)
}

console.log('\n══════════════════════════════════════════════════')
console.log('  SECTOR SUMMARY')
console.log('══════════════════════════════════════════════════')

const sectorSummary: Record<string, {
  avgWinRate: number
  avgAvgReturn: number
  avgSharpe: number | null
  avgOOSWinRate: number | null
  tickers: string[]
  totalTrades: number
}> = {}

for (const [sector, sResults] of Object.entries(sectorMap)) {
  const hasWR = sResults.filter(r => r.winRate != null)
  const hasOOS = sResults.filter(r => r.oosWinRate != null)
  const hasSharpe = sResults.filter(r => r.sharpeRatio != null)
  const avgWR = hasWR.length > 0 ? hasWR.reduce((s, r) => s + (r.winRate ?? 0), 0) / hasWR.length : 0
  const avgRet = sResults.filter(r => r.avgReturn20d != null).reduce((s, r) => s + (r.avgReturn20d ?? 0), 0) / Math.max(1, sResults.filter(r => r.avgReturn20d != null).length)
  const avgShp = hasSharpe.length > 0 ? hasSharpe.reduce((s, r) => s + (r.sharpeRatio ?? 0), 0) / hasSharpe.length : null
  const avgOOS = hasOOS.length > 0 ? hasOOS.reduce((s, r) => s + (r.oosWinRate ?? 0), 0) / hasOOS.length : null
  const totalTrades = sResults.reduce((s, r) => s + r.buySignals, 0)
  sectorSummary[sector] = {
    avgWinRate: avgWR,
    avgAvgReturn: avgRet,
    avgSharpe: avgShp,
    avgOOSWinRate: avgOOS,
    tickers: sResults.map(r => r.ticker),
    totalTrades,
  }
  const oosStr = avgOOS != null ? (avgOOS * 100).toFixed(1) + '%' : 'N/A  '
  console.log(`  ${sector.padEnd(20)} WR: ${(avgWR * 100).toFixed(1)}% OOS: ${oosStr} Sharpe: ${avgShp?.toFixed(2) ?? 'N/A'} Trades: ${totalTrades}`)
}

// ─── Aggregate metrics ────────────────────────────────────────────────────────

const aggWinRate = totalBuys > 0 ? totalWins / totalBuys : 0
const instrumentsWithTrades = results.filter(r => r.buySignals > 0)
const avgWRPerInst = instrumentsWithTrades.length > 0
  ? instrumentsWithTrades.reduce((s, r) => s + (r.winRate ?? 0), 0) / instrumentsWithTrades.length
  : 0

const withOOS = results.filter(r => r.oosWinRate != null)
const avgOOS = withOOS.length > 0 ? withOOS.reduce((s, r) => s + (r.oosWinRate ?? 0), 0) / withOOS.length : 0

const withOverfit = results.filter(r => r.overfitGap != null)
const avgOverfitGap = withOverfit.length > 0 ? withOverfit.reduce((s, r) => s + (r.overfitGap ?? 0), 0) / withOverfit.length : 0

const sortedByWR = [...results].sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
const bottom10 = [...results].filter(r => r.winRate != null).sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0)).slice(0, 10)

console.log('\n══════════════════════════════════════════════════')
console.log('  AGGREGATE RESULTS')
console.log('══════════════════════════════════════════════════')
console.log(`  Instruments:             ${results.length}`)
console.log(`  Instruments with trades: ${instrumentsWithTrades.length}`)
console.log(`  Total BUY signals:       ${totalBuys}`)
console.log(`  Aggregate Win Rate:      ${(aggWinRate * 100).toFixed(2)}%`)
console.log(`  Avg WR per Instrument:   ${(avgWRPerInst * 100).toFixed(2)}%`)
console.log(`  Avg OOS Win Rate:        ${(avgOOS * 100).toFixed(2)}%`)
console.log(`  Avg Overfit Gap (IS-OOS): ${(avgOverfitGap * 100).toFixed(2)}%`)
console.log(`\n  BOTTOM 10 (need fixes):`)
for (const r of bottom10) {
  const wr = r.winRate != null ? (r.winRate * 100).toFixed(1) + '%' : 'N/A'
  console.log(`    ${r.ticker.padEnd(8)} ${r.sector.padEnd(18)} WR: ${wr} Buys: ${r.buySignals}`)
}

// ─── Save results ─────────────────────────────────────────────────────────────

const output = {
  timestamp: new Date().toISOString(),
  version: 'v2.0-phase2-enhanced',
  strategy: 'enhancedCombinedSignal — 7-factor weighted confluence (regime-adaptive)',
  aggregate: {
    totalInstruments: results.length,
    instrumentsWithTrades: instrumentsWithTrades.length,
    totalBuySignals: totalBuys,
    totalWins,
    totalLosses,
    aggregateWinRate: Number((aggWinRate * 100).toFixed(2)),
    avgWinRatePerInstrument: Number((avgWRPerInst * 100).toFixed(2)),
    avgOOSWinRate: Number((avgOOS * 100).toFixed(2)),
    avgOverfitGap: Number((avgOverfitGap * 100).toFixed(2)),
    vsBaseline: {
      baselineWinRate: 56.35,
      baselineAvgWinRatePerInst: 58.97,
      improvement: Number((aggWinRate * 100 - 56.35).toFixed(2)),
    },
  },
  sectorSummary,
  byInstrument: sortedByWR,
}

const outPath = join(__dirname, 'benchmark-results-enhanced.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`\n✓ Results saved to scripts/benchmark-results-enhanced.json`)
