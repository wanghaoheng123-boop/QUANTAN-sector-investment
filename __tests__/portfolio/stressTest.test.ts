import { describe, it, expect } from 'vitest'
import {
  runStressTest,
  runAllStressTests,
  STRESS_SCENARIOS,
  type StressScenario,
} from '@/lib/portfolio/stressTest'

/**
 * Phase 13 S2 audit regressions for lib/portfolio/stressTest.ts.
 *
 * Q (Quant) found two fail-open bugs:
 *   1. Weights summing to ≠ 1 silently mis-scale the portfolio return.
 *   2. `Math.min(...lengths)` truncated to the shortest ticker series,
 *      so a single missing ticker zeroed the entire stress result.
 *
 * Fixes verified here:
 *   - Weight sum drift > 1e-6 emits a warning.
 *   - Missing-data tickers emit a warning with their names; result is
 *     marked partial but still useful (other tickers contribute).
 *   - Window length is now the MAX across non-empty tickers, not the min.
 */

// Build a synthetic daily-return series spanning a scenario window.
function syntheticReturns(startDate: string, endDate: string, dailyReturn: number) {
  const out: { date: string; return: number }[] = []
  const cur = new Date(startDate)
  const end = new Date(endDate)
  while (cur <= end) {
    const dow = cur.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      out.push({
        date: cur.toISOString().slice(0, 10),
        return: dailyReturn,
      })
    }
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

const SCENARIO: StressScenario = STRESS_SCENARIOS.find(s => s.id === 'covid2020')!

describe('runStressTest — fail-closed under bad inputs', () => {
  it('emits warning when weights do not sum to 1 (sum drift > 1e-6)', () => {
    const weights = { AAPL: 0.5, MSFT: 0.4 } // sums to 0.9
    const returns = {
      AAPL: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, -0.02),
      MSFT: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, -0.01),
    }
    const r = runStressTest(weights, returns, 100_000, SCENARIO)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.warnings[0]).toMatch(/sum to 0\.9000/)
  })

  it('no warning when weights sum to 1 (within tolerance)', () => {
    const weights = { AAPL: 0.5, MSFT: 0.5 }
    const returns = {
      AAPL: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, -0.02),
      MSFT: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, -0.01),
    }
    const r = runStressTest(weights, returns, 100_000, SCENARIO)
    expect(r.warnings.filter(w => w.includes('sum to'))).toHaveLength(0)
  })

  /**
   * Regression: previously a single missing-data ticker zeroed the
   * entire stress result via Math.min(...lengths) = 0. Now it warns
   * and excludes the missing ticker, computing the result on the
   * remaining positions.
   */
  it('warns when a ticker has no data in the window and continues with the rest', () => {
    const weights = { AAPL: 0.5, MISSING: 0.5 }
    const returns = {
      AAPL: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, -0.02),
      MISSING: [], // empty series
    }
    const r = runStressTest(weights, returns, 100_000, SCENARIO)
    expect(r.warnings.some(w => w.includes('MISSING'))).toBe(true)
    expect(r.warnings.some(w => w.includes('partial'))).toBe(true)
    // Portfolio return should reflect the AAPL leg only (weight=0.5 of -2%/day),
    // not 0 (which is what the old fail-open path produced).
    expect(r.portfolioReturn).toBeLessThan(0)
  })

  it('returns 0 with no warnings when ALL tickers have data and weights normalize', () => {
    const weights = { AAPL: 1.0 }
    const returns = {
      AAPL: syntheticReturns(SCENARIO.startDate, SCENARIO.endDate, 0),
    }
    const r = runStressTest(weights, returns, 100_000, SCENARIO)
    expect(r.portfolioReturn).toBeCloseTo(0, 6)
    expect(r.warnings).toEqual([])
  })

  it('handles total data absence — all tickers missing → result is 0 but flagged', () => {
    const weights = { AAPL: 0.5, MSFT: 0.5 }
    const returns: Record<string, { date: string; return: number }[]> = {
      AAPL: [], MSFT: [],
    }
    const r = runStressTest(weights, returns, 100_000, SCENARIO)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.portfolioReturn).toBe(0)
    expect(r.maxDrawdown).toBe(0)
  })
})

describe('runAllStressTests', () => {
  it('runs all 5 documented scenarios', () => {
    const weights = { AAPL: 1.0 }
    const returns = { AAPL: [] } // no data, but the test still produces 5 results with warnings
    const all = runAllStressTests(weights, returns, 100_000)
    expect(all).toHaveLength(STRESS_SCENARIOS.length)
    // Every result should have a warnings field (Phase 13 S2 contract).
    for (const r of all) {
      expect(r).toHaveProperty('warnings')
      expect(Array.isArray(r.warnings)).toBe(true)
    }
  })
})
