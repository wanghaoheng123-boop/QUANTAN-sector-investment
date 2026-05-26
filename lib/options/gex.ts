/**
 * Gamma Exposure (GEX) analysis.
 *
 * GEX quantifies the aggregate option market-maker delta-hedging pressure at
 * each strike. When net GEX is positive, market makers are long gamma and act
 * as stabilisers (sell rallies / buy dips). When net GEX is negative, they are
 * short gamma and amplify moves.
 *
 * Sign convention (F3.4 — Phase 13 S2 documentation):
 * ────────────────────────────────────────────────────
 *   This module uses the **Squeezemetrics convention**: dealers are assumed to
 *   be net SHORT calls (customers buy calls speculatively) and net LONG puts
 *   (customers buy puts as protection). Positive aggregate GEX therefore means
 *   dealers carry net long gamma → they hedge by selling into rallies and
 *   buying into dips, dampening realised volatility.
 *
 *   Vendor cross-reference:
 *     • Squeezemetrics (https://squeezemetrics.com)            — same sign as ours
 *     • SpotGamma (https://spotgamma.com)                       — same sign for SPX
 *     • MenthorQ                                                — opposite sign for some indices
 *   If migrating clients between platforms, verify each vendor's convention
 *   before reading the GEX magnitude as directional evidence.
 *
 *   Reference: Krishnan, H. (2017). The Second Leg Down. Wiley. p120–125.
 *
 * Per-side gamma (F3.3 — Phase 13 S2 fix):
 * ────────────────────────────────────────
 *   Previously averaged call gamma and put gamma at the same strike before
 *   the (callOI - putOI) × gamma × ... aggregation. Under skew, call IV ≠ put
 *   IV at the same strike, so the averaged-gamma form under-weights the
 *   dominant side. Corrected formulation:
 *
 *     GEX_strike = (callOI × call_gamma - putOI × put_gamma) × 100 × spot² × 0.01
 *
 * Multipliers:
 *   100        = contracts per lot (US standard equity options)
 *   spot² × 0.01 = dollar change for a 1% spot move applied to the squared
 *                  notional (gamma's quadratic-payoff scaling)
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
  // Phase 14 wave 7: defensive guard on spot. A NaN/Inf/zero spot poisons
  // `dollarPer1Pct = 100 * spot * spot * 0.01` and propagates NaN through
  // every per-strike GEX value and the totalGex sum.
  if (!Number.isFinite(spot) || spot <= 0) {
    return { totalGex: 0, strikeGex: [], flipPoint: null, flipPoints: [] }
  }

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
    // Phase 14 wave 7: NaN gamma comes from deep-ITM/OTM Greeks near the B-S
    // singularity or 0-DTE contracts. A single NaN poisoned every downstream
    // sum. We treat non-finite gamma like zero-OI: count it in side OI for
    // depth-of-book metrics but EXCLUDE it from the gamma average so the
    // healthy contracts retain accurate gamma. Same defence for non-finite
    // OI or strike.
    if (!Number.isFinite(strike) || !Number.isFinite(oi)) return
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
      // Phase 14 wave 7: also require gamma finite.
      if (oi > 0 && Number.isFinite(gamma)) {
        entry.callGammaSum += gamma
        entry.callGammaCount++
      }
    } else {
      entry.putOI += oi
      if (oi > 0 && Number.isFinite(gamma)) {
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
    // Phase 14 wave 41 (F3): require STRICT sign change.
    //
    // Prior `cumulative <= 0` / `cumulative >= 0` fired on every strike
    // where the running sum landed exactly on zero — common when both
    // sides have zero OI at that strike, OR when a strike's GEX exactly
    // cancels the running sum. Pre-wave-41 this produced spurious
    // flipPoints, sometimes multiple in a row, contaminating the chart.
    //
    // Strict comparison: only flip when the sign actually changes
    // (positive → strictly negative, negative → strictly positive).
    // A landing on exactly zero is treated as carry-through; the next
    // non-zero contribution decides direction.
    if ((prev > 0 && cumulative < 0) || (prev < 0 && cumulative > 0)) {
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
