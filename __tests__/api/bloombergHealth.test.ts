import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/bloomberg-bridge/health/route'
import { applyRateLimit } from '@/lib/api/rateLimit'

vi.mock('@/lib/api/rateLimit', () => ({ applyRateLimit: vi.fn() }))

const ACK = 'i-confirm-our-bloomberg-agreement-permits-this-redistribution'
const request = (key?: string) => new Request('http://localhost/api/bloomberg-bridge/health', {
  headers: key === undefined ? {} : { 'x-api-key': key },
})

beforeEach(() => {
  vi.stubEnv('QUANTAN_API_KEY', 'operator-test-key')
  vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example')
  vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', ACK)
  vi.mocked(applyRateLimit).mockResolvedValue(null)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

describe('Bloomberg health disclosure boundary', () => {
  it.each([
    ['', '', undefined],
    ['https://bridge.example', '', undefined],
    ['https://bridge.example', ACK, undefined],
    ['https://bridge.example', ACK, 'wrong-key'],
  ])('anonymous response is opaque for URL=%s ACK=%s key=%s', async (url, ack, key) => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', url)
    vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', ack)
    const response = await GET(request(key))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"status":"ok"}')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch).not.toHaveBeenCalled()
    // The rate limiter can fetch Redis; anonymous requests must not reach it.
    expect(applyRateLimit).not.toHaveBeenCalled()
  })

  it('does not authorize session cookies or query-string keys', async () => {
    const response = await GET(new Request(
      'http://localhost/api/bloomberg-bridge/health?api_key=operator-test-key', {
        headers: { cookie: 'next-auth.session-token=fixture-session; x-api-key=operator-test-key' },
      },
    ))
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(fetch).not.toHaveBeenCalled()
    expect(applyRateLimit).not.toHaveBeenCalled()
  })

  it('fails closed when no operator key is configured', async () => {
    vi.stubEnv('QUANTAN_API_KEY', '')
    expect(await (await GET(request('anything'))).json()).toEqual({ status: 'ok' })
    expect(fetch).not.toHaveBeenCalled()
    expect(applyRateLimit).not.toHaveBeenCalled()
  })

  it.each([['', 'off'], ['https://bridge.example', 'unacknowledged']])(
    'explains a closed gate to the operator without fetching (%s)', async (url, state) => {
      vi.stubEnv('BLOOMBERG_BRIDGE_URL', url)
      vi.stubEnv('BLOOMBERG_REDISTRIBUTION_ACK', '')
      const response = await GET(request('operator-test-key'))
      expect(await response.json()).toEqual({ status: 'ok', state })
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('allows an acknowledged operator probe with no secret in the response', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_SECRET', 'bridge-test-secret')
    const response = await GET(request('operator-test-key'))
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', state: 'enabled', reachable: true, latencyMs: expect.any(Number) })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://bridge.example/health', expect.objectContaining({
      headers: { 'X-Bridge-Secret': 'bridge-test-secret' },
    }))
    expect(applyRateLimit).toHaveBeenCalledTimes(1)
  })

  it('rate-limits authenticated diagnostics before probing', async () => {
    vi.mocked(applyRateLimit).mockResolvedValue(new Response('limited', { status: 429 }))
    const response = await GET(request('operator-test-key'))
    expect(response.status).toBe(429)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetch).not.toHaveBeenCalled()
  })
})
