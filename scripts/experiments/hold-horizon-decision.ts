/**
 * HOLD-HORIZON DECISION EXPERIMENT — H=60 vs the incumbent H=20 engine
 * default (2026-07-16, owner-delegated decision; follows the Q-076 finding
 * that the purged IS grid selects labelMatched_H60, and C7's rotation
 * walk-forward preferring H=60).
 *
 * PRE-REGISTERED DECISION RULE (D3-style, fixed before running):
 *   Adopt H=60 as the engine default IFF the H60 portfolio beats the H20
 *   portfolio on Sharpe OR MAR in >= 3 of the 4 purged OOS segments
 *   (2023, 2024, 2025, 2026H1). Otherwise H=20 stays.
 *
 * Design
 *  - Engine: runPortfolioBacktest, production signal path
 *    (QUANTAN_USE_ENHANCED_SIGNAL=0), default structure (10 slots, 20% cap).
 *  - Configs: time-only exits (label-matched family) H=20 vs H=60; H=40
 *    reported as context only (NOT part of the decision rule).
 *  - Per segment Y: OOS = [Jan 1 Y, Dec 31 Y] (2026: through data end) with a
 *    220-bar warmup prefix feeding indicators only — the engine cannot enter
 *    before its warmup, so the first possible entry is at the segment start.
 *    No IS selection happens here: both configs are FIXED candidates, so the
 *    purge/embargo requirements of a selection protocol do not apply; the
 *    segments are pure evaluation windows.
 *  - Metrics per segment: total return, Sharpe, maxDD, MAR, trades, WR.
 *  - The label pipeline (benchmarkLabel, LABEL_HOLD_DAYS=20) and the D1 gate
 *    are NOT touched by this experiment or by the decision — the published
 *    label WR stays on its own 20d horizon either way.
 *
 * Usage: npm run experiment:hold-horizon
 * Output: workspace/optimization-runs/hold-horizon-decision.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { runPortfolioBacktest, DEFAULT_PORTFOLIO_CONFIG } from '../../lib/backtest/portfolioBacktest'
import type { PortfolioBacktestResult } from '../../lib/backtest/portfolioBacktest'
import { LABEL_MATCHED_EXIT_CONFIG } from '../../lib/backtest/exitRules'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const ENGINE_WARMUP_BARS = 220
const SEGMENT_YEARS = ['2023', '2024', '2025', '2026'] as const
const DECISION_HOLDS = [20, 60] as const
const CONTEXT_HOLDS = [40] as const

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
  for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as {
      sector?: string
      candles?: Array<Omit<OhlcvRow, 'volume'> & { volume?: number }>
    }
    const ticker = f.replace('.json', '')
    const rows = (data.candles ?? [])
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
    if (rows.length >= 252) {
      instrumentData[ticker] = rows
      sectorMap[ticker] = data.sector ?? 'Unknown'
    }
  }
  return { instrumentData, sectorMap }
}

/** Segment window [Jan 1 Y, Jan 1 Y+1) with a 220-bar warmup prefix. */
function sliceSegment(rows: OhlcvRow[], year: string): OhlcvRow[] {
  const startTs = Date.UTC(Number(year), 0, 1) / 1000
  const endTs = Date.UTC(Number(year) + 1, 0, 1) / 1000
  const startIdx = rows.findIndex((r) => r.time >= startTs)
  if (startIdx < 0) return []
  let endIdx = rows.length
  for (let i = startIdx; i < rows.length; i++) {
    if (rows[i].time >= endTs) {
      endIdx = i
      break
    }
  }
  return rows.slice(Math.max(0, startIdx - ENGINE_WARMUP_BARS), endIdx)
}

interface SegMetrics {
  totalReturnPct: number
  sharpe: number | null
  maxDrawdownPct: number
  mar: number | null
  trades: number
  winRatePct: number
  avgExposureProxy: number
}

function metricsOf(r: PortfolioBacktestResult): SegMetrics {
  // MAR = annualized return / maxDD (rotation-experiment convention).
  const mar = r.maxDrawdown > 0 ? r.annualizedReturn / r.maxDrawdown : null
  return {
    totalReturnPct: Number((r.totalReturn * 100).toFixed(2)),
    sharpe: r.sharpeRatio != null ? Number(r.sharpeRatio.toFixed(3)) : null,
    maxDrawdownPct: Number((r.maxDrawdown * 100).toFixed(2)),
    mar: mar != null ? Number(mar.toFixed(3)) : null,
    trades: r.totalTrades,
    winRatePct: Number((r.winRate * 100).toFixed(2)),
    avgExposureProxy: Number(r.avgConcurrentPositions.toFixed(2)),
  }
}

console.log('Loading instruments…')
const { instrumentData, sectorMap } = loadAllInstruments()
console.log(`Universe: ${Object.keys(instrumentData).length} instruments`)

interface SegmentRow {
  year: string
  bars: Record<string, number>
  byHold: Record<string, SegMetrics>
  h60BeatsH20Sharpe: boolean
  h60BeatsH20Mar: boolean
  h60Beats: boolean
}

const segments: SegmentRow[] = []
const t0 = Date.now()

for (const year of SEGMENT_YEARS) {
  const segData: Record<string, OhlcvRow[]> = {}
  for (const [t, rows] of Object.entries(instrumentData)) {
    const sliced = sliceSegment(rows, year)
    if (sliced.length >= 252) segData[t] = sliced
  }
  const nInst = Object.keys(segData).length
  process.stdout.write(`\nSegment ${year} (${nInst} instruments): `)

  const byHold: Record<string, SegMetrics> = {}
  for (const h of [...DECISION_HOLDS, ...CONTEXT_HOLDS]) {
    const res = runPortfolioBacktest(segData, sectorMap, {
      ...DEFAULT_PORTFOLIO_CONFIG,
      exit: { ...LABEL_MATCHED_EXIT_CONFIG, maxHoldDays: h },
    })
    byHold[`H${h}`] = metricsOf(res)
    process.stdout.write(`H${h}✓ `)
  }
  console.log()

  const h20 = byHold.H20
  const h60 = byHold.H60
  const h60BeatsH20Sharpe = (h60.sharpe ?? -Infinity) > (h20.sharpe ?? -Infinity)
  const h60BeatsH20Mar = (h60.mar ?? -Infinity) > (h20.mar ?? -Infinity)
  segments.push({
    year,
    bars: { universe: nInst },
    byHold,
    h60BeatsH20Sharpe,
    h60BeatsH20Mar,
    h60Beats: h60BeatsH20Sharpe || h60BeatsH20Mar,
  })
}

const beats = segments.filter((s) => s.h60Beats).length
const adopt = beats >= 3
const verdict = adopt ? 'ADOPT H=60' : 'KEEP H=20'

const payload = {
  timestamp: new Date().toISOString(),
  experiment:
    'Hold-horizon decision: H=60 vs incumbent H=20 engine default (owner-delegated 2026-07-16). Label pipeline (20d) untouched either way.',
  decisionRule:
    'PRE-REGISTERED: adopt H=60 iff H60 beats H20 on Sharpe OR MAR in >= 3 of 4 OOS segments (2023, 2024, 2025, 2026H1). H=40 is context only.',
  signalPath: 'QUANTAN_USE_ENHANCED_SIGNAL=0 (production path)',
  structure: 'default portfolio (10 slots, 20% cap, correlation-adjusted Kelly)',
  segments,
  segmentsWhereH60Beats: beats,
  verdict,
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'hold-horizon-decision.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== HOLD-HORIZON DECISION — H60 vs H20 ===')
for (const s of segments) {
  console.log(
    `\n${s.year}:` +
      Object.entries(s.byHold)
        .map(
          ([k, m]) =>
            `\n  ${k.padEnd(4)} ret ${String(m.totalReturnPct).padStart(7)}%  Sharpe ${String(m.sharpe).padStart(7)}  maxDD ${String(m.maxDrawdownPct).padStart(6)}%  MAR ${String(m.mar).padStart(7)}  trades ${String(m.trades).padStart(3)}  WR ${m.winRatePct}%`,
        )
        .join('') +
      `\n  H60 beats H20: Sharpe=${s.h60BeatsH20Sharpe} MAR=${s.h60BeatsH20Mar} → ${s.h60Beats ? 'YES' : 'no'}`,
  )
}
console.log(`\nSegments where H60 beats H20: ${beats}/4 → ${verdict}`)
console.log(`Elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s`)
console.log(`Saved to: ${outPath}`)
