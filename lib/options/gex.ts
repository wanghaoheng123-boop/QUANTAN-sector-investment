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
   * The first spot price at which cumulative GEX (from lowest to highest
   * strike) changes sign. Backward-compatible single-flip API.
   * Null if no sign change exists.
   */
  flipPoint: number | null
  /**
   * Phase 13 S2 fix (F3.5): all spot prices at which cumulative GEX flips
   * sign. Multi-flip is common during vol-expansion regimes and when
   * positioning is bimodal (e.g. a put-skew cluster around a key level
   * sandwiched between call walls). Sorted ascending by strike.
   */
  flipPoints: number[]
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

  // F3.5: collect ALL flip points where cumulative GEX changes sign.
  // Linear-interpolated between strikes for sub-strike resolution.
  let cumulative = 0
  const flipPoints: number[] = []

  for (let i = 0; i < strikeGex.length; i++) {
    const prev = cumulative
    cumulative += strikeGex[i].gex
    // Check both sign-change directions: positive→negative OR negative→positive
    if ((prev > 0 && cumulative <= 0) || (prev < 0 && cumulative >= 0)) {
      const s0 = i > 0 ? strikeGex[i - 1].strike : strikeGex[i].strike
      const s1 = strikeGex[i].strike
      const denom = Math.abs(prev) + Math.abs(cumulative)
      const frac = denom > 0 ? Math.abs(prev) / denom : 0
      flipPoints.push(s0 + frac * (s1 - s0))
    }
  }

  // Backward-compat: flipPoint = first flip if any.
  const flipPoint = flipPoints.length > 0 ? flipPoints[0] : null

  return { strikeGex, totalGex, flipPoint, flipPoints }
}
