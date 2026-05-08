/**
 * Gamma Exposure (GEX) analysis.
 *
 * GEX quantifies the aggregate option market-maker delta-hedging pressure at
 * each strike. When net GEX is positive, market makers are long gamma and act
 * as stabilisers (sell rallies / buy dips). When net GEX is negative, they are
 * short gamma and amplify moves.
 *
 * Phase 13 S2 fix (F3.3): per-side gamma is now used. Previously the
 * implementation averaged call gamma and put gamma at the same strike before
 * the (callOI - putOI) × gamma × ... aggregation. Theoretically gamma is
 * type-independent for European options at same K/T/r/σ — but the chain
 * enrichment computes IV per-contract, so call IV and put IV at the same
 * strike differ under volatility skew. Averaging the gammas under-weights
 * the side with the higher gamma. The corrected formulation:
 *
 *   GEX_strike = (callOI × call_gamma - putOI × put_gamma) × 100 × spot² × 0.01
 *
 * Sign convention (Krishnan 2017 / Squeezemetrics whitepaper):
 *   Assumes standard customer flow — dealers short calls, long puts.
 *   Positive GEX = dealers net long gamma = stabilising (sell rallies, buy dips).
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
 *
 * F3.3: per-side gamma — call_gamma and put_gamma tracked independently so
 * skewed IV chains produce accurate GEX (averaging gammas underweights the
 * dominant side).
 */
export function computeGex(
  calls: EnrichedContract[],
  puts: EnrichedContract[],
  spot: number,
): GexResult {
  // Per-strike, per-side accumulators. Multiple contracts at the same strike
  // (rare but possible across providers) get OI summed and gamma averaged
  // (within-side average is meaningful — same side IV is consistent).
  interface StrikeAccum {
    callOI: number
    callGammaSum: number
    callGammaCount: number
    putOI: number
    putGammaSum: number
    putGammaCount: number
  }
  const strikeMap = new Map<number, StrikeAccum>()

  function upsert(strike: number, oi: number, gamma: number, side: 'call' | 'put') {
    let entry = strikeMap.get(strike)
    if (!entry) {
      entry = {
        callOI: 0, callGammaSum: 0, callGammaCount: 0,
        putOI: 0, putGammaSum: 0, putGammaCount: 0,
      }
      strikeMap.set(strike, entry)
    }
    if (side === 'call') {
      entry.callOI += oi
      // F3.3: only accumulate gamma if OI > 0 — zero-OI contracts shouldn't
      // pollute the side average (and they contribute nothing to GEX anyway).
      if (oi > 0) {
        entry.callGammaSum += gamma
        entry.callGammaCount++
      }
    } else {
      entry.putOI += oi
      if (oi > 0) {
        entry.putGammaSum += gamma
        entry.putGammaCount++
      }
    }
  }

  for (const c of calls) upsert(c.strike, c.openInterest ?? 0, c.gamma, 'call')
  for (const p of puts)  upsert(p.strike, p.openInterest ?? 0, p.gamma, 'put')

  const strikes = Array.from(strikeMap.keys()).sort((a, b) => a - b)
  const dollarPer1Pct = 100 * spot * spot * 0.01

  const strikeGex: StrikeGex[] = strikes.map((strike) => {
    const e = strikeMap.get(strike)!
    const callGamma = e.callGammaCount > 0 ? e.callGammaSum / e.callGammaCount : 0
    const putGamma = e.putGammaCount > 0 ? e.putGammaSum / e.putGammaCount : 0
    // F3.3: per-side gamma weighting.
    const gex = (e.callOI * callGamma - e.putOI * putGamma) * dollarPer1Pct
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
