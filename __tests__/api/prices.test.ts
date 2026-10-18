import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { quoteMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
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
  return {
    ...actual,
    withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
  }
})

import { GET } from '@/app/api/prices/route'
import { fetchBloombergQuotesViaBridge, isBloombergBridgeConfigured } from '@/lib/data/bloomberg/bridgeClient'

function request(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

describe('GET /api/prices', () => {
  beforeEach(() => {
    quoteMock.mockReset()
  })

  it('returns 400 when every ticker token is invalid', async () => {
    const res = await GET(request('http://localhost:3000/api/prices?tickers=<script>,bad%20ticker'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_tickers')
  })

  it('returns 400 when ticker count exceeds cap', async () => {
    const tickers = Array.from({ length: 51 }, (_, i) => `T${i}`).join(',')
    const res = await GET(request(`http://localhost:3000/api/prices?tickers=${tickers}`))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('too_many_tickers')
  })

  it('returns quotes with expected shape on success', async () => {
    quoteMock.mockResolvedValue({
      symbol: 'AAPL',
      regularMarketPrice: 190,
      regularMarketChange: 2,
      regularMarketChangePercent: 1.05,
      regularMarketVolume: 50_000_000,
      fiftyTwoWeekHigh: 200,
      fiftyTwoWeekLow: 150,
      trailingPE: 28,
      marketCap: 3_000_000_000_000,
      regularMarketTime: new Date('2026-05-24T20:00:00Z'),
    })

    const res = await GET(request('http://localhost:3000/api/prices?tickers=AAPL'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotes).toHaveLength(1)
    expect(body.quotes[0]).toMatchObject({
      ticker: 'AAPL',
      price: 190,
      change: 2,
      volume: 50_000_000,
    })
    expect(body.dataSources).toMatchObject({
      yahoo: true,
      bloombergStatus: 'not_configured',
    })
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3')
  })

  it('returns standardized error schema when Yahoo fails', async () => {
    quoteMock.mockRejectedValue(new Error('upstream 503'))
    const res = await GET(request('http://localhost:3000/api/prices?tickers=MSFT'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.degraded).toBe(false)
    expect(body.error).toMatchObject({
      code: 'prices_fetch_failed',
      message: 'Failed to fetch live prices',
    })
    expect(body.error).not.toHaveProperty('stack')
  })

  // Red-team Q145-R2 (M11): `unpriced` is computed from the MERGED rows. A
  // ticker Yahoo could not price but the Bloomberg bridge did is priced, and a
  // bridge row without a change carries null, not 0.
  it('a ticker priced only by the Bloomberg bridge is not reported unpriced', async () => {
    vi.mocked(isBloombergBridgeConfigured).mockReturnValueOnce(true)
    vi.mocked(fetchBloombergQuotesViaBridge).mockResolvedValueOnce(new Map([
      ['SPY', { ticker: 'SPY', quoteTime: null, price: 500, change: null, changePct: null, volume: null, high52w: null, low52w: null, pe: null, marketCap: 'N/A', dataSource: 'bloomberg' as const }],
    ]))
    quoteMock.mockResolvedValue([
      { symbol: 'SPY' },
      { symbol: 'QQQ', regularMarketPrice: 400, regularMarketChange: 2, regularMarketChangePercent: 0.5 },
    ])
    const body = await (await GET(request('/api/prices?tickers=SPY,QQQ'))).json()
    expect(body.unpriced).toEqual([])
    const spy = body.quotes.find((q: { ticker: string }) => q.ticker === 'SPY')
    expect(spy).toMatchObject({ price: 500, change: null, changePct: null, dataSource: 'bloomberg' })
  })
})
