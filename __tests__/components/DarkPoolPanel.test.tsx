// @vitest-environment jsdom
/**
 * UX-6 — the ILLUSTRATIVE badge on the dark-pool block prints.
 *
 * `prints` are ALWAYS synthetic: every consumer feeds them from
 * `lib/mockData.ts` → `generateDarkPoolPrints()`, a mulberry32 PRNG seeded on
 * the ticker's char codes, anchored to a hardcoded 2026-03-23 timestamp and
 * priced from a small seed table (unknown tickers fall back to ≈$100). But the
 * badge was gated on `!hasRealData`, and `hasRealData` describes the Yahoo
 * off-exchange METRICS from /api/darkpool/[ticker] — a different dataset
 * entirely. So the label disappeared exactly when the real metrics loaded, i.e.
 * on every liquid instrument a professional actually trades. Captured live on
 * /stock/AAPL: fabricated prints at ≈$100 against a real $305.40 quote, no
 * badge, directly beneath "Source: Yahoo Finance".
 *
 * These tests pin the disclosure to the DATA, not to an unrelated call's
 * success: the badge, the footnote and the flow-gauge label must survive
 * `hasRealData: true`.
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
  { time: '14:58:00', ticker: 'AAPL', size: 334_000, price: 100.07, premium: 0.54, type: 'BLOCK', sentiment: 'BULLISH' },
  { time: '14:30:00', ticker: 'AAPL', size: 114_000, price: 100.59, premium: 0.63, type: 'SWEEP', sentiment: 'BEARISH' },
])

const METRICS: DarkPoolMetric = {
  sharesShorted: 141_610_000,
  shortFloatPct: 0.97,
  shortInterestAsOf: '2026-07-31',
  daysToCover: 2.6,
  avgDailyVolume: 54_000_000,
  sharesOutstanding: 14_900_000_000,
  sharesFloat: 14_590_000_000,
}

function analysis(hasRealData: boolean): DarkPoolAnalysis {
  return {
    ticker: 'AAPL',
    fetchedAt: '2026-08-15T00:39:59.000Z',
    quote: { price: 305.4, change: 1.2, changePct: 0.39, quoteTime: '2026-08-14T20:00:00.000Z' },
    metrics: METRICS,
    hasRealData,
    statusNote: hasRealData ? null : 'Off-exchange volume unavailable for this ticker.',
  }
}

const render = (apiData: DarkPoolAnalysis | null) =>
  renderToStaticMarkup(
    <DarkPoolPanel prints={PRINTS} ticker="AAPL" color="#3b82f6" apiData={apiData} />,
  )

/**
 * Markup from the "Block Prints" header onwards. The flow gauge above it now
 * carries an ILLUSTRATIVE badge too, so a bare `toContain('ILLUSTRATIVE')`
 * against the whole document would pass even with the prints badge deleted —
 * scoping the assertion to this section is what makes it a real guard.
 */
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
    // The gauge used to be gated on `(hasRealData || true)`. Its presence in
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
    expect(html).toContain('Short Interest (% of float)')
    expect(html).toContain('0.97%')
    expect(html).toContain('141.61M shares · as of 2026-07-31')
    expect(html).toContain('14.90B')
    expect(html).toContain('Float 14.59B')
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
      metrics: { sharesShorted: null, shortFloatPct: null, shortInterestAsOf: null, daysToCover: null, avgDailyVolume: 6_000_000, sharesOutstanding: null, sharesFloat: null },
      statusNote: 'Yahoo Finance reports no short-interest or share-count figures for this ticker.',
    }
    const html = render(etf)
    expect(html).not.toMatch(/moderate/i)
    expect(html).toContain('Yahoo Finance reports no short-interest or share-count figures for this ticker.')
    expect(html).toContain('Float not reported')
    // The definition line describes a number; with no number it does not render.
    expect(html).not.toContain('reported twice a month')
  })
})
