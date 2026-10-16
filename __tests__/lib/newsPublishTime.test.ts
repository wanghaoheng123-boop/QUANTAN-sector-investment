/** Q-140 red-team L12 — one reader for Yahoo's news publish time. */
import { describe, expect, it } from 'vitest'
import { newsPublishTime } from '@/lib/news/publishTime'

describe('newsPublishTime', () => {
  const iso = '2026-10-16T00:01:45.000Z'
  it('reads providerPublishTime as yahoo-finance2 delivers it (a Date)', () => {
    expect(newsPublishTime({ providerPublishTime: new Date(iso) })).toBe(iso)
  })
  it('reads a raw Unix-seconds number as seconds, not 1970 milliseconds', () => {
    expect(newsPublishTime({ providerPublishTime: Date.parse(iso) / 1000 })).toBe(iso)
    expect(newsPublishTime({ providerPublishTime: Date.parse(iso) })).toBe(iso)
  })
  it('falls back to publishedAt, and says null when nothing usable is present', () => {
    expect(newsPublishTime({ publishedAt: iso })).toBe(iso)
    expect(newsPublishTime({})).toBeNull()
    expect(newsPublishTime({ providerPublishTime: 'not a date' })).toBeNull()
  })
})
