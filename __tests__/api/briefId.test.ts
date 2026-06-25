import { describe, it, expect } from 'vitest'
import { newsBriefId } from '@/lib/api/briefId'

/**
 * Reconstructs the pre-fix id derivation so the regression is self-documenting:
 * the first 16 base64 chars encode exactly the first 12 bytes of the link.
 */
function legacyBriefId(link: string): string {
  return Buffer.from(link).toString('base64').slice(0, 16)
}

describe('newsBriefId (B-1 regression)', () => {
  // Two distinct real Yahoo Finance news links that share the 12-byte prefix
  // "https://fina". These are exactly the case the live route produces.
  const linkA = 'https://finance.yahoo.com/news/apple-earnings-beat-123.html'
  const linkB = 'https://finance.yahoo.com/news/nvidia-guidance-raised-456.html'
  // A different domain — shares "https://www." with other publisher links.
  const linkC = 'https://www.reuters.com/markets/us/article-one'
  const linkD = 'https://www.reuters.com/markets/us/article-two'

  it('documents the OLD bug: shared-prefix links collapse to one id', () => {
    // Same-domain Yahoo links collide under the legacy truncation...
    expect(legacyBriefId(linkA)).toBe(legacyBriefId(linkB))
    // ...as do same-domain publisher links.
    expect(legacyBriefId(linkC)).toBe(legacyBriefId(linkD))
  })

  it('gives distinct ids to distinct links (the fix)', () => {
    expect(newsBriefId(linkA)).not.toBe(newsBriefId(linkB))
    expect(newsBriefId(linkC)).not.toBe(newsBriefId(linkD))
    // Cross-domain too.
    expect(newsBriefId(linkA)).not.toBe(newsBriefId(linkC))
  })

  it('is stable: the same link always maps to the same id', () => {
    expect(newsBriefId(linkA)).toBe(newsBriefId(linkA))
  })

  it('round-trips back to the original link (bijection ⇒ no collisions)', () => {
    const id = newsBriefId(linkA)
    expect(Buffer.from(id, 'base64url').toString('utf8')).toBe(linkA)
  })

  it('produces a URL-safe id (no +, /, or = padding)', () => {
    // A link whose bytes would yield + and / in standard base64.
    const id = newsBriefId('https://example.com/path?x=ÿþ>>>')
    expect(id).not.toMatch(/[+/=]/)
  })
})
