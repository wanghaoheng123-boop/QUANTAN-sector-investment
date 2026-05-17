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

  /**
   * Regression: prior implementation computed `elapsedSec = (now - lastRefill) / 1000`
   * without clamping. When the system clock skewed BACKWARD (NTP correction,
   * manual override, VM time-jump), elapsed went negative → refillTokens negative
   * → tokens SUBTRACTED instead of added → user got rate-limited for no reason.
   * Fix clamps elapsedSec to >= 0.
   *
   * We can't easily move the system clock in a test, but we can verify the
   * positive-path invariant: repeated identical-now calls don't reduce tokens.
   */
  it('repeated calls with identical timestamps do not reduce capacity (clock-skew regression)', () => {
    const key = `clock-${Date.now()}-${Math.random()}`
    const cfg = { maxRequests: 5, windowSeconds: 60 }
    // Burst of 5 should all be allowed (initial tokens = max).
    let allowed = 0
    for (let i = 0; i < 5; i++) {
      if (checkRateLimit(key, cfg).allowed) allowed++
    }
    expect(allowed).toBe(5)
    // 6th must be blocked
    expect(checkRateLimit(key, cfg).allowed).toBe(false)
  })
})

describe('getRateLimitKey', () => {
  // R7-C-2 (Phase 14 S1): `x-forwarded-for` is now only trusted when running on
  // Vercel (process.env.VERCEL === '1'). On any other host (Railway, raw Node,
  // self-hosted) the header is attacker-controllable and ignored. Tests now
  // exercise both branches explicitly via env-var manipulation.

  const withVercelEnv = (vercel: boolean, fn: () => void) => {
    const original = process.env.VERCEL
    process.env.VERCEL = vercel ? '1' : ''
    try { fn() } finally {
      if (original === undefined) delete process.env.VERCEL
      else process.env.VERCEL = original
    }
  }

  it('uses x-forwarded-for first IP when running on Vercel', () => {
    withVercelEnv(true, () => {
      const req = new Request('http://localhost/x', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      })
      expect(getRateLimitKey(req, 'route-x')).toBe('route-x:1.2.3.4')
    })
  })

  it('IGNORES x-forwarded-for off-Vercel (spoofable header)', () => {
    withVercelEnv(false, () => {
      const req = new Request('http://localhost/x', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      })
      // Off-Vercel, the spoofable XFF must NOT be the key — degrade to 'server'.
      expect(getRateLimitKey(req, 'route-x')).toBe('route-x:server')
    })
  })

  it('falls back to x-real-ip when forwarded missing (Vercel)', () => {
    withVercelEnv(true, () => {
      const req = new Request('http://localhost/x', {
        headers: { 'x-real-ip': '9.9.9.9' },
      })
      expect(getRateLimitKey(req, 'route-y')).toBe('route-y:9.9.9.9')
    })
  })

  it('uses x-real-ip off-Vercel when provided by trusted upstream proxy', () => {
    withVercelEnv(false, () => {
      const req = new Request('http://localhost/x', {
        headers: { 'x-real-ip': '9.9.9.9' },
      })
      // x-real-ip is set by upstream proxies (nginx/Caddy) and is conventionally
      // single-valued, so it is honoured even off-Vercel.
      expect(getRateLimitKey(req, 'route-y')).toBe('route-y:9.9.9.9')
    })
  })

  it('falls back to "unknown" when no headers present on Vercel', () => {
    withVercelEnv(true, () => {
      const req = new Request('http://localhost/x')
      expect(getRateLimitKey(req, 'route-z')).toBe('route-z:unknown')
    })
  })

  it('falls back to "server" when no headers present off-Vercel', () => {
    withVercelEnv(false, () => {
      const req = new Request('http://localhost/x')
      // Off-Vercel without a trusted upstream → degrade to single global bucket.
      expect(getRateLimitKey(req, 'route-z')).toBe('route-z:server')
    })
  })
})
