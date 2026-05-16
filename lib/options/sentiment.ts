/**
 * Options sentiment analysis: put/call ratios and max pain calculation.
 */

import type { CallOrPut } from './chain'

export interface PutCallRatio {
  /** Sum(put volume) / Sum(call volume). Null if no call volume. */
  volumeRatio: number | null
  /** Sum(put OI) / Sum(call OI). Null if no call OI. */
  oiRatio: number | null
}

/**
 * Computes put/call ratios by volume and open interest.
 * A ratio > 1.0 is generally bearish; < 0.7 is generally bullish.
 */
export function putCallRatio(calls: CallOrPut[], puts: CallOrPut[]): PutCallRatio {
  const callVol = calls.reduce((s, c) => s + (c.volume ?? 0), 0)
  const putVol  = puts.reduce((s, p) => s + (p.volume ?? 0), 0)
  const callOI  = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0)
  const putOI   = puts.reduce((s, p) => s + (p.openInterest ?? 0), 0)

  return {
    volumeRatio: callVol > 0 ? putVol / callVol : null,
    oiRatio:     callOI  > 0 ? putOI  / callOI  : null,
  }
}

/**
 * Max Pain — the strike price at which option holders (as a group) suffer the
 * greatest loss at expiry, i.e. the strike minimising total payout to all
 * option holders (equivalent to maximising pain for buyers).
 *
 * Algorithm: for each candidate strike, compute what call writers and put
 * writers must pay out at expiry, sum them, return the minimum strike.
 *
 * Returns null when:
 *   - No strike data is available
 *   - Total open interest across all contracts is zero (no meaningful OI to
 *     derive max pain from — Phase 13 S2 fail-closed regression fix).
 *
 * Citation: Krishnan, V. (2017). "Gamma Exposure: Quantifying Hedging
 *           Flows." Squeezemetrics whitepaper — same OI-weighted payout
 *           framework as max pain.
 */
export function maxPain(calls: CallOrPut[], puts: CallOrPut[]): number | null {
  // Collect all unique strikes
  const strikeSet = new Set<number>()
  calls.forEach((c) => strikeSet.add(c.strike))
  puts.forEach((p) => strikeSet.add(p.strike))
  const strikes = Array.from(strikeSet).sort((a, b) => a - b)
  if (strikes.length === 0) return null

  // Phase 13 S2 fail-closed: when total OI is zero, every candidate
  // strike yields payout=0 and the first one trivially wins. The
  // returned strike is meaningless (it's just the lowest one, not a
  // derived max-pain value). Reject the input instead of emitting a
  // misleading number.
  const totalOI = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0)
                + puts.reduce((s, p) => s + (p.openInterest ?? 0), 0)
  if (!Number.isFinite(totalOI) || totalOI <= 0) return null

  let minPayout = Infinity
  let maxPainStrike = strikes[0]

  for (const candidatePrice of strikes) {
    // Call payout: each call with strike < candidatePrice is ITM
    let callPayout = 0
    for (const c of calls) {
      if (candidatePrice > c.strike) {
        callPayout += (candidatePrice - c.strike) * (c.openInterest ?? 0) * 100
      }
    }

    // Put payout: each put with strike > candidatePrice is ITM
    let putPayout = 0
    for (const p of puts) {
      if (candidatePrice < p.strike) {
        putPayout += (p.strike - candidatePrice) * (p.openInterest ?? 0) * 100
      }
    }

    const total = callPayout + putPayout
    if (total < minPayout) {
      minPayout = total
      maxPainStrike = candidatePrice
    }
  }

  return maxPainStrike
}
