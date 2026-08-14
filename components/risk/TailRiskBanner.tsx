'use client'

import { evaluateTailRisk, type TailRiskInput } from '@/lib/portfolio/tailRiskAlerts'

/**
 * UX-27. This banner renders on /portfolio, and every number feeding it is a
 * literal. Until 2026-08-15 the word "Demo" appeared ONLY in the source comment
 * above this component, so the page told the reader — with an amber warning and
 * a red critical — that *their* book carried −$600,000 of vega, and attached
 * four concrete options trades to it. There is no portfolio input anywhere in
 * the product, so the alerts were fabricated, unlabelled, and phrased as advice.
 *
 * `/risk/scenarios` already ships the right pattern for the same Phase-16
 * placeholder data ("Demo portfolio — wire live positions in Phase 16.",
 * rendered, not commented). That disclosure is ported here, the inputs are
 * hoisted into a named DEMO_ constant like that page's DEMO_POSITIONS, and the
 * "Suggestions:" line is reframed so it reads as what the alert TYPE would
 * suggest rather than as instructions for a book the user never entered.
 *
 * The feature itself is untouched: wire real positions into DEMO_INPUTS' place
 * and the disclosure is the only thing that needs to come out.
 */

/** Fixed placeholder inputs — NOT a real book. Replace with live portfolio state. */
const DEMO_INPUTS: TailRiskInput = {
  realizedSkew: -0.6,
  realizedVol: 0.22,
  volMean: 0.18,
  portfolioVegaUsd: -600_000,
}

export function TailRiskBanner() {
  const alerts = evaluateTailRisk(DEMO_INPUTS)
  if (!alerts.length) return null
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/90 leading-relaxed">
        <span className="mr-2 rounded border border-amber-500/30 bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
          ILLUSTRATIVE
        </span>
        Demo portfolio — wire live positions in Phase 16. The alerts below are computed from
        fixed example inputs (skew {DEMO_INPUTS.realizedSkew.toFixed(2)}, realized vol{' '}
        {(DEMO_INPUTS.realizedVol * 100).toFixed(0)}% vs {(DEMO_INPUTS.volMean * 100).toFixed(0)}%
        mean, vega {DEMO_INPUTS.portfolioVegaUsd.toLocaleString()} USD), not from your positions.
        Nothing here is a recommendation.
      </div>
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
          {/* "Suggestions:" read as instructions for the reader's own book. */}
          <p className="text-xs mt-1 opacity-80">
            What this alert type would suggest: {a.suggestions.join(' · ')}
          </p>
        </div>
      ))}
    </div>
  )
}
