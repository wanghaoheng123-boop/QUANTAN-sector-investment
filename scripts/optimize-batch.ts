/**
 * Batch optimization loop — canonical benchmark parameter search.
 *
 * Runs ≥100 iterations (default 120), logs each to workspace/optimization-runs/iter-NNN.json,
 * writes BEST_CONFIG.json, optionally promotes winners to benchmark-signals.mjs constants.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts
 *   npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts --from 101 --count 50
 *   npx tsx --tsconfig tsconfig.json scripts/optimize-batch.ts --no-promote
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

import {
  DEFAULT_CANONICAL_PARAMS,
  evaluateCanonicalBenchmark,
  type CanonicalSignalParams,
} from '../lib/optimize/canonicalBenchmark'
import { getProfileForTicker } from '../lib/optimize/sectorProfiles'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')
const dataDir = join(__dirname, 'backtestData')
const runsDir = join(ROOT, 'workspace', 'optimization-runs')

const FLOOR_WR = 0.55
const BASELINE_WR = 0.5726

interface LoadedTicker {
  ticker: string
  sector: string
  closes: number[]
}

function loadAllTickers(): LoadedTicker[] {
  if (!existsSync(dataDir)) {
    console.error('No backtestData. Run fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const raw = readFileSync(join(dataDir, f), 'utf-8')
      const data = JSON.parse(raw) as { sector?: string; candles?: Array<{ close: number }> }
      const ticker = f.replace('.json', '').replace(/-/g, '.')
      const closes = (data.candles ?? [])
        .map(c => c.close)
        .filter(c => Number.isFinite(c))
      return { ticker, sector: data.sector ?? 'Unknown', closes }
    })
    .filter(d => d.closes.length >= 252)
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function randomParams(rng: () => number, mode: 'random' | 'sector_blend'): CanonicalSignalParams {
  if (mode === 'sector_blend') {
    // Use median sector profile thresholds (canonical path proxy)
    return {
      slopeThreshold: pick(rng, [0.003, 0.004, 0.005, 0.006, 0.008]),
      rsiBuyMax: pick(rng, [38, 40, 42, 45]),
      dipLowerPct: pick(rng, [-22, -20, -18, -15]),
      dipUpperPct: pick(rng, [-3, -2, -1, 0]),
      overboughtSellPct: pick(rng, [18, 20, 22, 25]),
      fallingKnifeLowerPct: pick(rng, [-18, -15, -12]),
      fallingKnifeSlope: pick(rng, [-0.008, -0.005, -0.003]),
      holdDays: pick(rng, [15, 18, 20, 22, 25]),
    }
  }
  return {
    slopeThreshold: 0.003 + rng() * 0.008,
    rsiBuyMax: 35 + Math.floor(rng() * 12),
    dipLowerPct: -25 + rng() * 8,
    dipUpperPct: -5 + rng() * 4,
    overboughtSellPct: 15 + rng() * 12,
    fallingKnifeLowerPct: -20 + rng() * 8,
    fallingKnifeSlope: -0.01 + rng() * 0.008,
    holdDays: 15 + Math.floor(rng() * 16),
  }
}

/** Grid neighbors around production defaults (iterations 1–24) */
function gridAroundBaseline(index: number): CanonicalSignalParams {
  const slopes = [0.003, 0.004, 0.005, 0.006, 0.007, 0.008]
  const rsiVals = [36, 38, 40, 42, 44]
  const dipUppers = [-3, -2, -1, 0]
  const holds = [18, 20, 22]
  const combos: CanonicalSignalParams[] = []
  for (const slopeThreshold of slopes) {
    for (const rsiBuyMax of rsiVals) {
      for (const dipUpperPct of dipUppers) {
        for (const holdDays of holds) {
          combos.push({
            ...DEFAULT_CANONICAL_PARAMS,
            slopeThreshold,
            rsiBuyMax,
            dipUpperPct,
            holdDays,
          })
        }
      }
    }
  }
  return combos[index % combos.length] ?? DEFAULT_CANONICAL_PARAMS
}

/** Per-sector slope from sectorProfiles (iterations 25–40) */
function sectorSlopeSweep(index: number, datasets: LoadedTicker[]): CanonicalSignalParams {
  const tickers = datasets.map(d => d.ticker)
  const slopes = [0.003, 0.004, 0.005, 0.006, 0.008]
  const slope = slopes[index % slopes.length]!
  // Evaluate uses global params; sector-specific noted in hypothesis
  const profile = getProfileForTicker(tickers[index % tickers.length]!)
  return {
    ...DEFAULT_CANONICAL_PARAMS,
    slopeThreshold: profile.slopeThreshold,
    rsiBuyMax: profile.confidenceThreshold > 55 ? 38 : 42,
  }
}

interface IterLog {
  iteration: number
  timestamp: string
  hypothesis: string
  persona: 'Quant/Math' | 'Code/Architecture' | 'Physics/Risk' | 'Verifier' | 'Data integrity'
  params: CanonicalSignalParams
  metrics: {
    canonicalWinRatePct: number
    avgWinRatePerInstrumentPct: number
    totalBuySignals: number
    avgReturnPerSignalPct: number
    deltaVsBaselinePct: number
  }
  decision: 'ACCEPT' | 'REJECT'
  reason: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  let from = 1
  let count = 120
  let promote = true
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) from = Number(args[++i])
    if (args[i] === '--count' && args[i + 1]) count = Number(args[++i])
    if (args[i] === '--no-promote') promote = false
  }
  return { from, count, promote }
}

function runTests(): { pass: boolean; output: string } {
  try {
    const out = execSync('npm run test', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    return { pass: true, output: out.slice(-200) }
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string }
    return { pass: false, output: (err.stderr ?? err.stdout ?? String(e)).slice(-500) }
  }
}

async function main() {
  const { from, count, promote } = parseArgs()
  const end = from + count - 1

  mkdirSync(runsDir, { recursive: true })

  console.log('\n══════════════════════════════════════════════════════')
  console.log('  QUANTAN — Batch Canonical Optimization')
  console.log(`  Iterations ${from}–${end} | Floor ${FLOOR_WR * 100}% | Baseline ${(BASELINE_WR * 100).toFixed(2)}%`)
  console.log('══════════════════════════════════════════════════════\n')

  const datasets = loadAllTickers()
  const evalData = datasets.map(({ closes }) => ({ ticker: '', closes }))
  console.log(`Loaded ${datasets.length} instruments\n`)

  const baseline = evaluateCanonicalBenchmark(evalData, DEFAULT_CANONICAL_PARAMS)
  const baselineWR = baseline.aggregateWinRate
  console.log(
    `Baseline replay: ${(baselineWR * 100).toFixed(2)}% WR, ${baseline.totalBuySignals} signals\n`,
  )

  let bestWR = baselineWR
  let bestParams = { ...DEFAULT_CANONICAL_PARAMS }
  let bestSignals = baseline.totalBuySignals
  let accepted = 0
  let rejected = 0

  const rng = mulberry32(42 + from)

  for (let iter = from; iter <= end; iter++) {
    let params: CanonicalSignalParams
    let hypothesis: string
    let persona: IterLog['persona']

    if (iter <= 24) {
      params = gridAroundBaseline(iter - 1)
      hypothesis = `Grid sweep around default canonical thresholds (slope/RSI/dip/hold)`
      persona = 'Quant/Math'
    } else if (iter <= 40) {
      params = sectorSlopeSweep(iter - 25, datasets)
      hypothesis = `Sector profile slopeThreshold mapped to canonical path`
      persona = 'Quant/Math'
    } else if (iter <= 60) {
      params = randomParams(rng, 'sector_blend')
      hypothesis = `Discrete random blend — sector-informed threshold sets`
      persona = 'Physics/Risk'
    } else {
      params = randomParams(rng, 'random')
      hypothesis = `Continuous random search in canonical param space`
      persona = 'Physics/Risk'
    }

    const result = evaluateCanonicalBenchmark(evalData, params)
    const wr = result.aggregateWinRate
    const delta = wr - baselineWR

    let decision: 'ACCEPT' | 'REJECT' = 'REJECT'
    let reason = ''

    if (wr < FLOOR_WR) {
      reason = `WR ${(wr * 100).toFixed(2)}% below floor ${FLOOR_WR * 100}%`
    } else if (wr < baselineWR - 1e-9) {
      reason = `WR ${(wr * 100).toFixed(2)}% below baseline ${(baselineWR * 100).toFixed(2)}%`
    } else if (wr > bestWR + 1e-9) {
      decision = 'ACCEPT'
      reason = `New best: ${(wr * 100).toFixed(2)}% (+${(delta * 100).toFixed(2)}pp vs baseline)`
      bestWR = wr
      bestParams = { ...params }
      bestSignals = result.totalBuySignals
      accepted++
    } else if (
      Math.abs(wr - baselineWR) < 1e-9 &&
      result.totalBuySignals < bestSignals
    ) {
      decision = 'ACCEPT'
      reason = `Same WR with fewer signals (${result.totalBuySignals} vs ${bestSignals})`
      bestParams = { ...params }
      bestSignals = result.totalBuySignals
      accepted++
    } else {
      reason = `No improvement (WR ${(wr * 100).toFixed(2)}%)`
      rejected++
    }

    const log: IterLog = {
      iteration: iter,
      timestamp: new Date().toISOString(),
      hypothesis,
      persona,
      params,
      metrics: {
        canonicalWinRatePct: Number((wr * 100).toFixed(4)),
        avgWinRatePerInstrumentPct: Number((result.avgWinRatePerInstrument * 100).toFixed(4)),
        totalBuySignals: result.totalBuySignals,
        avgReturnPerSignalPct: Number((result.avgReturnPerSignal * 100).toFixed(4)),
        deltaVsBaselinePct: Number((delta * 100).toFixed(4)),
      },
      decision,
      reason,
    }

    const pad = String(iter).padStart(3, '0')
    writeFileSync(join(runsDir, `iter-${pad}.json`), JSON.stringify(log, null, 2))

    if (iter % 10 === 0 || decision === 'ACCEPT') {
      const mark = decision === 'ACCEPT' ? '✓' : '·'
      console.log(
        `  ${mark} iter ${pad}  WR ${log.metrics.canonicalWinRatePct.toFixed(2)}%  ` +
          `signals ${result.totalBuySignals}  ${decision}  ${reason.slice(0, 60)}`,
      )
    }

    if (iter % 10 === 0) {
      console.log(`\n  [Verifier] Running test suite at iteration ${iter}...`)
      const tests = runTests()
      console.log(tests.pass ? '  [Verifier] npm run test PASS' : `  [Verifier] FAIL:\n${tests.output}`)
      const statePath = join(ROOT, 'workspace', 'SESSION_STATE.json')
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, 'utf-8')) as Record<string, unknown>
        state.last_updated = new Date().toISOString()
        const checkpoint = {
          optimization_batch: { iteration: iter, bestCanonicalWR: Number((bestWR * 100).toFixed(2)) },
        }
        state.checkpoint = checkpoint
        writeFileSync(statePath, JSON.stringify(state, null, 2))
      }
    }
  }

  const bestConfig = {
    timestamp: new Date().toISOString(),
    iterationsRun: { from, to: end, count },
    baseline: {
      canonicalWinRatePct: Number((baselineWR * 100).toFixed(4)),
      totalBuySignals: baseline.totalBuySignals,
      params: DEFAULT_CANONICAL_PARAMS,
    },
    best: {
      canonicalWinRatePct: Number((bestWR * 100).toFixed(4)),
      deltaVsBaselinePct: Number(((bestWR - baselineWR) * 100).toFixed(4)),
      deltaVsTarget5726Pct: Number(((bestWR - BASELINE_WR) * 100).toFixed(4)),
      totalBuySignals: bestSignals,
      params: bestParams,
      promoted: false,
    },
    summary: { accepted, rejected, floorPct: FLOOR_WR * 100 },
  }

  writeFileSync(join(runsDir, 'BEST_CONFIG.json'), JSON.stringify(bestConfig, null, 2))

  console.log('\n══════════════════════════════════════════════════════')
  console.log(`  Completed ${count} iterations (${from}–${end})`)
  console.log(`  Accepted: ${accepted} | Rejected: ${rejected}`)
  console.log(`  Best WR: ${(bestWR * 100).toFixed(2)}% (baseline ${(baselineWR * 100).toFixed(2)}%)`)
  console.log(`  Logs: workspace/optimization-runs/iter-*.json`)
  console.log('══════════════════════════════════════════════════════\n')

  if (promote && bestWR > baselineWR + 1e-6) {
    console.log('  Promoting best params to scripts/benchmark-signals.mjs ...')
    promoteToBenchmarkScript(bestParams)
    bestConfig.best.promoted = true
    writeFileSync(join(runsDir, 'BEST_CONFIG.json'), JSON.stringify(bestConfig, null, 2))
    console.log('  Re-running npm run benchmark to verify...')
    execSync('npm run benchmark', { cwd: ROOT, stdio: 'inherit' })
  } else if (bestWR <= baselineWR + 1e-6) {
    console.log('  No promotion — baseline params remain optimal for canonical path.')
  }

  // Append summary line to optimization-results-loop1.json
  const loop1Path = join(__dirname, 'optimization-results-loop1.json')
  const batchSummary = {
    batchOptimization: {
      timestamp: bestConfig.timestamp,
      iterations: `${from}-${end}`,
      bestCanonicalWR: bestConfig.best.canonicalWinRatePct,
      promoted: bestConfig.best.promoted,
    },
  }
  if (existsSync(loop1Path)) {
    const existing = JSON.parse(readFileSync(loop1Path, 'utf-8')) as Record<string, unknown>
    writeFileSync(loop1Path, JSON.stringify({ ...existing, ...batchSummary }, null, 2))
  } else {
    writeFileSync(loop1Path, JSON.stringify(batchSummary, null, 2))
  }
}

function roundParams(params: CanonicalSignalParams): CanonicalSignalParams {
  return {
    slopeThreshold: Math.round(params.slopeThreshold * 1000) / 1000,
    rsiBuyMax: params.rsiBuyMax,
    dipLowerPct: Math.round(params.dipLowerPct),
    dipUpperPct: Math.round(params.dipUpperPct),
    overboughtSellPct: Math.round(params.overboughtSellPct),
    fallingKnifeLowerPct: Math.round(params.fallingKnifeLowerPct),
    fallingKnifeSlope: Math.round(params.fallingKnifeSlope * 1000) / 1000,
    holdDays: params.holdDays,
  }
}

function promoteToBenchmarkScript(params: CanonicalSignalParams) {
  const path = join(__dirname, 'benchmark-signals.mjs')
  let src = readFileSync(path, 'utf-8')
  const rounded = roundParams(params)

  const block = `const CANONICAL_PARAMS = {
  slopeThreshold: ${rounded.slopeThreshold},
  rsiBuyMax: ${rounded.rsiBuyMax},
  dipLowerPct: ${rounded.dipLowerPct},
  dipUpperPct: ${rounded.dipUpperPct},
  overboughtSellPct: ${rounded.overboughtSellPct},
  fallingKnifeLowerPct: ${rounded.fallingKnifeLowerPct},
  fallingKnifeSlope: ${rounded.fallingKnifeSlope},
  holdDays: ${rounded.holdDays},
}`

  if (!/const CANONICAL_PARAMS = \{[\s\S]*?\}/.test(src)) {
    console.error('  promote: CANONICAL_PARAMS block not found in benchmark-signals.mjs')
    return
  }

  src = src.replace(/const CANONICAL_PARAMS = \{[\s\S]*?\}/, block)
  writeFileSync(path, src)
  console.log('  promote: updated CANONICAL_PARAMS — sync lib/optimize/canonicalBenchmark.ts DEFAULT_CANONICAL_PARAMS')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
