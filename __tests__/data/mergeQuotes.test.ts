import { describe, it, expect } from 'vitest'
import { mergeYahooAndBloomberg, type YahooQuoteLike } from '@/lib/data/mergeQuotes'
import type { BloombergQuoteNormalized } from '@/lib/data/bloomberg/bridgeClient'

const yahoo = (overrides: Partial<YahooQuoteLike> = {}): YahooQuoteLike => ({
  ticker: 'AAPL',
  price: 200,
  change: 1,
  changePct: 0.5,
  volume: 1_000_000,
  high52w: 250,
  low52w: 150,
  pe: 30,
  marketCap: '3.5T',
  quoteTime: '2026-05-07T15:30:00.000Z',
  ...overrides,
})

const bb = (overrides: Partial<BloombergQuoteNormalized> = {}): BloombergQuoteNormalized => ({
  ticker: 'AAPL',
  price: 201,
  change: 2,
  changePct: 1.0,
  volume: 2_000_000,
  high52w: 260,
  low52w: 155,
  pe: 31,
  marketCap: '3.6T',
  bid: 200.99,
  ask: 201.01,
  dataSource: 'bloomberg' as const,
  ...overrides,
})

describe('mergeYahooAndBloomberg', () => {
  it('returns yahoo-only when bloomberg is null', () => {
    const out = mergeYahooAndBloomberg([yahoo()], null)
    expect(out).toHaveLength(1)
    expect(out[0].dataSource).toBe('yahoo')
    expect(out[0].price).toBe(200)
  })

  it('returns yahoo-only when bloomberg map is empty', () => {
    const out = mergeYahooAndBloomberg([yahoo()], new Map())
    expect(out[0].dataSource).toBe('yahoo')
  })

  it('uses bloomberg primary fields when bridge has the ticker', () => {
    const bbMap = new Map([['AAPL', bb()]])
    const out = mergeYahooAndBloomberg([yahoo()], bbMap)
    expect(out[0].dataSource).toBe('bloomberg')
    expect(out[0].price).toBe(201)
    expect(out[0].change).toBe(2)
    expect(out[0].bid).toBe(200.99)
    expect(out[0].ask).toBe(201.01)
  })

  it('keeps yahoo quoteTime even when bloomberg-sourced (bridge does not provide it)', () => {
    const bbMap = new Map([['AAPL', bb()]])
    const out = mergeYahooAndBloomberg([yahoo()], bbMap)
    expect(out[0].quoteTime).toBe('2026-05-07T15:30:00.000Z')
  })

  it('falls back to yahoo for missing bloomberg fields (volume, 52w, pe, marketCap)', () => {
    const bbMap = new Map([
      ['AAPL', bb({ volume: 0, high52w: 0, low52w: 0, pe: 0, marketCap: 'N/A' })],
    ])
    const out = mergeYahooAndBloomberg([yahoo()], bbMap)
    // Bloomberg primary numeric fields override price/change/changePct,
    // but missing optional fields fall back to yahoo.
    expect(out[0].volume).toBe(1_000_000) // yahoo
    expect(out[0].high52w).toBe(250)
    expect(out[0].marketCap).toBe('3.5T')
  })

  it('appends bloomberg-only tickers (no yahoo counterpart)', () => {
    const bbMap = new Map([['MSFT', bb({ ticker: 'MSFT', price: 400 })]])
    const out = mergeYahooAndBloomberg([yahoo()], bbMap)
    expect(out).toHaveLength(2)
    const symbols = out.map((q) => q.ticker).sort()
    expect(symbols).toEqual(['AAPL', 'MSFT'])
    const msft = out.find((q) => q.ticker === 'MSFT')!
    expect(msft.dataSource).toBe('bloomberg')
    expect(msft.price).toBe(400)
  })

  it('does not duplicate when ticker is in both yahoo and bloomberg', () => {
    const bbMap = new Map([['AAPL', bb()]])
    const out = mergeYahooAndBloomberg([yahoo()], bbMap)
    expect(out.filter((q) => q.ticker === 'AAPL')).toHaveLength(1)
  })
})
