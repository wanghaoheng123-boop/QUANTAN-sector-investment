import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { chartMock } = vi.hoisted(() => ({
  chartMock: vi.fn(),
}))

vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    chart = chartMock
  },
}))

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}))

import { GET } from '@/app/api/sector-rotation/route'

function request() {
  return new NextRequest(new URL('http://localhost:3000/api/sector-rotation'))
}

describe('GET /api/sector-rotation', () => {
  beforeEach(() => {
    chartMock.mockReset()
  })

  it('returns sector scores when chart data is sufficient', async () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1)
    chartMock.mockResolvedValue({
      quotes: closes.map((close, i) => ({
        date: new Date(Date.UTC(2024, 0, i + 1)),
        close,
      })),
    })

    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.scores)).toBe(true)
    expect(body.scores.length).toBeGreaterThan(0)
    expect(body.scores[0]).toMatchObject({
      sector: expect.any(String),
      etf: expect.any(String),
      composite: expect.any(Number),
      signal: expect.stringMatching(/OVERWEIGHT|NEUTRAL|UNDERWEIGHT/),
    })
  })

  it('surfaces excluded sectors when Yahoo chart fails (partial degrade)', async () => {
    chartMock.mockRejectedValue(new Error('upstream failure'))
    const res = await GET(request())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scores).toEqual([])
    expect(body.excludedSectors.length).toBeGreaterThan(0)
    expect(body.excludedSectors[0].reason).toBe('fetch_failed')
  })
})
