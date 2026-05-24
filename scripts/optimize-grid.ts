/**
 * scripts/optimize-grid.ts — Phase 8 Loop 1 + Loop 2: Walk-forward grid search
 *
 * Loop 1: Wide 768-combo grid per instrument (4×4×4×3×4).
 *         Strict IS/OOS: 70% in-sample, 30% OOS. Max 8pp overfit gap.
 *         Objective: maximize OOS Sharpe.
 *
 * Loop 2: After aggregating Loop 1 best params, runs 288-combo narrowed grid
 *         on each sector to surface per-sector optimal configurations.
 *
 * Output: scripts/optimization-results-loop1.json
 *
 * Loop 1 summary (2026-04-29 run — see reviews/optimization-loop1.md):
 *   - Aggregate OOS win rate ~25.7% — far below 56.35% production floor.
 *   - Do NOT ship grid winners as production defaults until enhanced path recovers.
 *   - Best sector rollup: Utilities ~52% OOS; many sectors flagged CRITICAL.
 *
 * Usage: npm run optimize:grid
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { gridSearch, aggregateGridResults } from '../lib/optimize/gridSearch'
import type { GridSearchSummary, GridSearchResult } from '../lib/optimize/gridSearch'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import {
  LOOP1_GRID,
  LOOP2_GRID,
  OPTIMIZATION_TARGETS,
  CURRENT_BASELINE,
} from '../lib/optimize/parameterSets'

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

function normalizeRows(
  candles: CandleFile['candles'],
): OhlcvRow[] {
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
      const rows = normalizeRows(data.candles ?? [])
      return { ticker, sector, rows }
    })
    .filter(d => d.rows.length >= 252)
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(n: number | null | undefined, dp = 1, suffix = '%'): string {
  if (n == null || !Number.isFinite(n)) return 'N/A'.padStart(5 + suffix.length)
  return (n * 100).toFixed(dp).padStart(5) + suffix
}

function fmtN(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return '  N/A'
  return n.toFixed(dp).padStart(5)
}

// ─── Loop 1: Per-instrument wide grid search ──────────────────────────────────

function runLoop1(
  instruments: Array<{ ticker: string; sector: string; rows: OhlcvRow[] }>,
): GridSearchSummary[] {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  LOOP 1 — Wide Grid Search (768 combos × 56 instruments)')
  console.log('  IS/OOS: 70/30 split | Overfit cap: 8pp | Min OOS trades: 10')
  console.log('══════════════════════════════════════════════════════\n')

  const summaries: GridSearchSummary[] = []

  for (const { ticker, sector, rows } of instruments) {
    process.stdout.write(`  [${sector.padEnd(18)}] ${ticker.padEnd(8)} `)
    const summary = gridSearch(rows, LOOP1_GRID, ticker, sector)
    summaries.push(summary)

    const b = summary.best
    const oosWR = fmt(b.oosWinRate)
    const isWR = fmt(b.isWinRate)
    const gap = (b.overfitGap >= 0 ? '+' : '') + (b.overfitGap * 100).toFixed(1) + '%'
    const valid = summary.validCombinations
    const score = fmtN(b.score)
    const oosSh = fmtN(b.oosSharpe)
    console.log(
      `valid: ${String(valid).padStart(3)}/${summary.totalCombinations}  ` +
      `IS: ${isWR} OOS: ${oosWR} gap: ${gap.padStart(5)}  ` +
      `oosSharpe: ${oosSh}  score: ${score}  ` +
      `OOStrades: ${b.oosTrades}`,
    )
  }

  return summaries
}

// ─── Loop 2: Per-sector narrow grid search ────────────────────────────────────

function runLoop2(
  instruments: Array<{ ticker: string; sector: string; rows: OhlcvRow[] }>,
  loop1Summaries: GridSearchSummary[],
): Record<string, GridSearchSummary[]> {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  LOOP 2 — Sector-level Narrow Grid (288 combos)')
  console.log('  Narrowed around Loop 1 best results per sector')
  console.log('══════════════════════════════════════════════════════\n')

  const byTicker = new Map(loop1Summaries.map(s => [s.ticker, s]))
  const bySector: Record<string, typeof instruments> = {}
  for (const inst of instruments) {
    if (!bySector[inst.sector]) bySector[inst.sector] = []
    bySector[inst.sector].push(inst)
  }

  const loop2Results: Record<string, GridSearchSummary[]> = {}

  for (const [sector, sectorInsts] of Object.entries(bySector)) {
    console.log(`  ── ${sector} ──`)
    const sectSummaries: GridSearchSummary[] = []
    for (const { ticker, rows } of sectorInsts) {
      process.stdout.write(`    ${ticker.padEnd(8)} `)
      const summary = gridSearch(rows, LOOP2_GRID, ticker, sector)
      sectSummaries.push(summary)
      const b = summary.best
      const oosWR = fmt(b.oosWinRate)
      const gap = (b.overfitGap >= 0 ? '+' : '') + (b.overfitGap * 100).toFixed(1) + '%'
      console.log(
        `OOS: ${oosWR} gap: ${gap.padStart(5)}  ` +
        `best: slope=${b.params.slopeThreshold} conf=${b.params.confidenceThreshold} atr=${b.params.atrStopMultiplier}`,
      )
    }
    loop2Results[sector] = sectSummaries
    console.log()
  }

  return loop2Results
}

// ─── Analysis: per-sector aggregation and recommendations ─────────────────────

interface SectorOptResult {
  sector: string
  tickers: string[]
  avgOOSWinRate: number
  avgOverfitGap: number
  avgOOSTrades: number
  bestGlobalParams: {
    slopeThreshold: number
    confidenceThreshold: number
    atrStopMultiplier: number
    buyWScoreThreshold: number
  }
  worstTickers: string[]
  recommendation: string
}

function buildSectorRecommendations(
  summaries: GridSearchSummary[],
  loop2Results: Record<string, GridSearchSummary[]>,
): SectorOptResult[] {
  const bySector: Record<string, GridSearchSummary[]> = {}
  for (const s of summaries) {
    if (!bySector[s.sector]) bySector[s.sector] = []
    bySector[s.sector].push(s)
  }

  const results: SectorOptResult[] = []

  for (const [sector, ssList] of Object.entries(bySector)) {
    const avgOOS = ssList.reduce((s, r) => s + r.best.oosWinRate, 0) / ssList.length
    const avgGap = ssList.reduce((s, r) => s + r.best.overfitGap, 0) / ssList.length
    const avgTrades = ssList.reduce((s, r) => s + r.best.oosTrades, 0) / ssList.length

    // Find robust params from Loop 2 for this sector (if available)
    const l2 = loop2Results[sector] ?? ssList
    const l2Agg = aggregateGridResults(l2)

    // Worst tickers (OOS WR < 40%)
    const worst = ssList
      .filter(s => s.best.oosWinRate < 0.40)
      .sort((a, b) => a.best.oosWinRate - b.best.oosWinRate)
      .map(s => `${s.ticker}(${(s.best.oosWinRate * 100).toFixed(0)}%)`)

    // Build recommendation
    let rec = ''
    if (avgOOS < 0.50) {
      rec = `CRITICAL: avg OOS WR ${(avgOOS * 100).toFixed(1)}% — structural signal failure. Needs intermarket gate.`
    } else if (avgGap > 0.08) {
      rec = `Overfit gap ${(avgGap * 100).toFixed(1)}pp > 8pp cap — tighten thresholds or add confirmation filters.`
    } else if (avgOOS < OPTIMIZATION_TARGETS.loop2.minSectorWinRate) {
      rec = `OOS WR ${(avgOOS * 100).toFixed(1)}% below 58% target — apply Loop 2 narrow params.`
    } else {
      rec = `On target (OOS ${(avgOOS * 100).toFixed(1)}%). Maintain current sector profile.`
    }

    results.push({
      sector,
      tickers: ssList.map(s => s.ticker),
      avgOOSWinRate: avgOOS,
      avgOverfitGap: avgGap,
      avgOOSTrades: avgTrades,
      bestGlobalParams: {
        slopeThreshold: l2Agg.bestGlobalParams.slopeThreshold,
        confidenceThreshold: l2Agg.bestGlobalParams.confidenceThreshold,
        atrStopMultiplier: l2Agg.bestGlobalParams.atrStopMultiplier,
        buyWScoreThreshold: l2Agg.bestGlobalParams.buyWScoreThreshold,
      },
      worstTickers: worst,
      recommendation: rec,
    })
  }

  return results.sort((a, b) => a.avgOOSWinRate - b.avgOOSWinRate)
}

// ─── Print sector summary ─────────────────────────────────────────────────────

function printSectorSummary(recs: SectorOptResult[]): void {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  SECTOR SUMMARY & RECOMMENDATIONS')
  console.log('══════════════════════════════════════════════════════\n')

  for (const r of recs) {
    const oos = fmt(r.avgOOSWinRate)
    const gap = (r.avgOverfitGap * 100).toFixed(1) + 'pp'
    const status = r.avgOOSWinRate >= 0.58 ? '✓' : r.avgOOSWinRate >= 0.50 ? '~' : '✗'
    console.log(`  ${status} ${r.sector.padEnd(20)} OOS: ${oos} Gap: ${gap.padStart(6)}  trades: ${r.avgOOSTrades.toFixed(0)}`)
    console.log(`    Rec:  ${r.recommendation}`)
    if (r.worstTickers.length > 0) {
      console.log(`    Weak: ${r.worstTickers.join(', ')}`)
    }
    console.log(`    Params: slope=${r.bestGlobalParams.slopeThreshold} conf=${r.bestGlobalParams.confidenceThreshold} atr=${r.bestGlobalParams.atrStopMultiplier}`)
    console.log()
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const startTime = Date.now()
console.log('\n══════════════════════════════════════════════════════')
console.log('  QUANTAN — Phase 8 Optimization Loops 1 & 2')
console.log(`  Baseline: ${CURRENT_BASELINE.slopeThreshold}/${CURRENT_BASELINE.buyWScoreThreshold}/${CURRENT_BASELINE.confidenceThreshold}`)
console.log('══════════════════════════════════════════════════════')

const allData = loadAllTickers()
console.log(`\nLoaded ${allData.length} instruments from backtestData/`)

// ── Loop 1 ────────────────────────────────────────────────────────────────────
const loop1Summaries = runLoop1(allData)

// ── Aggregate Loop 1 ─────────────────────────────────────────────────────────
const globalAgg = aggregateGridResults(loop1Summaries)
const avgOOS1 = loop1Summaries.reduce((s, r) => s + r.best.oosWinRate, 0) / loop1Summaries.length
const avgGap1 = loop1Summaries.reduce((s, r) => s + r.best.overfitGap, 0) / loop1Summaries.length
const noValidCombo = loop1Summaries.filter(s => s.validCombinations === 0)
const below40pct = loop1Summaries.filter(s => s.best.oosWinRate < 0.40 && s.validCombinations > 0)

console.log('\n══════════════════════════════════════════════════════')
console.log('  LOOP 1 AGGREGATE')
console.log('══════════════════════════════════════════════════════')
console.log(`  Instruments:               ${loop1Summaries.length}`)
console.log(`  No valid combos:           ${noValidCombo.length} (${noValidCombo.map(s => s.ticker).join(', ')})`)
console.log(`  Below 40% OOS WR:          ${below40pct.length} (${below40pct.map(s => s.ticker).join(', ')})`)
console.log(`  Avg OOS win rate (Loop 1): ${(avgOOS1 * 100).toFixed(2)}%`)
console.log(`  Avg overfit gap:           ${(avgGap1 * 100).toFixed(2)}pp`)
console.log(`  Global best params: slope=${globalAgg.bestGlobalParams.slopeThreshold} buy=${globalAgg.bestGlobalParams.buyWScoreThreshold} sell=${globalAgg.bestGlobalParams.sellWScoreThreshold} conf=${globalAgg.bestGlobalParams.confidenceThreshold} atr=${globalAgg.bestGlobalParams.atrStopMultiplier}`)
console.log(`  vs. baseline:   slope=${CURRENT_BASELINE.slopeThreshold} buy=${CURRENT_BASELINE.buyWScoreThreshold} conf=${CURRENT_BASELINE.confidenceThreshold} atr=${CURRENT_BASELINE.atrStopMultiplier}`)

const t1Target = OPTIMIZATION_TARGETS.loop1
const targetsHit: string[] = []
const targetsMissed: string[] = []
if (avgOOS1 >= t1Target.minAggregateWinRate) targetsHit.push(`OOS WR ${(avgOOS1 * 100).toFixed(1)}% ≥ 60%`)
else targetsMissed.push(`OOS WR ${(avgOOS1 * 100).toFixed(1)}% < 60% target`)
if (below40pct.length <= t1Target.maxInstrumentsBelow40pct) targetsHit.push(`${below40pct.length} instr <40% ≤ 3 max`)
else targetsMissed.push(`${below40pct.length} instr <40% > ${t1Target.maxInstrumentsBelow40pct} max`)
if (avgGap1 <= t1Target.maxOSISGap) targetsHit.push(`overfit gap ${(avgGap1 * 100).toFixed(1)}pp ≤ 8pp`)
else targetsMissed.push(`overfit gap ${(avgGap1 * 100).toFixed(1)}pp > 8pp cap`)
if (targetsHit.length > 0) console.log(`\n  ✓ Targets hit:   ${targetsHit.join(' | ')}`)
if (targetsMissed.length > 0) console.log(`  ✗ Targets missed: ${targetsMissed.join(' | ')}`)

// ── Loop 2 ────────────────────────────────────────────────────────────────────
const loop2Results = runLoop2(allData, loop1Summaries)

// ── Sector recommendations ────────────────────────────────────────────────────
const sectorRecs = buildSectorRecommendations(loop1Summaries, loop2Results)
printSectorSummary(sectorRecs)

// ── Top 10 / Bottom 10 ───────────────────────────────────────────────────────
const sortedByOOS = [...loop1Summaries].sort((a, b) => b.best.oosWinRate - a.best.oosWinRate)
console.log('  TOP 10 instruments (by OOS win rate):')
for (const s of sortedByOOS.slice(0, 10)) {
  console.log(`    ${s.ticker.padEnd(8)} [${s.sector.padEnd(18)}]  OOS: ${fmt(s.best.oosWinRate)}  IS: ${fmt(s.best.isWinRate)}  gap: ${(s.best.overfitGap * 100).toFixed(1)}pp  trades: ${s.best.oosTrades}`)
}
console.log()
console.log('  BOTTOM 10 instruments (by OOS win rate):')
for (const s of sortedByOOS.slice(-10).reverse()) {
  const note = s.validCombinations === 0 ? ' ← NO VALID COMBOS' : s.best.oosTrades < 10 ? ' ← FEW TRADES' : ''
  console.log(`    ${s.ticker.padEnd(8)} [${s.sector.padEnd(18)}]  OOS: ${fmt(s.best.oosWinRate)}  IS: ${fmt(s.best.isWinRate)}  valid: ${s.validCombinations}${note}`)
}

// ── Save results ──────────────────────────────────────────────────────────────

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
console.log(`\n══════════════════════════════════════════════════════`)
console.log(`  Elapsed: ${elapsed}s`)

const output = {
  timestamp: new Date().toISOString(),
  version: 'v1.0-phase8-loop1-loop2',
  elapsed_seconds: Number(elapsed),
  loop1: {
    grid: LOOP1_GRID,
    aggregate: {
      avgOOSWinRate: Number((avgOOS1 * 100).toFixed(2)),
      avgOverfitGap: Number((avgGap1 * 100).toFixed(2)),
      noValidCombos: noValidCombo.map(s => s.ticker),
      below40pctOOS: below40pct.map(s => ({ ticker: s.ticker, oosWinRate: Number((s.best.oosWinRate * 100).toFixed(1)) })),
      globalBestParams: globalAgg.bestGlobalParams,
      vsBaseline: CURRENT_BASELINE,
    },
    byInstrument: loop1Summaries.map(s => ({
      ticker: s.ticker,
      sector: s.sector,
      totalCombinations: s.totalCombinations,
      validCombinations: s.validCombinations,
      splitDate: s.splitDate,
      best: {
        params: s.best.params,
        isWinRate: Number((s.best.isWinRate * 100).toFixed(1)),
        oosWinRate: Number((s.best.oosWinRate * 100).toFixed(1)),
        overfitGap: Number((s.best.overfitGap * 100).toFixed(1)),
        oosTrades: s.best.oosTrades,
        isTrades: s.best.isTrades,
        oosSharpe: s.best.oosSharpe,
        score: Number(s.best.score.toFixed(4)),
      },
      top3: s.top5.slice(0, 3).map(r => ({
        params: r.params,
        oosWinRate: Number((r.oosWinRate * 100).toFixed(1)),
        oosSharpe: r.oosSharpe,
        overfitGap: Number((r.overfitGap * 100).toFixed(1)),
      })),
      robustParams: s.robustParams,
    })),
  },
  loop2: {
    grid: LOOP2_GRID,
    bySector: Object.fromEntries(
      Object.entries(loop2Results).map(([sector, summaries]) => [
        sector,
        summaries.map(s => ({
          ticker: s.ticker,
          bestParams: s.best.params,
          oosWinRate: Number((s.best.oosWinRate * 100).toFixed(1)),
          overfitGap: Number((s.best.overfitGap * 100).toFixed(1)),
          oosTrades: s.best.oosTrades,
        })),
      ]),
    ),
  },
  sectorRecommendations: sectorRecs,
  targets: OPTIMIZATION_TARGETS.loop1,
}

const outPath = join(__dirname, 'optimization-results-loop1.json')
writeFileSync(outPath, JSON.stringify(output, null, 2))
console.log(`  Results saved → scripts/optimization-results-loop1.json`)
