/**
 * Tail-risk hedging alerts (Phase 15 Q-045-NEW).
 */

export interface TailRiskInput {
  realizedSkew: number
  realizedVol: number
  volMean: number
  portfolioVegaUsd: number
}

export interface TailRiskAlert {
  level: 'warning' | 'critical'
  code: string
  message: string
  suggestions: string[]
}

export function evaluateTailRisk(input: TailRiskInput): TailRiskAlert[] {
  const alerts: TailRiskAlert[] = []
  if (input.realizedSkew < -0.5 && input.realizedVol > input.volMean) {
    alerts.push({
      level: 'warning',
      code: 'NEGATIVE_SKEW_VOL_SPIKE',
      message: 'Realized skew is negative while volatility exceeds its mean — tail risk elevated.',
      suggestions: ['Consider protective puts', 'Put spreads on index hedge', 'VIX call calendars'],
    })
  }
  if (input.portfolioVegaUsd < -500_000) {
    alerts.push({
      level: 'critical',
      code: 'SHORT_VEGA',
      message: `Portfolio vega ${input.portfolioVegaUsd.toLocaleString()} USD — short vol exposure.`,
      suggestions: ['Buy OTM puts', 'Reduce short premium positions', 'Add VIX hedge'],
    })
  }
  return alerts
}
