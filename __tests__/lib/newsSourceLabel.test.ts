/** Q-090 — news sources are presented as reported, and only ever downgraded. */
import { describe, expect, it } from 'vitest'
import { sourceLabel } from '@/lib/news/sourceLabel'

const YAHOO = 'https://finance.yahoo.com/news/x-123.html'

describe('sourceLabel', () => {
  it('says who served the item: Yahoo, for every Yahoo-hosted link', () => {
    expect(sourceLabel('Reuters', YAHOO)).toEqual({ publisher: 'Reuters', kind: 'reported', via: 'Yahoo Finance' })
  })

  it('never upgrades: a named wire is "reported", not verified', () => {
    for (const p of ['Reuters', 'MT Newswires', 'Bloomberg', 'Associated Press']) {
      expect(sourceLabel(p, YAHOO).kind).toBe('reported')
    }
  })

  it('labels issuer press-release services as press releases', () => {
    for (const p of ['GlobeNewswire', 'PR Newswire', 'Business Wire', 'ACCESS Newswire']) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe('press-release')
    }
  })

  it('labels opinion outlets as commentary', () => {
    for (const p of ['Motley Fool', 'Zacks', 'GuruFocus.com', '24/7 Wall St.', 'Simply Wall St.', 'Stocktwits']) {
      expect(sourceLabel(p, YAHOO).kind, p).toBe('commentary')
    }
  })

  it('a spoofed string can only make an item look LESS authoritative', () => {
    expect(sourceLabel('Reuters via PR Newswire', YAHOO).kind).toBe('press-release')
  })

  it('handles missing publisher and an unparseable link', () => {
    expect(sourceLabel(undefined, 'not a url')).toEqual({ publisher: 'Unknown publisher', kind: 'reported', via: 'unknown source' })
  })
})
