/**
 * scripts/portfolio-backtest.ts — portfolio-level exit-family grid
 *
 * Q-076 (2026-07-16): the grid explores the LABEL-MATCHED exit family
 * (time-only exits — the D2/D4 production default) instead of the retired
 * stop family, whose members ALL scored negative Sharpe on the 2026-07-13
 * sweep. The legacy DEFAULT_EXIT_CONFIG is kept as a single reference row.
 *
 * Q-064 protocol (purged IS→OOS selection, no selection-on-OOS bias):
 *   1. Every config runs on the IS window (bars strictly before the
 *      OOS_BOUNDARY date, minus a LABEL_HOLD purge so no IS hold crosses in).
 *   2. The config with the best IS score is SELECTED.
 *   3. That one config is validated ONCE on the OOS window (boundary → end,
 *      with a 220-bar warmup prefix feeding indicators only). These are the
 *      headline numbers.
 *   4. Full-window runs for every config are reported as context.
 *
 * Runs on the PRODUCTION signal path (QUANTAN_USE_ENHANCED_SIGNAL=0) so
 * results are comparable with /api/backtest and the D2/D4 ship numbers.
 *
 * Usage: npm run portfolio:backtest
 * Output: scripts/portfolio-backtest-results.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = process.env.QUANTAN_USE_ENHANCED_SIGNAL ?? '0'

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { runPortfolioBacktest, DEFAULT_PORTFOLIO_CONFIG } from '../lib/backtest/portfolioBacktest'
import type { PortfolioBacktestResult, PortfolioConfig } from '../lib/backtest/portfolioBacktest'
import { DEFAULT_EXIT_CONFIG, LABEL_MATCHED_EXIT_CONFIG } from '../lib/backtest/exitRules'
import type { ExitConfig } from '../lib/backtest/exitRules'
import { OPTIMIZATION_TARGETS } from '../lib/optimize/parameterSets'
import { LABEL_HOLD_DAYS } from '../lib/backtest/benchmarkLabel'
import type { OhlcvRow } from '../lib/backtest/dataLoader'

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

interface CandleFile {
  ticker?: string
  sector?: string
  candles: Array<Omit<OhlcvRow, 'volume'> & { volume?: number }>
}

function normalizeRows(candles: CandleFile['candles']): OhlcvRow[] {
  return candles
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .map((c) => ({
      ...c,
      volume: typeof c.volume === 'number' && Number.isFinite(c.volume) ? c.volume : 0,
    }))
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

  // Phase 14 wave 7: only class-share filenames use dash→dot mangling.
  // Crypto pairs like BTC-USD.json must stay as BTC-USD (matches the
  // normalizeTicker regex updated in R4-M-2). Previously every dash was
  // replaced unconditionally, mangling BTC-USD → BTC.USD and breaking the
  // sector-attribution lookup for every crypto file.
  const CLASS_SHARE_TICKERS = new Set(['BRK-B', 'BRK-A', 'BF-B', 'BF-A', 'RDS-B', 'RDS-A'])
  function tickerFromFilename(filename: string): string {
    const base = filename.replace('.json', '')
    return CLASS_SHARE_TICKERS.has(base) ? base.replace('-', '.') : base
  }

  for (const f of readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
    const raw = readFileSync(join(dataDir, f), 'utf-8')
    const data = JSON.parse(raw) as CandleFile
    const ticker = tickerFromFilename(f)
    const rows = normalizeRows(data.candles ?? [])
    if (rows.length >= 252) {
      instrumentData[ticker] = rows
      sectorMap[ticker] = SECTORS_MAP[ticker] ?? data.sector ?? 'Unknown'
    }
  }

  return { instrumentData, sectorMap }
}

// ─── Config candidates (Q-076: label-matched exit family) ────────────────────

interface CandidateConfig {
  label: string
  exit: ExitConfig
  portfolio: Partial<PortfolioConfig>
}

/** Time-only exit with hold horizon H — the label-matched family (D2/D4). */
function timeOnlyExit(holdDays: number): ExitConfig {
  return { ...LABEL_MATCHED_EXIT_CONFIG, maxHoldDays: holdDays }
}

function buildCandidates(): CandidateConfig[] {
  const configs: CandidateConfig[] = []

  // Hold-horizon sweep (time-only exits; H=20 is the shipped default)
  for (const h of [10, 20, 40, 60]) {
    configs.push({
      label: `labelMatched_H${h}${h === 20 ? '_shippedDefault' : ''}`,
      exit: timeOnlyExit(h),
      portfolio: {},
    })
  }

  // Structure sweep around the shipped exit (slots + concentration cap)
  configs.push({
    label: 'labelMatched_H20_maxPos5',
    exit: timeOnlyExit(20),
    portfolio: { maxPositions: 5 },
  })
  configs.push({
    label: 'labelMatched_H20_maxPos15',
    exit: timeOnlyExit(20),
    portfolio: { maxPositions: 15 },
  })
  configs.push({
    label: 'labelMatched_H20_cap10pct',
    exit: timeOnlyExit(20),
    portfolio: { maxSinglePositionPct: 0.10 },
  })

  // Retired stop family — single reference row so the report keeps showing
  // WHY it was retired (all members scored negative Sharpe, 2026-07-13 sweep).
  configs.push({
    label: 'legacyStopFamily_reference',
    exit: DEFAULT_EXIT_CONFIG,
    portfolio: {},
  })

  return configs
}

// ─── Q-064: purged IS / OOS windows ──────────────────────────────────────────

/** First bar of the OOS window (calendar date, exclusive end of IS). */
const OOS_BOUNDARY_ISO = '2025-01-01'
const OOS_BOUNDARY_TS = Date.UTC(2025, 0, 1) / 1000
/** Engine warmup on each instrument's own calendar. */
const ENGINE_WARMUP_BARS = 220

/**
 * IS window: bars strictly before the boundary MINUS a label-hold purge, so
 * no IS position's hold window extends into OOS (the engine force-closes at
 * slice end; without the purge those force-closes would leak boundary-
 * adjacent information into IS metrics).
 */
function sliceIS(rows: OhlcvRow[]): OhlcvRow[] {
  const boundaryIdx = rows.findIndex((r) => r.time >= OOS_BOUNDARY_TS)
  if (boundaryIdx < 0) return rows // series ends before the boundary
  return rows.slice(0, Math.max(0, boundaryIdx - (LABEL_HOLD_DAYS + 1)))
}

/**
 * OOS window: boundary → end, prefixed with the engine's warmup bars.
 * Warmup bars feed indicators only — the engine cannot enter before its
 * 220-bar warmup, so the first possible OOS entry is at the boundary itself.
 */
function sliceOOS(rows: OhlcvRow[]): OhlcvRow[] {
  const boundaryIdx = rows.findIndex((r) => r.time >= OOS_BOUNDARY_TS)
  if (boundaryIdx < 0) return []
  return rows.slice(Math.max(0, boundaryIdx - ENGINE_WARMUP_BARS))
}

function sliceAll(
  instrumentData: Record<string, OhlcvRow[]>,
  slicer: (rows: OhlcvRow[]) => OhlcvRow[],
): Record<string, OhlcvRow[]> {
  const out: Record<string, OhlcvRow[]> = {}
  for (const [t, rows] of Object.entries(instrumentData)) {
    const sliced = slicer(rows)
    if (sliced.length >= 252) out[t] = sliced
  }
  return out
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
console.log('  QUANTAN — Portfolio exit-family grid (Q-076)')
console.log('  Label-matched (time-only) family + legacy reference')
console.log(`  Protocol (Q-064): select on IS (< ${OOS_BOUNDARY_ISO}, ${LABEL_HOLD_DAYS + 1}-bar purge),`)
console.log('  validate the ONE selected config OOS; full window = context only')
console.log('══════════════════════════════════════════════════════')

const { instrumentData, sectorMap } = loadAllInstruments()
console.log(`\nLoaded ${Object.keys(instrumentData).length} instruments`)

const isData = sliceAll(instrumentData, sliceIS)
const oosData = sliceAll(instrumentData, sliceOOS)
console.log(`IS universe: ${Object.keys(isData).length} instruments | OOS universe: ${Object.keys(oosData).length}`)

const candidates = buildCandidates()

interface RunRow {
  label: string
  exitConfig: ExitConfig
  portfolioOverrides: Partial<PortfolioConfig>
  isResult: PortfolioBacktestResult
  isScore: number
  fullResult: PortfolioBacktestResult
  fullScore: number
}

const runResults: RunRow[] = []
for (const cand of candidates) {
  process.stdout.write(`\n  Running: ${cand.label} ... `)
  const t0 = Date.now()
  const cfg: Partial<PortfolioConfig> = {
    ...DEFAULT_PORTFOLIO_CONFIG,
    ...cand.portfolio,
    exit: cand.exit,
  }
  const isResult = runPortfolioBacktest(isData, sectorMap, cfg)
  const fullResult = runPortfolioBacktest(instrumentData, sectorMap, cfg)
  runResults.push({
    label: cand.label,
    exitConfig: cand.exit,
    portfolioOverrides: cand.portfolio,
    isResult,
    isScore: scoreResult(isResult),
    fullResult,
    fullScore: scoreResult(fullResult),
  })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(
    `done (${elapsed}s)  IS Sharpe=${isResult.sharpeRatio?.toFixed(3) ?? 'N/A'} ret=${(isResult.totalReturn * 100).toFixed(1)}% | full Sharpe=${fullResult.sharpeRatio?.toFixed(3) ?? 'N/A'} ret=${(fullResult.totalReturn * 100).toFixed(1)}%`,
  )
}

// ─── Q-064: select on IS, validate the ONE winner OOS ────────────────────────
const rankedIs = [...runResults].sort((a, b) => b.isScore - a.isScore)
const selected = rankedIs[0]
process.stdout.write(`\n  OOS validation of IS-selected "${selected.label}" ... `)
const oosResult = runPortfolioBacktest(oosData, sectorMap, {
  ...DEFAULT_PORTFOLIO_CONFIG,
  ...selected.portfolioOverrides,
  exit: selected.exitConfig,
})
console.log(
  `done  OOS Sharpe=${oosResult.sharpeRatio?.toFixed(3) ?? 'N/A'}  ret=${(oosResult.totalReturn * 100).toFixed(1)}%  DD=${(oosResult.maxDrawdown * 100).toFixed(1)}%  trades=${oosResult.totalTrades}`,
)

// ─── Print detailed results ───────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════')
console.log('  DETAILED RESULTS (full window, context)')
console.log('══════════════════════════════════════════════════════')
for (const { label, fullResult } of runResults) {
  printResult(label, fullResult)
}
console.log('\n══════════════════════════════════════════════════════')
console.log(`  OOS VALIDATION — ${selected.label} (selected on IS only)`)
console.log('══════════════════════════════════════════════════════')
printResult(`${selected.label} [OOS ${OOS_BOUNDARY_ISO} →]`, oosResult)

// ─── Ranking ──────────────────────────────────────────────────────────────────
const best = selected
console.log('\n══════════════════════════════════════════════════════')
console.log('  IS RANKING (selection basis — OOS never consulted)')
console.log('══════════════════════════════════════════════════════')
for (const [i, { label, isResult, isScore, fullResult }] of rankedIs.entries()) {
  const isSharpe = isResult.sharpeRatio?.toFixed(3) ?? 'N/A'
  const fullSharpe = fullResult.sharpeRatio?.toFixed(3) ?? 'N/A'
  const mark = i === 0 ? '★' : ' '
  console.log(
    `  ${mark} ${String(i + 1).padStart(2)}. ${label.padEnd(40)}  isScore=${isScore.toFixed(3)}  IS Sharpe=${isSharpe}  full Sharpe=${fullSharpe}  IS ret=${(isResult.totalReturn * 100).toFixed(1)}%`,
  )
}

// ─── Target assessment (on the honest OOS validation) ────────────────────────
const t3 = OPTIMIZATION_TARGETS.loop3
const br = oosResult
console.log('\n══════════════════════════════════════════════════════')
console.log('  IS-SELECTED CONFIG vs LOOP 3 TARGETS (measured OOS)')
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

function metricsOf(result: PortfolioBacktestResult) {
  return {
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
  }
}

const output = {
  timestamp: new Date().toISOString(),
  version: 'v2.0-q076-label-matched-grid',
  protocol: {
    description:
      'Q-064/Q-076: label-matched exit-family grid; selection on IS only (purged), one OOS validation of the selected config; full window = context',
    oosBoundary: OOS_BOUNDARY_ISO,
    isPurgeBars: LABEL_HOLD_DAYS + 1,
    signalPath: `QUANTAN_USE_ENHANCED_SIGNAL=${process.env.QUANTAN_USE_ENHANCED_SIGNAL}`,
  },
  elapsed_seconds: Number(elapsed),
  instruments: Object.keys(instrumentData).length,
  selectedConfig: {
    label: best.label,
    exitConfig: best.exitConfig,
    portfolioOverrides: best.portfolioOverrides,
    isScore: Number(best.isScore.toFixed(4)),
  },
  oosValidation: metricsOf(oosResult),
  targets: OPTIMIZATION_TARGETS.loop3,
  isRanking: rankedIs.map(({ label, exitConfig, portfolioOverrides, isResult, isScore }) => ({
    label,
    isScore: Number(isScore.toFixed(4)),
    exitConfig,
    portfolioOverrides,
    metrics: metricsOf(isResult),
  })),
  fullWindowContext: runResults.map(({ label, fullResult, fullScore }) => ({
    label,
    fullScore: Number(fullScore.toFixed(4)),
    metrics: metricsOf(fullResult),
  })),
  bestFullEquityCurve: best.fullResult.equityCurve,
  bestTrades: best.fullResult.trades.map(t => ({
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
