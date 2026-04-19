/**
 * Deterministic optimizer smoke on synthetic OHLCV (no Yahoo).
 * CI-friendly; keep under a few hundred ms.
 */

import { mergeStrategyConfig } from '../lib/strategy/strategyConfig'
import { boundedGridSearch, paretoFilter, paretoFilter3Objectives } from '../lib/optimize/gridSearch'
import { boundedWalkForwardGridSearch } from '../lib/optimize/walkForwardGrid'
import type { OhlcvRow } from '../lib/backtest/engine'

function synthRows(n: number): OhlcvRow[] {
  const t0 = 1_700_000_000
  const out: OhlcvRow[] = []
  for (let i = 0; i < n; i++) {
    const c = 100 + Math.sin(i / 30) * 2
    out.push({
      time: t0 + i * 86_400,
      open: c - 0.1,
      high: c + 0.2,
      low: c - 0.2,
      close: c,
      volume: 1e6,
    })
  }
  return out
}

const base = mergeStrategyConfig()
const rows = synthRows(400)
const axes = [
  { path: 'regime.smaPeriod' as const, values: [150, 180] },
  { path: 'confirmations.rsiBullThreshold' as const, values: [30, 32] },
]

const grid = boundedGridSearch(base, rows, 'SYN', 'Test', axes, { maxIterations: 8, maxMs: 5000 })
const p = paretoFilter(grid)
const p3 = paretoFilter3Objectives(grid)
const wf = boundedWalkForwardGridSearch(base, rows, 'SYN', 'Test', axes, { maxIterations: 6, maxMs: 8000 })

if (grid.length < 1) {
  console.error('benchmark-optimizer: expected at least one grid row')
  process.exit(1)
}
if (p.length < 1) {
  console.error('benchmark-optimizer: expected at least one Pareto row')
  process.exit(1)
}
if (p3.length < 1) {
  console.error('benchmark-optimizer: expected at least one 3-objective Pareto row')
  process.exit(1)
}
if (wf.length < 1) {
  console.error('benchmark-optimizer: expected at least one walk-forward row')
  process.exit(1)
}

console.log(
  JSON.stringify({
    ok: true,
    gridRows: grid.length,
    pareto: p.length,
    pareto3: p3.length,
    wfRows: wf.length,
    topCalmar: grid[0]?.calmar,
  }),
)
