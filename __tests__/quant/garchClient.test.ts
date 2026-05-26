/**
 * lib/quant/garchClient.ts tests (Q-051-NEW + CI branch-coverage backfill).
 *
 * Covers: ewmaVolForecast happy + min-bar guard; fetchGarchForecast sidecar
 * happy + sidecar HTTP fail + fallback when QUANT_FRAMEWORK_URL absent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ewmaVolForecast, fetchGarchForecast } from '@/lib/quant/garchClient'

describe('ewmaVolForecast', () => {
  it('returns empty array when closes < 30', () => {
    expect(ewmaVolForecast([100, 101, 102])).toEqual([])
  })

  it('returns horizon entries with positive annualized vol on 100-bar series', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 5)
    const fc = ewmaVolForecast(closes, 20)
    expect(fc).toHaveLength(20)
    for (const point of fc) {
      expect(point.conditionalVol).toBeGreaterThan(0)
      // YYYY-MM-DD shape
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('respects custom horizon parameter', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 * Math.exp(0.001 * i))
    expect(ewmaVolForecast(closes, 5)).toHaveLength(5)
    expect(ewmaVolForecast(closes, 1)).toHaveLength(1)
  })

  it('larger lambda → smoother variance estimate (sanity)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + (i % 5) * 0.5)
    const low = ewmaVolForecast(closes, 1, 0.5)[0].conditionalVol
    const high = ewmaVolForecast(closes, 1, 0.99)[0].conditionalVol
    expect(low).toBeGreaterThan(0)
    expect(high).toBeGreaterThan(0)
  })
})

describe('fetchGarchForecast', () => {
  let savedEnv: string | undefined
  let savedFetch: typeof globalThis.fetch

  beforeEach(() => {
    savedEnv = process.env.QUANT_FRAMEWORK_URL
    savedFetch = globalThis.fetch
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.QUANT_FRAMEWORK_URL
    else process.env.QUANT_FRAMEWORK_URL = savedEnv
    globalThis.fetch = savedFetch
  })

  it('returns ewma-fallback when sidecar URL is unset', async () => {
    delete process.env.QUANT_FRAMEWORK_URL
    const closes = Array.from({ length: 50 }, () => 100)
    const result = await fetchGarchForecast('AAPL', closes)
    expect(result.source).toBe('ewma-fallback')
    expect(result.ticker).toBe('AAPL')
    expect(result.model).toBe('GARCH(1,1)')
  })

  it('returns sidecar response when QUANT_FRAMEWORK_URL is set + OK', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        ticker: 'AAPL',
        model: 'GARCH(1,1)',
        forecast: [{ date: '2026-05-25', conditionalVol: 0.2 }],
        source: 'python',
      }), { status: 200 })
    ) as unknown as typeof fetch
    const result = await fetchGarchForecast('AAPL', [])
    expect(result.source).toBe('python')
    expect(result.forecast[0]).toEqual({ date: '2026-05-25', conditionalVol: 0.2 })
  })

  it('falls back to EWMA when sidecar returns non-OK', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const closes = Array.from({ length: 50 }, () => 100)
    const result = await fetchGarchForecast('AAPL', closes)
    expect(result.source).toBe('ewma-fallback')
  })

  it('falls back to EWMA when sidecar fetch throws', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () => { throw new Error('network') }) as unknown as typeof fetch
    const closes = Array.from({ length: 50 }, () => 100)
    const result = await fetchGarchForecast('AAPL', closes)
    expect(result.source).toBe('ewma-fallback')
  })
})
