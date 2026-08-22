/**
 * Compute the Probability of Backtest Overfitting for the strategy's own
 * parameter search.
 *
 * Design invariant I5 requires a PBO before any claim of skill. The Q-079 audit
 * found PBO had ZERO implementation, which made I5 unmeetable by construction.
 * `lib/quant/pbo.ts` supplies the algorithm; THIS is its producer, because an
 * algorithm with no producer is the "built and inert" defect this repo has now
 * found in four separate packages.
 *
 * Usage: npm run pbo   ->   scripts/pbo-results.json
 *
 * WHY THIS GRID AND NOT `BacktestConfig`
 * --------------------------------------
 * The first version of this script varied `confidenceThreshold` and
 * `stopLossPct` on `backtestInstrument` and produced PBO = 1 with a median logit
 * of exactly 0 — the signature of TIES, not of overfitting. A probe confirmed
 * the cause: those two fields are never read as decisions by the engine
 * (`lib/backtest/core.ts` echoes them at `:239`/`:479` and branches on neither),
 * so all 18 "configurations" returned byte-identical trades. Publishing that 1
 * would have been a fabricated finding.
 *
 * The LIVE search dimensions are `slopeThreshold` and `atrStopMultiplier`, which
 * `simpleBacktestSlice` actually consumes. `generateGrid` already holds the other
 * three ParamGrid fields inert and says so at `lib/optimize/gridSearch.ts:70-83`.
 *
 * PBO must measure the procedure someone actually runs; a grid whose columns are
 * identical measures nothing and returns a comfortable number while doing it.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import { simpleBacktestSlice } from '../lib/optimize/gridSearch'
import { LOOP1_GRID } from '../lib/optimize/parameterSets'
import { pboFromBlockPerformance } from '../lib/quant/pbo'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'backtestData')

/** CSCV blocks. 4 -> C(4,2) = 6 splits. See the honesty note at the bottom. */
const BLOCKS = 4
/** `simpleBacktestSlice` returns zeros below this; each block must clear it. */
const MIN_SLICE_ROWS = 252

function loadAllTickers(): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData directory. Run scripts/fetchBacktestData.mjs first.')
    process.exit(1)
  }
  return readdirSync(dataDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const d = JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as {
        sector?: string
        candles?: OhlcvRow[]
      }
      return {
        ticker: f.replace('.json', '').replace(/-/g, '.'),
        sector: d.sector ?? 'Unknown',
        rows: (d.candles ?? []).filter((r) => Number.isFinite(r.close) && r.close > 0),
      }
    })
    .filter((d) => d.rows.length >= MIN_SLICE_ROWS * BLOCKS)
}

// Only the two dimensions the evaluator consumes. Iterating the inert three
// would inflate the configuration count while producing identical columns —
// which is exactly the artifact that inflated T-0001's declared grid to 1024
// when only 16 configurations were ever really tried (Q-084).
const configs = LOOP1_GRID.slopeThreshold.flatMap((slopeThreshold) =>
  LOOP1_GRID.atrStopMultiplier.map((atrStopMultiplier) => ({
    slopeThreshold,
    atrStopMultiplier,
    buyWScoreThreshold: LOOP1_GRID.buyWScoreThreshold[0],
    sellWScoreThreshold: LOOP1_GRID.sellWScoreThreshold[0],
    confidenceThreshold: LOOP1_GRID.confidenceThreshold[0],
  })),
)

const data = loadAllTickers()
if (data.length === 0) {
  console.error(`FAIL: no instrument has ${MIN_SLICE_ROWS * BLOCKS} rows; cannot form ${BLOCKS} blocks.`)
  process.exit(1)
}
console.log(`Computing PBO: ${configs.length} live configurations x ${data.length} instruments, ${BLOCKS} blocks...`)

/** blockPerf[block][config] = mean Sharpe across instruments on that block. */
const blockPerf: number[][] = Array.from({ length: BLOCKS }, () => new Array(configs.length).fill(0))
const blockCounts: number[][] = Array.from({ length: BLOCKS }, () => new Array(configs.length).fill(0))

for (const { rows } of data) {
  const size = Math.floor(rows.length / BLOCKS)
  for (let b = 0; b < BLOCKS; b++) {
    const lo = b * size
    const hi = b === BLOCKS - 1 ? rows.length : (b + 1) * size
    configs.forEach((cfg, ci) => {
      const r = simpleBacktestSlice(rows, lo, hi, cfg)
      // A slice with no trades carries no information about this configuration;
      // scoring it 0 would reward configurations that simply sat out.
      if (r.trades > 0 && r.sharpe != null && Number.isFinite(r.sharpe)) {
        blockPerf[b][ci] += r.sharpe
        blockCounts[b][ci] += 1
      }
    })
  }
}

let thinCells = 0
for (let b = 0; b < BLOCKS; b++) {
  for (let c = 0; c < configs.length; c++) {
    if (blockCounts[b][c] === 0) thinCells++
    else blockPerf[b][c] /= blockCounts[b][c]
  }
}

const distinctColumns = new Set(
  configs.map((_, c) => blockPerf.map((row) => row[c].toFixed(6)).join('|')),
).size

// FAIL CLOSED on a degenerate grid. This is the check the first version lacked:
// identical columns produce ties, ties produce omega = 0.5, and PBO comes back
// exactly 1 while measuring nothing at all.
if (distinctColumns < 2) {
  console.error(
    `\nFAIL: all ${configs.length} configurations produced identical block performance. ` +
      'PBO on a degenerate grid is a tie artifact, not a measurement. Refusing to publish it.',
  )
  process.exit(1)
}

const result = pboFromBlockPerformance(blockPerf)

const out = {
  computedAt: new Date().toISOString(),
  method: 'CSCV over contiguous price blocks; per-block performance = mean per-instrument Sharpe',
  grid: {
    live: { slopeThreshold: LOOP1_GRID.slopeThreshold, atrStopMultiplier: LOOP1_GRID.atrStopMultiplier },
    inertHeldFixed: ['buyWScoreThreshold', 'sellWScoreThreshold', 'confidenceThreshold'],
    note:
      'Only the two dimensions simpleBacktestSlice consumes are varied. The other three are legacy ' +
      'enhanced-signal parameters the evaluator never reads (lib/optimize/gridSearch.ts:70-83); ' +
      'iterating them inflates the count while producing identical columns. This is the resolution ' +
      'of the 1024-vs-16 discrepancy recorded as UNRESOLVED against T-0001 (Q-084).',
  },
  configurations: result.configurations,
  distinctColumns,
  blocks: result.blocks,
  splits: result.splits,
  instruments: data.length,
  thinCells,
  pbo: Number(result.pbo.toFixed(4)),
  medianLogit: Number(
    [...result.logits].sort((a, b) => a - b)[Math.floor(result.logits.length / 2)].toFixed(4),
  ),
  limitations:
    `Only ${result.splits} splits (C(${BLOCKS},${BLOCKS / 2})), because simpleBacktestSlice needs ` +
    `>= ${MIN_SLICE_ROWS} rows per block and the pinned window holds ~5 years. This is a COARSE ` +
    'estimate: with 6 splits the resolution of PBO is 1/6, so read it as a direction, not a decimal. ' +
    'BBLZ use S=16 where the sample allows.',
  interpretation:
    'PBO is the probability that a configuration selected as best IN-SAMPLE lands at or below the ' +
    'median OUT-OF-SAMPLE. 0.5 is the no-skill null. This measures the SELECTION PROCEDURE and is ' +
    'not on its own a claim of skill — see CLAUDE.md I5.',
  reference:
    'Bailey, Borwein, Lopez de Prado & Zhu (2017), The Probability of Backtest Overfitting, ' +
    'Journal of Computational Finance 20(4), 39-69.',
}

writeFileSync(join(__dirname, 'pbo-results.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`\nPBO = ${out.pbo}  (${result.splits} splits, ${result.blocks} blocks, ${result.configurations} configs, ${distinctColumns} distinct columns)`)
console.log(`median logit = ${out.medianLogit}`)
console.log(
  out.pbo >= 0.5
    ? '  => AT OR ABOVE THE NO-SKILL NULL. Selecting the in-sample best is no better than chance.'
    : '  => below the no-skill null — necessary but NOT sufficient for a claim of skill.',
)
console.log(`NOTE: ${result.splits} splits only; read as a direction, not a decimal.`)
console.log('Saved to scripts/pbo-results.json')
