/**
 * Q-140 — the specific promises behind the fail-closed detector
 * (__tests__/architecture/fail-closed-routes.test.ts), which only checks that
 * SOME failure signal is present.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_QUOTE_NOTE, NO_SHORT_INTEREST_NOTE } from '@/lib/darkpool'
import { DEGRADED_CACHE_CONTROL } from '@/lib/api/reliability'
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
    expect(first.error.message).toMatch(/Price data failed for \d+ of \d+ instruments/)

    chartMock.mockResolvedValue(__SYNTHETIC__chart())
    const second = await (await GET(req('/api/ma-deviation'))).json()
    expect(second.degraded).toBeUndefined()
    expect(second._cached).toBe(false)
    expect(second.rows.some((r: { price: number | null }) => r.price != null)).toBe(true)
  })

  it('a degraded board is held at the CDN for 30 s only, not the healthy 5 minutes', async () => {
    const { GET } = await import('@/app/api/ma-deviation/route')
    chartMock.mockRejectedValue(new Error('yahoo down'))
    const res = await GET(req('/api/ma-deviation'))
    // Red-team M4: no-store removed all damping while Yahoo is throttling.
    expect(res.headers.get('cache-control')).toBe(DEGRADED_CACHE_CONTROL)
    expect((await res.json()).error.message).toMatch(/of 13 instruments/)
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
    // Red-team L9: the old note guessed "ETF, ADR, or OTC" for every all-letter
    // ticker (AAPL included) and this test pinned the guess. It now says what
    // was observed and nothing about the security type.
    expect(body.statusNote).toBe(NO_SHORT_INTEREST_NOTE)
  })

  // Q-149: a 10-day volume comes from the QUOTE, which every ETF has, so it
  // made all 11 sector ETFs report data they did not have. Q149-D1: the ETF
  // quote DOES carry a share count (9 of 11 sector ETFs), which the route now
  // shows — the fixture carries it, so the note cannot claim there is none.
  it('an ETF: shares outstanding from the quote, no short interest, no float drift logged', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    quoteMock.mockResolvedValue({ quoteType: 'ETF', regularMarketPrice: 300, regularMarketChange: 1, averageDailyVolume10Day: 6_000_000, sharesOutstanding: 300_000_000 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {} })
    const body = await (await GET(req('/api/darkpool/XLK'), { params: Promise.resolve({ ticker: 'XLK' }) })).json()
    expect(body).not.toHaveProperty('hasRealData')
    expect(body.metrics).toMatchObject({ avgDailyVolume: 6_000_000, sharesOutstanding: 300_000_000, sharesShorted: null, shortFloatPct: null })
    expect(body.statusNote).toBe(NO_SHORT_INTEREST_NOTE)
    expect(body.statusNote).not.toMatch(/share-count/)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // Q-149: Yahoo's shortPercentOfFloat is a fraction; the panel printed it as a
  // percent, 100x too small. Invented figures throughout (I8).
  it('an equity reads the declared fields, in percent units, with the settlement date', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY', regularMarketPrice: 25, regularMarketChange: 1, averageDailyVolume10Day: 9_000_000 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {
      sharesOutstanding: 450_000_000, floatShares: 400_000_000, sharesShort: 60_000_000, // 60M / 400M = 0.15
      shortPercentOfFloat: 0.15, shortRatio: 6.5, dateShortInterest: new Date('2026-09-30T00:00:00Z'),
    } })
    const body = await (await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })).json()
    expect(body.statusNote).toBeNull()
    expect(body.metrics).toMatchObject({
      sharesShorted: 60_000_000, shortFloatPct: 15, shortInterestAsOf: '2026-09-30', daysToCover: 6.5,
      avgDailyVolume: 9_000_000, sharesOutstanding: 450_000_000, sharesFloat: 400_000_000, floatWithheld: null,
    })
    expect(typeof body.metrics.shortInterestAgeDays).toBe('number')
    expect(summaryMock).toHaveBeenCalledWith('ABCD', { modules: ['defaultKeyStatistics'] })
  })

  // Red-team Q145-R5: a decimal-form percent was rendered 100x too small.
  it('normalises a decimal-form change percent like every other quote producer', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY', regularMarketPrice: 101.6, regularMarketChange: 1.6, regularMarketChangePercent: 0.016 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {} })
    const body = await (await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })).json()
    expect(body.quote.changePct).toBeCloseTo(1.6, 10)
  })

  it('a quote with neither change field has a null percent, not 0; with only a change, the percent is implied', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockResolvedValue({ quoteType: 'ETF', regularMarketPrice: 300 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {} })
    const body = await (await GET(req('/api/darkpool/XLK'), { params: Promise.resolve({ ticker: 'XLK' }) })).json()
    expect(body.quote).toMatchObject({ price: 300, change: null, changePct: null })
    quoteMock.mockResolvedValue({ quoteType: 'ETF', regularMarketPrice: 300, regularMarketChange: 3 })
    const implied = await (await GET(req('/api/darkpool/XLK'), { params: Promise.resolve({ ticker: 'XLK' }) })).json()
    expect(implied.quote.changePct).not.toBeNull() // Q149-D10 M12: the middle case is pinned
  })

  it('an equity with NO float field is logged as schema drift', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY', regularMarketPrice: 25, regularMarketChange: 1 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: { sharesOutstanding: 450_000_000 } })
    await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('darkpool.shares_float_missing')
    warn.mockRestore()
  })

  // Q149-D3: a float the builder WITHHELD is not drift; the response says why instead.
  it('a withheld float, an index, or a missing price logs no drift', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY', regularMarketPrice: 25, regularMarketChange: 1 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: { sharesOutstanding: 1e9, floatShares: 2.5e9 } })
    const withheld = await (await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })).json()
    expect(withheld.metrics).toMatchObject({ sharesFloat: null, floatWithheld: 'exceeds-shares-out' })
    quoteMock.mockResolvedValue({ quoteType: 'INDEX', regularMarketPrice: 5000, regularMarketChange: 1 })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {} })
    await GET(req('/api/darkpool/^GSPC'), { params: Promise.resolve({ ticker: '^GSPC' }) })
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY' })
    summaryMock.mockResolvedValue({ defaultKeyStatistics: {} })
    await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // Q149-D10 (M14/M15): the two partial-failure notes are pinned, so the old
  // "off-exchange statistics" wording cannot come back green.
  it('one of the two calls fails: each note names what failed', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockRejectedValue(new Error('yahoo down'))
    summaryMock.mockResolvedValue({ defaultKeyStatistics: { sharesShort: 1e6 } })
    const noQuote = await (await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })).json()
    expect(noQuote).toMatchObject({ degraded: true, statusNote: 'The price quote failed to load; the short-interest figures below are shown without it.' })
    quoteMock.mockResolvedValue({ quoteType: 'EQUITY', regularMarketPrice: 25 })
    summaryMock.mockRejectedValue(new Error('yahoo down'))
    const noStats = await (await GET(req('/api/darkpool/ABCD'), { params: Promise.resolve({ ticker: 'ABCD' }) })).json()
    expect(noStats).toMatchObject({ degraded: true, statusNote: 'The short-interest figures failed to load; try again shortly.' })
  })

  // Q149-D4: quote() RESOLVES to undefined for a symbol Yahoo does not know.
  // The route dereferenced it, threw, and answered 502 "failed".
  it('a ticker Yahoo has no quote for is "no quote", 200, not a 502 outage', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    quoteMock.mockResolvedValue(undefined)
    summaryMock.mockRejectedValue(new Error('Quote not found'))
    const res = await GET(req('/api/darkpool/ZZZZZZ'), { params: Promise.resolve({ ticker: 'ZZZZZZ' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.statusNote).toBe(NO_QUOTE_NOTE)
    expect(body.degraded).toBeUndefined()
    expect(body.quote).toEqual({ price: null, change: null, changePct: null, quoteTime: null })
  })

  // Q149-D5: Yahoo has no key statistics for a crypto pair or a currency and
  // rejects the request — a permanent absence, not "try again shortly".
  it('a crypto pair or currency without key statistics is not an outage', async () => {
    const { GET } = await import('@/app/api/darkpool/[ticker]/route')
    for (const quoteType of ['CRYPTOCURRENCY', 'CURRENCY']) {
      quoteMock.mockResolvedValue({ quoteType, regularMarketPrice: 60_000, regularMarketChange: 100 })
      summaryMock.mockRejectedValue(new Error('No fundamentals data found'))
      const body = await (await GET(req('/api/darkpool/BTC-USD'), { params: Promise.resolve({ ticker: 'BTC-USD' }) })).json()
      expect(body.degraded, quoteType).toBeUndefined()
      expect(body.statusNote, quoteType).toBe(NO_SHORT_INTEREST_NOTE)
    }
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
    expect(res.headers.get('cache-control')).toBe(DEGRADED_CACHE_CONTROL)
  })
})

// Red-team M1: a Yahoo search answer with no `news` array is schema drift —
// /api/news/ticker already answers it as a failure; these two read it as a
// quiet news day.
describe('a search payload with no news array is a failure, not "no news"', () => {
  const searchMock = vi.fn(async () => ({ quotes: [] }))
  beforeEach(() => {
    vi.doMock('yahoo-finance2', () => ({ default: class { search = searchMock } }))
  })
  afterEach(() => { vi.doUnmock('yahoo-finance2') })

  it('/api/news/[sector]', async () => {
    const { GET } = await import('@/app/api/news/[sector]/route')
    const res = await GET(req('/api/news/technology'), { params: Promise.resolve({ sector: 'technology' }) })
    const body = await res.json()
    expect(body.degraded).toBe(true)
    expect(body.error.message).toMatch(/no headlines could be loaded/)
  })

  it('/api/briefs', async () => {
    const { GET } = await import('@/app/api/briefs/route')
    const res = await GET(req('/api/briefs'))
    const body = await res.json()
    expect(body.degraded).toBe(true)
    expect(body.error.message).toMatch(/no headlines could be loaded/)
  })
})
