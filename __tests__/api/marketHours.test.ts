import { describe, it, expect } from 'vitest'
import { isMarketOpen, minutesUntilNextOpen } from '@/lib/api/marketHours'
import { readFileSync } from 'fs'
import { join } from 'path'

// All times below are constructed via UTC so the test passes on any runtime
// timezone (CI, local, Lambda, etc.) — the function under test must be
// timezone-independent.

describe('isMarketOpen', () => {
  it('open at NYSE midday on a weekday (June 2 2026 at 14:00 UTC = 10:00 ET DST)', () => {
    // June 2 2026 is a Tuesday; NY is in DST (UTC-4) so 14:00 UTC = 10:00 ET.
    const t = new Date('2026-06-02T14:00:00Z')
    expect(isMarketOpen(t)).toBe(true)
  })

  it('open at 13:30 UTC = 09:30 ET on DST weekday (boundary at open)', () => {
    const t = new Date('2026-06-02T13:30:00Z')
    expect(isMarketOpen(t)).toBe(true)
  })

  it('closed at 13:29 UTC = 09:29 ET on DST weekday (one minute pre-open)', () => {
    const t = new Date('2026-06-02T13:29:00Z')
    expect(isMarketOpen(t)).toBe(false)
  })

  it('closed at 20:00 UTC = 16:00 ET on DST weekday (boundary at close)', () => {
    const t = new Date('2026-06-02T20:00:00Z')
    expect(isMarketOpen(t)).toBe(false)
  })

  it('open at 19:59 UTC = 15:59 ET on DST weekday (one minute pre-close)', () => {
    const t = new Date('2026-06-02T19:59:00Z')
    expect(isMarketOpen(t)).toBe(true)
  })

  it('open at 14:30 UTC = 09:30 ET on EST weekday (Jan, no DST)', () => {
    // January 6 2026 is a Tuesday; NY is in EST (UTC-5) so 14:30 UTC = 09:30 ET.
    const t = new Date('2026-01-06T14:30:00Z')
    expect(isMarketOpen(t)).toBe(true)
  })

  it('closed Saturday', () => {
    const t = new Date('2026-06-06T14:00:00Z')  // Saturday in NY
    expect(isMarketOpen(t)).toBe(false)
  })

  it('closed Sunday', () => {
    const t = new Date('2026-06-07T14:00:00Z')  // Sunday in NY
    expect(isMarketOpen(t)).toBe(false)
  })
})

describe('minutesUntilNextOpen', () => {
  it('returns 0 when currently open', () => {
    const t = new Date('2026-06-02T14:00:00Z')
    expect(minutesUntilNextOpen(t)).toBe(0)
  })

  it('returns positive count when before open', () => {
    const t = new Date('2026-06-02T12:00:00Z')  // 08:00 ET, before 09:30
    const m = minutesUntilNextOpen(t)
    expect(m).toBeGreaterThan(0)
    expect(m).toBeLessThan(2 * 60)  // < 2 hours
  })

  it('returns positive count over weekend', () => {
    const t = new Date('2026-06-06T14:00:00Z')  // Saturday
    const m = minutesUntilNextOpen(t)
    expect(m).toBeGreaterThan(0)
    expect(m).toBeLessThan(3 * 24 * 60)  // < 3 days to next Mon open
  })
})

/**
 * Q-101 — the stream contract carries the vendor's stamp.
 *
 * A source-level assertion because the alternative is standing up an SSE
 * server; the property is that neither route may pair a price with our own
 * clock as its age.
 */
describe('SSE quote events carry the vendor stamp, not the emit time', () => {
  const read = (p: string) =>
    readFileSync(join(__dirname, '../..', p), 'utf8')

  it.each(['app/api/stream/[ticker]/route.ts', 'app/api/stream/route.ts'])(
    '%s derives quoteTime from regularMarketTime',
    (path) => {
      const src = read(path)
      expect(src).toMatch(/quoteTime:\s*parseQuoteTime\(\s*(q|row)\.regularMarketTime\s*\)/)
    },
  )

  it.each([
    'app/stock/[ticker]/page.tsx',
    'app/sector/[slug]/page.tsx',
  ])('%s reads the vendor stamp, never the emit time', (path) => {
    const src = read(path)
    expect(src).toMatch(/quoteTime:\s*live\.quote!\.quoteTime/)
    expect(src).not.toMatch(/quoteTime:\s*live\.quote!\.timestamp/)
  })

  it('app/page.tsx reads the vendor stamp too', () => {
    const src = read('app/page.tsx')
    expect(src).toMatch(/quoteTime:\s*q\.quoteTime/)
    expect(src).not.toMatch(/quoteTime:\s*q\.timestamp/)
  })
})
