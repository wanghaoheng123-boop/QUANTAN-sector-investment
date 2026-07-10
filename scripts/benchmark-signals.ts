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
  WARMUP_BARS,
} from '../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../lib/backtest/executionModel'
import { probabilisticSharpe, deflatedSharpe, sampleStd } from '../lib/quant/deflatedSharpe'

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

// ── Q-065: PSR / Deflated Sharpe on pooled per-trade NET returns ─────────────
// CAVEAT (printed + persisted): label trades OVERLAP (daily signals, 20d holds),
// so the effective sample is smaller than nTrades and PSR/DSR are OPTIMISTIC
// upper bounds. DSR shown as a sensitivity band (N=10 / N=100 assumed trials)
// rather than a single invented trials count.
const allTrades = results.flatMap((r) => r.trades)
const netRets = allTrades.map((t) => t.netReturn)
const perTradeSharpe =
  netRets.length > 1 && sampleStd(netRets) > 0
    ? netRets.reduce((a, b) => a + b, 0) / netRets.length / sampleStd(netRets)
    : null
const psr = probabilisticSharpe(netRets, 0)
const dsr10 = deflatedSharpe(netRets, 10)
const dsr100 = deflatedSharpe(netRets, 100)

// ── Base rate (2026-07-11 rethink): the honest context for the headline WR ──
// Net-label outcome of "BUY every eligible bar" on the SAME universe/window/
// costs. On a survivor universe in a bull window this sits well above 50%
// (54.02% at introduction), so the KPI that matters is EDGE OVER BASE RATE,
// not distance from a coin flip. (Medallion's famous 50.75% is a short-horizon
// long/short figure with a ~50% base rate — not comparable to long-only 20d.)
let baseBuys = 0
let baseNetWins = 0
let baseSumNet = 0
for (const { rows } of allData) {
  for (let i = WARMUP_BARS; i < rows.length - LABEL_HOLD_DAYS - 1; i++) {
    const entry = rows[i + 1].close
    const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, rows.length - 1)].close
    if (!(entry > 0) || !(exit > 0)) continue
    const gross = (exit - entry) / entry
    const net = netReturnAfterCosts(gross, DEFAULT_EXECUTION_COSTS)
    baseBuys++
    baseSumNet += net
    if (net > 0) baseNetWins++
  }
}
const baseRateNetWR = baseBuys > 0 ? (baseNetWins / baseBuys) * 100 : 0
const baseRateAvgNet = baseBuys > 0 ? (baseSumNet / baseBuys) * 100 : 0

// ── Q-066: regime-bucketed WR (zone at the signal bar) ───────────────────────
const bucketMap = new Map<string, { n: number; netWins: number; sumNet: number }>()
for (const t of allTrades) {
  const b = bucketMap.get(t.zone) ?? { n: 0, netWins: 0, sumNet: 0 }
  b.n++
  if (t.netReturn > 0) b.netWins++
  b.sumNet += t.netReturn
  bucketMap.set(t.zone, b)
}
const regimeBuckets = Array.from(bucketMap.entries())
  .map(([zone, b]) => ({
    zone,
    trades: b.n,
    netWinRate: Number(((b.netWins / b.n) * 100).toFixed(2)),
    avgNetReturn20d: Number(((b.sumNet / b.n) * 100).toFixed(4)),
  }))
  .sort((a, b) => b.trades - a.trades)

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
  // Q-065 (additive): per-trade Sharpe + PSR/DSR on pooled net label returns.
  tradeStats: {
    nTrades: netRets.length,
    perTradeSharpe: perTradeSharpe == null ? null : Number(perTradeSharpe.toFixed(4)),
    psrGtZero: psr == null ? null : Number(psr.toFixed(4)),
    deflatedSharpeN10: dsr10 == null ? null : Number(dsr10.toFixed(4)),
    deflatedSharpeN100: dsr100 == null ? null : Number(dsr100.toFixed(4)),
    note:
      'Bailey-Lopez de Prado PSR/DSR on pooled per-trade 20d NET returns. Trades overlap (daily signals, 20d holds) so these are OPTIMISTIC upper bounds; DSR shown as an N=10/N=100 assumed-trials sensitivity band.',
  },
  // 2026-07-11 rethink (additive): "BUY every bar" base rate on the same
  // universe/window/costs — the honest yardstick for the headline WR.
  alwaysBuyBaseline: {
    nBars: baseBuys,
    netWinRatePct: Number(baseRateNetWR.toFixed(2)),
    avgNetReturn20dPct: Number(baseRateAvgNet.toFixed(4)),
    note:
      'Unconditional long exposure on this survivor universe/bull window. The strategy KPI is EDGE OVER THIS BASE RATE; note the CI net-WR floor (53.29) sits BELOW it — floor re-baseline is an owner decision tracked in the 2026-07-11 rethink.',
  },
  edgeOverBaseRatePp: Number((Number((aggNetWinRate * 100).toFixed(2)) - Number(baseRateNetWR.toFixed(2))).toFixed(2)),
  // Q-066 (additive): WR bucketed by the regime zone at the signal bar.
  regimeBuckets,
  // byInstrument keeps its EXACT pre-Q-065 shape: strip the per-trade detail.
  byInstrument: results
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .map(({ trades: _trades, ...rest }) => rest),
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
console.log(
  `Per-trade Sharpe (net): ${benchmark.tradeStats.perTradeSharpe} | PSR(>0): ${benchmark.tradeStats.psrGtZero} | DSR N=10/N=100: ${benchmark.tradeStats.deflatedSharpeN10} / ${benchmark.tradeStats.deflatedSharpeN100} (overlapping trades — optimistic bounds)`,
)
console.log(
  `Always-buy base rate (net): ${benchmark.alwaysBuyBaseline.netWinRatePct}% over ${benchmark.alwaysBuyBaseline.nBars} bars | strategy edge over base: ${benchmark.edgeOverBaseRatePp}pp`,
)
console.log('Regime buckets (net WR / avg net 20d):')
for (const b of benchmark.regimeBuckets) {
  console.log(`  ${b.zone.padEnd(14)} n=${String(b.trades).padStart(4)}  WR ${b.netWinRate}%  avg ${b.avgNetReturn20d}%`)
}
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
