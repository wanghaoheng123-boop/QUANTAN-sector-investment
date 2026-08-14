/**
 * AL-4a (2026-08-15) — /api/ma-deviation must fetch enough history for the
 * 200-SMA *slope*, not just the SMA.
 *
 * The route sized its fetch window to the SMA (200 bars) and shipped a comment
 * saying so: `- 310` calendar days "→ ~220 trading days". Measured against real
 * trading dates a 310-day window is ~214 bars, and `sma200Slope` needs ≥ 221
 * (lib/quant/indicators.ts:71-77). So `slopePct` / `slopePositive` came back
 * null for all 13 tickers on every request, permanently, and `ma200Regime` ran
 * its unknown-slope arm on the whole board.
 *
 * The route's only length guard is `quotes.length < 10`, so nothing else would
 * ever have surfaced this. These tests assert the window at the boundary that
 * actually matters — the bar count the indicator needs — rather than restating
 * the magic number, and they read it off the Date the route really passes to
 * Yahoo rather than off the source text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { sma200Slope } from '@/lib/quant/indicators'

interface ChartOptions {
  period1: Date
  interval: string
}

const { chartMock } = vi.hoisted(() => ({
  // Typed args (not a bare `async () => …`) so the recorded call tuple keeps
  // its shape and `period1` can be read back without an unknown-cast.
  chartMock: vi.fn(async (_ticker: string, _options: { period1: Date; interval: string }) => ({
    quotes: [] as unknown[],
  })),
}))
vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    chart = chartMock
  },
}))

import { GET as maDeviationGET } from '@/app/api/ma-deviation/route'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The bar count `sma200Slope` needs, discovered empirically rather than copied.
 * If the indicator's warmup ever changes, this test moves with it instead of
 * silently pinning a stale constant.
 */
function minBarsForSlope(): number {
  for (let n = 200; n <= 400; n++) {
    const rising = Array.from({ length: n }, (_, i) => 100 + i * 0.5)
    if (sma200Slope(rising) != null) return n
  }
  throw new Error('sma200Slope never became computable below 400 bars')
}

/** Weekdays in [from, to) — the ceiling on how many sessions a window can hold. */
function weekdaysBetween(from: Date, to: Date): number {
  let count = 0
  const cursor = new Date(from.getTime())
  while (cursor < to) {
    const dow = cursor.getUTCDay()
    if (dow !== 0 && dow !== 6) count++
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}

/**
 * Full-day US market closures run 9–10 a year. Budget 12 per 365 days (rounded
 * up, scaled to the window) so the estimate stays conservative — this is a
 * floor on available bars, and it should under-count rather than over-count.
 */
function holidayBudget(calendarDays: number): number {
  return Math.ceil((calendarDays / 365) * 12)
}

function estimatedTradingBars(calendarDays: number): number {
  const to = new Date(Date.UTC(2026, 7, 15))
  const from = new Date(to.getTime() - calendarDays * DAY_MS)
  return weekdaysBetween(from, to) - holidayBudget(calendarDays)
}

describe('/api/ma-deviation fetch window (AL-4a)', () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.clearAllMocks()
  })

  it('requests a window long enough for sma200Slope to be computable', async () => {
    const before = Date.now()
    await maDeviationGET(
      new NextRequest('http://localhost/api/ma-deviation', {
        headers: { 'x-real-ip': '10.44.0.1' },
      }),
    )

    expect(chartMock).toHaveBeenCalled()
    const opts: ChartOptions | undefined = chartMock.mock.calls[0]?.[1]
    expect(opts).toBeDefined()
    expect(opts!.interval).toBe('1d')
    expect(opts!.period1).toBeInstanceOf(Date)

    const calendarDays = Math.round((before - opts!.period1.getTime()) / DAY_MS)

    // The coordinator's floor for this fix.
    expect(calendarDays).toBeGreaterThanOrEqual(360)

    // The floor that actually matters: even after docking a conservative
    // holiday budget, the window must clear the indicator's warmup with room
    // to spare rather than landing on the boundary.
    const bars = estimatedTradingBars(calendarDays)
    const required = minBarsForSlope()
    expect(required).toBe(221)
    expect(bars).toBeGreaterThanOrEqual(required + 20)
  })

  it('the old 310-day window did NOT clear that floor (the regression this pins)', () => {
    // Without this the test above passes for the wrong reason — a floor no
    // plausible window could fail is not a gate.
    expect(estimatedTradingBars(310)).toBeLessThan(minBarsForSlope())
  })
})
