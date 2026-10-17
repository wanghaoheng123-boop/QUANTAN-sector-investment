/**
 * Q-090 — news sources are presented as reported, only ever downgraded, and
 * an absent badge is a classification, never a default (red-team R2-242-1).
 */
import { describe, expect, it } from 'vitest'
import { SOURCE_KIND_TEXT, sourceLabel, type SourceKind } from '@/lib/news/sourceLabel'

const YAHOO = 'https://finance.yahoo.com/news/x-123.html'

/**
 * Every publisher on production's sector news on 2026-10-17 (11 sectors, a
 * read-only fetch of /api/news/<sector>), with the kind it must get. A new
 * publisher is not in this list; it gets 'unclassified' and a visible badge
 * until someone classifies it here.
 */
const PRODUCTION_PUBLISHERS_2026_10_17: Record<string, SourceKind> = {
  'Zacks': 'opinion-outlet', 'Trefis': 'opinion-outlet', 'Motley Fool': 'opinion-outlet',
  'MT Newswires': 'newsroom', 'Simply Wall St.': 'opinion-outlet', 'Barrons.com': 'newsroom',
  'Stocktwits': 'opinion-outlet', 'TIKR': 'opinion-outlet', '24/7 Wall St.': 'opinion-outlet',
  'GuruFocus.com': 'opinion-outlet', 'Investing.com': 'newsroom', 'The Wall Street Journal': 'newsroom',
  "Investor's Business Daily": 'newsroom', 'TheStreet': 'unclassified', 'PR Newswire': 'press-release',
  'Investopedia': 'unclassified', 'Business Wire': 'press-release', 'Barchart': 'opinion-outlet',
  'Reuters': 'newsroom', 'Proactive': 'unclassified', 'CNW Group': 'press-release', 'CRE Daily': 'newsroom',
  'Manufacturing Dive': 'newsroom', 'CorpGov.com': 'unclassified', 'Yahoo Finance': 'newsroom',
}

describe('sourceLabel', () => {
  it('says who served the item: Yahoo, for every Yahoo-hosted link', () => {
    expect(sourceLabel('Reuters', YAHOO)).toEqual({ publisher: 'Reuters', kind: 'newsroom', via: 'Yahoo Finance' })
  })

  it('never verifies: a named wire is a newsroom "as reported", not a verified source', () => {
    for (const p of ['Reuters', 'MT Newswires', 'Bloomberg', 'Associated Press']) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe('newsroom')
    }
  })

  it('labels issuer press-release services, including the ones production showed unbadged', () => {
    for (const p of ['GlobeNewswire', 'PR Newswire', 'Business Wire', 'ACCESS Newswire', 'CNW Group', 'Cision', 'PRWeb', 'EQS Group', 'TheNewswire', 'Newswire.ca']) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe('press-release')
    }
  })

  it('labels opinion/analysis outlets by outlet, and says so (R2-242-5)', () => {
    for (const p of ['Motley Fool', 'Zacks', 'GuruFocus.com', '24/7 Wall St.', 'Simply Wall St.', 'Stocktwits', 'TIKR', "Schaeffer's Investment Research"]) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe('opinion-outlet')
    }
    expect(SOURCE_KIND_TEXT['opinion-outlet']).toBe('Opinion/analysis outlet')
  })

  it('an unknown publisher is VISIBLY unclassified; only a newsroom shows no badge', () => {
    expect(sourceLabel('Some New Outlet', YAHOO).kind).toBe('unclassified')
    expect(SOURCE_KIND_TEXT.unclassified).toBe('Unclassified source')
    const unbadged = (Object.keys(SOURCE_KIND_TEXT) as SourceKind[]).filter((k) => SOURCE_KIND_TEXT[k] === null)
    expect(unbadged).toEqual(['newsroom'])
  })

  it('NBSP and zero-width characters do not dodge the lists (R2-242-1)', () => {
    expect(sourceLabel('Globe Newswire', YAHOO).kind).toBe('press-release')
    expect(sourceLabel('PR​Newswire', YAHOO).kind).toBe('press-release')
  })

  it('a spoofed string can only make an item look LESS authoritative', () => {
    expect(sourceLabel('Reuters via PR Newswire', YAHOO).kind).toBe('press-release')
    expect(sourceLabel('Reuters, per Motley Fool', YAHOO).kind).toBe('opinion-outlet')
  })

  it('only a link the page would render is credited to a host (R2-242-3)', () => {
    expect(sourceLabel('Reuters', 'javascript://finance.yahoo.com/%0aalert(1)').via).toBe('unknown source')
    expect(sourceLabel('Reuters', 'ftp://finance.yahoo.com/x').via).toBe('unknown source')
    expect(sourceLabel('Reuters', 'data:text/html,x').via).toBe('unknown source')
  })

  it('handles a missing publisher and an unparseable link', () => {
    expect(sourceLabel(undefined, 'not a url')).toEqual({ publisher: 'Unknown publisher', kind: 'unclassified', via: 'unknown source' })
  })

  it("classifies every publisher production served on 2026-10-17", () => {
    for (const [p, want] of Object.entries(PRODUCTION_PUBLISHERS_2026_10_17)) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe(want)
    }
  })
})
