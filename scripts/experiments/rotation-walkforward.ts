/**
 * D3/R2 EXPERIMENT — cross-sectional K-slot rotation, walk-forward validated
 * (2026-07-11 rethink, MASTER §4 D3 / red-team R2). EXPERIMENT ONLY: no display
 * or published-number changes; results go to workspace/optimization-runs/.
 *
 * Design
 *  - Universe: the 55 shared-calendar equities (BTC excluded — different calendar).
 *  - Signal: fast array reimplementation of the production regime-only path
 *    (ported from reviews/RETHINK-2026-07-11/redteam2.ts.txt, which the red team
 *    verified bar-for-bar against the SSOT). This script RE-VERIFIES parity at
 *    runtime on 3 instruments against benchmarkLabel.signalAtBarIndex and exits
 *    non-zero on any mismatch — the fast path is never trusted blind.
 *  - Grid: K ∈ {5,10,15} slots × H ∈ {20,40,60} hold bars × rank ∈ {deepest,
 *    shallowest} dip-first (18 configs).
 *  - Walk-forward: for each OOS year Y in {2023,2024,2025} select the config
 *    with the best IS Sharpe on ALL data before Y (expanding window, residual
 *    positions force-closed at the IS boundary), then score year Y with the
 *    portfolio state evolved from history under that config (no re-fitting
 *    inside Y). 2022 has no prior signal year to select on and is IS-only.
 *  - LOCKED HOLDOUT: 2026 H1 is never touched by selection; it is scored ONCE
 *    with the config selected on 2022–2025.
 *  - Acceptance (R2): rotation beats equal-weight B&H on Sharpe OR MAR
 *    (annualized return / maxDD) in ≥3 of the 4 OOS segments (2023, 2024,
 *    2025, 2026H1).
 *
 * Costs: 11 bps per side (matches DEFAULT_EXECUTION_COSTS round trip 22 bps),
 * T+1 open fills, signal at prior close — same execution hygiene as the SSOT.
 *
 * Usage: npm run experiment:rotation
 * Output: workspace/optimization-runs/rotation-walkforward.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'
import { signalAtBarIndex, LABEL_HOLD_DAYS, WARMUP_BARS } from '../../lib/backtest/benchmarkLabel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const SIDE = 0.0011
const RT = 2 * SIDE
const SIM_START = 201 // first bar with a possible T+1 fill after warmup

interface Inst {
  ticker: string
  rows: OhlcvRow[]
  closes: number[]
  dev: Float64Array
  action: Int8Array
}

/** Fast regime-only signal arrays (port of the red team's verified build()). */
function build(ticker: string, rows: OhlcvRow[]): Inst {
  const n = rows.length
  const closes = rows.map((r) => r.close)
  const P = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) P[i + 1] = P[i] + closes[i]
  const sma = new Float64Array(n).fill(NaN)
  const dev = new Float64Array(n).fill(NaN)
  for (let i = 199; i < n; i++) {
    sma[i] = (P[i + 1] - P[i - 199]) / 200
    dev[i] = ((closes[i] - sma[i]) / sma[i]) * 100
  }
  const slope = new Float64Array(n).fill(NaN)
  for (let i = 220; i < n; i++) slope[i] = (sma[i] - sma[i - 20]) / sma[i - 20]
  const near = new Uint8Array(n)
  for (let i = 219; i < n; i++) {
    for (let j = i - 19; j <= i; j++) if (j >= 199 && dev[j] >= -5) { near[i] = 1; break }
  }
  const action = new Int8Array(n)
  for (let i = 200; i < n; i++) {
    const d = dev[i]
    if (!Number.isFinite(d) || d >= 0) continue
    const sl = slope[i]
    const sp = Number.isFinite(sl) ? sl > 0.005 : null
    const canBuy = sp === true && near[i] === 1
    if (d >= -10) { action[i] = canBuy ? 1 : 0; continue }
    if (sp == null) continue
    action[i] = canBuy ? 1 : -1
  }
  return { ticker, rows, closes, dev, action }
}

function loadEquities(): Inst[] {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const data = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as {
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
      return build(ticker, rows)
    })
    .filter((x) => x.rows.length >= 252 && x.ticker !== 'BTC')
}

/** Fail-closed parity check: fast BUY set === SSOT BUY set on sample tickers. */
function verifyParity(insts: Inst[]): { checked: string[]; mismatches: number } {
  const sample = [insts[0], insts[Math.floor(insts.length / 2)], insts[insts.length - 1]]
  let mismatches = 0
  for (const inst of sample) {
    const n = inst.rows.length
    for (let i = WARMUP_BARS; i < n - LABEL_HOLD_DAYS - 1; i++) {
      const ssotBuy =
        signalAtBarIndex(inst.rows, i, inst.ticker, { productionPath: true }).action === 'BUY'
      const fastBuy = inst.action[i] === 1
      if (ssotBuy !== fastBuy) {
        mismatches++
        if (mismatches <= 5) {
          console.error(
            `PARITY MISMATCH ${inst.ticker} bar ${i}: ssot=${ssotBuy} fast=${fastBuy}`,
          )
        }
      }
    }
  }
  return { checked: sample.map((s) => s.ticker), mismatches }
}

interface Config {
  K: number
  H: number
  rank: 'deepest' | 'shallowest'
}
const GRID: Config[] = []
for (const K of [5, 10, 15])
  for (const H of [20, 40, 60])
    for (const rank of ['deepest', 'shallowest'] as const) GRID.push({ K, H, rank })

const cfgLabel = (c: Config) => `K=${c.K}/H=${c.H}/${c.rank}`

interface SimResult {
  /** Equity curve value AFTER entries, marked at close[t]; index aligned to bar t (t = SIM_START..end). */
  curve: number[]
  /** Bar index of curve[0]. */
  firstBar: number
  trades: number
  wins: number
  /** Exit-bar index per closed round trip (for per-year attribution). */
  exitBars: number[]
  exposureByBar: number[]
}

/**
 * Rotation sim over bars [SIM_START, endBar]. Signals from close t-1 fill at
 * open t; exits after H bars at open t; residual positions force-closed at
 * close[endBar] with costs.
 */
function simulate(insts: Inst[], cfg: Config, endBar: number): SimResult {
  interface Pos {
    k: number
    entry: number
    entryBar: number
    alloc: number
  }
  let cash = 1
  let open: Pos[] = []
  let trades = 0
  let wins = 0
  const exitBars: number[] = []
  const curve: number[] = []
  const exposureByBar: number[] = []

  for (let t = SIM_START; t <= endBar; t++) {
    const still: Pos[] = []
    for (const p of open) {
      if (t - p.entryBar >= cfg.H) {
        const px = insts[p.k].rows[t].open
        const gross = px / p.entry
        cash += p.alloc * gross * (1 - SIDE)
        trades++
        exitBars.push(t)
        if (gross - 1 - RT > 0) wins++
      } else still.push(p)
    }
    open = still

    const cands: { k: number; d: number }[] = []
    for (let k = 0; k < insts.length; k++) {
      if (insts[k].action[t - 1] === 1 && !open.some((p) => p.k === k)) {
        cands.push({ k, d: insts[k].dev[t - 1] })
      }
    }
    cands.sort((a, b) => (cfg.rank === 'deepest' ? a.d - b.d : b.d - a.d))

    let mtm = cash
    for (const p of open) mtm += p.alloc * (insts[p.k].rows[t].close / p.entry)
    for (const c of cands) {
      if (open.length >= cfg.K || cash <= 0) break
      const px = insts[c.k].rows[t].open
      if (!(px > 0)) continue
      const alloc = Math.min(cash, mtm / cfg.K)
      cash -= alloc
      open.push({ k: c.k, entry: px * (1 + SIDE), entryBar: t, alloc })
    }

    let eq = cash
    for (const p of open) eq += p.alloc * (insts[p.k].rows[t].close / p.entry)
    curve.push(eq)
    exposureByBar.push(eq > 0 ? (eq - cash) / eq : 0)
  }

  // Force-close residual at close[endBar] (IS terminal value / end of data).
  for (const p of open) {
    const gross = insts[p.k].closes[endBar] / p.entry
    // curve already marks these at close[endBar]; realize the exit cost.
    cash += p.alloc * gross * (1 - SIDE)
    trades++
    exitBars.push(endBar)
    if (gross - 1 - RT > 0) wins++
  }
  const finalEq = cash
  if (curve.length > 0) curve[curve.length - 1] = finalEq

  return { curve, firstBar: SIM_START, trades, wins, exitBars, exposureByBar }
}

interface SegmentMetrics {
  bars: number
  totalReturnPct: number
  annualizedReturnPct: number
  sharpe: number | null
  maxDrawdownPct: number
  mar: number | null
}

function segmentMetrics(values: number[]): SegmentMetrics | null {
  if (values.length < 3) return null
  const rets: number[] = []
  for (let i = 1; i < values.length; i++) rets.push(values[i] / values[i - 1] - 1)
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd = Math.sqrt(
    rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(1, rets.length - 1),
  )
  const total = values[values.length - 1] / values[0] - 1
  const ann = Math.pow(1 + total, 252 / rets.length) - 1
  let pk = values[0]
  let dd = 0
  for (const v of values) {
    if (v > pk) pk = v
    dd = Math.max(dd, (pk - v) / pk)
  }
  return {
    bars: values.length,
    totalReturnPct: Number((total * 100).toFixed(2)),
    annualizedReturnPct: Number((ann * 100).toFixed(2)),
    sharpe: sd > 0 ? Number(((mean / sd) * Math.sqrt(252)).toFixed(3)) : null,
    maxDrawdownPct: Number((dd * 100).toFixed(2)),
    mar: dd > 0 ? Number((ann / dd).toFixed(3)) : null,
  }
}

// ── Load + verify ────────────────────────────────────────────────────────────
console.log('Loading equities + building fast signal arrays…')
const insts = loadEquities()
console.log(`Universe: ${insts.length} equities (BTC excluded)`)

const lens = new Set(insts.map((x) => x.rows.length))
const t0 = new Set(insts.map((x) => x.rows[0].time))
const t1 = new Set(insts.map((x) => x.rows[x.rows.length - 1].time))
if (lens.size !== 1 || t0.size !== 1 || t1.size !== 1) {
  console.error(
    `Shared-calendar assumption violated: lengths=${[...lens].join(',')} firstTs=${t0.size} lastTs=${t1.size}`,
  )
  process.exit(1)
}
const nBars = insts[0].rows.length

console.log('Verifying fast-path parity against SSOT on 3 instruments…')
const parity = verifyParity(insts)
if (parity.mismatches > 0) {
  console.error(`PARITY FAILED: ${parity.mismatches} mismatches — aborting`)
  process.exit(1)
}
console.log(`Parity OK (${parity.checked.join(', ')}: 0 mismatches)`)

// Calendar-year bar ranges on the shared calendar.
const yearOf = (t: number) => new Date(insts[0].rows[t].time * 1000).toISOString().slice(0, 4)
const yearRange = new Map<string, { start: number; end: number }>()
for (let t = 0; t < nBars; t++) {
  const y = yearOf(t)
  const r = yearRange.get(y)
  if (!r) yearRange.set(y, { start: t, end: t })
  else r.end = t
}
const years = Array.from(yearRange.keys()).sort()
console.log(
  `Shared calendar: ${nBars} bars, ${years[0]}–${years[years.length - 1]} (sim from bar ${SIM_START})`,
)

// Equal-weight B&H daily curve over the full sim window (base 1 at SIM_START close).
const bnhCurve: number[] = []
for (let t = SIM_START; t < nBars; t++) {
  let s = 0
  for (const x of insts) s += x.closes[t] / x.closes[SIM_START]
  bnhCurve.push(s / insts.length)
}
const curveSlice = (curve: number[], firstBar: number, from: number, to: number) => {
  // include the bar before `from` as the base so the segment's first daily
  // return is from's return
  const a = Math.max(0, from - 1 - firstBar)
  const b = to - firstBar
  return curve.slice(a, b + 1)
}

// ── Walk-forward ─────────────────────────────────────────────────────────────
const WF_YEARS = ['2023', '2024', '2025']
const HOLDOUT_YEAR = '2026'

interface FoldReport {
  year: string
  locked?: boolean
  selectedConfig: string
  isSharpe: number | null
  isTop3: { config: string; sharpe: number | null; mar: number | null }[]
  rotation: SegmentMetrics | null
  rotationTradesClosed: number
  rotationAvgExposurePct: number | null
  bnh: SegmentMetrics | null
  beatsSharpe: boolean
  beatsMar: boolean
  beats: boolean
}

function selectConfig(
  isEndBar: number,
  metric: 'sharpe' | 'mar' = 'sharpe',
): {
  best: Config
  bestSharpe: number | null
  top3: FoldReport['isTop3']
} {
  const scored = GRID.map((cfg) => {
    const sim = simulate(insts, cfg, isEndBar)
    const m = segmentMetrics(sim.curve)
    return { cfg, sharpe: m?.sharpe ?? null, mar: m?.mar ?? null }
  }).sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))
  return {
    best: scored[0].cfg,
    bestSharpe: scored[0].sharpe,
    top3: scored.slice(0, 3).map((s) => ({ config: cfgLabel(s.cfg), sharpe: s.sharpe, mar: s.mar })),
  }
}

function scoreFold(year: string, locked: boolean, metric: 'sharpe' | 'mar' = 'sharpe'): FoldReport {
  const prevYear = years[years.indexOf(year) - 1]
  const isEndBar = yearRange.get(prevYear)!.end
  const { best, bestSharpe, top3 } = selectConfig(isEndBar, metric)

  const r = yearRange.get(year)!
  const sim = simulate(insts, best, Math.min(r.end, nBars - 1))
  const seg = curveSlice(sim.curve, sim.firstBar, r.start, Math.min(r.end, nBars - 1))
  const rot = segmentMetrics(seg)
  const bnhSeg = curveSlice(bnhCurve, SIM_START, r.start, Math.min(r.end, nBars - 1))
  const bnh = segmentMetrics(bnhSeg)

  const tradesClosed = sim.exitBars.filter((t) => t >= r.start && t <= r.end).length
  const expInYear: number[] = []
  for (let t = Math.max(r.start, sim.firstBar); t <= Math.min(r.end, nBars - 1); t++) {
    expInYear.push(sim.exposureByBar[t - sim.firstBar])
  }
  const avgExp =
    expInYear.length > 0
      ? Number(((expInYear.reduce((a, b) => a + b, 0) / expInYear.length) * 100).toFixed(1))
      : null

  const beatsSharpe = (rot?.sharpe ?? -Infinity) > (bnh?.sharpe ?? -Infinity)
  const beatsMar = (rot?.mar ?? -Infinity) > (bnh?.mar ?? -Infinity)
  return {
    year,
    ...(locked ? { locked: true } : {}),
    selectedConfig: cfgLabel(best),
    isSharpe: bestSharpe,
    isTop3: top3,
    rotation: rot,
    rotationTradesClosed: tradesClosed,
    rotationAvgExposurePct: avgExp,
    bnh,
    beatsSharpe,
    beatsMar,
    beats: beatsSharpe || beatsMar,
  }
}

console.log('\nWalk-forward folds (config selected on expanding IS, scored OOS)…')
const foldReports: FoldReport[] = WF_YEARS.map((y) => scoreFold(y, false))

console.log('Scoring LOCKED HOLDOUT 2026 H1 (selection on 2022–2025, evaluated once)…')
foldReports.push(scoreFold(HOLDOUT_YEAR, true))

const beats = foldReports.filter((f) => f.beats).length
const accepted = beats >= 3
const verdict = accepted ? 'ACCEPTED' : 'REJECTED'

// Sensitivity: does the verdict survive a different selection metric (MAR)?
console.log('Selection-metric sensitivity (MAR instead of Sharpe)…')
const marFolds: FoldReport[] = [...WF_YEARS.map((y) => scoreFold(y, false, 'mar')), scoreFold(HOLDOUT_YEAR, true, 'mar')]
const marBeats = marFolds.filter((f) => f.beats).length

// Full-period reference: the prototype config on all data (context only).
const refCfg: Config = { K: 10, H: 40, rank: 'deepest' }
const refSim = simulate(insts, refCfg, nBars - 1)
const refMetrics = segmentMetrics(refSim.curve)
const bnhFull = segmentMetrics(bnhCurve)

const payload = {
  timestamp: new Date().toISOString(),
  experiment:
    'D3/R2 K-slot rotation walk-forward (2026-07-11 rethink). EXPERIMENT ONLY — no published-number change.',
  universe: { equities: insts.length, btcExcluded: true, sharedCalendarBars: nBars },
  costsPerSide: SIDE,
  parityCheck: { instruments: parity.checked, mismatches: parity.mismatches },
  grid: { K: [5, 10, 15], H: [20, 40, 60], rank: ['deepest', 'shallowest'] },
  selectionMetric: 'IS Sharpe (daily, annualized), expanding window, residuals force-closed at IS end',
  acceptance:
    'R2: rotation beats equal-weight B&H on Sharpe OR MAR in ≥3 of 4 OOS segments (2023, 2024, 2025, 2026H1-locked-holdout)',
  folds: foldReports,
  oosSegmentsBeatingBnh: beats,
  verdict,
  selectionSensitivity: {
    metric: 'MAR',
    folds: marFolds.map((f) => ({
      year: f.year,
      selectedConfig: f.selectedConfig,
      beats: f.beats,
    })),
    oosSegmentsBeatingBnh: marBeats,
    verdict: marBeats >= 3 ? 'ACCEPTED' : 'REJECTED',
  },
  fullPeriodReference: {
    config: cfgLabel(refCfg),
    rotation: refMetrics,
    trades: refSim.trades,
    netWinRatePct: refSim.trades > 0 ? Number(((refSim.wins / refSim.trades) * 100).toFixed(1)) : null,
    bnh: bnhFull,
    note: 'Prototype config on the full window — context only, NOT walk-forward-honest.',
  },
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'rotation-walkforward.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== D3/R2 ROTATION WALK-FORWARD ===')
for (const f of foldReports) {
  const tag = f.locked ? ' [LOCKED HOLDOUT]' : ''
  console.log(
    `\n${f.year}${tag}  selected ${f.selectedConfig} (IS Sharpe ${f.isSharpe})` +
      `\n  rotation: ret ${f.rotation?.totalReturnPct}%  Sharpe ${f.rotation?.sharpe}  maxDD ${f.rotation?.maxDrawdownPct}%  MAR ${f.rotation?.mar}  trades ${f.rotationTradesClosed}  exp ${f.rotationAvgExposurePct}%` +
      `\n  B&H     : ret ${f.bnh?.totalReturnPct}%  Sharpe ${f.bnh?.sharpe}  maxDD ${f.bnh?.maxDrawdownPct}%  MAR ${f.bnh?.mar}` +
      `\n  beats B&H: Sharpe=${f.beatsSharpe} MAR=${f.beatsMar} → ${f.beats ? 'YES' : 'no'}`,
  )
}
console.log(
  `\nFull-period reference ${payload.fullPeriodReference.config}: ret ${refMetrics?.totalReturnPct}% (B&H ${bnhFull?.totalReturnPct}%), Sharpe ${refMetrics?.sharpe} (B&H ${bnhFull?.sharpe}), maxDD ${refMetrics?.maxDrawdownPct}% (B&H ${bnhFull?.maxDrawdownPct}%), trades ${refSim.trades}, netWR ${payload.fullPeriodReference.netWinRatePct}%`,
)
console.log(`\nOOS segments beating B&H (Sharpe or MAR): ${beats}/4 → ${verdict}`)
console.log(
  `Sensitivity (MAR selection): ${marBeats}/4 beat B&H → ${marBeats >= 3 ? 'ACCEPTED' : 'REJECTED'} (${marFolds.map((f) => `${f.year}:${f.selectedConfig}${f.beats ? '✓' : '✗'}`).join('  ')})`,
)
console.log(`Saved to: ${outPath}`)
