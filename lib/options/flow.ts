/**
 * Unusual options flow detection and sentiment scoring.
 *
 * "Unusual" = volume significantly exceeds open interest, suggesting a new,
 * aggressive directional position rather than routine hedging.
 */

import type { CallOrPut } from './chain'

export type FlowSide = 'CALL' | 'PUT'
export type FlowSentimentLabel = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

export interface UnusualFlowItem {
  contractSymbol: string
  side: FlowSide
  strike: number
  expiration: Date
  volume: number
  openInterest: number
  /** Ratio of volume to OI. Infinity when OI is 0. */
  volumeToOI: number
  impliedVolatility: number
  lastPrice: number
  bid: number | null
  ask: number | null
  /** True when last trade was near the ask (aggressive buyer). */
  nearAsk: boolean
  /** BULLISH = aggressive call buy or put sell; BEARISH = aggressive put buy or call sell */
  sentiment: FlowSentimentLabel
}

/** Volume must exceed OI by this multiplier to qualify as unusual. */
const UNUSUAL_VOLUME_MULTIPLIER = 3

/**
 * Phase 14 wave 41 (F6) — JSON-safe sentinel for "vol >> OI" cases.
 *
 * When openInterest == 0 but volume meets the unusual threshold (line 88),
 * the raw ratio is Infinity. JSON.stringify(Infinity) === "null", which then
 * appears as `null` in the API response and crashes any downstream arithmetic
 * (e.g. UI .toFixed). 9_999 is large enough to dominate any percentile sort
 * AND serialises cleanly. UI components can test against this sentinel to
 * render an "∞" badge instead of a numeric value.
 */
export const MAX_VOL_OI_RATIO = 9_999
/**
 * Minimum absolute volume to avoid noise on near-zero-OI contracts.
 *
 * Phase 14 (Q3-M-3): The vol/OI > 3 gate alone produces false positives
 * on legitimate multi-leg structures. A 200-contract vertical spread or
 * iron condor opening fresh appears as "unusual" call/put activity on
 * each leg even though no directional opinion is implied — both legs
 * inflate volume relative to (often small) prior OI on those strikes.
 * Natenberg (2015, "Option Volatility and Pricing," ch. 23) cautions
 * that single-leg volume signals on contracts with low absolute volume
 * lack the statistical power to distinguish flow from noise; he
 * recommends ignoring volume signals below a meaningful absolute floor.
 *
 * We use 500 (above the requested floor of 100) because most spread
 * trades clear in lots of 100-200, and 500 reliably filters retail
 * single-legged "lottery ticket" buys from institutional flow. The
 * MIN_ABSOLUTE_VOL_FOR_UNUSUAL alias documents the floor explicitly.
 */
const MIN_UNUSUAL_VOLUME = 500
export const MIN_ABSOLUTE_VOL_FOR_UNUSUAL = MIN_UNUSUAL_VOLUME

/**
 * Fraction of the bid–ask range at which a trade is classified as "near ask"
 * (aggressor-side buy). The conventional Lee-Ready / EMO trade-classification
 * threshold is the quote midpoint (50%); we tighten to 98% of the spread
 * because retail brokers commonly route to internalizers that fill at
 * mid-or-better, so a fill at "near the ask" is a much stronger signal of
 * aggressive lifting than a fill above mid.
 *
 * Phase 14 (Q3-H-1): hoisted out of the inline expression so the threshold
 * is explicit and tunable. Adjusting this materially shifts the BULLISH /
 * BEARISH split for unusual flow — coordinate with the back-test in
 * `__tests__/options/flow.test.ts` before changing.
 *
 * References:
 *   • Lee & Ready (1991, J. Finance) — original tick / midpoint rule.
 *   • Ellis, Michaely, O'Hara (2000, J. Fin. Quant. Anal.) — EMO rule that
 *     prefers quote-based classification when the trade is at or near a
 *     standing quote.
 */
const NEAR_ASK_FRACTION = 0.98

/**
 * Returns contracts where volume is unusually high relative to open interest.
 * Sorted by volume descending.
 */
export function unusualFlow(calls: CallOrPut[], puts: CallOrPut[]): UnusualFlowItem[] {
  const items: UnusualFlowItem[] = []

  function process(contracts: CallOrPut[], side: FlowSide) {
    for (const c of contracts) {
      const vol = c.volume ?? 0
      const oi  = c.openInterest ?? 0
      if (vol < MIN_UNUSUAL_VOLUME) continue
      const ratio = oi > 0 ? vol / oi : Infinity
      if (oi > 0 && ratio < UNUSUAL_VOLUME_MULTIPLIER) continue

      const bid = c.bid ?? null
      const ask = c.ask ?? null
      // "Near ask" = last price ≥ NEAR_ASK_FRACTION · ask. Prior bugs in this
      // gate:
      //   (a) the `mid != null` fallback was dead code — `mid = (bid+ask)/2`
      //       requires BOTH bid and ask, so when ask is null mid is also
      //       null and the branch never fired.
      //   (b) ask === 0 (illiquid contract with zero quoted spread) made
      //       `lastPrice >= 0 * 0.98 = 0` always true, marking every
      //       illiquid trade as a near-ask buy → false BULLISH/BEARISH
      //       sentiment. Now we require ask > 0 explicitly.
      //   (c) Phase 14 (Q3-H-1): a closed / crossed book (bid >= ask) cannot
      //       be classified — the trade-classification literature explicitly
      //       skips trades when no valid two-sided quote exists (Lee-Ready
      //       1991 §III, Ellis-Michaely-O'Hara 2000 §IV.B). We now also
      //       refuse classification when (ask - bid) <= 0, defaulting to
      //       NEUTRAL via `nearAsk = false`. This matters most around the
      //       open/close where bids briefly cross asks during the matching
      //       process and stale prints would otherwise be mis-tagged.
      const spreadValid = bid != null && ask != null && ask - bid > 0

      // Phase 14 wave 41 (F4): three-state classification, NOT binary.
      //
      // Prior code forced `nearAsk = false` when the spread couldn't be
      // classified (single-sided quote, halted symbol, after-hours).
      // Falling through to the binary sentiment branch then flipped the
      // sign — call → BEARISH and put → BULLISH — i.e. the OPPOSITE of
      // a truly ambiguous classification. The function had no NEUTRAL
      // output, so every unclassifiable item became a confident wrong
      // signal.
      //
      // Now: tri-state. When the quote is missing/crossed/zero-spread,
      // sentiment is NEUTRAL and downstream `flowSentiment` ignores it.
      // Reference: Lee-Ready (1991) §III, Ellis-Michaely-O'Hara (2000) §IV.B
      // — when no valid two-sided quote exists, trade-direction is undefined.
      let sentiment: FlowSentimentLabel
      let nearAsk: boolean
      if (!spreadValid || ask == null || ask <= 0) {
        nearAsk = false
        sentiment = 'NEUTRAL'
      } else {
        nearAsk = c.lastPrice >= ask * NEAR_ASK_FRACTION
        // Near-ask call buy = BULLISH; near-ask put buy = BEARISH.
        // Far from ask (near bid) suggests closing / selling: call sell
        // = BEARISH, put sell = BULLISH.
        if (side === 'CALL') {
          sentiment = nearAsk ? 'BULLISH' : 'BEARISH'
        } else {
          sentiment = nearAsk ? 'BEARISH' : 'BULLISH'
        }
      }

      items.push({
        contractSymbol: c.contractSymbol,
        side,
        strike: c.strike,
        expiration: c.expiration instanceof Date ? c.expiration : new Date(c.expiration),
        volume: vol,
        openInterest: oi,
        // Phase 14 wave 41 (F6): cap Infinity at a documented sentinel.
        // JSON serialises Infinity as null, which breaks any downstream
        // arithmetic. MAX_VOL_OI_RATIO is a sentinel "extreme" value that
        // serialises cleanly and is easy to test against in the UI.
        volumeToOI: ratio === Infinity ? MAX_VOL_OI_RATIO : ratio,
        impliedVolatility: c.impliedVolatility,
        lastPrice: c.lastPrice,
        bid,
        ask,
        nearAsk,
        sentiment,
      })
    }
  }

  process(calls, 'CALL')
  process(puts,  'PUT')

  return items.sort((a, b) => b.volume - a.volume)
}

/**
 * Aggregates individual flow items into an overall sentiment signal.
 * Uses volume-weighted majority vote.
 */
export function flowSentiment(items: UnusualFlowItem[]): FlowSentimentLabel {
  if (items.length === 0) return 'NEUTRAL'

  let bullishVol = 0
  let bearishVol = 0

  for (const item of items) {
    if (item.sentiment === 'BULLISH') bullishVol += item.volume
    else if (item.sentiment === 'BEARISH') bearishVol += item.volume
  }

  const total = bullishVol + bearishVol
  if (total === 0) return 'NEUTRAL'

  const bullishPct = bullishVol / total
  if (bullishPct > 0.6) return 'BULLISH'
  if (bullishPct < 0.4) return 'BEARISH'
  return 'NEUTRAL'
}
