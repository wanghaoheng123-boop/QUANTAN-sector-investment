import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OhlcvRow } from '@/lib/backtest/core'
import { markSynthetic, unwrapSynthetic } from '@/lib/synthetic'

const data = vi.hoisted(() => ({ rows: [] as OhlcvRow[], loads: vi.fn() }))
vi.mock('@/lib/sectors', () => ({ SECTORS: [{ name: 'Technology', topHoldings: ['AAPL'] }] }))
vi.mock('@/lib/backtest/dataLoader', () => ({
  availableTickers: () => ['AAPL'],
  loadStockHistory: () => { data.loads(); return data.rows },
  loadBtcHistory: () => [],
}))
vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: () => null }))
vi.mock('@/lib/api/csrf', () => ({ validateCsrf: () => true }))

beforeEach(() => {
  vi.resetModules() // Discard the route's cache and in-flight promise per test.
  data.loads.mockClear()
  data.rows = unwrapSynthetic(markSynthetic(Array.from({ length: 252 }, (_, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: 100, high: 100, low: 100, close: 100, volume: 1000,
  }))), 'Q122 API regression fixture only')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

const request = () => new Request('http://localhost/api/backtest')

describe('Q122 — a failed run cannot become cached success', () => {
  it('rejects the entire GET run, then recomputes successfully after repair', async () => {
    const { GET } = await import('@/app/api/backtest/route')
    data.rows[251].close = 0
    const failed = await GET(request())
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ error: 'Backtest failed' })

    data.rows[251].close = 100
    const repaired = await GET(request())
    const body = await repaired.json()
    expect(repaired.status).toBe(200)
    expect(body._cached).toBe(false)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].finalPrice).toBe(100)
    expect(data.loads).toHaveBeenCalledTimes(2)

    const cached = await GET(request())
    expect((await cached.json())._cached).toBe(true)
    expect(data.loads).toHaveBeenCalledTimes(2)
  })

  it('failed POST recompute clears the old cache without publishing broken results', async () => {
    const { GET, POST } = await import('@/app/api/backtest/route')
    expect((await GET(request())).status).toBe(200)
    data.rows[251].close = NaN
    const failed = await POST(request())
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ error: 'Recompute failed' })
    expect((await GET(request())).status).toBe(500)

    data.rows[251].close = 100
    const recovered = await GET(request())
    expect(recovered.status).toBe(200)
    expect((await recovered.json())._cached).toBe(false)
  })
})
