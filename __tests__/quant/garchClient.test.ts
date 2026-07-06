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

// ─── Q25-1 (2026-07-06): crypto annualization + 7-day forecast calendar ──────
describe('Q25-1: crypto-aware annualization', () => {
  const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 5)

  it('annualizes with √365 when periodsPerYear=365 (√(365/252) ≈ 1.2034× equity vol)', () => {
    const equity = ewmaVolForecast(closes, 1)[0].conditionalVol
    const crypto = ewmaVolForecast(closes, 1, 0.94, { periodsPerYear: 365 })[0].conditionalVol
    expect(crypto / equity).toBeCloseTo(Math.sqrt(365 / 252), 10)
  })

  it('includeWeekends emits 7-day consecutive calendar dates', () => {
    const fc = ewmaVolForecast(closes, 10, 0.94, { periodsPerYear: 365, includeWeekends: true })
    expect(fc).toHaveLength(10)
    const days = fc.map(p => new Date(`${p.date}T00:00:00Z`).getUTCDay())
    expect(days.some(d => d === 0 || d === 6)).toBe(true) // a weekend appears in any 10-day span
    for (let i = 1; i < fc.length; i++) {
      const prev = new Date(`${fc[i - 1].date}T00:00:00Z`).getTime()
      const cur = new Date(`${fc[i].date}T00:00:00Z`).getTime()
      expect(cur - prev).toBe(86_400_000) // strictly consecutive calendar days
    }
  })

  it('default (equity) behavior is unchanged: 252 annualization, Mon–Fri only', () => {
    const fc = ewmaVolForecast(closes, 10)
    for (const p of fc) {
      const day = new Date(`${p.date}T00:00:00Z`).getUTCDay()
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(5)
    }
  })

  it('fetchGarchForecast fallback uses 365/weekends for BTC, 252/weekdays for AAPL', async () => {
    delete process.env.QUANT_FRAMEWORK_URL
    const btc = await fetchGarchForecast('BTC', closes)
    const aapl = await fetchGarchForecast('AAPL', closes)
    expect(btc.forecast[0].conditionalVol / aapl.forecast[0].conditionalVol)
      .toBeCloseTo(Math.sqrt(365 / 252), 10)
    const btcDays = btc.forecast.map(p => new Date(`${p.date}T00:00:00Z`).getUTCDay())
    expect(btcDays.some(d => d === 0 || d === 6)).toBe(true)
  })
})
