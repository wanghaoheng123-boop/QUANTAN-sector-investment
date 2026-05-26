/**
 * Canonical CI benchmark — uses resolveBacktestSignal (production path) via benchmarkLabel SSOT.
 * Forces QUANTAN_USE_ENHANCED_SIGNAL=0 so WR matches Vercel production.
 *
 * Usage: npm run benchmark
 * Output: scripts/benchmark-results.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import {
  runInstrumentLabelBenchmark,
  roundTripCostPct,
  LABEL_HOLD_DAYS,
} from '../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS } from '../lib/backtest/executionModel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')

function loadAllTickers(): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const raw = readFileSync(join(dataDir, f), 'utf-8')
      const data = JSON.parse(raw) as { sector?: string; candles?: OhlcvRow[] }
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const rows = (data.candles ?? []).filter(
        (c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      return { ticker, sector: data.sector ?? 'Unknown', rows }
    })
    .filter((d) => d.rows.length >= 252)
}

console.log('Loading data (SSOT: resolveBacktestSignal, production path)...')
const allData = loadAllTickers()
console.log(`Loaded ${allData.length} instruments`)

const results = []
let totalBuySignals = 0
let totalWins = 0
let totalLosses = 0
let totalNetWins = 0

for (const { ticker, sector, rows } of allData) {
  const stats = runInstrumentLabelBenchmark(ticker, sector, rows, { productionPath: true })
  if (!stats) continue
  results.push(stats)
  totalBuySignals += stats.buySignals
  totalWins += stats.wins
  totalLosses += stats.losses
  if (stats.netWinRate != null && stats.buySignals > 0) {
    totalNetWins += Math.round(stats.netWinRate * stats.buySignals)
  }
}

const aggWinRate = totalBuySignals > 0 ? totalWins / totalBuySignals : 0
const aggNetWinRate = totalBuySignals > 0 ? totalNetWins / totalBuySignals : 0

const instrumentsWithTrades = results.filter((r) => r.buySignals > 0)
const avgWinRatePerInstrument =
  instrumentsWithTrades.length > 0
    ? instrumentsWithTrades.reduce((s, r) => s + (r.winRate ?? 0), 0) / instrumentsWithTrades.length
    : 0

const avgReturn =
  results.reduce((s, r) => s + (r.avgReturn20d ?? 0) * r.buySignals, 0) /
  Math.max(1, totalBuySignals)
const avgNetReturn =
  results.reduce((s, r) => s + (r.avgNetReturn20d ?? 0) * r.buySignals, 0) /
  Math.max(1, totalBuySignals)

const expectancyGross = avgReturn
const expectancyNet = avgNetReturn

const benchmark = {
  timestamp: new Date().toISOString(),
  version: 'v2.0-ssot-regime-production',
  strategy: 'resolveBacktestSignal (regime-only, QUANTAN_USE_ENHANCED_SIGNAL=0)',
  metricNote: `Label win rate: ${LABEL_HOLD_DAYS}d forward return after BUY; entry next close; gross and net after round-trip costs`,
  executionCosts: {
    ...DEFAULT_EXECUTION_COSTS,
    roundTripPct: Number((roundTripCostPct() * 100).toFixed(4)),
  },
  aggregate: {
    totalInstruments: results.length,
    instrumentsWithTrades: instrumentsWithTrades.length,
    totalBuySignals,
    totalWins,
    totalLosses,
    aggregateWinRate: Number((aggWinRate * 100).toFixed(2)),
    aggregateNetWinRate: Number((aggNetWinRate * 100).toFixed(2)),
    avgWinRatePerInstrument: Number((avgWinRatePerInstrument * 100).toFixed(2)),
    avgReturn20d: Number((avgReturn * 100).toFixed(4)),
    avgNetReturn20d: Number((avgNetReturn * 100).toFixed(4)),
    expectancyGrossPct: Number((expectancyGross * 100).toFixed(4)),
    expectancyNetPct: Number((expectancyNet * 100).toFixed(4)),
    avgHoldDays: LABEL_HOLD_DAYS,
  },
  byInstrument: results.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0)),
}

const outPath = join(__dirname, 'benchmark-results.json')
writeFileSync(outPath, JSON.stringify(benchmark, null, 2))

console.log('\n=== BENCHMARK RESULTS (SSOT) ===')
console.log(`Instruments: ${benchmark.aggregate.totalInstruments}`)
console.log(`Instruments with trades: ${benchmark.aggregate.instrumentsWithTrades}`)
console.log(`Total BUY signals: ${benchmark.aggregate.totalBuySignals}`)
console.log(`Wins: ${benchmark.aggregate.totalWins} | Losses: ${benchmark.aggregate.totalLosses}`)
console.log(`Aggregate Win Rate (gross label): ${benchmark.aggregate.aggregateWinRate}%`)
console.log(`Aggregate Win Rate (net after costs): ${benchmark.aggregate.aggregateNetWinRate}%`)
console.log(`Avg 20d return (gross): ${benchmark.aggregate.avgReturn20d}%`)
console.log(`Avg 20d return (net): ${benchmark.aggregate.avgNetReturn20d}%`)
console.log(`Expectancy gross/net: ${benchmark.aggregate.expectancyGrossPct}% / ${benchmark.aggregate.expectancyNetPct}%`)
console.log(`\nSaved to: ${outPath}`)

/** Frozen 2026-05-26 SSOT re-baseline (50 bps tolerance). See reviews/invariants-baseline.md §1b. */
const FLOOR_GROSS_WR = 54.27
const FLOOR_NET_WR = 53.29

if (benchmark.aggregate.aggregateNetWinRate < FLOOR_NET_WR) {
  console.error(
    `\nREGRESSION: net aggregate WR ${benchmark.aggregate.aggregateNetWinRate}% below floor ${FLOOR_NET_WR}%`,
  )
  process.exit(1)
}
if (benchmark.aggregate.aggregateWinRate < FLOOR_GROSS_WR) {
  console.warn(
    `WARN: gross aggregate WR ${benchmark.aggregate.aggregateWinRate}% below gross floor ${FLOOR_GROSS_WR}%`,
  )
}
