/**
 * Q-086 — the DCF refusal, exercised through the real route handler and the
 * real builder (only Yahoo is mocked). The builder's own tests feed it a
 * hand-built object, which cannot see what the ROUTE requests: the route asks
 * quoteSummary for no `price` module, so a currency refusal that read only
 * `quoteSummary.price` could never fire in production. These pin the effect
 * where users meet it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { quoteMock, quoteSummaryMock, chartMock } = vi.hoisted(() => ({
  quoteMock: vi.fn(),
  quoteSummaryMock: vi.fn(),
  chartMock: vi.fn(),
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

import { GET } from '@/app/api/fundamentals/[ticker]/route'

/** __SYNTHETIC__ fixture: a deterministic 320-session daily series. */
function chart() {
  const quotes = []
  let level = 100
  for (let i = 0; i < 320; i++) {
    level *= 1 + 0.0015 + Math.sin(i * 0.7) * 0.004
    quotes.push({ date: new Date(Date.UTC(2024, 0, 1) + i * 86400_000), open: level, high: level + 0.4, low: level - 0.4, close: level, volume: 1e6 })
  }
  return { __SYNTHETIC__: true, quotes }
}

const summary = (sector: string, industry: string, financialCurrency = 'USD') => ({
  __SYNTHETIC__: true,
  summaryProfile: { longName: 'X Corp', sector, industry },
  financialData: { freeCashflow: 8e9, targetMeanPrice: 180, financialCurrency },
  defaultKeyStatistics: { sharesOutstanding: 1e9, forwardEps: 8, forwardPE: 20 },
})

async function get(ticker: string) {
  const res = await GET(new NextRequest(new URL(`/api/fundamentals/${ticker}`, 'http://localhost:3000')), { params: Promise.resolve({ ticker }) })
  expect(res.status).toBe(200)
  return res.json()
}

beforeEach(() => {
  vi.clearAllMocks()
  chartMock.mockResolvedValue(chart())
  quoteMock.mockResolvedValue({ __SYNTHETIC__: true, regularMarketPrice: 150, currency: 'USD' })
})

describe('fundamentals route — DCF refusal reaches the response', () => {
  it('an admitted company gets scenarios and bands', async () => {
    quoteSummaryMock.mockResolvedValue(summary('Technology', 'Software'))
    const body = await get('ACME')
    expect(body.dcf.notApplicable).toBeNull()
    expect(body.dcf.scenarios.base).not.toBeNull()
    expect(body.bands).not.toBeNull()
  })

  it('a bank gets no scenarios, no bands and no signal', async () => {
    quoteSummaryMock.mockResolvedValue(summary('Financial Services', 'Banks - Diversified'))
    const body = await get('BANK')
    expect(body.dcf.notApplicable).toMatch(/balance sheet is the product/)
    expect(body.dcf.scenarios).toEqual({ bear: null, base: null, bull: null })
    expect(body.bands).toBeNull()
    expect(body.signal).toBeNull()
  })

  it('a reporting currency different from the quote currency is refused (quote currency from quote())', async () => {
    quoteSummaryMock.mockResolvedValue(summary('Technology', 'Semiconductors', 'TWD'))
    const body = await get('ADR')
    expect(body.dcf.notApplicable).toMatch(/reported in TWD and the price is quoted in USD/)
    expect(body.bands).toBeNull()
  })

  it('re-gate N2: when quote() fails, the chart meta currency is the second source', async () => {
    quoteMock.mockRejectedValue(new Error('quote down'))
    chartMock.mockResolvedValue({ ...chart(), meta: { currency: 'USD' } })
    quoteSummaryMock.mockResolvedValue(summary('Technology', 'Semiconductors', 'TWD'))
    expect((await get('ADR')).dcf.notApplicable).toMatch(/reported in TWD and the price is quoted in USD/)
  })

  it('re-gate N2: with no quote currency from either source, a TWD reporter is refused, not valued', async () => {
    quoteMock.mockRejectedValue(new Error('quote down'))
    quoteSummaryMock.mockResolvedValue(summary('Technology', 'Semiconductors', 'TWD'))
    expect((await get('ADR')).dcf.notApplicable).toMatch(/currency is unavailable/)
  })
})
