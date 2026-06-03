import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { isValidApiKey } from '@/lib/auth/apiKey'

// ── Mocks (vi.hoisted so the factories can reference them safely) ────────────
// validateCsrf is controllable per-test to isolate the API-key path
// (default false = "no valid CSRF token", i.e. a non-browser / cross-site call).
const { validateCsrfMock, getServerSessionMock } = vi.hoisted(() => ({
  validateCsrfMock: vi.fn(() => false),
  getServerSessionMock: vi.fn(),
}))

vi.mock('@/lib/api/csrf', () => ({ validateCsrf: validateCsrfMock }))
// Neutralize the per-IP rate limiter so it never interferes with auth assertions.
vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn(async () => null) }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))

import { POST } from '@/app/api/trading-agents/[ticker]/route'

const PARAMS = { params: Promise.resolve({ ticker: 'AAPL' }) }
const SECRET = 'super-secret-key-value'

function postReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/trading-agents/AAPL', {
    method: 'POST',
    headers,
  })
}

const adminSession = { user: { id: 'u1', email: 'a@b.c' } }

// ── Helper unit tests (D4-1 core) ───────────────────────────────────────────
describe('isValidApiKey (fail-closed, constant-time)', () => {
  const ORIGINAL = process.env.QUANTAN_API_KEY
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QUANTAN_API_KEY
    else process.env.QUANTAN_API_KEY = ORIGINAL
  })

  it('rejects when the server secret is unset (fail-closed)', () => {
    delete process.env.QUANTAN_API_KEY
    expect(isValidApiKey('anything')).toBe(false)
    expect(isValidApiKey('')).toBe(false)
    expect(isValidApiKey(null)).toBe(false)
  })

  it('rejects when the secret is set but no key is presented', () => {
    process.env.QUANTAN_API_KEY = SECRET
    expect(isValidApiKey(null)).toBe(false)
    expect(isValidApiKey(undefined)).toBe(false)
    expect(isValidApiKey('')).toBe(false)
  })

  it('rejects a wrong key (including a short probe — must not throw)', () => {
    process.env.QUANTAN_API_KEY = SECRET
    expect(isValidApiKey('x')).toBe(false) // length-mismatch must not throw
    expect(isValidApiKey('wrong')).toBe(false)
    expect(isValidApiKey(SECRET + 'x')).toBe(false)
  })

  it('accepts the exact matching key', () => {
    process.env.QUANTAN_API_KEY = SECRET
    expect(isValidApiKey(SECRET)).toBe(true)
  })
})

// ── Route auth-gate tests (D4-1 wiring) ─────────────────────────────────────
//
// These assert the SECURITY BOUNDARY (reject vs admit), not the sidecar proxy.
// A request that clears both the CSRF gate and the auth gate proceeds to config
// logic, which (no TRADING_AGENTS_BASE in the test env) returns a config error —
// NOT 401/403. So "admitted" == status is neither 401 nor 403.
describe('POST /api/trading-agents/[ticker] — auth gate (D4-1)', () => {
  const ORIGINAL = process.env.QUANTAN_API_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    validateCsrfMock.mockReturnValue(false)
    getServerSessionMock.mockResolvedValue(null) // unauthenticated by default
  })
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QUANTAN_API_KEY
    else process.env.QUANTAN_API_KEY = ORIGINAL
  })

  it('rejects a bare x-api-key when no secret is configured (the OLD bypass is closed)', async () => {
    delete process.env.QUANTAN_API_KEY
    const res = await POST(postReq({ 'x-api-key': 'literally-anything' }), PARAMS)
    // Invalid key + no valid CSRF → blocked at the CSRF gate.
    expect(res.status).toBe(403)
  })

  it('rejects a wrong x-api-key when a secret IS configured', async () => {
    process.env.QUANTAN_API_KEY = SECRET
    const res = await POST(postReq({ 'x-api-key': 'not-the-secret' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('rejects when there is no key, no session, and no CSRF token', async () => {
    process.env.QUANTAN_API_KEY = SECRET
    const res = await POST(postReq(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('admits a correct x-api-key even without CSRF (server-to-server path)', async () => {
    process.env.QUANTAN_API_KEY = SECRET
    const res = await POST(postReq({ 'x-api-key': SECRET }), PARAMS)
    // Valid key clears CSRF + auth gates → not rejected.
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('admits an authenticated session that also carries a valid CSRF token', async () => {
    delete process.env.QUANTAN_API_KEY
    getServerSessionMock.mockResolvedValue(adminSession)
    validateCsrfMock.mockReturnValue(true) // browser supplied the double-submit token
    const res = await POST(postReq(), PARAMS)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('rejects an invalid ticker only AFTER auth is satisfied (valid key)', async () => {
    process.env.QUANTAN_API_KEY = SECRET
    const res = await POST(
      postReq({ 'x-api-key': SECRET }),
      { params: Promise.resolve({ ticker: 'not a ticker!!' }) },
    )
    expect(res.status).toBe(400)
  })
})
