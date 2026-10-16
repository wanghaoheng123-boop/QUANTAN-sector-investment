/**
 * Q-094 — the news payload is parsed at the client boundary (zod), item by
 * item; Q-140 — a degraded answer carries its message through.
 */
import { describe, expect, it } from 'vitest'
import { parseNewsPayload } from '@/lib/news/newsPayload'

const __SYNTHETIC__GOOD = { __SYNTHETIC__: true, title: 'Chipmakers rally', publisher: 'Reuters', link: 'https://example.test/a', publishedAt: '2026-01-01T12:00:00Z', tickers: ['NVDA'] }

describe('parseNewsPayload', () => {
  it('keeps well-formed items', () => {
    const r = parseNewsPayload({ news: [__SYNTHETIC__GOOD], fetchedAt: '2026-01-01T12:01:00Z' })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].title).toBe('Chipmakers rally')
    expect(r.fetchedAt).toBe('2026-01-01T12:01:00Z')
    expect(r.dropped).toBe(0)
    expect(r.degradedMessage).toBeNull()
  })

  it('a 200 carrying malformed items drops THOSE items, not the feed', () => {
    const r = parseNewsPayload({ news: [__SYNTHETIC__GOOD, { title: '' }, { publisher: 'x' }, null, 42, { title: 7 }] })
    expect(r.items.map((i) => i.title)).toEqual(['Chipmakers rally'])
    expect(r.dropped).toBe(5)
  })

  it('a body that is not a news envelope throws (the caller renders its error state)', () => {
    expect(() => parseNewsPayload({ error: 'oops' })).toThrow()
    expect(() => parseNewsPayload(null)).toThrow()
    expect(() => parseNewsPayload({ news: 'not-an-array' })).toThrow()
  })

  it('carries the route’s degraded message through', () => {
    const r = parseNewsPayload({ news: [], degraded: true, error: { code: 'news_unavailable', message: 'The news feed failed for 5 of 5 lookups; this list may be incomplete.' } })
    expect(r.degradedMessage).toBe('The news feed failed for 5 of 5 lookups; this list may be incomplete.')
  })

  it('a degraded answer with no message still says so', () => {
    expect(parseNewsPayload({ news: [], degraded: true }).degradedMessage).toMatch(/degraded/)
  })
})
