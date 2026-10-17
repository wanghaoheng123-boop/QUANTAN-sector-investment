/**
 * Q-145 — a missing change is missing, never a measured 0.
 *
 * Red-team S4 (2026-10-17): parseLiveQuote({changePct: null}) became 0, then
 * FLAT, and a live tick with no change overwrote a real REST change. These pin
 * each link: the normaliser, the client parser, the tick merge, the session
 * move, and what a card renders.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'
import { parseLiveQuote } from '@/hooks/useLiveQuote'
import { resolveTickChange } from '@/lib/quoteChange'
import { sessionMoveFor } from '@/lib/sessionMoves'
import SectorCard from '@/components/SectorCard'
import { SECTORS } from '@/lib/sectors'

const MON_10AM = '2026-10-19T14:00:00.000Z' // 10:00 New York
const MON_2PM = '2026-10-19T18:00:00.000Z'
const TUE_10AM = '2026-10-20T14:00:00.000Z'

describe('producers say null', () => {
  it('normalizedChangePercent: neither a percent nor a change → null', () => {
    expect(normalizedChangePercent(undefined, undefined, 250)).toBeNull()
    expect(normalizedChangePercent(null, null, null)).toBeNull()
    expect(normalizedChangePercent(1.2, undefined, undefined)).toBe(1.2)
  })

  it('parseLiveQuote keeps a missing change null', () => {
    const q = parseLiveQuote({ ticker: 'XLK', price: 250, timestamp: MON_10AM, change: null, changePct: null })
    expect(q).toMatchObject({ change: null, changePct: null })
    expect(parseLiveQuote({ ticker: 'XLK', price: 250, timestamp: MON_10AM, change: Number.NaN, changePct: 'x' })).toMatchObject({ change: null, changePct: null })
  })
})

describe('resolveTickChange', () => {
  it('uses the tick change when it has one', () => {
    expect(resolveTickChange(null, { price: 101, change: 1, changePct: 1, quoteTime: MON_10AM })).toEqual({ change: 1, changePct: 1 })
  })

  it('fills the missing half from the tick price', () => {
    const r = resolveTickChange(null, { price: 101, change: 1, changePct: null, quoteTime: MON_10AM })
    expect(r.change).toBe(1)
    expect(r.changePct).toBeCloseTo(1, 12)
    const r2 = resolveTickChange(null, { price: 101, change: null, changePct: 1, quoteTime: MON_10AM })
    expect(r2.change).toBeCloseTo(1, 12)
  })

  it('derives a missing change from the prior close within the same New York session', () => {
    const prev = { price: 102, change: 2, changePct: 2, quoteTime: MON_10AM } // prior close 100
    const r = resolveTickChange(prev, { price: 105, change: null, changePct: null, quoteTime: MON_2PM })
    expect(r.change).toBeCloseTo(5, 12)
    expect(r.changePct).toBeCloseTo(5, 12)
  })

  it('does NOT carry the old change across a session, or without vendor stamps', () => {
    const prev = { price: 102, change: 2, changePct: 2, quoteTime: MON_10AM }
    expect(resolveTickChange(prev, { price: 105, change: null, changePct: null, quoteTime: TUE_10AM })).toEqual({ change: null, changePct: null })
    expect(resolveTickChange({ ...prev, quoteTime: null }, { price: 105, change: null, changePct: null, quoteTime: MON_2PM })).toEqual({ change: null, changePct: null })
    expect(resolveTickChange(null, { price: 105, change: null, changePct: null, quoteTime: MON_2PM })).toEqual({ change: null, changePct: null })
  })
})

describe('consumers show it as missing', () => {
  it('a sector with no change has no session move (not a measured FLAT)', () => {
    expect(sessionMoveFor('XLK', { price: 250, changePct: null })).toBeNull()
    expect(sessionMoveFor('XLK', { price: 250, changePct: 0 })?.direction).toBe('FLAT')
  })

  it('SectorCard renders "—" for a null change, not 0.00%', () => {
    const sector = SECTORS.find((s) => s.etf === 'XLK')!
    const html = renderToStaticMarkup(<SectorCard sector={sector} quote={{ price: 250, change: null, changePct: null }} />)
    expect(html).toContain('aria-label="no change data"')
    expect(html).not.toMatch(/0\.00%/)
  })
})
