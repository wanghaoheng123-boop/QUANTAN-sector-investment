'use client'

import { evaluateTailRisk } from '@/lib/portfolio/tailRiskAlerts'

/** Demo banner — wire live skew/vol/vega in Phase 16. */
export function TailRiskBanner() {
  const alerts = evaluateTailRisk({
    realizedSkew: -0.6,
    realizedVol: 0.22,
    volMean: 0.18,
    portfolioVegaUsd: -600_000,
  })
  if (!alerts.length) return null
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.code}
          className={`rounded-lg border px-4 py-3 text-sm ${
            a.level === 'critical'
              ? 'border-red-800 bg-red-950/40 text-red-200'
              : 'border-amber-800 bg-amber-950/30 text-amber-100'
          }`}
        >
          <p className="font-medium">{a.message}</p>
          <p className="text-xs mt-1 opacity-80">Suggestions: {a.suggestions.join(' · ')}</p>
        </div>
      ))}
    </div>
  )
}
