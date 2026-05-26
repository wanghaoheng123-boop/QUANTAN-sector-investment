import { describe, it, expect } from 'vitest'
import { isSafeHttpUrl, safeHref } from '@/lib/security/urlValidation'

/**
 * Direct unit coverage for the URL-safety SSOT primitive used by:
 *   - app/api/briefs/route.ts (news link filtering at API boundary)
 *   - app/api/briefs/[sector]/route.ts (sector news API)
 *   - components/NewsFeed.tsx (render boundary)
 *   - app/briefs/sector/[sector]/LiveBriefClient.tsx (render boundary)
 *
 * Defense-in-depth: even if one boundary regresses, the other still
 * blocks the XSS supply-chain. These tests pin the contract for both.
 *
 * Citation: OWASP XSS Prevention Cheat Sheet; CWE-79.
 */

describe('isSafeHttpUrl', () => {
  describe('accepts safe schemes', () => {
    it('http://', () => {
      expect(isSafeHttpUrl('http://example.com')).toBe(true)
    })
    it('https://', () => {
      expect(isSafeHttpUrl('https://example.com')).toBe(true)
    })
    it('full URL with query + fragment', () => {
      expect(isSafeHttpUrl('https://example.com/path?q=1&r=2#anchor')).toBe(true)
    })
    it('localhost (http) is allowed (dev environments)', () => {
      expect(isSafeHttpUrl('http://localhost:3000/api')).toBe(true)
    })
    it('IP addresses are allowed (parsed by URL)', () => {
      expect(isSafeHttpUrl('http://10.0.0.1/x')).toBe(true)
    })
  })

  describe('rejects XSS-vector schemes', () => {
    it('javascript: is rejected', () => {
      expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
    })
    it('javascript: with leading whitespace (browser-tolerated) is rejected', () => {
      // URL parser strips leading whitespace, then sees `javascript:`.
      expect(isSafeHttpUrl('  javascript:alert(1)')).toBe(false)
    })
    it('JavaScript: with mixed case is rejected', () => {
      expect(isSafeHttpUrl('JaVaScRiPt:alert(1)')).toBe(false)
    })
    it('data: URI is rejected', () => {
      expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    })
    it('vbscript: is rejected', () => {
      expect(isSafeHttpUrl('vbscript:msgbox("xss")')).toBe(false)
    })
    it('file: is rejected', () => {
      expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false)
    })
    it('ftp: is rejected (non-http)', () => {
      expect(isSafeHttpUrl('ftp://user:pass@host/path')).toBe(false)
    })
    it('mailto: is rejected', () => {
      expect(isSafeHttpUrl('mailto:user@example.com')).toBe(false)
    })
  })

  describe('rejects malformed / oversized / wrong-type inputs', () => {
    it('null', () => {
      expect(isSafeHttpUrl(null)).toBe(false)
    })
    it('undefined', () => {
      expect(isSafeHttpUrl(undefined)).toBe(false)
    })
    it('empty string', () => {
      expect(isSafeHttpUrl('')).toBe(false)
    })
    it('number', () => {
      expect(isSafeHttpUrl(42)).toBe(false)
    })
    it('object', () => {
      expect(isSafeHttpUrl({ href: 'https://example.com' })).toBe(false)
    })
    it('not-a-url string', () => {
      expect(isSafeHttpUrl('not a url')).toBe(false)
    })
    it('relative path (no scheme)', () => {
      expect(isSafeHttpUrl('/some/relative/path')).toBe(false)
    })
    it('over 2048 chars is rejected', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2050)
      expect(isSafeHttpUrl(longUrl)).toBe(false)
    })
    it('exactly 2048 chars is accepted (boundary)', () => {
      // https://example.com/ = 20 chars; pad to exactly 2048
      const padding = 2048 - 'https://example.com/'.length
      const exact = 'https://example.com/' + 'a'.repeat(padding)
      expect(exact.length).toBe(2048)
      expect(isSafeHttpUrl(exact)).toBe(true)
    })
  })
})

describe('safeHref', () => {
  it('returns the raw URL when safe', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x')
  })

  it('returns "#" fallback when unsafe', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
    expect(safeHref('data:text/html,xss')).toBe('#')
    expect(safeHref(null)).toBe('#')
    expect(safeHref(undefined)).toBe('#')
  })

  it('respects a custom fallback', () => {
    expect(safeHref('javascript:alert(1)', '/blocked')).toBe('/blocked')
    expect(safeHref(undefined, '')).toBe('')
  })

  it('returns "#" by default (no second arg)', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#')
  })
})
