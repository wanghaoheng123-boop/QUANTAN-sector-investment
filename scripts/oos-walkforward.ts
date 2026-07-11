/**
 * D5 walk-forward OOS harness (2026-07-11 rethink, MASTER §4 D5 / red-team R5+C8).
 *
 * Replaces the legacy 12-instrument alphabetical-prefix 70/30 gross-only split
 * (scripts/oos-validation.ts, kept for continuity) with the honest design:
 *   - ALL instruments (56 incl. BTC), not an alphabetical prefix
 *   - yearly walk-forward folds (expanding IS, calendar-year OOS)
 *   - 20d PURGE: IS excludes signal bars whose label window would cross the
 *     fold boundary (i + 1 + H must stay before the OOS start bar)
 *   - 5-bar EMBARGO at the OOS start (serial-correlation guard)
 *   - NET win rate after round-trip costs, not gross
 *   - per-fold edge over the always-buy base rate measured on the SAME OOS
 *     window (an OOS WR without its base rate is uninterpretable on a
 *     survivor universe — red-team C1)
 *   - non-overlapping effective-n + Wilson 95% CI per fold (red-team C2)
 *
 * The production signal is rule-based (no fitted parameters), so folds measure
 * regime stability, not overfitting of a fit step. The fold structure is the
 * future home for D6/R3's calibrated score (which WILL fit per-fold) and the
 * interim to Q-064 CPCV.
 *
 * Research infrastructure only — no published number changes. Exit code stays
 * 0; the PASS/WARN verdict is informational until the owner re-founds the gate
 * (decision D1).
 *
 * Usage: npm run benchmark:oos:wf
 * Output: workspace/optimization-runs/oos-walkforward.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import {
  runInstrumentLabelBenchmark,
  LABEL_HOLD_DAYS,
  WARMUP_BARS,
} from '../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../lib/backtest/executionModel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const EMBARGO_BARS = 5

interface InstrumentData {
  ticker: string
  sector: string
  rows: OhlcvRow[]
  /** All signal trades over the full window (expanding-window signal — window-independent). */
  trades: { barIndex: number; date: string; netReturn: number }[]
  /** Every eligible bar's always-buy net label (base rate universe). */
  baseBars: { barIndex: number; year: string; net: number }[]
  /** barIndex of the first bar in each calendar year present. */
  yearStart: Map<string, number>
  /** barIndex of the last bar in each calendar year present. */
  yearEnd: Map<string, number>
}

function loadAllInstruments(): InstrumentData[] {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  const out: InstrumentData[] = []
  for (const f of readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    const data = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as {
      sector?: string
      candles?: OhlcvRow[]
    }
    const ticker = f.replace('.json', '').replace(/-/g, '.')
    const rows = (data.candles ?? []).filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    if (rows.length < 252) continue

    const stats = runInstrumentLabelBenchmark(ticker, data.sector ?? 'Unknown', rows, {
      productionPath: true,
    })
    if (!stats) continue

    const baseBars: InstrumentData['baseBars'] = []
    const yearStart = new Map<string, number>()
    const yearEnd = new Map<string, number>()
    for (let i = 0; i < rows.length; i++) {
      const year = new Date(rows[i].time * 1000).toISOString().slice(0, 4)
      if (!yearStart.has(year)) yearStart.set(year, i)
      yearEnd.set(year, i)
      if (i < WARMUP_BARS || i >= rows.length - LABEL_HOLD_DAYS - 1) continue
      const entry = rows[i + 1].close
      const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, rows.length - 1)].close
      if (!(entry > 0) || !(exit > 0)) continue
      const gross = (exit - entry) / entry
      baseBars.push({ barIndex: i, year, net: netReturnAfterCosts(gross, DEFAULT_EXECUTION_COSTS) })
    }

    out.push({
      ticker,
      sector: data.sector ?? 'Unknown',
      rows,
      trades: stats.trades.map(({ barIndex, date, netReturn }) => ({ barIndex, date, netReturn })),
      baseBars,
      yearStart,
      yearEnd,
    })
  }
  return out
}

function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.959963984540054
  const p = k / n
  const denom = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

const pct = (x: number | null) => (x == null ? null : Number((x * 100).toFixed(2)))

console.log('Loading instruments + SSOT signal trades (production path)…')
const insts = loadAllInstruments()
console.log(`Loaded ${insts.length} instruments`)

// Fold years: every calendar year that has OOS-eligible content in at least one
// instrument, excluding the first year in the data (pure warmup/IS seed).
const allYears = Array.from(new Set(insts.flatMap((d) => Array.from(d.yearStart.keys())))).sort()
const foldYears = allYears.slice(1)

interface FoldResult {
  year: string
  isTrades: number
  isNetWR: number | null
  oosTrades: number
  oosNetWR: number | null
  oosBaseBars: number
  oosBaseNetWR: number | null
  oosEdgePp: number | null
  isOosGapPp: number | null
  nonOverlap: { n: number; netWR: number | null; wilson95Pct: [number | null, number | null] }
}

const folds: FoldResult[] = []
let pooledOosN = 0
let pooledOosWins = 0
let pooledBaseN = 0
let pooledBaseWins = 0
let pooledNoN = 0
let pooledNoWins = 0

for (const year of foldYears) {
  let isN = 0
  let isWins = 0
  let oosN = 0
  let oosWins = 0
  let baseN = 0
  let baseWins = 0
  let noN = 0
  let noWins = 0

  for (const inst of insts) {
    const boundary = inst.yearStart.get(year)
    if (boundary == null) continue
    const oosEnd = inst.yearEnd.get(year)!
    // PURGE: IS keeps only signal bars whose full label window closes strictly
    // before the OOS boundary bar: i + 1 + H < boundary.
    const isCutoff = boundary - LABEL_HOLD_DAYS - 2
    // EMBARGO: OOS starts EMBARGO_BARS after the boundary.
    const oosStart = boundary + EMBARGO_BARS

    let lastTaken = -Infinity
    for (const t of inst.trades) {
      if (t.barIndex <= isCutoff) {
        isN++
        if (t.netReturn > 0) isWins++
      } else if (t.barIndex >= oosStart && t.barIndex <= oosEnd) {
        oosN++
        if (t.netReturn > 0) oosWins++
        if (t.barIndex - lastTaken > LABEL_HOLD_DAYS) {
          lastTaken = t.barIndex
          noN++
          if (t.netReturn > 0) noWins++
        }
      }
    }
    for (const b of inst.baseBars) {
      if (b.barIndex >= oosStart && b.barIndex <= oosEnd) {
        baseN++
        if (b.net > 0) baseWins++
      }
    }
  }

  const isWR = isN > 0 ? isWins / isN : null
  const oosWR = oosN > 0 ? oosWins / oosN : null
  const baseWR = baseN > 0 ? baseWins / baseN : null
  const [noLo, noHi] = wilson95(noWins, noN)

  folds.push({
    year,
    isTrades: isN,
    isNetWR: pct(isWR),
    oosTrades: oosN,
    oosNetWR: pct(oosWR),
    oosBaseBars: baseN,
    oosBaseNetWR: pct(baseWR),
    oosEdgePp:
      oosWR != null && baseWR != null ? Number(((oosWR - baseWR) * 100).toFixed(2)) : null,
    isOosGapPp:
      isWR != null && oosWR != null ? Number(((isWR - oosWR) * 100).toFixed(2)) : null,
    nonOverlap: {
      n: noN,
      netWR: pct(noN > 0 ? noWins / noN : null),
      wilson95Pct: noN > 0 ? [pct(noLo), pct(noHi)] : [null, null],
    },
  })

  pooledOosN += oosN
  pooledOosWins += oosWins
  pooledBaseN += baseN
  pooledBaseWins += baseWins
  pooledNoN += noN
  pooledNoWins += noWins
}

const pooledOosWR = pooledOosN > 0 ? pooledOosWins / pooledOosN : null
const pooledBaseWR = pooledBaseN > 0 ? pooledBaseWins / pooledBaseN : null
const pooledEdgePp =
  pooledOosWR != null && pooledBaseWR != null
    ? Number(((pooledOosWR - pooledBaseWR) * 100).toFixed(2))
    : null
const [pooledNoLo, pooledNoHi] = wilson95(pooledNoWins, pooledNoN)

const foldsWithTrades = folds.filter((f) => f.oosTrades > 0)
const nonNegativeFolds = foldsWithTrades.filter((f) => (f.oosEdgePp ?? -1) >= 0).length
// Informational verdict (not a hard gate until owner decision D1): pooled OOS
// edge over base must be positive and at least half the folds non-negative.
const verdict =
  pooledEdgePp != null && pooledEdgePp > 0 && nonNegativeFolds * 2 >= foldsWithTrades.length
    ? 'PASS'
    : 'WARN'

const payload = {
  timestamp: new Date().toISOString(),
  design:
    'D5 walk-forward OOS (2026-07-11 rethink): all instruments, yearly folds, ' +
    `${LABEL_HOLD_DAYS}d purge + ${EMBARGO_BARS}-bar embargo, net WR, edge over always-buy base rate per fold. ` +
    'Supersedes the 12-instrument alphabetical 70/30 gross split for sweep purposes (interim to Q-064 CPCV).',
  signalPath: 'resolveBacktestSignal (regime-only, production path)',
  instruments: insts.length,
  labelHoldDays: LABEL_HOLD_DAYS,
  embargoBars: EMBARGO_BARS,
  folds,
  pooledOos: {
    trades: pooledOosN,
    netWinRatePct: pct(pooledOosWR),
    baseBars: pooledBaseN,
    baseNetWinRatePct: pct(pooledBaseWR),
    edgeOverBasePp: pooledEdgePp,
    nonOverlap: {
      n: pooledNoN,
      netWinRatePct: pct(pooledNoN > 0 ? pooledNoWins / pooledNoN : null),
      wilson95Pct: pooledNoN > 0 ? [pct(pooledNoLo), pct(pooledNoHi)] : [null, null],
    },
  },
  verdict,
  verdictNote:
    'PASS = pooled OOS edge over base > 0 AND ≥ half of folds non-negative. Informational only — ' +
    'the CI gate remains the frozen net-WR floor until owner decision D1 re-founds it.',
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'oos-walkforward.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== D5 WALK-FORWARD OOS (net WR, purge+embargo) ===')
console.log(
  'fold   IS-n    IS-WR   OOS-n  OOS-WR   base-WR   edge     gap    nonOverlap (Wilson95)',
)
for (const f of folds) {
  console.log(
    `${f.year}  ${String(f.isTrades).padStart(5)}  ${String(f.isNetWR).padStart(6)}%  ` +
      `${String(f.oosTrades).padStart(5)}  ${String(f.oosNetWR).padStart(6)}%  ` +
      `${String(f.oosBaseNetWR).padStart(6)}%  ` +
      `${f.oosEdgePp == null ? '    —' : ((f.oosEdgePp >= 0 ? '+' : '') + f.oosEdgePp).padStart(6)}pp ` +
      `${f.isOosGapPp == null ? '    —' : String(f.isOosGapPp).padStart(6)}pp  ` +
      `n=${String(f.nonOverlap.n).padStart(3)} ${String(f.nonOverlap.netWR).padStart(6)}% [${f.nonOverlap.wilson95Pct[0]}, ${f.nonOverlap.wilson95Pct[1]}]`,
  )
}
console.log(
  `\nPooled OOS: ${payload.pooledOos.trades} trades, net WR ${payload.pooledOos.netWinRatePct}% vs base ${payload.pooledOos.baseNetWinRatePct}% → edge ${pooledEdgePp == null ? '—' : (pooledEdgePp >= 0 ? '+' : '') + pooledEdgePp}pp`,
)
console.log(
  `Pooled non-overlap: n=${payload.pooledOos.nonOverlap.n}, net WR ${payload.pooledOos.nonOverlap.netWinRatePct}% (Wilson95 [${payload.pooledOos.nonOverlap.wilson95Pct[0]}, ${payload.pooledOos.nonOverlap.wilson95Pct[1]}])`,
)
console.log(`Verdict: ${verdict} — ${payload.verdictNote}`)
console.log(`Saved to: ${outPath}`)
