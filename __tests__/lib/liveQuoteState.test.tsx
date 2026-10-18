/**
 * Q-145 — a missing change is missing, never a measured 0 and never the
 * previous change.
 *
 * Red-team S4 (2026-10-17): parseLiveQuote({changePct: null}) became 0, then
 * FLAT, and a live tick with no change overwrote a real REST change. Red-team
 * Q145-R1 then showed the first fix was tested only as a function, never where
 * the pages use it. These pin each link — the normaliser, the client parser,
 * the per-page transitions the pages delegate to, the boot fetch, and what each
 * shared component renders. `__tests__/architecture/live-quote-merge.test.ts`
 * pins that the pages delegate.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'
import { parseLiveQuote } from '@/hooks/useLiveQuote'
import {
  ABSENT_REASON,
  UNPRICED_REASON,
  bootQuoteFrom,
  mergeLandingTick,
  mergeSectorTick,
  mergeStockTick,
  tickChange,
  type LiveTick,
  type SectorQuoteState,
  type StockQuoteState,
} from '@/lib/liveQuoteState'
import { sessionMoveFor } from '@/lib/sessionMoves'
import SectorCard from '@/components/SectorCard'
import PriceTicker from '@/components/PriceTicker'
import { QuoteChangeLine, QuoteUnavailable } from '@/components/QuoteHeadline'
import { SECTORS } from '@/lib/sectors'

const T = '2026-10-19T14:00:00.000Z'
const noChangeTick: LiveTick = { price: 105, change: null, changePct: null, quoteTime: T }

describe('producers say null', () => {
  it('normalizedChangePercent: neither a percent nor a change → null', () => {
    expect(normalizedChangePercent(undefined, undefined, 250)).toBeNull()
    expect(normalizedChangePercent(null, null, null)).toBeNull()
    expect(normalizedChangePercent(1.2, undefined, undefined)).toBe(1.2)
  })

  it('parseLiveQuote keeps a missing change null', () => {
    const q = parseLiveQuote({ ticker: 'XLK', price: 250, timestamp: T, change: null, changePct: null })
    expect(q).toMatchObject({ change: null, changePct: null })
    expect(parseLiveQuote({ ticker: 'XLK', price: 250, timestamp: T, change: Number.NaN, changePct: 'x' })).toMatchObject({ change: null, changePct: null })
  })
})

describe('tickChange', () => {
  it('uses the tick change when it has one', () => {
    expect(tickChange({ price: 101, change: 1, changePct: 1 })).toEqual({ change: 1, changePct: 1 })
  })

  it('fills the missing half from the tick price, against the prior close', () => {
    const r = tickChange({ price: 110, change: 10, changePct: null })
    expect(r.change).toBe(10)
    expect(r.changePct).toBeCloseTo(10, 12) // prior close 100, not 9.09% of 110
    const r2 = tickChange({ price: 110, change: null, changePct: 10 })
    expect(r2.change).toBeCloseTo(10, 12)
  })

  it('a tick with no change is no change — never 0', () => {
    expect(tickChange(noChangeTick)).toEqual({ change: null, changePct: null })
  })

  it('refuses impossible pairs (red-team Q145-R6)', () => {
    const none = { change: null, changePct: null }
    expect(tickChange({ price: 100, change: null, changePct: -150 })).toEqual(none)
    expect(tickChange({ price: 100, change: null, changePct: -100 })).toEqual(none)
    expect(tickChange({ price: 6, change: 6, changePct: null })).toEqual(none) // prior close 0
    expect(tickChange({ price: 6, change: 7, changePct: null })).toEqual(none)
    expect(tickChange({ price: 100, change: 5, changePct: -3 })).toEqual(none) // opposite signs
    expect(tickChange({ price: 0, change: 1, changePct: 1 })).toEqual(none)
    expect(tickChange({ price: Number.NaN, change: 1, changePct: 1 })).toEqual(none)
    // Both zero is a measured flat; one zero beside a move is a contradiction (R2-10).
    expect(tickChange({ price: 100, change: 0, changePct: 0 })).toEqual({ change: 0, changePct: 0 })
    expect(tickChange({ price: 100, change: 0, changePct: 2 })).toEqual(none)
    expect(tickChange({ price: 100, change: 2, changePct: 0 })).toEqual(none)
  })
})

describe('the page transitions never reuse a previous change (red-team Q145-R1)', () => {
  const stockPrev: StockQuoteState = { price: 102, change: 2, changePct: 2, marketCap: '3.1T', quoteTime: T }
  const sectorPrev: SectorQuoteState = { price: 102, change: 2, changePct: 2, volume: 9, high52w: 120, low52w: 80, pe: 25, quoteTime: T }

  it('stock: a tick with no change renders "—", keeps market cap, takes the tick stamp', () => {
    const next = mergeStockTick(stockPrev, { ...noChangeTick, quoteTime: '2026-10-19T15:00:00.000Z' })
    expect(next).toEqual({ price: 105, change: null, changePct: null, marketCap: '3.1T', quoteTime: '2026-10-19T15:00:00.000Z' })
    expect(mergeStockTick(null, noChangeTick).marketCap).toBe('—')
    expect(mergeStockTick(stockPrev, { price: 103, change: 3, changePct: 3, quoteTime: null })).toMatchObject({ change: 3, changePct: 3, quoteTime: null })
  })

  it('sector: a tick with no change renders "—"; REST-only fields are kept or null, never 0', () => {
    expect(mergeSectorTick(sectorPrev, noChangeTick)).toEqual({
      price: 105, change: null, changePct: null, volume: 9, high52w: 120, low52w: 80, pe: 25, quoteTime: T,
    })
    expect(mergeSectorTick(null, noChangeTick)).toEqual({
      price: 105, change: null, changePct: null, volume: null, high52w: null, low52w: null, pe: null, quoteTime: T,
    })
    expect(mergeSectorTick(sectorPrev, { ...noChangeTick, volume: 12 }).volume).toBe(12)
  })

  it('landing: a tick with no change renders "—"', () => {
    expect(mergeLandingTick('XLK', noChangeTick)).toEqual({ ticker: 'XLK', price: 105, change: null, changePct: null })
    expect(mergeLandingTick('XLK', { price: 101, change: 1, changePct: 1 })).toEqual({ ticker: 'XLK', price: 101, change: 1, changePct: 1 })
  })
})

describe('bootQuoteFrom — an unpriced ticker is MISSING, not loading (red-team Q145-R2)', () => {
  it('a priced ticker', () => {
    const q = { ticker: 'XLK', price: 250, change: 1, changePct: 0.4 }
    expect(bootQuoteFrom({ quotes: [q], unpriced: [] }, 'XLK')).toEqual({ kind: 'priced', quote: q })
  })

  it('a ticker the route named as unpriced', () => {
    expect(bootQuoteFrom({ quotes: [], unpriced: ['XLK'] }, 'XLK')).toEqual({ kind: 'missing', reason: UNPRICED_REASON })
  })

  it('a ticker the response left out, or a malformed response', () => {
    expect(bootQuoteFrom({ quotes: [{ ticker: 'SPY', price: 1 }] }, 'XLK')).toEqual({ kind: 'missing', reason: ABSENT_REASON })
    expect(bootQuoteFrom(null, 'XLK')).toEqual({ kind: 'missing', reason: ABSENT_REASON })
    expect(bootQuoteFrom({ quotes: 'nope', unpriced: 'XLK' }, 'XLK')).toEqual({ kind: 'missing', reason: ABSENT_REASON })
  })
})

describe('what the shared components render', () => {
  it('QuoteChangeLine: no percent is "— (no change data)", never 0.00%', () => {
    for (const changePct of [null, Number.NaN]) {
      const html = renderToStaticMarkup(<QuoteChangeLine change={null} changePct={changePct} />)
      expect(html).toContain('— (no change data)')
      expect(html).not.toContain('%')
    }
    expect(renderToStaticMarkup(<QuoteChangeLine change={1.23} changePct={0.5} />)).toMatch(/▲<\/span> \+1\.23 \(0\.50%\)/)
    expect(renderToStaticMarkup(<QuoteChangeLine change={-2} changePct={-1.25} />)).toMatch(/▼<\/span> -2\.00 \(1\.25%\)/)
    // A percent without an absolute change shows the percent and "—" for the change.
    expect(renderToStaticMarkup(<QuoteChangeLine change={null} changePct={0.5} />)).toContain('— (0.50%)')
  })

  it('QuoteUnavailable states the reason in a status region', () => {
    const html = renderToStaticMarkup(<QuoteUnavailable reason={UNPRICED_REASON} />)
    expect(html).toContain('role="status"')
    expect(html).toContain(UNPRICED_REASON)
    expect(html).not.toContain('animate-pulse')
  })

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

  it('PriceTicker renders "—" for a null change, not ▲0.00%', () => {
    const html = renderToStaticMarkup(<PriceTicker items={[{ ticker: 'XLK', name: 'Technology', price: 250, changePct: null }]} />)
    expect(html).toContain('XLK')
    expect(html).toContain('>—<')
    expect(html).not.toMatch(/0\.00%/)
    expect(renderToStaticMarkup(<PriceTicker items={[{ ticker: 'XLK', name: 'Technology', price: 250, changePct: -1.5 }]} />)).toContain('▼1.50%')
  })
})
