/**
 * CROSS-ROUTE INVARIANT: /api/prices and /api/stream must emit the SAME
 * `changePct` for the same upstream Yahoo row.
 *
 * Context (2026-08-15, DQ-5 — filed as DQ-2 in the wave brief): the dashboard
 * renders both surfaces at once — the polled tiles come from /api/prices via
 * hooks/useLivePrices, the streamed tiles from /api/stream via
 * hooks/useLiveQuotes. /api/prices ran the value through
 * `normalizedChangePercent`; the multiplex route (added 2026-08-14) took
 * `regularMarketChangePercent` raw. Yahoo occasionally serves that field in
 * DECIMAL form (0.016 meaning 1.6%), so on those symbols one tile said +1.6%
 * and the other +0.016% — a 100× understatement, on the same page, with no
 * error raised.
 *
 * THE FIXTURE MUST EXERCISE THE BUG. A percent-form row normalizes to itself,
 * so a parity assertion on one would pass with or without the fix; the decimal
 * -form row below is the one that has teeth.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

interface MockQuoteRow {
  symbol: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketVolume?: number
}

const { quoteMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(async (
    _symbols: unknown,
    _queryOptions?: unknown,
    _moduleOptions?: unknown,
  ): Promise<MockQuoteRow[]> => []),
}))

vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    quote = quoteMock
  },
}))

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}))

vi.mock('@/lib/data/bloomberg/bridgeClient', () => ({
  isBloombergBridgeConfigured: vi.fn(() => false),
  fetchBloombergQuotesViaBridge: vi.fn(),
}))

vi.mock('@/lib/api/reliability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/reliability')>()
  return { ...actual, withRetry: vi.fn((fn: () => Promise<unknown>) => fn()) }
})

import { GET as pricesGET } from '@/app/api/prices/route'
import { GET as streamGET } from '@/app/api/stream/route'
import { GET as singleStreamGET } from '@/app/api/stream/[ticker]/route'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'

/**
 * The row Yahoo returns in DECIMAL form: a 1.6% move reported as 0.016. (Strictly
 * a change of 1.6 on a price of 100 is 1.626% of the prior close; the
 * normaliser's implied value divides by the current price, which is close
 * enough to choose the scale — red-team Q145-R7, logged.)
 */
const DECIMAL_FORM_ROW: MockQuoteRow = {
  symbol: 'SPY',
  regularMarketPrice: 100,
  regularMarketChange: 1.6,
  regularMarketChangePercent: 0.016,
  regularMarketVolume: 1_000,
}

/** The ordinary case: the same move already reported in percent form. */
const PERCENT_FORM_ROW: MockQuoteRow = { ...DECIMAL_FORM_ROW, regularMarketChangePercent: 1.6 }

async function pricesChangePct(): Promise<number> {
  const res = await pricesGET(
    new NextRequest(new URL('http://localhost:3000/api/prices?tickers=SPY')),
  )
  const body = await res.json() as { quotes: Array<{ ticker: string; changePct: number }> }
  const spy = body.quotes.find((q) => q.ticker === 'SPY')
  if (!spy) throw new Error('prices route returned no SPY row')
  return spy.changePct
}

/**
 * Drain the SSE body until the aggregated `market_state` arrives (the server
 * emits it right after the initial quote burst) and return the SPY quote's
 * changePct, then abort. The abort matters: the route arms 15 s / 30 s
 * intervals and a 240 s close timer, and live timers would hold the event loop
 * open for the whole suite (same rationale as streamMultiplex.test.ts).
 */
async function streamChangePct(ip: string): Promise<number> {
  const controller = new AbortController()
  const res = await streamGET(new Request('http://localhost/api/stream?tickers=SPY', {
    headers: { 'x-real-ip': ip },
    signal: controller.signal,
  }))
  if (!res.body) {
    controller.abort()
    throw new Error('stream route returned no body')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let changePct: number | null = null
  try {
    for (let i = 0; i < 64; i++) {
      const { value, done } = await reader.read()
      if (done) break
      let sawMarketState = false
      for (const block of decoder.decode(value).split('\n\n')) {
        // [\s\S] rather than the `s` flag — tsconfig targets ES2017.
        const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim())
        if (!m) continue
        if (m[1] === 'market_state') sawMarketState = true
        if (m[1] !== 'quote') continue
        const data = JSON.parse(m[2]) as { ticker: string; changePct: number }
        if (data.ticker === 'SPY') changePct = data.changePct
      }
      if (sawMarketState) break
    }
  } finally {
    controller.abort()          // fires the route's client-disconnect cleanup
    await reader.cancel().catch(() => { /* already closed */ })
  }
  if (changePct === null) throw new Error('stream route emitted no SPY quote')
  return changePct
}

describe('changePct: /api/prices ≡ /api/stream (DQ-5)', () => {
  beforeEach(() => {
    // Force the in-process rate limiter (no KV), per route-rate-limit.test.ts.
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    quoteMock.mockReset()
  })

  it('THE INVARIANT: both routes emit the same value for a DECIMAL-form row', async () => {
    quoteMock.mockResolvedValue([DECIMAL_FORM_ROW])
    const polled = await pricesChangePct()
    const streamed = await streamChangePct('10.9.5.1')

    expect(streamed).toBe(polled)
    // And the shared value is the CORRECT one: (1.6 / 100) * 100 = 1.6%, not
    // the raw 0.016 the stream used to serve.
    expect(polled).toBeCloseTo(1.6, 10)
    expect(streamed).not.toBeCloseTo(0.016, 10)
  })

  it('both routes agree on an ordinary PERCENT-form row too (no regression)', async () => {
    quoteMock.mockResolvedValue([PERCENT_FORM_ROW])
    const polled = await pricesChangePct()
    const streamed = await streamChangePct('10.9.5.2')

    expect(streamed).toBe(polled)
    expect(polled).toBeCloseTo(1.6, 10)
  })

  it('both routes agree on a negative decimal-form row', async () => {
    quoteMock.mockResolvedValue([{
      symbol: 'SPY',
      regularMarketPrice: 400,
      regularMarketChange: -8,
      regularMarketChangePercent: -0.02,   // decimal form of -2%
    }])
    const polled = await pricesChangePct()
    const streamed = await streamChangePct('10.9.5.3')

    expect(streamed).toBe(polled)
    expect(polled).toBeCloseTo(-2, 10)
  })

  it('both routes run the SSOT normalizer, not a re-derivation', async () => {
    // Pins the parity to lib/yahooQuoteFields rather than to a coincidence of
    // two hand-rolled formulas agreeing on these fixtures.
    quoteMock.mockResolvedValue([DECIMAL_FORM_ROW])
    const expected = normalizedChangePercent(
      DECIMAL_FORM_ROW.regularMarketChangePercent,
      DECIMAL_FORM_ROW.regularMarketChange,
      DECIMAL_FORM_ROW.regularMarketPrice,
    )
    expect(await pricesChangePct()).toBe(expected)
    expect(await streamChangePct('10.9.5.4')).toBe(expected)
  })
})

/** The first SPY `quote` event of the multiplex stream, as sent (null-safe). */
async function multiStreamQuote(ip: string): Promise<{ change: number | null; changePct: number | null }> {
  const controller = new AbortController()
  const res = await streamGET(new Request('http://localhost/api/stream?tickers=SPY', { headers: { 'x-real-ip': ip }, signal: controller.signal }))
  if (!res.body) { controller.abort(); throw new Error('stream route returned no body') }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (let i = 0; i < 64; i++) {
      const { value, done } = await reader.read()
      if (done) break
      for (const block of decoder.decode(value).split('\n\n')) {
        const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim())
        if (m && m[1] === 'quote') {
          const d = JSON.parse(m[2]) as { ticker: string; change: number | null; changePct: number | null }
          if (d.ticker === 'SPY') return d
        }
      }
    }
  } finally {
    controller.abort()
    await reader.cancel().catch(() => { /* already closed */ })
  }
  throw new Error('stream route emitted no SPY quote')
}

/** The first `quote` event of the single-ticker stream, then abort. */
async function singleStreamQuote(ip: string): Promise<{ change: number | null; changePct: number | null }> {
  const controller = new AbortController()
  const res = await singleStreamGET(
    new Request('http://localhost/api/stream/SPY', { headers: { 'x-real-ip': ip }, signal: controller.signal }) as never,
    { params: Promise.resolve({ ticker: 'SPY' }) },
  )
  if (!res.body) { controller.abort(); throw new Error('single stream returned no body') }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    for (let i = 0; i < 64; i++) {
      const { value, done } = await reader.read()
      if (done) break
      for (const block of decoder.decode(value).split('\n\n')) {
        const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim())
        if (m && m[1] === 'quote') return JSON.parse(m[2])
      }
    }
  } finally {
    controller.abort()
    await reader.cancel().catch(() => { /* already closed */ })
  }
  throw new Error('single stream emitted no quote')
}

// Q-145: the single-ticker stream took regularMarketChangePercent RAW, so a
// decimal-form value reached the stock page 100x too small (DQ-5, which the
// multiplex route fixed on 2026-08-14); and every producer turned a missing
// change into a measured 0.
describe('Q-145: every quote producer — same percent, and null (not 0) when Yahoo gave none', () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    quoteMock.mockReset()
  })

  it('/api/stream/[ticker] normalises a DECIMAL-form row like the other two routes', async () => {
    quoteMock.mockResolvedValue(DECIMAL_FORM_ROW as never)
    const single = await singleStreamQuote('10.9.6.1')
    expect(single.changePct).toBeCloseTo(1.6, 10)
    quoteMock.mockResolvedValue([DECIMAL_FORM_ROW])
    expect(await pricesChangePct()).toBe(single.changePct)
  })

  it('a row with a price but no change is null on all three routes, never 0', async () => {
    const noChange = { symbol: 'SPY', regularMarketPrice: 100 }
    quoteMock.mockResolvedValue([noChange])
    const res = await pricesGET(new NextRequest(new URL('http://localhost:3000/api/prices?tickers=SPY')))
    const body = await res.json() as { quotes: Array<{ ticker: string; change: number | null; changePct: number | null }> }
    expect(body.quotes[0]).toMatchObject({ ticker: 'SPY', change: null, changePct: null })
    quoteMock.mockResolvedValue([noChange])
    expect(await multiStreamQuote('10.9.6.2')).toMatchObject({ change: null, changePct: null })
    quoteMock.mockResolvedValue(noChange as never)
    expect(await singleStreamQuote('10.9.6.3')).toMatchObject({ change: null, changePct: null })
  })

  // Red-team Q145-R8: the multiplex stream accepted a price of 0 (finite only),
  // while /api/prices and the single stream require > 0.
  it('/api/stream emits no quote for a row priced at 0, like the other two routes', async () => {
    quoteMock.mockResolvedValue([{ symbol: 'SPY', regularMarketPrice: 0, regularMarketChange: 1 }, { symbol: 'QQQ', regularMarketPrice: 400, regularMarketChange: 2 }])
    const controller = new AbortController()
    const res = await streamGET(new Request('http://localhost/api/stream?tickers=SPY,QQQ', { headers: { 'x-real-ip': '10.9.6.4' }, signal: controller.signal }))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const quoted: string[] = []
    try {
      for (let i = 0; i < 64; i++) {
        const { value, done } = await reader.read()
        if (done) break
        let sawMarketState = false
        for (const block of decoder.decode(value).split('\n\n')) {
          const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim())
          if (!m) continue
          if (m[1] === 'market_state') sawMarketState = true
          if (m[1] === 'quote') quoted.push((JSON.parse(m[2]) as { ticker: string }).ticker)
        }
        if (sawMarketState) break
      }
    } finally {
      controller.abort()
      await reader.cancel().catch(() => { /* already closed */ })
    }
    expect(quoted).toEqual(['QQQ'])
  })

  it('/api/prices drops a row with no usable price and names the ticker in `unpriced`', async () => {
    quoteMock.mockResolvedValue([{ symbol: 'SPY', regularMarketChange: 1 }, { symbol: 'QQQ', regularMarketPrice: 0 }])
    const res = await pricesGET(new NextRequest(new URL('http://localhost:3000/api/prices?tickers=SPY,QQQ')))
    const body = await res.json() as { quotes: unknown[]; unpriced: string[] }
    expect(body.quotes).toEqual([])
    expect(body.unpriced.sort()).toEqual(['QQQ', 'SPY'])
  })
})

/**
 * Red-team Q145-R5: the briefs producer took `regularMarketChangePercent` raw, so
 * a decimal-form row rendered +0.02% on /briefs while every quote route said
 * +1.6%. It goes through the same normaliser now — for the ETF and each holding.
 */
describe('changePct: the sector-brief producer ≡ /api/prices', () => {
  it('the ETF and every holding normalise a DECIMAL-form row like the quote routes', async () => {
    const { buildSectorBrief } = await import('@/lib/briefs/sectorBrief')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = { ...DECIMAL_FORM_ROW, regularMarketTime: new Date('2026-10-16T20:00:00Z') }
    const brief = await buildSectorBrief('technology', {
      quote: vi.fn(async () => row),
      quoteSummary: vi.fn(async () => ({ defaultKeyStatistics: {} })),
      search: vi.fn(async () => ({ news: [] })),
    })
    warn.mockRestore()
    expect(brief).not.toBeNull()
    const expected = normalizedChangePercent(row.regularMarketChangePercent, row.regularMarketChange, row.regularMarketPrice)
    expect(expected).toBeCloseTo(1.6, 10)
    expect(brief!.changePct).toBe(expected)
    expect(brief!.holdings.length).toBeGreaterThan(0)
    for (const h of brief!.holdings) expect(h.changePct).toBe(expected)
  })

  it('a row with neither change field has a null percent, not 0', async () => {
    const { buildSectorBrief } = await import('@/lib/briefs/sectorBrief')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const brief = await buildSectorBrief('technology', {
      quote: vi.fn(async () => ({ symbol: 'XLK', regularMarketPrice: 250 })),
      quoteSummary: vi.fn(async () => ({ defaultKeyStatistics: {} })),
      search: vi.fn(async () => ({ news: [] })),
    })
    warn.mockRestore()
    expect(brief!.changePct).toBeNull()
    for (const h of brief!.holdings) expect(h.changePct).toBeNull()
  })
})
