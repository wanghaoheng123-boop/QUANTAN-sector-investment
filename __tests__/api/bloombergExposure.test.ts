import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { quoteMock, quoteSummaryMock, chartMock, buildPayloadMock, fetchMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  quoteSummaryMock: vi.fn(),
  chartMock: vi.fn(),
  buildPayloadMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    quote = quoteMock
    quoteSummary = quoteSummaryMock
    chart = chartMock
  },
}))

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(() => null) }))
vi.mock('@/lib/api/reliability', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api/reliability')>(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))
vi.mock('@/lib/quant/buildFundamentalsPayload', () => ({
  buildFundamentalsPayload: buildPayloadMock,
}))

// Keep bridgeClient and mergeQuotes real: mocking the configuration predicate
// would miss the public consumers that Q-108 must prevent from redistributing.
import { GET as pricesGET } from '@/app/api/prices/route'
import { GET as fundamentalsGET } from '@/app/api/fundamentals/[ticker]/route'

const ACK = 'i-confirm-our-bloomberg-agreement-permits-this-redistribution'
const BRIDGE_URL = 'https://bridge.example'
const __SYNTHETIC__YAHOO_QUOTE = {
  __SYNTHETIC__: true as const,
  symbol: 'AAPL',
  regularMarketPrice: 190,
  regularMarketChange: 2,
  regularMarketChangePercent: 1.05,
  regularMarketVolume: 50_000_000,
  fiftyTwoWeekHigh: 200,
  fiftyTwoWeekLow: 150,
  trailingPE: 28,
  marketCap: 3_000_000_000_000,
  regularMarketTime: new Date('2026-09-14T20:00:00Z'),
}
const __SYNTHETIC__BRIDGE_QUOTE = {
  __SYNTHETIC__: true as const,
  symbol: 'AAPL',
  last: 211,
  change: 3,
  changePct: 1.4,
}

const DISABLED_CONFIGURATIONS = [
  { name: 'URL is unset', url: undefined, ack: ACK },
  { name: 'URL alone is set', url: BRIDGE_URL, ack: undefined },
  { name: 'acknowledgement is incorrect', url: BRIDGE_URL, ack: 'true' },
] as const

function request(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BLOOMBERG_BRIDGE_URL', BRIDGE_URL)
  vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', ACK)
  vi.stubEnv('BLOOMBERG_BRIDGE_SECRET', '')
  vi.stubEnv('BLOOMBERG_BRIDGE_TIMEOUT_MS', '4000')
  vi.stubGlobal('fetch', fetchMock)
  quoteMock.mockResolvedValue({ ...__SYNTHETIC__YAHOO_QUOTE })
  quoteSummaryMock.mockResolvedValue({ __SYNTHETIC__: true })
  chartMock.mockResolvedValue({ __SYNTHETIC__: true, quotes: [] })
  buildPayloadMock.mockReturnValue({ __SYNTHETIC__: true, ticker: 'AAPL' })
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({
    quotes: [__SYNTHETIC__BRIDGE_QUOTE],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Bloomberg redistribution gate through public prices consumer', () => {
  it.each(DISABLED_CONFIGURATIONS)('retains Yahoo price and provenance when $name', async ({ url, ack }) => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', url)
    vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', ack)

    const response = await pricesGET(request('/api/prices?tickers=AAPL'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(quoteMock).toHaveBeenCalledExactlyOnceWith(['AAPL'])
    expect(body.quotes).toHaveLength(1)
    expect(body.quotes[0]).toMatchObject({
      ticker: 'AAPL',
      price: 190,
      dataSource: 'yahoo',
      provenance: { price: 'yahoo', volume: 'yahoo' },
    })
    expect(body.dataSources).toEqual({
      yahoo: true,
      bloombergBridge: false,
      bloombergTickers: [],
      bloombergStatus: 'not_configured',
    })
  })

  it('fetches and exposes the bridge price only with the exact acknowledgement', async () => {
    const response = await pricesGET(request('/api/prices?tickers=AAPL'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${BRIDGE_URL}/quotes`, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      body: JSON.stringify({ tickers: ['AAPL'] }),
    }))
    expect(body.quotes).toHaveLength(1)
    expect(body.quotes[0]).toMatchObject({
      ticker: 'AAPL',
      price: 211,
      dataSource: 'bloomberg',
      provenance: { price: 'bloomberg', volume: 'yahoo' },
    })
    expect(body.dataSources).toEqual({
      yahoo: true,
      bloombergBridge: true,
      bloombergTickers: ['AAPL'],
      bloombergStatus: 'ok',
    })
  })
})

describe('Bloomberg redistribution gate through public fundamentals consumer', () => {
  it.each(DISABLED_CONFIGURATIONS)('keeps Bloomberg out of payload construction when $name', async ({ url, ack }) => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', url)
    vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', ack)

    const response = await fundamentalsGET(request('/api/fundamentals/AAPL'), {
      params: Promise.resolve({ ticker: 'AAPL' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(buildPayloadMock).toHaveBeenCalledOnce()
    expect(buildPayloadMock.mock.calls[0][7]).toBe(190)
    expect(body.priceSources).toEqual({ display: 190, yahoo: 190, bloomberg: null })
  })

  it('passes the acknowledged bridge price to payload construction and records its source', async () => {
    const response = await fundamentalsGET(request('/api/fundamentals/AAPL'), {
      params: Promise.resolve({ ticker: 'AAPL' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`${BRIDGE_URL}/quotes`, expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      body: JSON.stringify({ tickers: ['AAPL'] }),
    }))
    expect(buildPayloadMock).toHaveBeenCalledOnce()
    expect(buildPayloadMock.mock.calls[0][7]).toBe(211)
    expect(body.priceSources).toEqual({ display: 211, yahoo: 190, bloomberg: 211 })
  })
})
