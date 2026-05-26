/**
 * Options sentiment analysis: put/call ratios and max pain calculation.
 */

import type { CallOrPut } from './chain'

export interface PutCallRatio {
  /**
   * Sum(put volume) / Sum(call volume). Null only when BOTH sides are empty.
   * If calls are empty but puts have volume, returns a clamped sentinel
   * value (PCR_MAX = 99) instead of null — losing that bearish signal silently
   * was the wave-41 F1 bug.
   */
  volumeRatio: number | null
  /** Same semantics as volumeRatio, but based on open interest. */
  oiRatio: number | null
}

/**
 * Phase 14 wave 41 (F7): Number.isFinite guards on every reducer field.
 * `c.volume ?? 0` only catches null/undefined — a single NaN volume from a
 * malformed Yahoo row would propagate NaN through the entire sum and the
 * UI would render "NaN" or crash on .toFixed.
 */
function sumFiniteField(rows: CallOrPut[], pick: (r: CallOrPut) => number | undefined): number {
  let s = 0
  for (const r of rows) {
    const v = pick(r)
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) s += v
  }
  return s
}

/** Sentinel for "puts exist but calls don't" — see F1 below. */
const PCR_MAX = 99

/**
 * Computes put/call ratios by volume and open interest.
 *
 * Returns null when BOTH sides have zero activity (truly no signal).
 * Returns PCR_MAX (99 — a known sentinel meaning "extremely bearish") when
 * puts have activity but calls don't, instead of dropping the signal to
 * null.
 *
 * Reference contract:
 *   ratio > 1.0  → generally bearish
 *   ratio < 0.7  → generally bullish
 *   ratio >= 5   → extreme bearish (rare; usually data anomaly)
 *
 * Phase 14 wave 41 F1: previously returned `null` whenever calls were
 * zero even though puts had activity, silently dropping a strongly
 * bearish signal — particularly damaging on small/illiquid symbols.
 */
export function putCallRatio(calls: CallOrPut[], puts: CallOrPut[]): PutCallRatio {
  const callVol = sumFiniteField(calls, (c) => c.volume)
  const putVol  = sumFiniteField(puts,  (p) => p.volume)
  const callOI  = sumFiniteField(calls, (c) => c.openInterest)
  const putOI   = sumFiniteField(puts,  (p) => p.openInterest)

  const volumeRatio = callVol > 0
    ? putVol / callVol
    : putVol > 0
      ? PCR_MAX
      : null
  const oiRatio = callOI > 0
    ? putOI / callOI
    : putOI > 0
      ? PCR_MAX
      : null

  return { volumeRatio, oiRatio }
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
export function maxPain(
  calls: CallOrPut[],
  puts: CallOrPut[],
  /**
   * Optional underlying price. When supplied AND the loss curve has tied
   * minima (e.g. single-side chain with all OI clustered at one wing),
   * the strike NEAREST to spot is returned instead of the lowest tied
   * strike. Without spot, the lowest tied strike is returned (legacy
   * behaviour preserved for callers that don't pass spot).
   *
   * Phase 14 wave 41 (F2): the prior strict-less-than comparison
   * (`total < minPayout`) picked the lowest of all tied strikes, which
   * for a single-side chain (all OI on one wing) is wrong — the loss
   * curve is flat across the no-payout side, and the "lowest strike"
   * is a meaningless choice. Picking the strike nearest spot is the
   * conventional tie-break in market practice.
   */
  spot?: number,
): number | null {
  // Collect all unique strikes, dropping NaN/Infinity strikes from a
  // malformed upstream row.
  const strikeSet = new Set<number>()
  for (const c of calls) {
    if (Number.isFinite(c.strike) && c.strike > 0) strikeSet.add(c.strike)
  }
  for (const p of puts) {
    if (Number.isFinite(p.strike) && p.strike > 0) strikeSet.add(p.strike)
  }
  const strikes = Array.from(strikeSet).sort((a, b) => a - b)
  if (strikes.length === 0) return null

  // Phase 13 S2 fail-closed: when total OI is zero, every candidate
  // strike yields payout=0 and the first one trivially wins. The
  // returned strike is meaningless (it's just the lowest one, not a
  // derived max-pain value). Reject the input instead of emitting a
  // misleading number.
  const callOI = sumFiniteField(calls, (c) => c.openInterest)
  const putOI  = sumFiniteField(puts,  (p) => p.openInterest)
  if (callOI + putOI <= 0) return null

  // Tie-tracking: collect every strike whose payout equals the minimum
  // (within a numerical epsilon — OI * (K-S) calculations can produce
  // floating-point ties that differ by ULP-level noise).
  const PAYOUT_TIE_EPSILON = 1e-6

  let minPayout = Infinity
  const tiedStrikes: number[] = []

  for (const candidatePrice of strikes) {
    let callPayout = 0
    for (const c of calls) {
      const oi = typeof c.openInterest === 'number' && Number.isFinite(c.openInterest) && c.openInterest > 0
        ? c.openInterest : 0
      if (oi > 0 && candidatePrice > c.strike) {
        callPayout += (candidatePrice - c.strike) * oi * 100
      }
    }

    let putPayout = 0
    for (const p of puts) {
      const oi = typeof p.openInterest === 'number' && Number.isFinite(p.openInterest) && p.openInterest > 0
        ? p.openInterest : 0
      if (oi > 0 && candidatePrice < p.strike) {
        putPayout += (p.strike - candidatePrice) * oi * 100
      }
    }

    const total = callPayout + putPayout

    if (total < minPayout - PAYOUT_TIE_EPSILON) {
      // Strict new minimum — reset ties list.
      minPayout = total
      tiedStrikes.length = 0
      tiedStrikes.push(candidatePrice)
    } else if (total <= minPayout + PAYOUT_TIE_EPSILON) {
      // Tied with current minimum — track for tie-break selection.
      tiedStrikes.push(candidatePrice)
      if (total < minPayout) minPayout = total
    }
  }

  if (tiedStrikes.length === 0) return null
  if (tiedStrikes.length === 1) return tiedStrikes[0]

  // Tie-break: pick the strike nearest spot when spot is known and finite.
  // Otherwise, fall back to the MEDIAN tied strike — far more reasonable
  // than the lowest, which is what the prior code returned.
  if (typeof spot === 'number' && Number.isFinite(spot) && spot > 0) {
    let nearestStrike = tiedStrikes[0]
    let nearestDistance = Math.abs(tiedStrikes[0] - spot)
    for (const k of tiedStrikes) {
      const dist = Math.abs(k - spot)
      if (dist < nearestDistance) {
        nearestStrike = k
        nearestDistance = dist
      }
    }
    return nearestStrike
  }

  // No spot supplied — return the median tied strike (more central than min).
  const mid = Math.floor(tiedStrikes.length / 2)
  return tiedStrikes[mid]
}
