import { describe, it, expect } from 'vitest'
import { evaluateTailRisk } from '@/lib/portfolio/tailRiskAlerts'
import { aggregatePortfolioGreeks } from '@/lib/portfolio/greeks'
import { regressFactorLoadings } from '@/lib/portfolio/factorAttribution'

describe('component infrastructure smoke (Q-027)', () => {
  it('tail risk alerts', () => {
    const alerts = evaluateTailRisk({
      realizedSkew: -0.6,
      realizedVol: 0.22,
      volMean: 0.18,
      portfolioVegaUsd: -600_000,
    })
    expect(alerts.length).toBeGreaterThan(0)
  })

  it('portfolio greeks aggregation', () => {
    const g = aggregatePortfolioGreeks([
      { ticker: 'SPY', shares: 1, delta: 100, gamma: 0, vega: -200, theta: 0, rho: 0 },
    ])
    expect(g.delta).toBe(100)
  })

  it('factor attribution regression', () => {
    const r = Array.from({ length: 30 }, () => 0.001)
    const f = { MKT: r, SMB: r, HML: r, MOM: r, QMJ: r }
    expect(regressFactorLoadings(r, f).loadings.MKT).toBeDefined()
  })
})
