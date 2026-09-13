import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseLiveQuote } from '@/hooks/useLiveQuote'

describe('parseLiveQuote (Q-049)', () => {
  it('parses quote payload', () => {
    const q = parseLiveQuote({
      ticker: 'AAPL',
      price: 100,
      change: 1,
      changePct: 1,
      marketOpen: true,
      timestamp: new Date().toISOString(),
    })
    expect(q?.price).toBe(100)
  })

  it('returns null for invalid payload', () => {
    expect(parseLiveQuote(null)).toBeNull()
  })
})

/**
 * Q-101 (2026-09-13) — the SSE quote's age was OUR clock, not the vendor's.
 *
 * `app/api/stream/[ticker]/route.ts:71` emitted `timestamp: new Date()` and
 * three pages wrote it straight into their `quoteTime` state, where it was
 * rendered as the quote's age. Observed on a Sunday at /stock/AAPL: Friday's
 * closing price, 42 hours old, labelled **"live"**, next to the page's own
 * CLOSED badge. 2124 tests were green on it.
 *
 * The vendor's `regularMarketTime` was on the same yahoo-finance2 object the
 * whole time. These lock the distinction.
 */
describe('parseLiveQuote — the vendor stamp is not our emit time', () => {
  const base = {
    ticker: 'AAPL',
    price: 332.27,
    change: 5.7,
    changePct: 1.75,
    marketOpen: false,
    timestamp: '2026-09-13T14:32:53.821Z', // when WE emitted: Sunday
  }

  it('keeps the vendor stamp separate from the emit time', () => {
    const q = parseLiveQuote({ ...base, quoteTime: '2026-09-11T20:00:00.000Z' })
    expect(q).not.toBeNull()
    expect(q!.quoteTime).toBe('2026-09-11T20:00:00.000Z') // Friday 16:00 ET
    expect(q!.timestamp).toBe(base.timestamp)
    expect(q!.quoteTime).not.toBe(q!.timestamp)
  })

  it.each([undefined, null, '', 0, {}, []])(
    'a missing or malformed vendor stamp becomes null, NOT the emit time (%s)',
    (bad) => {
      // The regression in one assertion. Borrowing `timestamp` here is what made
      // a 42-hour-old price read "live", so the fallback must be unknown.
      const q = parseLiveQuote({ ...base, quoteTime: bad })
      expect(q).not.toBeNull()
      expect(q!.quoteTime).toBeNull()
      expect(q!.quoteTime).not.toBe(base.timestamp)
    },
  )

  it('still rejects a quote with no emit timestamp at all', () => {
    // The pre-existing contract is unchanged: `timestamp` remains required.
    expect(parseLiveQuote({ ...base, timestamp: undefined, quoteTime: '2026-09-11T20:00:00.000Z' }))
      .toBeNull()
  })
})

/**
 * Q-101 — the SWR price hook must not substitute our clock either.
 *
 * Source-level, because the derivation lives inside a `useMemo` and the
 * property is an ABSENCE: that no path assigns the response's own completion
 * time to the value rendered as the quote's age. The SSE half of this defect
 * shipped for months; this is the same substitution in the other feed.
 */
describe('useLivePrices does not fall back to our fetch-completion time', () => {
  const src = readFileSync(join(__dirname, '../../hooks/useLivePrices.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('the quoteTime memo is present at all', () => {
    // Reachability: if this file stopped deriving quoteTime the assertion below
    // would pass vacuously.
    expect(code).toMatch(/const quoteTime = useMemo/)
  })

  it('never assigns the response timestamp into the rendered age', () => {
    expect(code).not.toMatch(/max\s*=\s*t\b[\s\S]{0,40}data\?\.timestamp/)
    expect(code).not.toMatch(/data\?\.timestamp[\s\S]{0,120}max\s*=/)
  })

  it('the matcher would catch the substitution if it came back', () => {
    // Negative control — the assertion above is worthless if the pattern cannot
    // match the thing it forbids.
    const reintroduced = `if (max === 0 && swr.data?.timestamp) {\n const t = Date.parse(swr.data.timestamp)\n if (Number.isFinite(t)) max = t\n }`
    expect(/data\?\.timestamp[\s\S]{0,120}max\s*=/.test(reintroduced)).toBe(true)
  })
})
