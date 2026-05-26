/**
 * lib/api/rateLimit.ts — Vercel KV / Upstash path tests (Q-005 + Q-051-NEW
 * branch-coverage backfill).
 *
 * The in-memory token-bucket path is covered by __tests__/api/rateLimit.test.ts.
 * This file exercises the OTHER half of applyRateLimit — the distributed KV
 * path that fires when both KV_REST_API_URL and KV_REST_API_TOKEN are set.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { applyRateLimit } from '@/lib/api/rateLimit'

describe('applyRateLimit — Vercel KV path', () => {
  let savedUrl: string | undefined
  let savedToken: string | undefined
  let savedFetch: typeof globalThis.fetch
  let fetchCalls: { url: string; init?: RequestInit }[] = []

  beforeEach(() => {
    savedUrl = process.env.KV_REST_API_URL
    savedToken = process.env.KV_REST_API_TOKEN
    savedFetch = globalThis.fetch
    fetchCalls = []
  })

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = savedUrl
    if (savedToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = savedToken
    globalThis.fetch = savedFetch
  })

  function stubKvFetch(impl: (path: string) => { result?: number; status?: number }) {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      fetchCalls.push({ url: u, init })
      const path = new URL(u).pathname
      const r = impl(path)
      return new Response(JSON.stringify({ result: r.result }), { status: r.status ?? 200 })
    }) as unknown as typeof fetch
  }

  it('falls back to in-memory when KV env vars are absent', async () => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    // Will use in-memory path; no fetch should fire.
    let fetched = false
    globalThis.fetch = (async () => { fetched = true; return new Response('') }) as unknown as typeof fetch
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '1.1.1.1' } })
    const result = await applyRateLimit(req, 'no-kv', { maxRequests: 5, windowSeconds: 60 })
    expect(result).toBeNull() // allowed
    expect(fetched).toBe(false)
  })

  it('hits KV INCR + EXPIRE on the first request of a window (count=1)', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'tok'
    stubKvFetch((path) => {
      if (path.startsWith('/incr/')) return { result: 1, status: 200 }
      if (path.startsWith('/expire/')) return { result: 1, status: 200 }
      return { status: 404 }
    })
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '2.2.2.2' } })
    const result = await applyRateLimit(req, 'kv-first', { maxRequests: 5, windowSeconds: 60 })
    expect(result).toBeNull() // allowed
    // INCR + EXPIRE both fire on first request.
    const paths = fetchCalls.map((c) => new URL(c.url).pathname)
    expect(paths.some((p) => p.startsWith('/incr/'))).toBe(true)
    expect(paths.some((p) => p.startsWith('/expire/'))).toBe(true)
  })

  it('skips EXPIRE on subsequent requests of the same window (count > 1)', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'tok'
    stubKvFetch((path) => {
      if (path.startsWith('/incr/')) return { result: 3, status: 200 }
      return { result: 1, status: 200 }
    })
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '3.3.3.3' } })
    const result = await applyRateLimit(req, 'kv-mid', { maxRequests: 5, windowSeconds: 60 })
    expect(result).toBeNull() // allowed (3 ≤ 5)
    const paths = fetchCalls.map((c) => new URL(c.url).pathname)
    expect(paths.some((p) => p.startsWith('/incr/'))).toBe(true)
    expect(paths.some((p) => p.startsWith('/expire/'))).toBe(false)
  })

  it('returns 429 with retryAfter when count exceeds maxRequests', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'tok'
    stubKvFetch(() => ({ result: 99, status: 200 }))
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '4.4.4.4' } })
    const result = await applyRateLimit(req, 'kv-over', { maxRequests: 5, windowSeconds: 60 })
    expect(result).not.toBeNull()
    expect(result!.status).toBe(429)
    expect(result!.headers.get('Retry-After')).toBe('60')
    const body = await result!.json()
    expect(body.error).toBe('rate_limited')
    expect(body.retryAfter).toBe(60)
  })

  it('falls back to in-memory when KV INCR returns non-OK', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'tok'
    stubKvFetch(() => ({ status: 500 }))
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '5.5.5.5' } })
    const result = await applyRateLimit(req, 'kv-down', { maxRequests: 5, windowSeconds: 60 })
    // In-memory bucket is fresh for this new key → allowed.
    expect(result).toBeNull()
  })

  it('falls back to in-memory when fetch throws (network error)', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'tok'
    globalThis.fetch = (async () => { throw new Error('econnrefused') }) as unknown as typeof fetch
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '6.6.6.6' } })
    const result = await applyRateLimit(req, 'kv-net-err', { maxRequests: 5, windowSeconds: 60 })
    expect(result).toBeNull() // memory fallback allowed (fresh key)
  })

  it('strips trailing slash from KV_REST_API_URL', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test/'
    process.env.KV_REST_API_TOKEN = 'tok'
    stubKvFetch(() => ({ result: 1, status: 200 }))
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '7.7.7.7' } })
    await applyRateLimit(req, 'kv-slash', { maxRequests: 5, windowSeconds: 60 })
    // URL must not contain a double slash before /incr/.
    const incrCall = fetchCalls.find((c) => new URL(c.url).pathname.startsWith('/incr/'))
    expect(incrCall).toBeDefined()
    expect(incrCall!.url).not.toMatch(/\/\/incr/)
  })

  it('sends Authorization: Bearer header from KV_REST_API_TOKEN', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    process.env.KV_REST_API_TOKEN = 'my-secret-token'
    stubKvFetch(() => ({ result: 1, status: 200 }))
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '8.8.8.8' } })
    await applyRateLimit(req, 'kv-auth', { maxRequests: 5, windowSeconds: 60 })
    const incrCall = fetchCalls.find((c) => new URL(c.url).pathname.startsWith('/incr/'))
    expect(incrCall).toBeDefined()
    const headers = incrCall!.init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bearer my-secret-token')
  })

  it('falls back to in-memory when only KV_REST_API_URL is set (no token)', async () => {
    process.env.KV_REST_API_URL = 'https://kv.test'
    delete process.env.KV_REST_API_TOKEN
    let fetched = false
    globalThis.fetch = (async () => { fetched = true; return new Response('') }) as unknown as typeof fetch
    const req = new Request('http://localhost/x', { headers: { 'x-real-ip': '9.9.9.9' } })
    const result = await applyRateLimit(req, 'kv-no-token', { maxRequests: 5, windowSeconds: 60 })
    expect(result).toBeNull()
    expect(fetched).toBe(false) // KV path skipped due to incomplete env
  })
})
