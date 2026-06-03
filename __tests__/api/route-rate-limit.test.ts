import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock yahoo-finance2 (constructor-style usage in both routes) so no real
// network calls happen. vi.hoisted keeps the mock fns available inside the
// hoisted vi.mock factory (avoids the TDZ "cannot access before init" error).
const { chartMock, quoteMock, quoteSummaryMock } = vi.hoisted(() => ({
  chartMock: vi.fn(async () => ({ quotes: [] })),
  quoteMock: vi.fn(async () => ({})),
  quoteSummaryMock: vi.fn(async () => ({})),
}))
vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    chart = chartMock
    quote = quoteMock
    quoteSummary = quoteSummaryMock
  },
}))

import { GET as analyticsGET } from '@/app/api/analytics/[ticker]/route'
import { GET as fundamentalsGET } from '@/app/api/fundamentals/[ticker]/route'

const PARAMS = { params: Promise.resolve({ ticker: 'AAPL' }) }
const LIMIT = 30

// Distinct IP per case keeps the per-process token buckets isolated.
function req(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/x/AAPL', {
    headers: { 'x-real-ip': ip },
  })
}

describe('rate limiting on Yahoo-fanout routes (D4-3)', () => {
  beforeEach(() => {
    // Force the in-process limiter (no KV).
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.clearAllMocks()
  })

  it('analytics: allows up to the limit then returns 429', async () => {
    const r = req('10.1.0.1')
    for (let i = 0; i < LIMIT; i++) {
      const res = await analyticsGET(r, PARAMS)
      expect(res.status).not.toBe(429)
    }
    const blocked = await analyticsGET(r, PARAMS)
    expect(blocked.status).toBe(429)
  })

  it('fundamentals: allows up to the limit then returns 429', async () => {
    const r = req('10.1.0.2')
    for (let i = 0; i < LIMIT; i++) {
      const res = await fundamentalsGET(r, PARAMS)
      expect(res.status).not.toBe(429)
    }
    const blocked = await fundamentalsGET(r, PARAMS)
    expect(blocked.status).toBe(429)
  })

  it('analytics and fundamentals use separate buckets (same IP)', async () => {
    const r = req('10.1.0.3')
    for (let i = 0; i < LIMIT; i++) await analyticsGET(r, PARAMS)
    expect((await analyticsGET(r, PARAMS)).status).toBe(429)
    // Fundamentals from the same IP is still fresh (distinct bucket name).
    expect((await fundamentalsGET(r, PARAMS)).status).not.toBe(429)
  })
})
