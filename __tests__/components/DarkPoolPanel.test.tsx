// @vitest-environment jsdom
/**
 * UX-6 — the ILLUSTRATIVE badge on the dark-pool block prints.
 *
 * `prints` are ALWAYS synthetic: every consumer feeds them from
 * `lib/mockData.ts` -> `generateDarkPoolPrints()`, a mulberry32 PRNG seeded on
 * the ticker's char codes and priced from a small seed table (unknown tickers
 * fall back to about $100). The badge used to be gated on a flag that described
 * the Yahoo metrics loaded from /api/darkpool/[ticker], which are a different
 * dataset from the prints. So the label disappeared exactly when those metrics
 * loaded, i.e. on every liquid instrument, and fabricated prints sat beside a
 * real quote at a very different price with no badge.
 *
 * These tests pin the disclosure to the DATA, not to an unrelated call's
 * success: the badge, the footnote and the flow-gauge label render in every
 * state of the metrics request, loaded or not.
 *
 * Every figure in this file is invented (design invariant I8).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DarkPoolPanel from '@/components/DarkPoolPanel'
import type { DarkPoolAnalysis, DarkPoolMetric } from '@/lib/darkpool'
import type { DarkPoolPrint } from '@/lib/sectors'
import { markSynthetic } from '@/lib/synthetic'

// Q-088: `prints` is a `Synthetic<DarkPoolPrint[]>` wrapper, so real market
// data cannot be assigned to it. A fixture is synthetic by definition, so it
// goes through the sanctioned constructor rather than a cast.
const PRINTS = markSynthetic<DarkPoolPrint[]>([
  { time: '14:58:00', ticker: 'ABCD', size: 334_000, price: 100.07, premium: 0.54, type: 'BLOCK', sentiment: 'BULLISH' },
  { time: '14:30:00', ticker: 'ABCD', size: 114_000, price: 100.59, premium: 0.63, type: 'SWEEP', sentiment: 'BEARISH' },
])

// Invented figures (Q149-D6, I8): digit runs that no issuer reports, so none can
// be read as, or derived from, a vendor figure.
const METRICS: DarkPoolMetric = {
  sharesShorted: 123_456_789,
  shortFloatPct: 1.25,
  shortInterestAsOf: '2026-07-31',
  shortInterestAgeDays: 15,
  shortInterestStale: false,
  daysToCover: 2.5,
  avgDailyVolume: 40_000_000,
  sharesOutstanding: 9_876_543_210,
  sharesFloat: 8_765_432_100,
  floatWithheld: null,
}

const NO_SHORT_INTEREST = 'Yahoo Finance reports no short-interest figures for this ticker.'

/** `hasData` stands for the route's hasShortInterestData — it sets statusNote. */
function analysis(hasData: boolean): DarkPoolAnalysis {
  return {
    ticker: 'ABCD',
    fetchedAt: '2026-08-15T00:39:59.000Z',
    quote: { price: 250, change: 1.2, changePct: 0.48, quoteTime: '2026-08-14T20:00:00.000Z' },
    metrics: METRICS,
    statusNote: hasData ? null : NO_SHORT_INTEREST,
  }
}

const render = (apiData: DarkPoolAnalysis | null) =>
  renderToStaticMarkup(
    <DarkPoolPanel prints={PRINTS} ticker="ABCD" color="#3b82f6" apiData={apiData} />,
  )

/**
 * Markup from the "Block Prints" header onwards. The flow gauge above it now
 * carries an ILLUSTRATIVE badge too, so a bare `toContain('ILLUSTRATIVE')`
 * against the whole document would pass even with the prints badge deleted —
 * scoping the assertion to this section is what makes it a real guard.
 */
/** The markup between a card's label and the next card's label. */
function card(html: string, label: string, nextLabel: string): string {
  const i = html.indexOf(label)
  const j = html.indexOf(nextLabel, i)
  expect(i, label).toBeGreaterThan(-1)
  expect(j, nextLabel).toBeGreaterThan(i)
  return html.slice(i, j)
}

function printsSection(html: string): string {
  const i = html.indexOf('Block Prints')
  expect(i).toBeGreaterThan(-1)
  return html.slice(i)
}

describe('DarkPoolPanel — the prints table is disclosed unconditionally (UX-6)', () => {
  it('shows ILLUSTRATIVE when the real metrics DID load (the regression case)', () => {
    const section = printsSection(render(analysis(true)))
    expect(section).toContain('ILLUSTRATIVE')
    expect(section).toContain('Illustrative block prints')
  })

  it('shows ILLUSTRATIVE when the real metrics did not load', () => {
    const section = printsSection(render(analysis(false)))
    expect(section).toContain('ILLUSTRATIVE')
    expect(section).toContain('Illustrative block prints')
  })

  it('shows ILLUSTRATIVE before any metrics request resolves', () => {
    const section = printsSection(render(null))
    expect(section).toContain('ILLUSTRATIVE')
    expect(section).toContain('Illustrative block prints')
  })

  it('renders the prints table in every one of those states', () => {
    for (const state of [analysis(true), analysis(false), null]) {
      expect(render(state)).toContain('Block Prints')
    }
  })
})

describe('DarkPoolPanel — the synthetic flow gauge carries its own label', () => {
  it('labels the Off-Exchange Flow gauge as illustrative even with real metrics', () => {
    const html = render(analysis(true))
    expect(html).toContain('Off-Exchange Flow')
    // Two badges: one on the gauge, one on the prints table.
    expect(html.match(/ILLUSTRATIVE/g)?.length).toBe(2)
    expect(html).toContain('Off-exchange flow sentiment (illustrative)')
  })

  it('renders the gauge without a dead always-true conditional', () => {
    // The gauge used to be gated on an always-true conditional. Its presence in
    // both branches is what that tautology was silently doing.
    expect(render(analysis(true))).toContain('Off-Exchange Flow')
    expect(render(analysis(false))).toContain('Off-Exchange Flow')
  })
})

describe('DarkPoolPanel — the Yahoo attribution is scoped to the metrics', () => {
  it('names what the source covers and disclaims what it does not', () => {
    const html = render(analysis(true))
    expect(html).toContain('Source for the figures above: Yahoo Finance (short interest, share counts, 10-day average')
    expect(html).toContain('The flow gauge and the block prints below are not from this source.')
    // The unscoped phrasing must not come back.
    expect(html).not.toContain('Source: Yahoo Finance aggregate off-exchange trading data.')
  })

  it('still reports the real metrics it does cover', () => {
    const html = render(analysis(true))
    expect(html).toContain('Short Interest (% as reported)')
    expect(html).not.toContain('% of float') // the denominator is the vendor's, not guaranteed to be the float
    expect(html).toContain('1.25%')
    expect(html).toContain('123.46M shares · as of 2026-07-31')
    expect(html).not.toContain('STALE')
    expect(html).toContain('9.88B')
    expect(html).toContain('Float 8.77B')
    expect(html).toContain('as reported by Yahoo; not computed from the volume shown')
  })
})

/**
 * Q-149 — the panel credited "Finra BATS" for an off-exchange figure no field
 * supplied, and its short-interest "signal" read a fraction as a percent. These
 * pin what replaced them, on the rendered markup.
 */
describe('DarkPoolPanel — says what this source does not publish (Q-149)', () => {
  it('states once that off-exchange volume is not published, in every loaded state', () => {
    for (const state of [analysis(true), analysis(false)]) {
      expect(render(state)).toContain('Off-exchange (dark-pool) volume is not published by this data source.')
    }
  })

  it('credits no venue and names no signal', () => {
    for (const state of [analysis(true), analysis(false), null]) {
      const html = render(state)
      for (const banned of ['Finra', 'FINRA', 'BATS', 'OTCQX', 'UQDF', 'ACCUMULATION', 'DISTRIBUTION', 'Short Interest Signal', 'Off-Exchange Vol']) {
        expect(html, banned).not.toContain(banned)
      }
    }
  })

  it('an ETF (no short-interest figure) is not told its short interest is moderate', () => {
    const etf: DarkPoolAnalysis = {
      ...analysis(false),
      ticker: 'XLK',
      metrics: {
        sharesShorted: null, shortFloatPct: null, shortInterestAsOf: null, shortInterestAgeDays: null, shortInterestStale: false,
        daysToCover: null, avgDailyVolume: 6_000_000, sharesOutstanding: 300_000_000, sharesFloat: null, floatWithheld: null,
      },
      statusNote: NO_SHORT_INTEREST,
    }
    const html = render(etf)
    expect(html).not.toMatch(/moderate/i)
    expect(html).toContain(NO_SHORT_INTEREST)
    expect(html).toContain('300.00M') // Q149-D1: the ETF's share count, from its quote
    expect(html).toContain('Float not reported')
    // The definition line describes a number; with no number it does not render.
    expect(html).not.toContain('reported twice a month')
    // Q149-R2-8 (M17): an empty Short Interest card says "not reported". The Shares
    // Outstanding card's "Float not reported" contains that phrase too, so the
    // assertion is on the card's own sub-label element.
    expect(card(html, 'Short Interest (% as reported)', 'Days to Cover')).toContain('>not reported<')
  })

  it('a float the route WITHHELD says so, with the reason — not "not reported" (Q149-D2)', () => {
    const withheld = (floatWithheld: DarkPoolMetric['floatWithheld']) =>
      render({ ...analysis(true), metrics: { ...METRICS, sharesFloat: null, floatWithheld } })
    expect(withheld('exceeds-shares-out')).toContain('Float withheld: larger than shares outstanding')
    expect(withheld('inconsistent-with-short-interest')).toContain('Float withheld: inconsistent with the short-interest figures')
    expect(withheld('exceeds-shares-out')).not.toContain('Float not reported')
  })

  it('a settlement date past a missed cycle reads STALE with its age (Q149-D12)', () => {
    const html = render({ ...analysis(true), metrics: { ...METRICS, shortInterestAsOf: '2026-06-30', shortInterestAgeDays: 46, shortInterestStale: true } })
    expect(html).toContain('as of 2026-06-30 · STALE (46 days)')
  })

  it('the screen-reader caption says the prints are illustrative, not trades (Q149-D13)', () => {
    const html = render(analysis(true))
    expect(html).toContain('Illustrative dark pool prints — generated examples, not real trades')
    expect(html).not.toContain('recent off-exchange block trades')
  })
})

/**
 * Q149 round 2 (R2-2, R2-8, R2-10): the percent's denominator is the vendor's;
 * the definition line follows the percent; Days to Cover is as old as the short
 * count it is divided from.
 */
describe('DarkPoolPanel — the short % states whose denominator it is (Q149-R2-2)', () => {
  it('explains, once, that the denominator is usually the float and for some names shares outstanding', () => {
    const html = render(analysis(true))
    expect(html).toContain('its denominator is usually the float, but for some dual-class and ADR names it is shares outstanding')
  })

  it('a withheld float says the short % is on the vendor\'s own denominator, when there is a short %', () => {
    const withheld = (m: Partial<DarkPoolMetric>) =>
      render({ ...analysis(true), metrics: { ...METRICS, sharesFloat: null, floatWithheld: 'exceeds-shares-out', ...m } })
    // The card ends at the first `</div></div>` after its label (sub-label, then card).
    const sub = (html: string) => {
      const i = html.indexOf('Shares Outstanding')
      expect(i).toBeGreaterThan(-1)
      return html.slice(i, html.indexOf('</div></div>', i))
    }
    expect(sub(withheld({}))).toMatch(/Float withheld: larger than shares outstanding · short % is on Yahoo(&#x27;|')s own denominator/)
    expect(sub(withheld({ floatWithheld: 'inconsistent-with-short-interest' })))
      .toMatch(/Float withheld: inconsistent with the short-interest figures · short % is on Yahoo(&#x27;|')s own denominator/)
    // No short % printed, so there is no denominator to describe.
    expect(sub(withheld({ shortFloatPct: null }))).not.toMatch(/denominator/)
    // A kept float carries no such caveat.
    expect(sub(render(analysis(true)))).not.toMatch(/denominator/)
  })
})

describe('DarkPoolPanel — the definition line follows the percent (Q149-R2-8, M18)', () => {
  it('renders when a percent is printed, even with no short count', () => {
    const html = render({ ...analysis(true), metrics: { ...METRICS, sharesShorted: null } })
    expect(html).toContain('reported twice a month')
  })

  it('does not render for a short count alone: it describes the percent card', () => {
    const html = render({ ...analysis(true), metrics: { ...METRICS, shortFloatPct: null } })
    expect(html).not.toContain('reported twice a month')
  })
})

describe('DarkPoolPanel — Days to Cover carries the same STALE mark as the short count (Q149-R2-10)', () => {
  const stale = { shortInterestAsOf: '2026-06-30', shortInterestAgeDays: 46, shortInterestStale: true }
  const dtc = (html: string) => card(html, 'Days to Cover', '10-Day Avg Volume')

  it('both cards say STALE with the same age', () => {
    const html = render({ ...analysis(true), metrics: { ...METRICS, ...stale } })
    expect(card(html, 'Short Interest (% as reported)', 'Days to Cover')).toContain('STALE (46 days)')
    expect(dtc(html)).toContain('as reported by Yahoo; not computed from the volume shown · STALE (46 days)')
  })

  it('a current settlement date marks neither card', () => {
    const html = render(analysis(true))
    expect(html).not.toContain('STALE')
  })

  it('no Days to Cover figure, nothing to mark stale on that card', () => {
    const html = render({ ...analysis(true), metrics: { ...METRICS, ...stale, daysToCover: null } })
    expect(dtc(html)).not.toContain('STALE')
    expect(card(html, 'Short Interest (% as reported)', 'Days to Cover')).toContain('STALE (46 days)')
  })
})
