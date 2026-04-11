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
   * changes sign from positive to negative.  Null if no sign change exists.
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
  const strikeMap = new Map<number, { callOI: number; putOI: number; gamma: number }>()

  function upsert(strike: number, oi: number, gamma: number, side: 'call' | 'put') {
    let entry = strikeMap.get(strike)
    if (!entry) {
      entry = { callOI: 0, putOI: 0, gamma }
      strikeMap.set(strike, entry)
    }
    if (side === 'call') entry.callOI += oi
    else entry.putOI += oi
    // Use the gamma from whichever contract we encounter last (they should be ~equal)
    entry.gamma = gamma
  }

  for (const c of calls) upsert(c.strike, c.openInterest ?? 0, c.gamma, 'call')
  for (const p of puts)  upsert(p.strike, p.openInterest ?? 0, p.gamma, 'put')

  const strikes = Array.from(strikeMap.keys()).sort((a, b) => a - b)

  const strikeGex: StrikeGex[] = strikes.map((strike) => {
    const { callOI, putOI, gamma } = strikeMap.get(strike)!
    const gex = (callOI - putOI) * gamma * 100 * spot * spot * 0.01
    return { strike, gex }
  })

  const totalGex = strikeGex.reduce((s, x) => s + x.gex, 0)

  // Find flip point: strike where cumulative GEX transitions positive → negative
  let cumulative = 0
  let flipPoint: number | null = null

  for (let i = 0; i < strikeGex.length; i++) {
    const prev = cumulative
    cumulative += strikeGex[i].gex
    if (prev > 0 && cumulative <= 0) {
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
