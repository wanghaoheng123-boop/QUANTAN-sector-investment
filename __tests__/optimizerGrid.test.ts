import { describe, it, expect } from 'vitest'
import { mergeStrategyConfig } from '@/lib/strategy/strategyConfig'
import { boundedGridSearch, paretoFilter3Objectives } from '@/lib/optimize/gridSearch'
import type { OhlcvRow } from '@/lib/backtest/engine'

function synthRows(n: number): OhlcvRow[] {
  const t0 = 1_700_000_000
  return Array.from({ length: n }, (_, i) => {
    const c = 50 + (i / n) * 0.5
    return {
      time: t0 + i * 86_400,
      open: c,
      high: c + 0.05,
      low: c - 0.05,
      close: c,
      volume: 1e5,
    }
  })
}

describe('boundedGridSearch', () => {
  it('returns rows with extended metrics on synthetic data', () => {
    const base = mergeStrategyConfig()
    const rows = synthRows(260)
    const axes = [{ path: 'regime.smaPeriod', values: [120, 150] }]
    const out = boundedGridSearch(base, rows, 'T', 'S', axes, { maxIterations: 4, maxMs: 10_000 })
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]).toHaveProperty('turnoverProxy')
    expect(out[0]).toHaveProperty('sortino')
    const p3 = paretoFilter3Objectives(out)
    expect(p3.length).toBeGreaterThan(0)
  })
})
