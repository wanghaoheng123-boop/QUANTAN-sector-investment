/**
 * Q-077 EXPERIMENT — score-RANKED selection with label-matched exits,
 * walk-forward validated (follow-through from the D6/R3 rejection: calibration
 * failed, but discrimination passed — top-decile non-overlap WR 60.71,
 * Wilson95 [56.12, 65.13], first honest CI lower bound above the base rate).
 * EXPERIMENT ONLY: no display, signal, or sizing changes; results go to
 * workspace/optimization-runs/.
 *
 * Hypothesis: RANKING by the D6 logistic score (no calibration — levels are
 * regime-unstable, order is not) selects entries good enough that a K-slot
 * portfolio with label-matched 20-bar time-only exits beats equal-weight B&H.
 *
 * Design
 *  - Universe: the shared-calendar equities (BTC excluded) — the D3 rotation
 *    machinery and its execution hygiene (signal at close t-1, T+1 open fill,
 *    11 bps per side, residuals force-closed at segment end).
 *  - Score: the D6 model exactly — 7 leak-free features (dev200, smaSlope20,
 *    ret5, ret20, atrPctPrior, volZ20, distFrom60dHigh), L2 logistic
 *    regression, deterministic full-batch GD, standardized on IS only.
 *  - Walk-forward: for each OOS segment Y in {2023, 2024, 2025} train on all
 *    samples with label windows closing before Y (20d PURGE — D5/D6
 *    conventions), threshold at the IS score's 90th percentile ("top decile",
 *    causal: no OOS distribution peeking), and pick K in {5,10,15} by IS
 *    Sharpe on an expanding window (residuals force-closed at IS end).
 *    2026 H1 is the LOCKED HOLDOUT: trained/selected on 2022–2025, scored once.
 *  - Portfolio state is evolved from history under the fold's model (the D3
 *    rotation convention; carried-in positions come from IS bars — disclosed).
 *  - Entries: score(t-1) >= IS-q90 threshold, not already held, ranked by
 *    score descending, up to K slots, alloc = min(cash, mtm/K).
 *  - Exits: time-only after 20 bars at open (label-matched — the D2/D4 family;
 *    stops/panic/profit-take retired).
 *  - Acceptance (D3-style, per Q-077): beats equal-weight B&H on Sharpe OR MAR
 *    in >=3 of the 4 OOS segments (2023, 2024, 2025, 2026H1).
 *  - Sensitivities (context, not acceptance): K selected by MAR instead of
 *    Sharpe; entry threshold at IS-q80 / IS-q95.
 *
 * Usage: npm run experiment:score-select
 * Output: workspace/optimization-runs/score-ranked-selection-walkforward.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'
import { LABEL_HOLD_DAYS, WARMUP_BARS } from '../../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../../lib/backtest/executionModel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const SIDE = 0.0011
const RT = 2 * SIDE
const N_FEATURES = 7
const HOLD_BARS = LABEL_HOLD_DAYS // 20 — label-matched time-only exit
// slope20 needs sma[i-20] finite (sma finite from bar 199) → first
// all-finite-feature bar is 219; first T+1 fill on a scored bar is 220.
const FIRST_FEATURE_BAR = WARMUP_BARS + 19
const SIM_START = FIRST_FEATURE_BAR + 1

interface Inst {
  ticker: string
  rows: OhlcvRow[]
  closes: number[]
  /** Raw feature vectors per bar (NaN-filled Float64Array(7) when undefined). */
  feat: Float64Array[]
  /** Training label per bar: 1 if net 20d fwd return > 0 (D6 label math), -1 = no sample. */
  y: Int8Array
}

function buildFeatures(ticker: string, rows: OhlcvRow[]): Inst {
  const n = rows.length
  const closes = rows.map((r) => r.close)
  const vols = rows.map((r) => r.volume ?? 0)
  const P = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) P[i + 1] = P[i] + closes[i]
  const sma = new Float64Array(n).fill(NaN)
  for (let i = 199; i < n; i++) sma[i] = (P[i + 1] - P[i - 199]) / 200
  const tr = new Float64Array(n)
  tr[0] = rows[0].high - rows[0].low
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - closes[i - 1]),
      Math.abs(rows[i].low - closes[i - 1]),
    )
  }
  const atr = new Float64Array(n).fill(NaN)
  let trSum = 0
  for (let i = 0; i < n; i++) {
    trSum += tr[i]
    if (i >= 14) trSum -= tr[i - 14]
    if (i >= 13) atr[i] = trSum / 14
  }

  const feat: Float64Array[] = new Array(n)
  const y = new Int8Array(n).fill(-1)
  const nanVec = () => new Float64Array(N_FEATURES).fill(NaN)
  for (let i = 0; i < n; i++) feat[i] = nanVec()

  for (let i = FIRST_FEATURE_BAR; i < n; i++) {
    const dev = closes[i] / sma[i] - 1
    const slope20 = sma[i] / sma[i - 20] - 1
    const ret5 = closes[i] / closes[i - 5] - 1
    const ret20 = closes[i] / closes[i - 20] - 1
    const atrPct = Number.isFinite(atr[i - 1]) ? atr[i - 1] / closes[i] : 0.02
    let vMean = 0
    for (let k = i - 19; k <= i; k++) vMean += vols[k]
    vMean /= 20
    let vVar = 0
    for (let k = i - 19; k <= i; k++) vVar += (vols[k] - vMean) * (vols[k] - vMean)
    const vStd = Math.sqrt(vVar / 19)
    const volZ = vStd > 0 ? (vols[i] - vMean) / vStd : 0
    let hi60 = -Infinity
    for (let k = Math.max(0, i - 59); k <= i; k++) if (closes[k] > hi60) hi60 = closes[k]
    const distHigh = closes[i] / hi60 - 1

    const x = new Float64Array([dev, slope20, ret5, ret20, atrPct, volZ, distHigh])
    if (!x.every((v) => Number.isFinite(v))) continue
    feat[i] = x

    // Training label (D6 math): entry next close, exit close+20, round-trip costs.
    if (i < n - LABEL_HOLD_DAYS - 1) {
      const entry = rows[i + 1].close
      const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, n - 1)].close
      if (entry > 0 && exit > 0) {
        const net = netReturnAfterCosts((exit - entry) / entry, DEFAULT_EXECUTION_COSTS)
        y[i] = net > 0 ? 1 : 0
      }
    }
  }
  return { ticker, rows, closes, feat, y }
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
      return { ticker, rows }
    })
    .filter((x) => x.rows.length >= 252 && x.ticker !== 'BTC')
    .map((x) => buildFeatures(x.ticker, x.rows))
}

/** Deterministic L2 logistic regression (D6 hyperparameters exactly). */
function fitLogistic(
  X: Float64Array[],
  y: (0 | 1)[],
  iters = 400,
  lr = 0.5,
  l2 = 1e-4,
): { w: Float64Array; b: number } {
  const n = X.length
  const d = N_FEATURES
  const w = new Float64Array(d)
  let b = 0
  const gw = new Float64Array(d)
  for (let it = 0; it < iters; it++) {
    gw.fill(0)
    let gb = 0
    for (let s = 0; s < n; s++) {
      let z = b
      const xs = X[s]
      for (let j = 0; j < d; j++) z += w[j] * xs[j]
      const p = 1 / (1 + Math.exp(-z))
      const err = p - y[s]
      for (let j = 0; j < d; j++) gw[j] += err * xs[j]
      gb += err
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j])
    b -= lr * (gb / n)
  }
  return { w, b }
}

interface FoldModel {
  year: string
  isSamples: number
  isBaseRatePct: number
  /** Entry threshold = q-quantile of IS scores, keyed by quantile string. */
  thresholds: Record<string, number>
  /** score[k][i] for every instrument/bar (NaN where features undefined). */
  scores: Float64Array[]
}

/**
 * Train the fold model on all samples with barIndex <= isCutoff (20d purge:
 * every IS label window closes before the OOS segment starts), standardize on
 * IS only, then score EVERY bar of every instrument with the fold's transform.
 */
function trainFold(insts: Inst[], year: string, yearStartBar: number): FoldModel {
  const isCutoff = yearStartBar - LABEL_HOLD_DAYS - 2

  const Xraw: Float64Array[] = []
  const yv: (0 | 1)[] = []
  for (const inst of insts) {
    const lim = Math.min(isCutoff, inst.rows.length - 1)
    for (let i = FIRST_FEATURE_BAR; i <= lim; i++) {
      if (inst.y[i] === -1) continue
      if (!Number.isFinite(inst.feat[i][0])) continue
      Xraw.push(inst.feat[i])
      yv.push(inst.y[i] as 0 | 1)
    }
  }

  const mean = new Float64Array(N_FEATURES)
  const std = new Float64Array(N_FEATURES)
  for (const x of Xraw) for (let j = 0; j < N_FEATURES; j++) mean[j] += x[j]
  for (let j = 0; j < N_FEATURES; j++) mean[j] /= Xraw.length
  for (const x of Xraw)
    for (let j = 0; j < N_FEATURES; j++) {
      const d = x[j] - mean[j]
      std[j] += d * d
    }
  for (let j = 0; j < N_FEATURES; j++) std[j] = Math.sqrt(std[j] / (Xraw.length - 1)) || 1

  const zX = (x: Float64Array) => {
    const out = new Float64Array(N_FEATURES)
    for (let j = 0; j < N_FEATURES; j++) out[j] = (x[j] - mean[j]) / std[j]
    return out
  }
  const Xis = Xraw.map(zX)
  const { w, b } = fitLogistic(Xis, yv)

  const scoreOf = (x: Float64Array) => {
    let z = b
    for (let j = 0; j < N_FEATURES; j++) z += (w[j] * (x[j] - mean[j])) / std[j]
    return 1 / (1 + Math.exp(-z))
  }

  const isScores = Xraw.map(scoreOf).sort((a, b2) => a - b2)
  const q = (p: number) => isScores[Math.min(isScores.length - 1, Math.floor(p * (isScores.length - 1)))]
  const thresholds: Record<string, number> = {
    'q80': q(0.8),
    'q90': q(0.9),
    'q95': q(0.95),
  }

  const scores = insts.map((inst) => {
    const s = new Float64Array(inst.rows.length).fill(NaN)
    for (let i = FIRST_FEATURE_BAR; i < inst.rows.length; i++) {
      if (Number.isFinite(inst.feat[i][0])) s[i] = scoreOf(inst.feat[i])
    }
    return s
  })

  const isBase = yv.reduce((a: number, v) => a + v, 0) / yv.length
  return {
    year,
    isSamples: Xraw.length,
    isBaseRatePct: Number((isBase * 100).toFixed(2)),
    thresholds,
    scores,
  }
}

interface SimResult {
  curve: number[]
  firstBar: number
  trades: number
  wins: number
  exitBars: number[]
  /** Parallel to exitBars: 1 if that round trip was a net win. */
  exitWins: Uint8Array | number[]
  exposureByBar: number[]
}

/**
 * K-slot portfolio sim over [SIM_START, endBar]: entries where score(t-1) >=
 * threshold (ranked by score desc), T+1 open fills, time-only exit after
 * HOLD_BARS at open, residuals force-closed at close[endBar] with costs.
 */
function simulate(
  insts: Inst[],
  model: FoldModel,
  K: number,
  threshold: number,
  endBar: number,
): SimResult {
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
  const exitWins: number[] = []
  const curve: number[] = []
  const exposureByBar: number[] = []

  for (let t = SIM_START; t <= endBar; t++) {
    const still: Pos[] = []
    for (const p of open) {
      if (t - p.entryBar >= HOLD_BARS) {
        const px = insts[p.k].rows[t].open
        const gross = px / p.entry
        cash += p.alloc * gross * (1 - SIDE)
        trades++
        exitBars.push(t)
        const win = gross - 1 - RT > 0
        exitWins.push(win ? 1 : 0)
        if (win) wins++
      } else still.push(p)
    }
    open = still

    const cands: { k: number; s: number }[] = []
    for (let k = 0; k < insts.length; k++) {
      const s = model.scores[k][t - 1]
      if (Number.isFinite(s) && s >= threshold && !open.some((p) => p.k === k)) {
        cands.push({ k, s })
      }
    }
    cands.sort((a, b) => b.s - a.s)

    let mtm = cash
    for (const p of open) mtm += p.alloc * (insts[p.k].rows[t].close / p.entry)
    for (const c of cands) {
      if (open.length >= K || cash <= 0) break
      const px = insts[c.k].rows[t].open
      if (!(px > 0)) continue
      const alloc = Math.min(cash, mtm / K)
      cash -= alloc
      open.push({ k: c.k, entry: px * (1 + SIDE), entryBar: t, alloc })
    }

    let eq = cash
    for (const p of open) eq += p.alloc * (insts[p.k].rows[t].close / p.entry)
    curve.push(eq)
    exposureByBar.push(eq > 0 ? (eq - cash) / eq : 0)
  }

  for (const p of open) {
    const gross = insts[p.k].closes[endBar] / p.entry
    cash += p.alloc * gross * (1 - SIDE)
    trades++
    exitBars.push(endBar)
    const win = gross - 1 - RT > 0
    exitWins.push(win ? 1 : 0)
    if (win) wins++
  }
  const finalEq = cash
  if (curve.length > 0) curve[curve.length - 1] = finalEq

  return { curve, firstBar: SIM_START, trades, wins, exitBars, exitWins, exposureByBar }
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

// ── Load ─────────────────────────────────────────────────────────────────────
console.log('Loading equities + building feature/label arrays…')
const t0ms = Date.now()
const insts = loadEquities()
console.log(`Universe: ${insts.length} equities (BTC excluded)`)

const lens = new Set(insts.map((x) => x.rows.length))
const tFirst = new Set(insts.map((x) => x.rows[0].time))
const tLast = new Set(insts.map((x) => x.rows[x.rows.length - 1].time))
if (lens.size !== 1 || tFirst.size !== 1 || tLast.size !== 1) {
  console.error(
    `Shared-calendar assumption violated: lengths=${[...lens].join(',')} firstTs=${tFirst.size} lastTs=${tLast.size}`,
  )
  process.exit(1)
}
const nBars = insts[0].rows.length

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

// Equal-weight B&H daily curve (base 1 at SIM_START close) — the D3 baseline.
const bnhCurve: number[] = []
for (let t = SIM_START; t < nBars; t++) {
  let s = 0
  for (const x of insts) s += x.closes[t] / x.closes[SIM_START]
  bnhCurve.push(s / insts.length)
}
const curveSlice = (curve: number[], firstBar: number, from: number, to: number) => {
  const a = Math.max(0, from - 1 - firstBar)
  const b = to - firstBar
  return curve.slice(a, b + 1)
}

// ── Walk-forward ─────────────────────────────────────────────────────────────
const WF_YEARS = ['2023', '2024', '2025']
const HOLDOUT_YEAR = '2026'
const K_GRID = [5, 10, 15]

console.log('Training fold models (expanding IS, 20d purge)…')
const foldModels = new Map<string, FoldModel>()
for (const y of [...WF_YEARS, HOLDOUT_YEAR]) {
  const m = trainFold(insts, y, yearRange.get(y)!.start)
  foldModels.set(y, m)
  console.log(
    `  fold ${y}: IS n=${m.isSamples} (base ${m.isBaseRatePct}%), thresholds q80=${m.thresholds.q80.toFixed(4)} q90=${m.thresholds.q90.toFixed(4)} q95=${m.thresholds.q95.toFixed(4)}`,
  )
}

interface FoldReport {
  year: string
  locked?: boolean
  selectedK: number
  isSharpe: number | null
  isGrid: { K: number; sharpe: number | null; mar: number | null }[]
  strategy: SegmentMetrics | null
  tradesClosed: number
  winRateClosedPct: number | null
  avgExposurePct: number | null
  bnh: SegmentMetrics | null
  beatsSharpe: boolean
  beatsMar: boolean
  beats: boolean
}

function scoreFold(
  year: string,
  locked: boolean,
  quantile: string,
  metric: 'sharpe' | 'mar' = 'sharpe',
): FoldReport {
  const model = foldModels.get(year)!
  const threshold = model.thresholds[quantile]
  const prevYear = years[years.indexOf(year) - 1]
  const isEndBar = yearRange.get(prevYear)!.end

  const scored = K_GRID.map((K) => {
    const sim = simulate(insts, model, K, threshold, isEndBar)
    const m = segmentMetrics(sim.curve)
    return { K, sharpe: m?.sharpe ?? null, mar: m?.mar ?? null }
  }).sort((a, b) => (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity))
  const bestK = scored[0].K

  const r = yearRange.get(year)!
  const endBar = Math.min(r.end, nBars - 1)
  const sim = simulate(insts, model, bestK, threshold, endBar)
  const seg = curveSlice(sim.curve, sim.firstBar, r.start, endBar)
  const strat = segmentMetrics(seg)
  const bnhSeg = curveSlice(bnhCurve, SIM_START, r.start, endBar)
  const bnh = segmentMetrics(bnhSeg)

  const inSeg = (t: number) => t >= r.start && t <= r.end
  let tradesClosed = 0
  let winsClosed = 0
  for (let i = 0; i < sim.exitBars.length; i++) {
    if (inSeg(sim.exitBars[i])) {
      tradesClosed++
      winsClosed += sim.exitWins[i]
    }
  }

  const expInSeg: number[] = []
  for (let t = Math.max(r.start, sim.firstBar); t <= endBar; t++) {
    expInSeg.push(sim.exposureByBar[t - sim.firstBar])
  }
  const avgExp =
    expInSeg.length > 0
      ? Number(((expInSeg.reduce((a, b) => a + b, 0) / expInSeg.length) * 100).toFixed(1))
      : null

  const beatsSharpe = (strat?.sharpe ?? -Infinity) > (bnh?.sharpe ?? -Infinity)
  const beatsMar = (strat?.mar ?? -Infinity) > (bnh?.mar ?? -Infinity)
  return {
    year,
    ...(locked ? { locked: true } : {}),
    selectedK: bestK,
    isSharpe: scored[0].sharpe,
    isGrid: K_GRID.map((K) => scored.find((s) => s.K === K)!).map((s) => ({
      K: s.K,
      sharpe: s.sharpe,
      mar: s.mar,
    })),
    strategy: strat,
    tradesClosed,
    winRateClosedPct: tradesClosed > 0 ? Number(((winsClosed / tradesClosed) * 100).toFixed(1)) : null,
    avgExposurePct: avgExp,
    bnh,
    beatsSharpe,
    beatsMar,
    beats: beatsSharpe || beatsMar,
  }
}

console.log('\nWalk-forward folds at IS-q90 threshold (K selected on expanding IS Sharpe)…')
const foldReports: FoldReport[] = WF_YEARS.map((y) => scoreFold(y, false, 'q90'))
console.log('Scoring LOCKED HOLDOUT 2026 H1 (trained/selected on 2022–2025, evaluated once)…')
foldReports.push(scoreFold(HOLDOUT_YEAR, true, 'q90'))

const beats = foldReports.filter((f) => f.beats).length
const accepted = beats >= 3
const verdict = accepted ? 'ACCEPTED' : 'REJECTED'

console.log('Selection-metric sensitivity (MAR instead of Sharpe)…')
const marFolds = [...WF_YEARS.map((y) => scoreFold(y, false, 'q90', 'mar')), scoreFold(HOLDOUT_YEAR, true, 'q90', 'mar')]
const marBeats = marFolds.filter((f) => f.beats).length

console.log('Threshold sensitivity (IS-q80 / IS-q95)…')
const q80Folds = [...WF_YEARS.map((y) => scoreFold(y, false, 'q80')), scoreFold(HOLDOUT_YEAR, true, 'q80')]
const q95Folds = [...WF_YEARS.map((y) => scoreFold(y, false, 'q95')), scoreFold(HOLDOUT_YEAR, true, 'q95')]

const payload = {
  timestamp: new Date().toISOString(),
  experiment:
    'Q-077 score-RANKED selection walk-forward (D6 discrimination follow-through). EXPERIMENT ONLY — no signal/display/sizing change.',
  model:
    'D6 L2 logistic (deterministic full-batch GD, 400 iters, lr 0.5, l2 1e-4), 7 leak-free features, standardized on IS only, per-fold expanding IS with 20d purge',
  entryRule:
    'score(t-1) >= IS-90th-percentile threshold (causal top decile), ranked by score desc, up to K slots (K in {5,10,15} selected per fold on expanding IS Sharpe)',
  exitRule: 'time-only after 20 bars at T+1 open (label-matched; stops/panic/profit-take retired)',
  costsPerSide: SIDE,
  universe: { equities: insts.length, btcExcluded: true, sharedCalendarBars: nBars },
  acceptance:
    'Q-077 (D3-style): strategy beats equal-weight B&H on Sharpe OR MAR in >=3 of 4 OOS segments (2023, 2024, 2025, 2026H1-locked-holdout)',
  folds: foldReports,
  oosSegmentsBeatingBnh: beats,
  verdict,
  sensitivities: {
    marSelection: {
      folds: marFolds.map((f) => ({ year: f.year, selectedK: f.selectedK, beats: f.beats })),
      oosSegmentsBeatingBnh: marBeats,
      verdict: marBeats >= 3 ? 'ACCEPTED' : 'REJECTED',
    },
    thresholdQ80: {
      folds: q80Folds.map((f) => ({ year: f.year, selectedK: f.selectedK, beats: f.beats })),
      oosSegmentsBeatingBnh: q80Folds.filter((f) => f.beats).length,
    },
    thresholdQ95: {
      folds: q95Folds.map((f) => ({ year: f.year, selectedK: f.selectedK, beats: f.beats })),
      oosSegmentsBeatingBnh: q95Folds.filter((f) => f.beats).length,
    },
  },
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'score-ranked-selection-walkforward.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== Q-077 SCORE-RANKED SELECTION — WALK-FORWARD ===')
for (const f of foldReports) {
  const tag = f.locked ? ' [LOCKED HOLDOUT]' : ''
  console.log(
    `\n${f.year}${tag}  K=${f.selectedK} (IS Sharpe ${f.isSharpe})` +
      `\n  strategy: ret ${f.strategy?.totalReturnPct}%  Sharpe ${f.strategy?.sharpe}  maxDD ${f.strategy?.maxDrawdownPct}%  MAR ${f.strategy?.mar}  trades ${f.tradesClosed}  exp ${f.avgExposurePct}%` +
      `\n  B&H     : ret ${f.bnh?.totalReturnPct}%  Sharpe ${f.bnh?.sharpe}  maxDD ${f.bnh?.maxDrawdownPct}%  MAR ${f.bnh?.mar}` +
      `\n  beats B&H: Sharpe=${f.beatsSharpe} MAR=${f.beatsMar} → ${f.beats ? 'YES' : 'no'}`,
  )
}
console.log(`\nOOS segments beating B&H (Sharpe or MAR): ${beats}/4 → ${verdict}`)
console.log(
  `Sensitivity — MAR selection: ${marBeats}/4 | q80 threshold: ${payload.sensitivities.thresholdQ80.oosSegmentsBeatingBnh}/4 | q95 threshold: ${payload.sensitivities.thresholdQ95.oosSegmentsBeatingBnh}/4`,
)
console.log(`Elapsed ${((Date.now() - t0ms) / 1000).toFixed(0)}s`)
console.log(`Saved to: ${outPath}`)
