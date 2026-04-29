/**
 * Gamma Exposure (GEX) analysis.
 *
 * GEX quantifies the aggregate option market-maker delta-hedging pressure at
 * each strike.  When net GEX is positive, market makers are long gamma and act
 * as stabilisers (sell rallies / buy dips).  When net GEX is negative, they are
 * short gamma and amplify moves.
 *
 * Formula per strike:
 *   GEX_strike = (callOI - putOI) × gamma × 100 × spot² × 0.01
 *
 * The factor 100 = contracts per lot; 0.01 converts a 1% spot move to dollars.
 */

import type { EnrichedContract } from './chain'

export interface StrikeGex {
  strike: number
  gex: number
}

export interface GexResult {
  /** GEX contribution broken down by strike, sorted ascending by strike. */
  strikeGex: StrikeGex[]
  /** Sum of all strikeGex values. */
  totalGex: number
  /**
   * The spot price at which cumulative GEX (from lowest to highest strike)
   * changes sign (either positive → negative or negative → positive).
   * In options markets, cumulative GEX typically transitions from negative
   * (puts dominate at low strikes) to positive (calls dominate at high strikes).
   * Returns the first flip point found regardless of direction.
   * Null if no sign change exists.
   */
  flipPoint: number | null
}

/**
 * Computes aggregate GEX from enriched calls and puts for the same expiry.
 */
export function computeGex(
  calls: EnrichedContract[],
  puts: EnrichedContract[],
  spot: number,
): GexResult {
  // Build per-strike map
  const strikeMap = new Map<number, { callOI: number; putOI: number; gammaSum: number; gammaCount: number }>()

  function upsert(strike: number, oi: number, gamma: number, side: 'call' | 'put') {
    let entry = strikeMap.get(strike)
    if (!entry) {
      entry = { callOI: 0, putOI: 0, gammaSum: 0, gammaCount: 0 }
      strikeMap.set(strike, entry)
    }
    if (side === 'call') entry.callOI += oi
    else entry.putOI += oi
    entry.gammaSum += gamma
    entry.gammaCount++
  }

  for (const c of calls) upsert(c.strike, c.openInterest ?? 0, c.gamma, 'call')
  for (const p of puts)  upsert(p.strike, p.openInterest ?? 0, p.gamma, 'put')

  const strikes = Array.from(strikeMap.keys()).sort((a, b) => a - b)

  const strikeGex: StrikeGex[] = strikes.map((strike) => {
    const entry = strikeMap.get(strike)!
    const gamma = entry.gammaCount > 0 ? entry.gammaSum / entry.gammaCount : 0
    const callOI = entry.callOI
    const putOI = entry.putOI
    const gex = (callOI - putOI) * gamma * 100 * spot * spot * 0.01
    return { strike, gex }
  })

  const totalGex = strikeGex.reduce((s, x) => s + x.gex, 0)

  // Find flip point: strike where cumulative GEX changes sign (either direction).
  // In options markets the typical pattern is negative (puts dominate low strikes)
  // → positive (calls dominate high strikes), but both directions are checked.
  let cumulative = 0
  let flipPoint: number | null = null

  for (let i = 0; i < strikeGex.length; i++) {
    const prev = cumulative
    cumulative += strikeGex[i].gex
    // Check both sign-change directions: positive→negative OR negative→positive
    if ((prev > 0 && cumulative <= 0) || (prev < 0 && cumulative >= 0)) {
      // Linear interpolation between strikes[i-1] and strikes[i]
      const s0 = i > 0 ? strikeGex[i - 1].strike : strikeGex[i].strike
      const s1 = strikeGex[i].strike
      const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(cumulative))
      flipPoint = s0 + frac * (s1 - s0)
      break
    }
  }

  return { strikeGex, totalGex, flipPoint }
}
