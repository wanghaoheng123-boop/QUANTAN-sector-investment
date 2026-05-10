import { describe, it, expect } from 'vitest'
import { checkRateLimit, getRateLimitKey } from '@/lib/api/rateLimit'

describe('checkRateLimit', () => {
  it('allows up to maxRequests in a fresh bucket', () => {
    const key = `test1-${Date.now()}-${Math.random()}`
    const cfg = { maxRequests: 3, windowSeconds: 60 }
    expect(checkRateLimit(key, cfg).allowed).toBe(true)
    expect(checkRateLimit(key, cfg).allowed).toBe(true)
    expect(checkRateLimit(key, cfg).allowed).toBe(true)
    const fourth = checkRateLimit(key, cfg)
    expect(fourth.allowed).toBe(false)
    if (!fourth.allowed) {
      expect(fourth.retryAfter).toBeGreaterThan(0)
    }
  })

  it('refills tokens after time passes', async () => {
    const key = `test2-${Date.now()}-${Math.random()}`
    // 10 req/sec → refill 1 token every 100ms
    const cfg = { maxRequests: 1, windowSeconds: 0.1 }
    expect(checkRateLimit(key, cfg).allowed).toBe(true)
    expect(checkRateLimit(key, cfg).allowed).toBe(false)
    // Wait long enough for one full refill.
    await new Promise((r) => setTimeout(r, 150))
    expect(checkRateLimit(key, cfg).allowed).toBe(true)
  })

  it('isolates buckets across keys', () => {
    const cfg = { maxRequests: 1, windowSeconds: 60 }
    const keyA = `iso-a-${Date.now()}-${Math.random()}`
    const keyB = `iso-b-${Date.now()}-${Math.random()}`
    expect(checkRateLimit(keyA, cfg).allowed).toBe(true)
    expect(checkRateLimit(keyA, cfg).allowed).toBe(false)
    // Different key has its own bucket.
    expect(checkRateLimit(keyB, cfg).allowed).toBe(true)
  })

  it('returns retryAfter >= 1 when rate-limited', () => {
    const key = `retry-${Date.now()}-${Math.random()}`
    const cfg = { maxRequests: 1, windowSeconds: 60 }
    checkRateLimit(key, cfg) // consume
    const blocked = checkRateLimit(key, cfg)
    expect(blocked.allowed).toBe(false)
    if (!blocked.allowed) {
      expect(blocked.retryAfter).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('getRateLimitKey', () => {
  it('uses x-forwarded-for first IP when present', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    })
    const key = getRateLimitKey(req, 'route-x')
    expect(key).toBe('route-x:1.2.3.4')
  })

  it('falls back to x-real-ip when forwarded missing', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-real-ip': '9.9.9.9' },
    })
    const key = getRateLimitKey(req, 'route-y')
    expect(key).toBe('route-y:9.9.9.9')
  })

  it('uses "unknown" when neither header is present', () => {
    const req = new Request('http://localhost/x')
    const key = getRateLimitKey(req, 'route-z')
    expect(key).toBe('route-z:unknown')
  })
})
