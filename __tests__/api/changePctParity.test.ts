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
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'

/** The row Yahoo returns in DECIMAL form: a true +1.6% move reported as 0.016. */
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
