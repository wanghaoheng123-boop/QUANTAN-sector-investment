import { describe, it, expect } from 'vitest'
import { evaluateTailRisk } from '@/lib/portfolio/tailRiskAlerts'
import type { TailRiskInput } from '@/lib/portfolio/tailRiskAlerts'

describe('evaluateTailRisk (Q-045-NEW)', () => {
  const base: TailRiskInput = {
    realizedSkew: 0,
    realizedVol: 0.15,
    volMean: 0.15,
    portfolioVegaUsd: 0,
  }

  it('emits no alerts on benign input', () => {
    expect(evaluateTailRisk(base)).toEqual([])
  })

  it('emits NEGATIVE_SKEW_VOL_SPIKE when skew < -0.5 AND vol > mean', () => {
    const alerts = evaluateTailRisk({
      ...base,
      realizedSkew: -0.8,
      realizedVol: 0.25,
      volMean: 0.15,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].code).toBe('NEGATIVE_SKEW_VOL_SPIKE')
    expect(alerts[0].level).toBe('warning')
    expect(alerts[0].suggestions.length).toBeGreaterThan(0)
  })

  it('does NOT emit NEGATIVE_SKEW when skew is mildly negative but ≥ -0.5', () => {
    const alerts = evaluateTailRisk({ ...base, realizedSkew: -0.4, realizedVol: 0.25 })
    expect(alerts.filter((a) => a.code === 'NEGATIVE_SKEW_VOL_SPIKE')).toEqual([])
  })

  it('does NOT emit NEGATIVE_SKEW when vol is not above mean', () => {
    const alerts = evaluateTailRisk({
      ...base,
      realizedSkew: -0.8,
      realizedVol: 0.10,
      volMean: 0.15,
    })
    expect(alerts.filter((a) => a.code === 'NEGATIVE_SKEW_VOL_SPIKE')).toEqual([])
  })

  it('emits SHORT_VEGA at critical level when portfolio vega < -$500k', () => {
    const alerts = evaluateTailRisk({ ...base, portfolioVegaUsd: -600_000 })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].code).toBe('SHORT_VEGA')
    expect(alerts[0].level).toBe('critical')
    expect(alerts[0].message).toContain('-600,000')
  })

  it('does NOT emit SHORT_VEGA at the exact threshold (-500k)', () => {
    // Strict < not ≤, per the impl.
    expect(evaluateTailRisk({ ...base, portfolioVegaUsd: -500_000 })).toEqual([])
  })

  it('emits BOTH alerts when both conditions trigger', () => {
    const alerts = evaluateTailRisk({
      realizedSkew: -0.8,
      realizedVol: 0.30,
      volMean: 0.15,
      portfolioVegaUsd: -750_000,
    })
    expect(alerts).toHaveLength(2)
    const codes = alerts.map((a) => a.code).sort()
    expect(codes).toEqual(['NEGATIVE_SKEW_VOL_SPIKE', 'SHORT_VEGA'])
  })
})
