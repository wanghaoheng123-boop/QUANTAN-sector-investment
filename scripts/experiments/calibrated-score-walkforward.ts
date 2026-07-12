/**
 * D6/R3 EXPERIMENT — calibrated continuous score, walk-forward validated
 * (2026-07-11 rethink, MASTER §4 D6 / red-team R3). EXPERIMENT ONLY: no
 * display, signal, or sizing changes; results go to workspace/optimization-runs/.
 *
 * R3 hypothesis: replace the decorative zones/confidences (C5 — flat Kelly
 * 0.15 on every BUY) with ONE continuous calibrated probability that the 20d
 * forward net return is positive, usable as a REAL Kelly input.
 *
 * Design
 *  - Every eligible bar of every instrument is a sample (not just BUY bars —
 *    the score is a candidate replacement for the entry rule itself).
 *  - 7 leak-free features from data ≤ signal bar: dev vs 200SMA, 20-bar SMA
 *    slope, 5d/20d returns, prior-bar ATR%, 20d volume z-score, distance from
 *    60d high.
 *  - Label: net 20d forward return > 0 (entry next close, exit close+20,
 *    round-trip costs — benchmark math).
 *  - Model: L2 logistic regression, deterministic full-batch gradient descent
 *    (no library, no randomness). Features standardized on IS only.
 *  - Walk-forward: expanding IS per fold year (2023..2026), 20d PURGE at the
 *    boundary (IS label windows must close before the fold), 5-bar EMBARGO at
 *    OOS start — the D5 harness conventions.
 *  - Evaluation per fold + pooled:
 *      (1) CALIBRATION: OOS Brier vs the constant IS-base-rate predictor;
 *          reliability table (predicted-prob quintiles vs realized WR).
 *      (2) DISCRIMINATION: top-decile-by-score OOS forward net WR, with a
 *          NON-OVERLAPPING greedy sample + Wilson 95% CI, vs the OOS base rate.
 *      (3) SSOT overlap: fraction of top-decile bars where the production
 *          signal says BUY (is the score just rediscovering the dip rule?).
 *  - R3 acceptance: pooled OOS Brier < base Brier AND pooled top-decile
 *    non-overlap Wilson LOWER bound > pooled OOS base rate.
 *
 * Usage: npm run experiment:calibrated-score
 * Output: workspace/optimization-runs/calibrated-score-walkforward.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../../lib/backtest/dataLoader'
import { signalAtBarIndex, LABEL_HOLD_DAYS, WARMUP_BARS } from '../../lib/backtest/benchmarkLabel'
import { DEFAULT_EXECUTION_COSTS, netReturnAfterCosts } from '../../lib/backtest/executionModel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, '..', 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

const EMBARGO_BARS = 5
const N_FEATURES = 7

interface Sample {
  inst: number
  barIndex: number
  year: string
  x: Float64Array // length N_FEATURES, raw (standardized per fold)
  y: 0 | 1
  net: number
  ssotBuy: boolean
}

interface InstMeta {
  ticker: string
  yearStart: Map<string, number>
}

function loadSamples(): { samples: Sample[]; insts: InstMeta[] } {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  const samples: Sample[] = []
  const insts: InstMeta[] = []
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json'))
  for (const f of files) {
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
    if (rows.length < 252) continue
    const n = rows.length
    const instIdx = insts.length

    const closes = rows.map((r) => r.close)
    const vols = rows.map((r) => r.volume ?? 0)
    // prefix sums for SMA200
    const P = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + closes[i]
    const sma = new Float64Array(n).fill(NaN)
    for (let i = 199; i < n; i++) sma[i] = (P[i + 1] - P[i - 199]) / 200
    // ATR14 (Wilder-free simple mean of TR, prior-bar convention at use site)
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

    const yearStart = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const y = new Date(rows[i].time * 1000).toISOString().slice(0, 4)
      if (!yearStart.has(y)) yearStart.set(y, i)
    }
    insts.push({ ticker, yearStart })

    for (let i = WARMUP_BARS; i < n - LABEL_HOLD_DAYS - 1; i++) {
      const entry = rows[i + 1].close
      const exit = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, n - 1)].close
      if (!(entry > 0) || !(exit > 0)) continue
      const net = netReturnAfterCosts((exit - entry) / entry, DEFAULT_EXECUTION_COSTS)

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

      const ssotBuy =
        signalAtBarIndex(rows, i, ticker, { productionPath: true }).action === 'BUY'

      samples.push({
        inst: instIdx,
        barIndex: i,
        year: new Date(rows[i].time * 1000).toISOString().slice(0, 4),
        x,
        y: net > 0 ? 1 : 0,
        net,
        ssotBuy,
      })
    }
  }
  return { samples, insts }
}

/** Deterministic L2 logistic regression, full-batch GD on standardized features. */
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

/**
 * Isotonic regression via PAVA (pool-adjacent-violators), deterministic.
 * Fit on (score, y) pairs; returns a step function evaluated by binary search.
 * Used as a RECENCY-WINDOW recalibrator: the logistic provides the ranking,
 * but its probability LEVELS drift with the base-rate regime — so calibrate
 * on the most recent IS year only (the regime closest to the OOS fold).
 */
function fitIsotonic(pairs: { s: number; y: number }[]): (score: number) => number {
  const sorted = [...pairs].sort((a, b) => a.s - b.s)
  const n = sorted.length
  if (n === 0) return () => 0.5
  // PAVA blocks
  const blockVal: number[] = []
  const blockW: number[] = []
  const blockEndScore: number[] = []
  for (const p of sorted) {
    blockVal.push(p.y)
    blockW.push(1)
    blockEndScore.push(p.s)
    while (blockVal.length > 1 && blockVal[blockVal.length - 2] >= blockVal[blockVal.length - 1]) {
      const v2 = blockVal.pop()!
      const w2 = blockW.pop()!
      const e2 = blockEndScore.pop()!
      const v1 = blockVal.pop()!
      const w1 = blockW.pop()!
      blockEndScore.pop()
      blockVal.push((v1 * w1 + v2 * w2) / (w1 + w2))
      blockW.push(w1 + w2)
      blockEndScore.push(e2)
    }
  }
  return (score: number) => {
    // first block whose end-score >= score
    let lo = 0
    let hi = blockEndScore.length - 1
    if (score > blockEndScore[hi]) return blockVal[hi]
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (blockEndScore[mid] >= score) hi = mid
      else lo = mid + 1
    }
    return blockVal[lo]
  }
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

console.log('Loading samples (features + SSOT actions — full production-path pass)…')
const t0 = Date.now()
const { samples, insts } = loadSamples()
console.log(
  `Loaded ${samples.length} samples from ${insts.length} instruments in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
)

const FOLD_YEARS = ['2023', '2024', '2025', '2026']

interface FoldResult {
  year: string
  isSamples: number
  oosSamples: number
  isBaseRatePct: number | null
  oosBaseRatePct: number | null
  brierModel: number | null
  brierBase: number | null
  brierSkill: number | null // 1 - model/base (positive = better than base)
  /** Brier after recency-window isotonic recalibration (fit on the last IS year). */
  brierRecal: number | null
  recalSkill: number | null
  reliability: { bucket: string; n: number; meanPredPct: number; realizedPct: number }[]
  topDecile: {
    n: number
    winRatePct: number | null
    ssotBuyOverlapPct: number | null
    nonOverlap: { n: number; winRatePct: number | null; wilson95Pct: [number | null, number | null] }
    edgeVsBasePp: number | null
  }
}

const folds: FoldResult[] = []
let pooledSqModel = 0
let pooledSqBase = 0
let pooledSqRecal = 0
let pooledRecalN = 0
let pooledOosN = 0
let pooledOosWins = 0
let pooledTopN = 0
let pooledTopWins = 0
let pooledTopSsot = 0
let pooledTopNoN = 0
let pooledTopNoWins = 0

for (const year of FOLD_YEARS) {
  // Per-instrument boundaries for purge/embargo.
  const boundary = insts.map((m) => m.yearStart.get(year) ?? Number.POSITIVE_INFINITY)
  const isCutoff = boundary.map((b) => b - LABEL_HOLD_DAYS - 2)
  const oosStart = boundary.map((b) => b + EMBARGO_BARS)

  const isIdx: number[] = []
  const oosIdx: number[] = []
  for (let s = 0; s < samples.length; s++) {
    const smp = samples[s]
    if (smp.barIndex <= isCutoff[smp.inst]) isIdx.push(s)
    else if (smp.year === year && smp.barIndex >= oosStart[smp.inst]) oosIdx.push(s)
  }
  if (isIdx.length < 500 || oosIdx.length < 100) {
    console.log(`fold ${year}: skipped (IS ${isIdx.length}, OOS ${oosIdx.length})`)
    continue
  }

  // Standardize on IS only.
  const mean = new Float64Array(N_FEATURES)
  const std = new Float64Array(N_FEATURES)
  for (const s of isIdx) for (let j = 0; j < N_FEATURES; j++) mean[j] += samples[s].x[j]
  for (let j = 0; j < N_FEATURES; j++) mean[j] /= isIdx.length
  for (const s of isIdx)
    for (let j = 0; j < N_FEATURES; j++) {
      const d = samples[s].x[j] - mean[j]
      std[j] += d * d
    }
  for (let j = 0; j < N_FEATURES; j++) std[j] = Math.sqrt(std[j] / (isIdx.length - 1)) || 1

  const zX = (s: number) => {
    const out = new Float64Array(N_FEATURES)
    for (let j = 0; j < N_FEATURES; j++) out[j] = (samples[s].x[j] - mean[j]) / std[j]
    return out
  }

  const Xis = isIdx.map(zX)
  const yis = isIdx.map((s) => samples[s].y)
  const { w, b } = fitLogistic(Xis, yis)

  const isBase = yis.reduce((a: number, v) => a + v, 0) / yis.length

  // OOS predictions.
  const score = (s: number) => {
    const xs = zX(s)
    let z = b
    for (let j = 0; j < N_FEATURES; j++) z += w[j] * xs[j]
    return 1 / (1 + Math.exp(-z))
  }
  const preds: { s: number; p: number }[] = oosIdx.map((s) => ({ s, p: score(s) }))

  // Recency-window isotonic recalibration: fit on the LAST IS calendar year
  // (already purge-clean via isCutoff) — the regime closest to the OOS fold.
  const recalYear = String(Number(year) - 1)
  const recalPairs = isIdx
    .filter((s) => samples[s].year === recalYear)
    .map((s) => ({ s: score(s), y: samples[s].y as number }))
  const iso = recalPairs.length >= 200 ? fitIsotonic(recalPairs) : null

  let sqM = 0
  let sqB = 0
  let sqR = 0
  let oosWins = 0
  for (const { s, p } of preds) {
    const yv = samples[s].y
    sqM += (p - yv) * (p - yv)
    sqB += (isBase - yv) * (isBase - yv)
    if (iso) {
      const pr = iso(p)
      sqR += (pr - yv) * (pr - yv)
    }
    oosWins += yv
  }
  const brierM = sqM / preds.length
  const brierB = sqB / preds.length
  const brierR = iso ? sqR / preds.length : null
  const oosBase = oosWins / preds.length

  // Reliability quintiles by predicted prob.
  const sorted = [...preds].sort((a, b2) => a.p - b2.p)
  const reliability: FoldResult['reliability'] = []
  for (let q = 0; q < 5; q++) {
    const lo = Math.floor((q * sorted.length) / 5)
    const hi = Math.floor(((q + 1) * sorted.length) / 5)
    const slice = sorted.slice(lo, hi)
    if (slice.length === 0) continue
    const mp = slice.reduce((a, v) => a + v.p, 0) / slice.length
    const rw = slice.reduce((a, v) => a + samples[v.s].y, 0) / slice.length
    reliability.push({
      bucket: `Q${q + 1}`,
      n: slice.length,
      meanPredPct: pct(mp)!,
      realizedPct: pct(rw)!,
    })
  }

  // Top decile by score.
  const top = sorted.slice(Math.floor(sorted.length * 0.9))
  const topWins = top.reduce((a, v) => a + samples[v.s].y, 0)
  const topSsot = top.reduce((a, v) => a + (samples[v.s].ssotBuy ? 1 : 0), 0)
  // Non-overlapping greedy per instrument among top-decile bars.
  const byInst = new Map<number, { barIndex: number; y: number }[]>()
  for (const v of top) {
    const smp = samples[v.s]
    const arr = byInst.get(smp.inst) ?? []
    arr.push({ barIndex: smp.barIndex, y: smp.y })
    byInst.set(smp.inst, arr)
  }
  let noN = 0
  let noWins = 0
  for (const arr of byInst.values()) {
    arr.sort((a, b2) => a.barIndex - b2.barIndex)
    let last = -Infinity
    for (const t of arr) {
      if (t.barIndex - last > LABEL_HOLD_DAYS) {
        last = t.barIndex
        noN++
        noWins += t.y
      }
    }
  }
  const [noLo, noHi] = wilson95(noWins, noN)

  folds.push({
    year,
    isSamples: isIdx.length,
    oosSamples: oosIdx.length,
    isBaseRatePct: pct(isBase),
    oosBaseRatePct: pct(oosBase),
    brierModel: Number(brierM.toFixed(5)),
    brierBase: Number(brierB.toFixed(5)),
    brierSkill: Number((1 - brierM / brierB).toFixed(4)),
    brierRecal: brierR == null ? null : Number(brierR.toFixed(5)),
    recalSkill: brierR == null ? null : Number((1 - brierR / brierB).toFixed(4)),
    reliability,
    topDecile: {
      n: top.length,
      winRatePct: pct(top.length > 0 ? topWins / top.length : null),
      ssotBuyOverlapPct: pct(top.length > 0 ? topSsot / top.length : null),
      nonOverlap: {
        n: noN,
        winRatePct: pct(noN > 0 ? noWins / noN : null),
        wilson95Pct: noN > 0 ? [pct(noLo), pct(noHi)] : [null, null],
      },
      edgeVsBasePp:
        top.length > 0 ? Number(((topWins / top.length - oosBase) * 100).toFixed(2)) : null,
    },
  })

  pooledSqModel += sqM
  pooledSqBase += sqB
  if (brierR != null) {
    pooledSqRecal += sqR
    pooledRecalN += preds.length
  }
  pooledOosN += preds.length
  pooledOosWins += oosWins
  pooledTopN += top.length
  pooledTopWins += topWins
  pooledTopSsot += topSsot
  pooledTopNoN += noN
  pooledTopNoWins += noWins
}

const pooledBrierM = pooledOosN > 0 ? pooledSqModel / pooledOosN : null
const pooledBrierB = pooledOosN > 0 ? pooledSqBase / pooledOosN : null
const pooledBrierR = pooledRecalN > 0 ? pooledSqRecal / pooledRecalN : null
const pooledBase = pooledOosN > 0 ? pooledOosWins / pooledOosN : null
const [pnLo, pnHi] = wilson95(pooledTopNoWins, pooledTopNoN)

// Calibration acceptance uses the RECALIBRATED probabilities (recency-window
// isotonic on the last IS year — the deployable form); the raw logistic Brier
// is reported alongside for honesty.
const calibrationPass =
  pooledBrierR != null && pooledBrierB != null && pooledBrierR < pooledBrierB
const discriminationPass =
  pooledBase != null && pooledTopNoN > 0 && pnLo > pooledBase
const verdict = calibrationPass && discriminationPass ? 'ACCEPTED' : 'REJECTED'

const payload = {
  timestamp: new Date().toISOString(),
  experiment:
    'D6/R3 calibrated-score walk-forward (2026-07-11 rethink). EXPERIMENT ONLY — no signal/display/sizing change.',
  model: 'L2 logistic regression (deterministic full-batch GD, 400 iters, lr 0.5, l2 1e-4), features standardized on IS only',
  features: ['dev200', 'smaSlope20', 'ret5', 'ret20', 'atrPctPrior', 'volZ20', 'distFrom60dHigh'],
  design: `expanding-window yearly folds ${FOLD_YEARS.join('/')}, ${LABEL_HOLD_DAYS}d purge + ${EMBARGO_BARS}-bar embargo (D5 conventions)`,
  samples: samples.length,
  instruments: insts.length,
  folds,
  pooled: {
    oosSamples: pooledOosN,
    oosBaseRatePct: pct(pooledBase),
    brierModel: pooledBrierM == null ? null : Number(pooledBrierM.toFixed(5)),
    brierBase: pooledBrierB == null ? null : Number(pooledBrierB.toFixed(5)),
    brierSkill:
      pooledBrierM == null || pooledBrierB == null
        ? null
        : Number((1 - pooledBrierM / pooledBrierB).toFixed(4)),
    brierRecal: pooledBrierR == null ? null : Number(pooledBrierR.toFixed(5)),
    recalSkill:
      pooledBrierR == null || pooledBrierB == null
        ? null
        : Number((1 - pooledBrierR / pooledBrierB).toFixed(4)),
    topDecile: {
      n: pooledTopN,
      winRatePct: pct(pooledTopN > 0 ? pooledTopWins / pooledTopN : null),
      ssotBuyOverlapPct: pct(pooledTopN > 0 ? pooledTopSsot / pooledTopN : null),
      edgeVsBasePp:
        pooledTopN > 0 && pooledBase != null
          ? Number(((pooledTopWins / pooledTopN - pooledBase) * 100).toFixed(2))
          : null,
      nonOverlap: {
        n: pooledTopNoN,
        winRatePct: pct(pooledTopNoN > 0 ? pooledTopNoWins / pooledTopNoN : null),
        wilson95Pct: pooledTopNoN > 0 ? [pct(pnLo), pct(pnHi)] : [null, null],
      },
    },
  },
  acceptance: {
    calibration:
      'pooled OOS Brier(RECALIBRATED: recency-window isotonic on last IS year) < Brier(IS-base-rate constant); raw logistic Brier reported alongside',
    discrimination:
      'pooled top-decile NON-OVERLAP Wilson95 lower bound > pooled OOS base rate',
    calibrationPass,
    discriminationPass,
  },
  verdict,
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'calibrated-score-walkforward.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))

console.log('\n=== D6/R3 CALIBRATED SCORE — WALK-FORWARD ===')
for (const f of folds) {
  console.log(
    `\n${f.year}: IS n=${f.isSamples} (base ${f.isBaseRatePct}%)  OOS n=${f.oosSamples} (base ${f.oosBaseRatePct}%)` +
      `\n  Brier model ${f.brierModel} / recal ${f.brierRecal} vs base ${f.brierBase} → skill ${f.brierSkill} / recal ${f.recalSkill}` +
      `\n  reliability: ${f.reliability.map((r) => `${r.bucket} pred ${r.meanPredPct}%→real ${r.realizedPct}%`).join('  ')}` +
      `\n  top decile: n=${f.topDecile.n} WR ${f.topDecile.winRatePct}% (edge ${f.topDecile.edgeVsBasePp}pp vs base; SSOT-BUY overlap ${f.topDecile.ssotBuyOverlapPct}%)` +
      `\n  top decile non-overlap: n=${f.topDecile.nonOverlap.n} WR ${f.topDecile.nonOverlap.winRatePct}% [${f.topDecile.nonOverlap.wilson95Pct[0]}, ${f.topDecile.nonOverlap.wilson95Pct[1]}]`,
  )
}
console.log(
  `\nPOOLED: OOS n=${payload.pooled.oosSamples}, base ${payload.pooled.oosBaseRatePct}% | Brier raw ${payload.pooled.brierModel} / recal ${payload.pooled.brierRecal} vs base ${payload.pooled.brierBase} (skill ${payload.pooled.brierSkill} / recal ${payload.pooled.recalSkill})`,
)
console.log(
  `POOLED top decile: WR ${payload.pooled.topDecile.winRatePct}% (edge ${payload.pooled.topDecile.edgeVsBasePp}pp; SSOT overlap ${payload.pooled.topDecile.ssotBuyOverlapPct}%) | non-overlap n=${payload.pooled.topDecile.nonOverlap.n} WR ${payload.pooled.topDecile.nonOverlap.winRatePct}% [${payload.pooled.topDecile.nonOverlap.wilson95Pct[0]}, ${payload.pooled.topDecile.nonOverlap.wilson95Pct[1]}]`,
)
console.log(
  `Acceptance: calibration=${calibrationPass} discrimination=${discriminationPass} → ${verdict}`,
)
console.log(`Saved to: ${outPath}`)
