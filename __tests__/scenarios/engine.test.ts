import { describe, it, expect } from 'vitest'
import { runAllScenarios } from '@/lib/scenarios/engine'

describe('scenario engine (Q-043)', () => {
  it('runs six canned scenarios', () => {
    const results = runAllScenarios([{ ticker: 'SPY', shares: 10, price: 500, delta: 10 }])
    expect(results).toHaveLength(6)
    expect(results[0].portfolioPnlPct).toBeDefined()
  })
})
