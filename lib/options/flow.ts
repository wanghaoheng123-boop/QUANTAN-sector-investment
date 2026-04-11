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
/** Minimum absolute volume to avoid noise on near-zero-OI contracts. */
const MIN_UNUSUAL_VOLUME = 500

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
      const mid = bid != null && ask != null ? (bid + ask) / 2 : null
      // "Near ask" = last price >= 98% of ask (or >= mid if no ask)
      const nearAsk = ask != null
        ? c.lastPrice >= ask * 0.98
        : mid != null
          ? c.lastPrice >= mid
          : false

      // Sentiment: near-ask call buy = BULLISH; near-ask put buy = BEARISH
      // Far from ask (near bid) suggests closing / selling: call sell = BEARISH, put sell = BULLISH
      let sentiment: FlowSentimentLabel
      if (side === 'CALL') {
        sentiment = nearAsk ? 'BULLISH' : 'BEARISH'
      } else {
        sentiment = nearAsk ? 'BEARISH' : 'BULLISH'
      }

      items.push({
        contractSymbol: c.contractSymbol,
        side,
        strike: c.strike,
        expiration: c.expiration instanceof Date ? c.expiration : new Date(c.expiration),
        volume: vol,
        openInterest: oi,
        volumeToOI: ratio,
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
