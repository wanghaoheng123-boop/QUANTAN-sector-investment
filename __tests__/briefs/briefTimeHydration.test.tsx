/**
 * Q-142 — the brief pages are server-rendered with data, so every time they
 * print must come out the same in the server's zone and in the viewer's.
 *
 * `toLocaleString()` without a `timeZone` broke that: production /briefs
 * rendered "03:15 PM" on the server (UTC) and "11:15 PM" on hydration in
 * Asia/Singapore, and React threw error #418 on every load. This renders each
 * page component under three zones and requires byte-identical markup — the
 * property hydration needs, rather than the implementation that provides it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BriefCard from '@/app/briefs/BriefCard'
import LiveBriefClient from '@/app/briefs/sector/[sector]/LiveBriefClient'
import type { SectorBrief } from '@/lib/briefs/sectorBrief'
import { formatEtDateTime } from '@/lib/format'

const ORIGINAL_TZ = process.env.TZ
afterEach(() => { process.env.TZ = ORIGINAL_TZ })

/** Three zones: UTC, and two on opposite sides of the date line from New York. */
const ZONES = ['UTC', 'Asia/Singapore', 'Pacific/Honolulu']

function brief(over: Partial<SectorBrief> = {}): SectorBrief {
  return {
    id: 'technology-test', sector: 'technology', sectorName: 'Technology',
    fetchedAt: '2026-10-01T15:15:40.000Z', lastUpdated: '2026-10-01T15:15:00.000Z',
    price: 250.12, change: 1.5, changePct: 0.6, quoteTime: '2026-10-01T15:15:00.000Z',
    high52w: 260, low52w: 180, priceVsHighPct: -3.8, priceVsLowPct: 38.9,
    volume: null, avgVolume: null, avgVolume10d: null, marketCap: null, peRatio: 31.2,
    dividendYield: null,
    holdings: [], holdingsAvgChange: null,
    news: [{ title: 'Headline', publisher: 'Wire', publishedAt: '2026-10-01T03:05:00.000Z', snippet: null, link: 'https://example.com/a', tickers: [] }],
    signals: [], summary: 'summary', source: 'Yahoo Finance', dataQuality: 'live', dataQualityNote: null,
    ...over,
  }
}

function renderUnder(tz: string, el: () => ReactElement): string {
  process.env.TZ = tz
  return renderToStaticMarkup(el())
}

describe('Q-142: brief pages render the same text in every zone', () => {
  it('the zone switch is real — a zone-less toLocaleString differs (positive control)', () => {
    // If the runtime ignored TZ changes, the identity tests below would pass vacuously.
    const t = new Date('2026-10-01T15:15:00.000Z')
    const seen = ZONES.map((z) => { process.env.TZ = z; return t.toLocaleString('en-US') })
    expect(new Set(seen).size).toBe(ZONES.length)
  })

  it('BriefCard', () => {
    const out = ZONES.map((z) => renderUnder(z, () => <BriefCard brief={brief()} />))
    expect(new Set(out).size).toBe(1)
    expect(out[0]).toContain('Thu, Oct 1, 11:15 AM EDT')
  })

  it('LiveBriefClient (quote time, headline time, footer)', () => {
    const out = ZONES.map((z) => renderUnder(z, () => <LiveBriefClient slug="technology" initialBrief={brief()} />))
    expect(new Set(out).size).toBe(1)
    expect(out[0]).toContain('Thu, Oct 1, 11:15 AM EDT')  // header + footer quote time
    expect(out[0]).toContain('Sep 30, 11:05 PM EDT')      // headline crosses midnight in New York
    expect(out[0]).toContain('Fetched: Oct 1, 11:15 AM EDT')
    // Red-team R2-242-2: the sector brief renders the shared source badge.
    expect(out[0]).toContain('data-source-kind="unclassified"')
    expect(out[0]).toContain('via example.com')
  })

  it('a missing quote time is stated, not replaced by a guess at the market phase', () => {
    const html = renderToStaticMarkup(<LiveBriefClient slug="technology" initialBrief={brief({ lastUpdated: null })} />)
    expect(html).toContain('Quote time not reported')
    expect(html).not.toMatch(/Pre\/post-market|session close/i)
  })
})

describe('formatEtDateTime', () => {
  it('uses New York time across the DST boundary', () => {
    expect(formatEtDateTime('2026-07-01T16:00:00.000Z')).toBe('Jul 1, 12:00 PM EDT') // UTC-4
    expect(formatEtDateTime('2026-01-15T16:00:00.000Z')).toBe('Jan 15, 11:00 AM EST') // UTC-5
  })

  it('names the two instants of the fall-back hour apart (red-team H2)', () => {
    // 2026-11-01: 1:30 AM happens twice in New York. "ET" printed both the same.
    expect(formatEtDateTime('2026-11-01T05:30:00.000Z')).toBe('Nov 1, 1:30 AM EDT')
    expect(formatEtDateTime('2026-11-01T06:30:00.000Z')).toBe('Nov 1, 1:30 AM EST')
  })

  it('adds the weekday on request', () => {
    expect(formatEtDateTime('2026-10-01T15:15:00.000Z', { weekday: true })).toBe('Thu, Oct 1, 11:15 AM EDT')
  })

  it('uses plain spaces only — no ICU-specific separators to diverge on', () => {
    expect(formatEtDateTime('2026-10-01T15:15:00.000Z')).not.toMatch(/[  ]/)
  })

  it('renders unknown as a dash', () => {
    expect(formatEtDateTime(null)).toBe('—')
    expect(formatEtDateTime(undefined)).toBe('—')
    expect(formatEtDateTime('not a date')).toBe('—')
  })
})
