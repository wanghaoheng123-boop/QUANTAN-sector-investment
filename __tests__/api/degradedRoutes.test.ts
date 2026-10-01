/**
 * Q-140 — the specific promises behind the fail-closed detector
 * (__tests__/architecture/fail-closed-routes.test.ts), which only checks that
 * SOME failure signal is present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { chartMock, quoteMock, summaryMock } = vi.hoisted(() => ({
  chartMock: vi.fn(),
  quoteMock: vi.fn(),
  summaryMock: vi.fn(),
}))

vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    chart = chartMock
    quote = quoteMock
    quoteSummary = summaryMock
  },
}))
vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(async () => null) }))
vi.mock('@/lib/api/reliability', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/reliability')>()),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

const req = (url: string) => new NextRequest(new URL(url, 'http://localhost:3000'))

/** 300 synthetic daily closes, enough for the 200-day SMA and its slope. */
function __SYNTHETIC__chart() {
  const quotes = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)), close: 100 + i * 0.1, open: 100, high: 101, low: 99, volume: 1e6 }))
  return { quotes }
}

beforeEach(() => {
  vi.resetModules()
  chartMock.mockReset(); quoteMock.mockReset(); summaryMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('/api/ma-deviation — a degraded board is not cached', () => {
  it('a failed board is followed by a fresh one, not served again from the module cache', async () => {
    const { GET } = await import('@/app/api/ma-deviation/route')
    chartMock.mockRejectedValue(new Error('yahoo down'))
    const first = await (await GET(req('/api/ma-deviation'))).json()
    expect(first.degraded).toBe(true)
    expect(first.error.message).toMatch(/Price data failed for \d+ of \d+ sectors/)

    chartMock.mockResolvedValue(__SYNTHETIC__chart())
    const second = await (await GET(req('/api/ma-deviation'))).json()
    expect(second.degraded).toBeUndefined()
    expect(second._cached).toBe(false)
    expect(second.rows.some((r: { price: number | null }) => r.price != null)).toBe(true)
  })

  it('a degraded board is not cacheable at the CDN', async () => {
    const { GET } = await import('@/app/api/ma-deviation/route')
    chartMock.mockRejectedValue(new Error('yahoo down'))
    const res = await GET(req('/api/ma-deviation'))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('/api/darkpool — a fetch failure is not explained as a coverage gap', () => {
  it('both calls fail: the note says the feed failed, the quote is null', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockRejectedValue(new Error('yahoo down'))
    summaryMock.mockRejectedValue(new Error('yahoo down'))
    const body = await (await GET(req('/api/darkpool/SPY'), { params: Promise.resolve({ ticker: 'SPY' }) })).json()
    expect(body.degraded).toBe(true)
    expect(body.statusNote).toBe('The market-data feed failed for this ticker; try again shortly.')
    expect(body.statusNote).not.toMatch(/security type|ETF, ADR, or OTC/)
    expect(body.quote).toEqual({ price: null, change: null, changePct: null, quoteTime: null })
  })

  it('genuinely no data (calls succeed, nothing reported) keeps the coverage note and is not degraded', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockResolvedValue({ regularMarketPrice: 500, regularMarketChange: 1, regularMarketChangePercent: 0.2 })
    summaryMock.mockResolvedValue({})
    const body = await (await GET(req('/api/darkpool/SPY'), { params: Promise.resolve({ ticker: 'SPY' }) })).json()
    expect(body.degraded).toBeUndefined()
    expect(body.quote.price).toBe(500)
    expect(body.statusNote).toMatch(/not available for this security type/)
  })
})

describe('/api/sector-rotation — a partial ranking says it is partial', () => {
  it('one sector fetch failing marks the ranking degraded and uncacheable', async () => {
    const { GET } = await import('@/app/api/sector-rotation/route')
    let n = 0
    chartMock.mockImplementation(async () => { n += 1; if (n === 1) throw new Error('yahoo down'); return __SYNTHETIC__chart() })
    const res = await GET(req('/api/sector-rotation'))
    const body = await res.json()
    expect(body.degraded).toBe(true)
    expect(body.error.message).toMatch(/Price data failed for 1 of 11 sectors; ranks are among the remaining sectors only/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
