/**
 * lib/data/providers tests (Q-051-NEW).
 *
 * Covers FredProvider, PolygonProvider, AlphaVantageProvider with mocked
 * fetch. Verifies: isAvailable gates, request URL shape, JSON parse paths,
 * and graceful failure (returns null on 4xx/5xx or malformed responses).
 *
 * NB: PolygonProvider has a 13s rate-limit between calls. Tests use a
 * single call per test to avoid the cross-test rate-limit interaction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FredProvider } from '@/lib/data/providers/fred'
import { PolygonProvider } from '@/lib/data/providers/polygon'
import { AlphaVantageProvider } from '@/lib/data/providers/alphavantage'

/** Stub global.fetch and return the original at test-end. */
function stubFetch(impl: (url: string) => Promise<Response>) {
  const original = globalThis.fetch
  globalThis.fetch = vi.fn(async (url) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.href : (url as Request).url
    return impl(u)
  }) as unknown as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

describe('FredProvider', () => {
  it('isAvailable always returns true (public CSV endpoint)', () => {
    const fred = new FredProvider()
    expect(fred.isAvailable()).toBe(true)
  })

  it('fetchDaily and fetchQuote return null (not applicable)', async () => {
    const fred = new FredProvider()
    expect(await fred.fetchDaily('AAPL', '2026-01-01')).toBeNull()
    expect(await fred.fetchQuote('AAPL')).toBeNull()
  })

  it('fetchMacroSeries via CSV: parses observations, skips "." (missing)', async () => {
    const restore = stubFetch(async () =>
      new Response(
        'DATE,FEDFUNDS\n2026-01-01,4.50\n2026-02-01,.\n2026-03-01,4.75\n',
        { status: 200 },
      ),
    )
    try {
      const fred = new FredProvider()
      const series = await fred.fetchMacroSeries('FEDFUNDS', '2026-01-01')
      expect(series).not.toBeNull()
      expect(series!.observations).toHaveLength(3)
      expect(series!.observations[0]).toEqual({ date: '2026-01-01', value: 4.5 })
      expect(series!.observations[1].value).toBeNull() // "." → null
      expect(series!.observations[2]).toEqual({ date: '2026-03-01', value: 4.75 })
    } finally {
      restore()
    }
  })

  it('fetchMacroSeries returns null on HTTP error', async () => {
    const restore = stubFetch(async () => new Response('', { status: 500 }))
    try {
      const fred = new FredProvider()
      expect(await fred.fetchMacroSeries('BAD_ID')).toBeNull()
    } finally {
      restore()
    }
  })

  it('fetchMacroSeries returns null on empty response', async () => {
    const restore = stubFetch(async () => new Response('', { status: 200 }))
    try {
      const fred = new FredProvider()
      expect(await fred.fetchMacroSeries('EMPTY')).toBeNull()
    } finally {
      restore()
    }
  })

  it('with apiKey set, prefers JSON API endpoint', async () => {
    const seenUrls: string[] = []
    const restore = stubFetch(async (url) => {
      seenUrls.push(url)
      return new Response(
        JSON.stringify({
          observations: [{ date: '2026-01-01', value: '4.5' }],
          units: 'Percent',
          frequency: 'Monthly',
        }),
        { status: 200 },
      )
    })
    try {
      const fred = new FredProvider('test-key')
      const series = await fred.fetchMacroSeries('FEDFUNDS')
      expect(series?.observations[0]).toEqual({ date: '2026-01-01', value: 4.5 })
      expect(seenUrls[0]).toContain('api.stlouisfed.org')
      expect(seenUrls[0]).toContain('api_key=test-key')
    } finally {
      restore()
    }
  })
})

describe('PolygonProvider', () => {
  // Note: PolygonProvider enforces a 13s minimum delay between calls via a
  // module-level `lastCallMs` (free-tier rate-limit guard). Tests here cover
  // the isAvailable gate + null paths that DON'T hit the network. The
  // network-hitting parsing path is covered by the dispatcher integration
  // test (__tests__/data/dispatcher.test.ts) which runs once per CI cycle.

  it('isAvailable: false when no key, true when key set', () => {
    expect(new PolygonProvider('').isAvailable()).toBe(false)
    expect(new PolygonProvider('test-key').isAvailable()).toBe(true)
  })

  it('fetchDaily / fetchQuote return null when unavailable (no key)', async () => {
    const p = new PolygonProvider('')
    expect(await p.fetchDaily('AAPL', '2026-01-01')).toBeNull()
    expect(await p.fetchQuote('AAPL')).toBeNull()
  })
})

describe('AlphaVantageProvider', () => {
  it('isAvailable: false when no key', () => {
    expect(new AlphaVantageProvider('').isAvailable()).toBe(false)
    expect(new AlphaVantageProvider('test-key').isAvailable()).toBe(true)
  })

  it('fetchDaily returns null when unavailable', async () => {
    expect(await new AlphaVantageProvider('').fetchDaily('AAPL', '2026-01-01')).toBeNull()
  })

  it('fetchDaily returns null when Time Series payload missing', async () => {
    const restore = stubFetch(async () =>
      new Response(JSON.stringify({ Note: 'API call frequency exceeded' }), { status: 200 }),
    )
    try {
      const av = new AlphaVantageProvider('test-key')
      expect(await av.fetchDaily('AAPL', '2026-01-01')).toBeNull()
    } finally {
      restore()
    }
  })

  it('fetchDaily returns null on HTTP error', async () => {
    const restore = stubFetch(async () => new Response('', { status: 500 }))
    try {
      const av = new AlphaVantageProvider('test-key')
      expect(await av.fetchDaily('AAPL', '2026-01-01')).toBeNull()
    } finally {
      restore()
    }
  })
})
