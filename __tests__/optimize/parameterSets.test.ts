/**
 * lib/optimize/parameterSets.ts tests (Q-051-NEW continuation).
 *
 * These exports are configuration constants for the 3-loop optimization
 * pipeline. Tests are structural invariants: grid combinatorics, baseline
 * inclusion, ordering, monotonicity, target sanity. Catch accidental
 * deletion / reorder / sign-flip that would silently invalidate cached
 * optimization runs.
 */
import { describe, it, expect } from 'vitest'
import {
  LOOP1_GRID,
  LOOP2_GRID,
  LOOP3_EXIT_GRID,
  CURRENT_BASELINE,
  OPTIMIZATION_TARGETS,
  PARAM_INTERPRETATION,
} from '@/lib/optimize/parameterSets'

describe('LOOP1_GRID', () => {
  it('has the documented 4×4×4×4×4 = 1024 combinations', () => {
    const product =
      LOOP1_GRID.slopeThreshold.length *
      LOOP1_GRID.buyWScoreThreshold.length *
      LOOP1_GRID.sellWScoreThreshold.length *
      LOOP1_GRID.confidenceThreshold.length *
      LOOP1_GRID.atrStopMultiplier.length
    expect(product).toBe(1024)
  })

  it('all numeric values are finite', () => {
    for (const key of Object.keys(LOOP1_GRID) as (keyof typeof LOOP1_GRID)[]) {
      for (const v of LOOP1_GRID[key]) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('slopeThreshold ascends', () => {
    const arr = LOOP1_GRID.slopeThreshold
    for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1])
  })

  it('sellWScoreThreshold is monotonically more negative', () => {
    const arr = LOOP1_GRID.sellWScoreThreshold
    for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeLessThan(arr[i - 1])
  })

  it('confidenceThreshold values are sane (0–100)', () => {
    for (const v of LOOP1_GRID.confidenceThreshold) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('includes the CURRENT_BASELINE values as candidates', () => {
    expect(LOOP1_GRID.slopeThreshold).toContain(CURRENT_BASELINE.slopeThreshold)
    expect(LOOP1_GRID.buyWScoreThreshold).toContain(CURRENT_BASELINE.buyWScoreThreshold)
    expect(LOOP1_GRID.sellWScoreThreshold).toContain(CURRENT_BASELINE.sellWScoreThreshold)
    expect(LOOP1_GRID.confidenceThreshold).toContain(CURRENT_BASELINE.confidenceThreshold)
    expect(LOOP1_GRID.atrStopMultiplier).toContain(CURRENT_BASELINE.atrStopMultiplier)
  })
})

describe('LOOP2_GRID', () => {
  it('has the documented 4×4×3×2×3 = 288 combinations', () => {
    const product =
      LOOP2_GRID.slopeThreshold.length *
      LOOP2_GRID.buyWScoreThreshold.length *
      LOOP2_GRID.sellWScoreThreshold.length *
      LOOP2_GRID.confidenceThreshold.length *
      LOOP2_GRID.atrStopMultiplier.length
    expect(product).toBe(288)
  })

  it('is narrower than LOOP1_GRID on at least one dimension', () => {
    const loop1Size = Object.values(LOOP1_GRID).reduce((s, a) => s * a.length, 1)
    const loop2Size = Object.values(LOOP2_GRID).reduce((s, a) => s * a.length, 1)
    expect(loop2Size).toBeLessThan(loop1Size)
  })
})

describe('LOOP3_EXIT_GRID', () => {
  it('all four exit-rule arrays are non-empty ascending numeric sets', () => {
    const arrays = [
      LOOP3_EXIT_GRID.maxHoldDays,
      LOOP3_EXIT_GRID.profitTakePct,
      LOOP3_EXIT_GRID.trailingStopPct,
      LOOP3_EXIT_GRID.panicExitAtrMultiple,
    ]
    for (const arr of arrays) {
      expect(arr.length).toBeGreaterThan(0)
      for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1])
    }
  })

  it('profitTakePct values are fractions (0–1), not percent points', () => {
    for (const v of LOOP3_EXIT_GRID.profitTakePct) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('panicExitAtrMultiple values are above 1 (volatility spike multiplier)', () => {
    for (const v of LOOP3_EXIT_GRID.panicExitAtrMultiple) expect(v).toBeGreaterThan(1)
  })
})

describe('OPTIMIZATION_TARGETS', () => {
  it('Loop 1 targets aggregate WR above the historical floor (56.35%)', () => {
    expect(OPTIMIZATION_TARGETS.loop1.minAggregateWinRate).toBeGreaterThan(0.5635)
  })

  it('Loop 1 OOS sample-size floor is reasonable', () => {
    expect(OPTIMIZATION_TARGETS.loop1.minOOSTrades).toBeGreaterThanOrEqual(5)
  })

  it('Loop 2 sector targets envelop Loop 1 targets', () => {
    expect(OPTIMIZATION_TARGETS.loop2.minSectorWinRate).toBeLessThanOrEqual(
      OPTIMIZATION_TARGETS.loop1.minAggregateWinRate,
    )
  })

  it('Loop 3 portfolio targets — Sharpe ≥ 1 and max DD ≤ 20%', () => {
    expect(OPTIMIZATION_TARGETS.loop3.minPortfolioSharpe).toBeGreaterThanOrEqual(1.0)
    expect(OPTIMIZATION_TARGETS.loop3.maxPortfolioDrawdown).toBeLessThanOrEqual(0.20)
  })
})

describe('PARAM_INTERPRETATION', () => {
  it('describes every value in LOOP1_GRID.slopeThreshold', () => {
    for (const v of LOOP1_GRID.slopeThreshold) {
      expect(PARAM_INTERPRETATION.slopeThreshold[v]).toBeDefined()
      expect(typeof PARAM_INTERPRETATION.slopeThreshold[v]).toBe('string')
    }
  })

  it('describes every value in LOOP1_GRID.buyWScoreThreshold', () => {
    for (const v of LOOP1_GRID.buyWScoreThreshold) {
      expect(PARAM_INTERPRETATION.buyWScoreThreshold[v]).toBeDefined()
    }
  })
})
