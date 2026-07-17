/**
 * Q-051 continuation (2026-07-17) — direct tests for lib/data/bloomberg/**
 * so the directory can leave the coverage exclude list.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  toBloombergSecurity,
  fromBloombergSecurity,
} from '@/lib/data/bloomberg/toBloombergSecurity'
import {
  bridgeSecretMatches,
  isBloombergBridgeConfigured,
  fetchBloombergQuotesViaBridge,
  bridgeHealthCheck,
} from '@/lib/data/bloomberg/bridgeClient'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── toBloombergSecurity / fromBloombergSecurity ─────────────────────────────

describe('toBloombergSecurity — mapping branches', () => {
  it('default: dot → slash + " US Equity" suffix, case-normalized', () => {
    expect(toBloombergSecurity('aapl')).toBe('AAPL US Equity')
    expect(toBloombergSecurity('BRK.B')).toBe('BRK/B US Equity')
    expect(toBloombergSecurity('  msft  ')).toBe('MSFT US Equity')
  })

  it('index symbols: ^VIX special-case, other ^ → " Index"', () => {
    expect(toBloombergSecurity('^VIX')).toBe('VIX Index')
    expect(toBloombergSecurity('^GSPC')).toBe('GSPC Index')
  })

  it('per-ticker JSON override wins; corrupt JSON is ignored', () => {
    const map = JSON.stringify({ 'BRK.B': 'BRK/B UN Equity' })
    expect(toBloombergSecurity('brk.b', map)).toBe('BRK/B UN Equity')
    expect(toBloombergSecurity('AAPL', map)).toBe('AAPL US Equity') // not in map
    expect(toBloombergSecurity('BRK.B', '{not json')).toBe('BRK/B US Equity')
    expect(toBloombergSecurity('BRK.B', JSON.stringify({ 'BRK.B': '' }))).toBe('BRK/B US Equity')
  })
})

describe('fromBloombergSecurity — inverse mapping', () => {
  it('round-trips the common forms', () => {
    expect(fromBloombergSecurity('AAPL US Equity')).toBe('AAPL')
    expect(fromBloombergSecurity('BRK/B US Equity')).toBe('BRK.B')
    expect(fromBloombergSecurity('VIX Index')).toBe('^VIX')
    expect(fromBloombergSecurity('S P X Index')).toBe('^SPX') // whitespace collapsed
  })
  it('fallthrough: unknown format upper-cased verbatim', () => {
    expect(fromBloombergSecurity('weird-id')).toBe('WEIRD-ID')
  })
})

// ─── bridgeSecretMatches (timing-safe compare, F7.5/Q-037) ───────────────────

describe('bridgeSecretMatches', () => {
  it('no expected secret configured → always true (auth disabled)', () => {
    expect(bridgeSecretMatches(null, undefined)).toBe(true)
    expect(bridgeSecretMatches('anything', '  ')).toBe(true)
  })
  it('expected set: null/missing/mismatch → false, exact match → true', () => {
    expect(bridgeSecretMatches(null, 's3cret')).toBe(false)
    expect(bridgeSecretMatches(undefined, 's3cret')).toBe(false)
    expect(bridgeSecretMatches('s3cret!', 's3cret')).toBe(false) // length mismatch
    expect(bridgeSecretMatches('s3creT', 's3cret')).toBe(false) // same length, wrong
    expect(bridgeSecretMatches('s3cret', 's3cret')).toBe(true)
  })
})

// ─── fetchBloombergQuotesViaBridge ───────────────────────────────────────────

type FetchCall = { url: string; init: RequestInit }

function stubFetch(response: Partial<Response> | Error, calls?: FetchCall[]) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls?.push({ url, init })
    if (response instanceof Error) throw response
    return response as Response
  })
}

describe('fetchBloombergQuotesViaBridge', () => {
  it('returns null when the bridge is unconfigured or tickers empty', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', '')
    expect(isBloombergBridgeConfigured()).toBe(false)
    expect(await fetchBloombergQuotesViaBridge(['AAPL'])).toBeNull()
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example')
    expect(isBloombergBridgeConfigured()).toBe(true)
    expect(await fetchBloombergQuotesViaBridge([])).toBeNull()
  })

  it('normalizes flexible row keys and formats market cap', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example/')
    vi.stubEnv('BLOOMBERG_BRIDGE_SECRET', 'topsecret')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const calls: FetchCall[] = []
    stubFetch(
      {
        ok: true,
        json: async () => ({
          quotes: [
            // Bloomberg-style keys + security-name symbol + numeric mcap
            {
              security: 'AAPL US Equity', LAST_PRICE: '190.5', NET_CHANGE: 1.5,
              PCT_CHG: 0.79, VOLUME: 1000, HIGH_52WEEK: 200, LOW_52WEEK: 150,
              PE_RATIO: 30, MARKET_CAP: 3_500_000_000_000, BID: 190.4, ASK: 190.6,
            },
            // Yahoo-style keys + plain symbol + string mcap
            { symbol: 'msft ', regularMarketPrice: 400, regularMarketChange: -2, marketCap: '3.0T' },
            // No usable price → skipped
            { symbol: 'BAD', last: 0 },
            // No symbol → skipped
            { last: 10 },
            'not-an-object',
          ],
        }),
      } as Partial<Response>,
      calls,
    )

    const map = await fetchBloombergQuotesViaBridge(['AAPL', 'MSFT'])
    expect(map).not.toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://bridge.example/quotes') // trailing slash stripped
    expect((calls[0].init.headers as Record<string, string>)['X-Bridge-Secret']).toBe('topsecret')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ tickers: ['AAPL', 'MSFT'] })

    const aapl = map!.get('AAPL')!
    expect(aapl.price).toBe(190.5) // string parsed
    expect(aapl.change).toBe(1.5)
    expect(aapl.changePct).toBe(0.79)
    expect(aapl.volume).toBe(1000)
    expect(aapl.high52w).toBe(200)
    expect(aapl.low52w).toBe(150)
    expect(aapl.pe).toBe(30)
    expect(aapl.marketCap).toBe('3.5T') // F4.7 compact formatting
    expect(aapl.bid).toBe(190.4)
    expect(aapl.ask).toBe(190.6)
    expect(aapl.dataSource).toBe('bloomberg')

    const msft = map!.get('MSFT')!
    expect(msft.price).toBe(400)
    expect(msft.marketCap).toBe('3.0T') // string passthrough
    expect(msft.bid).toBeUndefined()

    expect(map!.has('BAD')).toBe(false)
    expect(map!.size).toBe(2)
  })

  it('fail-closed: non-OK HTTP, thrown fetch, and zero usable rows → null', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    stubFetch({ ok: false, status: 503, text: async () => 'down' } as Partial<Response>)
    expect(await fetchBloombergQuotesViaBridge(['AAPL'])).toBeNull()
    stubFetch(new Error('ECONNREFUSED'))
    expect(await fetchBloombergQuotesViaBridge(['AAPL'])).toBeNull()
    stubFetch({ ok: true, json: async () => ({ quotes: [] }) } as Partial<Response>)
    expect(await fetchBloombergQuotesViaBridge(['AAPL'])).toBeNull()
  })
})

// ─── bridgeHealthCheck ───────────────────────────────────────────────────────

describe('bridgeHealthCheck', () => {
  it('unconfigured → ok:false with explicit reason', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', '')
    expect(await bridgeHealthCheck()).toEqual({ ok: false, error: 'BLOOMBERG_BRIDGE_URL not set' })
  })

  it('healthy endpoint → ok:true with latency; HTTP error → ok:false', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example/')
    const calls: FetchCall[] = []
    stubFetch({ ok: true, status: 200 } as Partial<Response>, calls)
    const healthy = await bridgeHealthCheck()
    expect(healthy.ok).toBe(true)
    expect(healthy.error).toBeUndefined()
    expect(typeof healthy.latencyMs).toBe('number')
    expect(calls[0].url).toBe('https://bridge.example/health')

    stubFetch({ ok: false, status: 500 } as Partial<Response>)
    const sick = await bridgeHealthCheck()
    expect(sick).toMatchObject({ ok: false, error: 'HTTP 500' })
  })

  it('network failure → sanitized error, never a throw', async () => {
    vi.stubEnv('BLOOMBERG_BRIDGE_URL', 'https://bridge.example')
    stubFetch(new Error('socket hang up'))
    const res = await bridgeHealthCheck()
    expect(res.ok).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error!.length).toBeGreaterThan(0)
  })
})
