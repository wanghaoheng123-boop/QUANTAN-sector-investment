/**
 * scripts/portfolio-backtest.ts — Phase 8 Loop 3: Portfolio-level backtest
 *
 * Runs the multi-instrument portfolio engine across all 56 instruments.
 * Iterates over representative exit parameter sets from LOOP3_EXIT_GRID,
 * picks the config with the best risk-adjusted OOS Sharpe, and reports
 * full portfolio metrics (Sharpe, Sortino, max drawdown, VaR, exit breakdown).
 *
 * Usage: npm run portfolio:backtest
 * Output: scripts/portfolio-backtest-results.json
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { runPortfolioBacktest, DEFAULT_PORTFOLIO_CONFIG } from '../lib/backtest/portfolioBacktest'
import type { PortfolioBacktestResult, PortfolioConfig } from '../lib/backtest/portfolioBacktest'
import { DEFAULT_EXIT_CONFIG } from '../lib/backtest/exitRules'
import type { ExitConfig } from '../lib/backtest/exitRules'
import { LOOP3_EXIT_GRID, OPTIMIZATION_TARGETS } from '../lib/optimize/parameterSets'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')

// ─── Sector universe ──────────────────────────────────────────────────────────

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

interface OhlcvRow {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | undefined
}

interface CandleFile {
  ticker?: string
  sector?: string
  candles: OhlcvRow[]
}

function loadAllInstruments(): {
  instrumentData: Record<string, OhlcvRow[]>
  sectorMap: Record<string, string>
} {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }

  const instrumentData: Record<string, OhlcvRow[]> = {}
  const sectorMap: Record<string, string> = {}

  for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    const raw = readFileSync(join(dataDir, f), 'utf-8')
    const data = JSON.parse(raw) as CandleFile
    const ticker = f.replace('.json', '').replace(/-/g, '.')
    const rows: OhlcvRow[] = (data.candles ?? []).filter(
      c => Number.isFinite(c.time) && Number.isFinite(c.open) &&
           Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close),
    )
    if (rows.length >= 252) {
      instrumentData[ticker] = rows
      sectorMap[ticker] = SECTORS_MAP[ticker] ?? data.sector ?? 'Unknown'
    }
  }

  return { instrumentData, sectorMap }
}

// ─── Exit config candidates ───────────────────────────────────────────────────

function buildExitConfigs(): Array<{ label: string; config: ExitConfig }> {
  const configs: Array<{ label: string; config: ExitConfig }> = []

  // Default baseline
  configs.push({ label: 'default', config: DEFAULT_EXIT_CONFIG })

  // Systematic sample from LOOP3_EXIT_GRID: representative combos
  const { maxHoldDays, profitTakePct, trailingStopPct, panicExitAtrMultiple } = LOOP3_EXIT_GRID

  // Short hold / tight profit-take (momentum style)
  configs.push({
    label: `hold${maxHoldDays[0]}_pt${(profitTakePct[0] * 100).toFixed(0)}_trail${(trailingStopPct[0] * 100).toFixed(0)}_panic${panicExitAtrMultiple[0]}`,
    config: {
      maxHoldDays: maxHoldDays[0],
      profitTakePct: profitTakePct[0],
      trailingStopPct: trailingStopPct[0],
      panicExitAtrMultiple: panicExitAtrMultiple[0],
      signalBasedExit: true,
      atrStopMultiplier: 1.5,
    },
  })

  // Medium hold / medium profit-take (balanced)
  configs.push({
    label: `hold${maxHoldDays[1]}_pt${(profitTakePct[1] * 100).toFixed(0)}_trail${(trailingStopPct[1] * 100).toFixed(0)}_panic${panicExitAtrMultiple[1]}`,
    config: {
      maxHoldDays: maxHoldDays[1],
      profitTakePct: profitTakePct[1],
      trailingStopPct: trailingStopPct[1],
      panicExitAtrMultiple: panicExitAtrMultiple[1],
      signalBasedExit: true,
      atrStopMultiplier: 1.8,
    },
  })

  // Long hold / high profit-take (trend following)
  configs.push({
    label: `hold${maxHoldDays[3]}_pt${(profitTakePct[3] * 100).toFixed(0)}_trail${(trailingStopPct[2] * 100).toFixed(0)}_panic${panicExitAtrMultiple[2]}`,
    config: {
      maxHoldDays: maxHoldDays[3],
      profitTakePct: profitTakePct[3],
      trailingStopPct: trailingStopPct[2],
      panicExitAtrMultiple: panicExitAtrMultiple[2],
      signalBasedExit: true,
      atrStopMultiplier: 2.0,
    },
  })

  // Wide stops / no panic exit (high conviction)
  configs.push({
    label: `hold${maxHoldDays[2]}_pt${(profitTakePct[2] * 100).toFixed(0)}_trail${(trailingStopPct[1] * 100).toFixed(0)}_panic${panicExitAtrMultiple[2]}`,
    config: {
      maxHoldDays: maxHoldDays[2],
      profitTakePct: profitTakePct[2],
      trailingStopPct: trailingStopPct[1],
      panicExitAtrMultiple: panicExitAtrMultiple[2],
      signalBasedExit: false,  // pure time+price exits
      atrStopMultiplier: 2.5,
    },
  })

  return configs
}

// ─── Print result ─────────────────────────────────────────────────────────────

function printResult(label: string, r: PortfolioBacktestResult): void {
  const annRet = (r.annualizedReturn * 100).toFixed(2) + '%'
  const totalRet = (r.totalReturn * 100).toFixed(2) + '%'
  const sharpe = r.sharpeRatio != null ? r.sharpeRatio.toFixed(3) : 'N/A'
  const sortino = r.sortinoRatio != null ? r.sortinoRatio.toFixed(3) : 'N/A'
  const maxDd = (r.maxDrawdown * 100).toFixed(2) + '%'
  const wr = (r.winRate * 100).toFixed(2) + '%'
  const pf = Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(3) : 'Inf'
  const var95 = r.varMetrics.var95_1d != null ? (r.varMetrics.var95_1d * 100).toFixed(3) + '%' : 'N/A'
  const var99 = r.varMetrics.var99_1d != null ? (r.varMetrics.var99_1d * 100).toFixed(3) + '%' : 'N/A'

  console.log(`\n  ── Config: ${label}`)
  console.log(`     Trades:     ${r.totalTrades}  WinRate: ${wr}  AvgReturn: ${(r.avgTradeReturn * 100).toFixed(3)}%`)
  console.log(`     Ann.Ret:    ${annRet}  TotalRet: ${totalRet}`)
  console.log(`     Sharpe:     ${sharpe}  Sortino: ${sortino}`)
  console.log(`     MaxDD:      ${maxDd}  ProfitFactor: ${pf}`)
  console.log(`     VaR(95):    ${var95}  VaR(99): ${var99}`)
  console.log(`     MaxConc:    ${r.maxConcurrentPositions}  AvgConc: ${r.avgConcurrentPositions.toFixed(1)}`)

  // Exit breakdown
  const exits = r.exitReasonBreakdown
  const exitStr = Object.entries(exits)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join('  ')
  console.log(`     Exits:      ${exitStr}`)

  // Sector attribution
  const sectors = Object.entries(r.sectorAttribution)
    .filter(([, v]) => v.trades > 0)
    .sort((a, b) => b[1].winRate - a[1].winRate)
  if (sectors.length > 0) {
    console.log(`     Sectors:`)
    for (const [sect, v] of sectors) {
      const status = v.winRate >= 0.58 ? '✓' : v.winRate >= 0.45 ? '~' : '✗'
      console.log(`       ${status} ${sect.padEnd(20)} WR: ${(v.winRate * 100).toFixed(1)}%  avgRet: ${(v.avgReturn * 100).toFixed(2)}%  trades: ${v.trades}`)
    }
  }
}

// ─── Score for ranking configs ────────────────────────────────────────────────

function scoreResult(r: PortfolioBacktestResult): number {
  if (r.totalTrades < 10) return -Infinity
  const sharpe = r.sharpeRatio ?? 0
  const ddPenalty = Math.max(0, r.maxDrawdown - 0.20) * 5  // penalize DD > 20%
  const tradePenalty = r.totalTrades < 30 ? (30 - r.totalTrades) * 0.01 : 0
  const varPenalty = (r.varMetrics.var99_1d ?? 0) > 0.08 ? 0.5 : 0  // VaR99 > 8%
  return sharpe - ddPenalty - tradePenalty - varPenalty
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const startTime = Date.now()
console.log('\n══════════════════════════════════════════════════════')
console.log('  QUANTAN — Phase 8 Loop 3: Portfolio Backtest')
console.log('  Multi-instrument (max 10 positions, correlation-adjusted Kelly)')
console.log('  Testing 6 exit rule configurations')
console.log('══════════════════════════════════════════════════════')

const { instrumentData, sectorMap } = loadAllInstruments()
console.log(`\nLoaded ${Object.keys(instrumentData).length} instruments`)

const exitConfigs = buildExitConfigs()
const runResults: Array<{
  label: string
  exitConfig: ExitConfig
  result: PortfolioBacktestResult
  score: number
}> = []

for (const { label, config: exitCfg } of exitConfigs) {
  process.stdout.write(`\n  Running: ${label} ... `)
  const t0 = Date.now()

  const portfolioConfig: Partial<PortfolioConfig> = {
    ...DEFAULT_PORTFOLIO_CONFIG,
    exit: exitCfg,
  }

  const result = runPortfolioBacktest(instrumentData, sectorMap, portfolioConfig)
  const score = scoreResult(result)
  runResults.push({ label, exitConfig: exitCfg, result, score })

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`done (${elapsed}s)  Sharpe=${result.sharpeRatio?.toFixed(3) ?? 'N/A'}  WR=${(result.winRate * 100).toFixed(1)}%  DD=${(result.maxDrawdown * 100).toFixed(1)}%`)
}

// ─── Print all results ────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════')
console.log('  DETAILED RESULTS')
console.log('══════════════════════════════════════════════════════')
for (const { label, result } of runResults) {
  printResult(label, result)
}

// ─── Ranking ──────────────────────────────────────────────────────────────────
const ranked = [...runResults].sort((a, b) => b.score - a.score)
const best = ranked[0]

console.log('\n══════════════════════════════════════════════════════')
console.log('  RANKING (by risk-adjusted Sharpe)')
console.log('══════════════════════════════════════════════════════')
for (const [i, { label, result, score }] of ranked.entries()) {
  const sharpe = result.sharpeRatio?.toFixed(3) ?? 'N/A'
  const wr = (result.winRate * 100).toFixed(1)
  const dd = (result.maxDrawdown * 100).toFixed(1)
  const mark = i === 0 ? '★' : ' '
  console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${label.padEnd(60)}  score=${score.toFixed(3)}  Sharpe=${sharpe}  WR=${wr}%  DD=${dd}%`)
}

// ─── Target assessment ────────────────────────────────────────────────────────
const t3 = OPTIMIZATION_TARGETS.loop3
const br = best.result
console.log('\n══════════════════════════════════════════════════════')
console.log('  BEST CONFIG vs LOOP 3 TARGETS')
console.log('══════════════════════════════════════════════════════')
console.log(`  Config:              ${best.label}`)
const checks = [
  { name: 'Portfolio Sharpe ≥ 1.0', pass: (br.sharpeRatio ?? 0) >= t3.minPortfolioSharpe, val: br.sharpeRatio?.toFixed(3) ?? 'N/A' },
  { name: 'Max Drawdown ≤ 20%',     pass: br.maxDrawdown <= t3.maxPortfolioDrawdown,       val: (br.maxDrawdown * 100).toFixed(1) + '%' },
  { name: 'Win Rate ≥ 62%',         pass: br.winRate >= t3.minOOSWinRate,                  val: (br.winRate * 100).toFixed(1) + '%' },
  { name: 'VaR99 10d ≤ 8%',         pass: (br.varMetrics.var99_1d ?? 0) * Math.sqrt(10) <= t3.maxVaR99_10d, val: br.varMetrics.var99_1d != null ? ((br.varMetrics.var99_1d * Math.sqrt(10)) * 100).toFixed(2) + '%' : 'N/A' },
]
for (const c of checks) {
  console.log(`  ${c.pass ? '✓' : '✗'} ${c.name.padEnd(35)} ${c.val}`)
}

// ─── Save results ─────────────────────────────────────────────────────────────

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\n  Elapsed: ${elapsed}s`)

const output = {
  timestamp: new Date().toISOString(),
  version: 'v1.0-phase8-loop3',
  elapsed_seconds: Number(elapsed),
  instruments: Object.keys(instrumentData).length,
  bestConfig: {
    label: best.label,
    exitConfig: best.exitConfig,
    score: best.score,
  },
  targets: OPTIMIZATION_TARGETS.loop3,
  ranking: ranked.map(({ label, exitConfig, result, score }) => ({
    label,
    score: Number(score.toFixed(4)),
    exitConfig,
    metrics: {
      totalTrades: result.totalTrades,
      winRate: Number((result.winRate * 100).toFixed(2)),
      avgTradeReturn: Number((result.avgTradeReturn * 100).toFixed(3)),
      annualizedReturn: Number((result.annualizedReturn * 100).toFixed(2)),
      totalReturn: Number((result.totalReturn * 100).toFixed(2)),
      sharpeRatio: result.sharpeRatio != null ? Number(result.sharpeRatio.toFixed(4)) : null,
      sortinoRatio: result.sortinoRatio != null ? Number(result.sortinoRatio.toFixed(4)) : null,
      maxDrawdown: Number((result.maxDrawdown * 100).toFixed(2)),
      profitFactor: Number.isFinite(result.profitFactor) ? Number(result.profitFactor.toFixed(4)) : null,
      maxConcurrentPositions: result.maxConcurrentPositions,
      varMetrics: {
        var95_1d: result.varMetrics.var95_1d != null ? Number((result.varMetrics.var95_1d * 100).toFixed(3)) : null,
        var99_1d: result.varMetrics.var99_1d != null ? Number((result.varMetrics.var99_1d * 100).toFixed(3)) : null,
      },
      exitReasonBreakdown: result.exitReasonBreakdown,
      sectorAttribution: Object.fromEntries(
        Object.entries(result.sectorAttribution).map(([k, v]) => [k, {
          trades: v.trades,
          winRate: Number((v.winRate * 100).toFixed(1)),
          avgReturn: Number((v.avgReturn * 100).toFixed(3)),
        }]),
      ),
    },
  })),
  bestFullEquityCurve: best.result.equityCurve,
  bestTrades: best.result.trades.map(t => ({
    ticker: t.ticker, sector: t.sector,
    entryDate: t.entryDate, exitDate: t.exitDate,
    pnlPct: Number((t.pnlPct * 100).toFixed(3)),
    exitReason: t.exitReason,
    confidence: t.confidence,
  })),
}

const outPath = join(__dirname, 'portfolio-backtest-results.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`  Results saved → scripts/portfolio-backtest-results.json`)
