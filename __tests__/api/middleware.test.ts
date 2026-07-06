/**
 * middleware.ts — CSP nonce wiring (A6-1, 2026-07-06).
 *
 * The A6-1 landmine: the nonce was only emitted as `x-nonce` with zero
 * consumers, so enforcing CSP would have blocked every Next inline script.
 * The fix follows the documented Next.js pattern — the strict nonce'd policy
 * rides the REQUEST headers (where Next reads the nonce during SSR) and the
 * RESPONSE serves it Report-Only by default, enforcing under
 * QUANTAN_CSP_ENFORCE=1.
 *
 * NextResponse.next({ request }) encodes forwarded request headers onto the
 * response as `x-middleware-request-<name>`, which is what we assert against.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

function run(url = 'https://quantan.vercel.app/backtest'): ReturnType<typeof middleware> {
  return middleware(new NextRequest(url))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('middleware CSP (A6-1)', () => {
  it('serves Report-Only by default — never enforcing without the owner flag', () => {
    vi.stubEnv('QUANTAN_CSP_ENFORCE', '')
    const res = run()
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    const ro = res.headers.get('Content-Security-Policy-Report-Only')
    expect(ro).toContain("default-src 'self'")
    expect(ro).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
  })

  it('forwards the SAME nonce\'d policy on the request headers (Next SSR reads it there)', () => {
    vi.stubEnv('QUANTAN_CSP_ENFORCE', '')
    const res = run()
    const forwarded = res.headers.get('x-middleware-request-content-security-policy')
    expect(forwarded).not.toBeNull()
    expect(forwarded).toBe(res.headers.get('Content-Security-Policy-Report-Only'))
    // x-nonce matches the nonce embedded in the policy
    const xNonce = res.headers.get('x-middleware-request-x-nonce')
    expect(forwarded).toContain(`'nonce-${xNonce}'`)
  })

  it('switches the response header to enforcing under QUANTAN_CSP_ENFORCE=1', () => {
    vi.stubEnv('QUANTAN_CSP_ENFORCE', '1')
    const res = run()
    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeNull()
  })

  it('never emits unsafe-eval in production mode', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = run()
    const ro = res.headers.get('Content-Security-Policy-Report-Only')
    expect(ro).not.toContain('unsafe-eval')
    // style-src keeps unsafe-inline (Next injects inline styles) — unchanged.
    expect(ro).toContain("style-src 'self' 'unsafe-inline'")
  })

  it('issues the CSRF cookie when missing (Q-055-NEW, unchanged)', () => {
    const res = run()
    expect(res.cookies.get('quantan_csrf')?.value).toMatch(/^[0-9a-f]{32}$/)
  })
})
