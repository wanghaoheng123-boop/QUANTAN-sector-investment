import { describe, it, expect } from 'vitest'
import { unusualFlow, flowSentiment } from '@/lib/options/flow'
import type { CallOrPut } from '@/lib/options/chain'

function makeContract(
  strike: number,
  volume: number,
  openInterest: number,
  lastPrice: number,
  bid: number | undefined,
  ask: number | undefined,
  type: 'call' | 'put',
): CallOrPut {
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  return {
    contractSymbol: `TEST${type === 'call' ? 'C' : 'P'}${strike}`,
    strike,
    lastPrice,
    change: 0,
    contractSize: 'REGULAR',
    expiration: expiry,
    lastTradeDate: new Date(),
    impliedVolatility: 0.30,
    inTheMoney: false,
    volume,
    openInterest,
    bid,
    ask,
  }
}

describe('unusualFlow', () => {
  it('flags contracts where volume > 3x OI', () => {
    const calls = [
      makeContract(100, 9000, 2000, 2.00, 1.90, 2.10, 'call'), // 4.5x — unusual
      makeContract(105,  600, 2000, 1.00, 0.95, 1.05, 'call'), // 0.3x — normal
    ]
    const result = unusualFlow(calls, [])
    expect(result).toHaveLength(1)
    expect(result[0].strike).toBe(100)
  })

  it('flags contracts where OI is 0 and volume >= MIN_UNUSUAL_VOLUME', () => {
    const calls = [makeContract(100, 1500, 0, 1.0, 0.9, 1.1, 'call')]
    const result = unusualFlow(calls, [])
    expect(result).toHaveLength(1)
    expect(result[0].volumeToOI).toBe(Infinity)
  })

  it('ignores contracts below min volume threshold', () => {
    const calls = [makeContract(100, 200, 0, 1.0, 0.9, 1.1, 'call')]
    expect(unusualFlow(calls, [])).toHaveLength(0)
  })

  it('marks BULLISH when call is near ask', () => {
    const calls = [
      makeContract(100, 5000, 1000, 2.09, 1.90, 2.10, 'call'),  // near ask (2.09 >= 2.10*0.98)
    ]
    const result = unusualFlow(calls, [])
    expect(result[0].nearAsk).toBe(true)
    expect(result[0].sentiment).toBe('BULLISH')
  })

  it('marks BEARISH when call is near bid', () => {
    const calls = [
      makeContract(100, 5000, 1000, 1.92, 1.90, 2.10, 'call'),  // near bid
    ]
    const result = unusualFlow(calls, [])
    expect(result[0].nearAsk).toBe(false)
    expect(result[0].sentiment).toBe('BEARISH')
  })

  it('marks BEARISH when put is near ask', () => {
    const puts = [
      makeContract(95, 5000, 1000, 1.96, 1.80, 2.00, 'put'),  // near ask
    ]
    const result = unusualFlow([], puts)
    expect(result[0].sentiment).toBe('BEARISH')
  })

  it('marks BULLISH when put is near bid', () => {
    const puts = [
      makeContract(95, 5000, 1000, 1.82, 1.80, 2.00, 'put'),  // near bid
    ]
    const result = unusualFlow([], puts)
    expect(result[0].sentiment).toBe('BULLISH')
  })

  it('sorts by volume descending', () => {
    const calls = [
      makeContract(100, 2000, 500, 1.0, 0.9, 1.1, 'call'),
      makeContract(105, 5000, 1000, 1.0, 0.9, 1.1, 'call'),
      makeContract(110, 8000, 1500, 1.0, 0.9, 1.1, 'call'),
    ]
    const result = unusualFlow(calls, [])
    expect(result[0].volume).toBeGreaterThanOrEqual(result[1].volume)
    if (result.length > 2) {
      expect(result[1].volume).toBeGreaterThanOrEqual(result[2].volume)
    }
  })
})

describe('flowSentiment', () => {
  it('returns NEUTRAL for empty list', () => {
    expect(flowSentiment([])).toBe('NEUTRAL')
  })

  it('returns BULLISH when bullish vol > 60%', () => {
    const items = unusualFlow([
      makeContract(100, 8000, 1000, 2.09, 1.90, 2.10, 'call'),  // bullish: 8000
      makeContract(95,  1000, 200, 1.96, 1.80, 2.00, 'put'),    // bearish: 1000
    ], [
      makeContract(95,  1000, 200, 1.96, 1.80, 2.00, 'put'),
    ])
    // Note: unusualFlow filters, so pass same items
    const bullish = [
      { ...items[0], sentiment: 'BULLISH' as const, volume: 8000 },
    ]
    const bearish = [
      { ...items[0], sentiment: 'BEARISH' as const, volume: 1000 },
    ]
    expect(flowSentiment([...bullish, ...bearish])).toBe('BULLISH')
  })

  it('returns BEARISH when bearish vol > 60%', () => {
    const calls = [makeContract(100, 5000, 1000, 1.92, 1.90, 2.10, 'call')]
    const puts  = [makeContract(95,  1000, 200, 1.96, 1.80, 2.00, 'put')]
    const items = unusualFlow(calls, puts)
    if (items.length >= 2) {
      // Force scenario: large bearish, small bullish
      const forced = [
        { ...items[0], sentiment: 'BEARISH' as const, volume: 7000 },
        { ...items[0], sentiment: 'BULLISH' as const, volume: 1000 },
      ]
      expect(flowSentiment(forced)).toBe('BEARISH')
    }
  })

  it('returns NEUTRAL when split is ~50/50', () => {
    const items = [
      { contractSymbol: 'A', side: 'CALL' as const, strike: 100, expiration: new Date(), volume: 1000, openInterest: 200, volumeToOI: 5, impliedVolatility: 0.3, lastPrice: 2, bid: null, ask: null, nearAsk: true, sentiment: 'BULLISH' as const },
      { contractSymbol: 'B', side: 'PUT' as const, strike: 95, expiration: new Date(), volume: 1000, openInterest: 200, volumeToOI: 5, impliedVolatility: 0.3, lastPrice: 2, bid: null, ask: null, nearAsk: true, sentiment: 'BEARISH' as const },
    ]
    expect(flowSentiment(items)).toBe('NEUTRAL')
  })
})
