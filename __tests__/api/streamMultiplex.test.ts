/**
 * Tests for the multiplexed SSE endpoint — GET /api/stream?tickers=…
 *
 * Context (2026-08-14): the dashboard used to open ONE EventSource per ticker
 * (13 of them). Browsers cap HTTP/1.1 at ~6 connections per origin, so most of
 * those streams never opened, and every stream that DID open pinned its own
 * serverless invocation for up to the 300 s ceiling. This route carries all
 * the tickers on one connection with one batched upstream call per tick.
 *
 * What's pinned here:
 *   • input validation (missing / invalid / over-cap → 400) BEFORE the rate
 *     limiter, so probes can't drain an IP's bucket;
 *   • the cap agreeing with the client hook's MAX_LIVE_STREAMS;
 *   • maxDuration agreeing with the streamBudget SSOT (the literal cannot be
 *     imported — Next reads route segment config by static analysis — so a
 *     test is the only thing standing between the two copies and drift);
 *   • the multiplexing itself: N tickers → N `quote` events with distinct
 *     `ticker` fields on ONE response body.
 *
 * Deliberately NOT covered: the EventSource client lifecycle (repo precedent
 * — a browser-side harness is disproportionately heavy for the coverage).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock yahoo-finance2 (constructor-style usage) so no real network calls
// happen. vi.hoisted keeps the mock fn reachable inside the hoisted factory.
/** Loose row shape — the route reads these fields structurally. */
interface MockQuoteRow {
  symbol: string
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketVolume?: number
}

const { quoteMock } = vi.hoisted(() => ({
  // Full arity (query, queryOptions, moduleOptions) so the call-args
  // assertion below stays type-safe.
  quoteMock: vi.fn(async (
    symbols: unknown,
    _queryOptions?: unknown,
    _moduleOptions?: unknown,
  ): Promise<MockQuoteRow[]> => {
    const list = Array.isArray(symbols) ? symbols : [symbols]
    return list.map((s, i) => ({
      symbol: String(s),
      regularMarketPrice: 100 + i,
      regularMarketChange: 1.5,
      regularMarketChangePercent: 1.25,
      regularMarketVolume: 1_000 + i,
    }))
  }),
}))
vi.mock('yahoo-finance2', () => ({
  default: class YahooFinance {
    quote = quoteMock
  },
}))

import { GET, maxDuration } from '@/app/api/stream/route'
import { MAX_STREAM_TICKERS, parseTickerParam } from '@/lib/api/streamTickers'
import { STREAM_MAX_DURATION_S } from '@/lib/api/streamBudget'
import { MAX_LIVE_STREAMS } from '@/hooks/useLiveQuotes'

const DASHBOARD_TICKERS = [
  'XLK', 'XLE', 'XLF', 'XLV', 'XLY', 'XLI', 'XLC', 'XLB', 'XLU', 'XLRE', 'XLP', 'SPY', 'QQQ',
]

/** Request with a distinct IP so per-case rate-limit buckets stay isolated. */
function req(query: string, ip = '10.9.0.1'): Request {
  return new Request(`http://localhost/api/stream${query}`, {
    headers: { 'x-real-ip': ip },
  })
}

interface SseEvent { event: string; data: Record<string, unknown> }

/**
 * Drain the SSE body until the aggregated `market_state` event arrives (the
 * server emits it right after the initial quote burst, so it is a
 * deterministic terminator), then abort the request.
 *
 * The abort matters: the route arms 15 s / 30 s intervals and a 240 s close
 * timer. Without firing the client-disconnect path those timers would hold
 * the Node event loop open and stall the whole suite.
 */
async function drainInitialBurst(query: string, ip: string): Promise<{ status: number; contentType: string | null; events: SseEvent[] }> {
  const controller = new AbortController()
  const request = new Request(`http://localhost/api/stream${query}`, {
    headers: { 'x-real-ip': ip },
    signal: controller.signal,
  })
  const res = await GET(request)
  const contentType = res.headers.get('Content-Type')
  if (!res.body) {
    controller.abort()
    return { status: res.status, contentType, events: [] }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const events: SseEvent[] = []
  try {
    // Bounded so a contract change can never hang the suite.
    for (let i = 0; i < 64; i++) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      for (const block of chunk.split('\n\n')) {
        // [\s\S] rather than the `s` flag — tsconfig targets ES2017.
        const m = /^event: (\w+)\ndata: ([\s\S]*)$/.exec(block.trim())
        if (!m) continue
        events.push({ event: m[1], data: JSON.parse(m[2]) as Record<string, unknown> })
      }
      if (events.some((e) => e.event === 'market_state')) break
    }
  } finally {
    controller.abort()          // fires the route's client-disconnect cleanup
    await reader.cancel().catch(() => { /* already closed */ })
  }
  return { status: res.status, contentType, events }
}

describe('GET /api/stream (multiplexed) — request validation', () => {
  beforeEach(() => {
    // Force the in-process limiter (no KV), per route-rate-limit.test.ts.
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.clearAllMocks()
  })

  it('rejects a missing `tickers` parameter with 400', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'missing_tickers' })
  })

  it('rejects an empty `tickers` parameter with 400', async () => {
    expect((await GET(req('?tickers='))).status).toBe(400)
    expect((await GET(req('?tickers=%20'))).status).toBe(400)
  })

  it('rejects a path-traversal-shaped ticker with 400', async () => {
    const res = await GET(req('?tickers=../etc'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_ticker' })
  })

  it('rejects the whole request when ANY ticker is invalid', async () => {
    // Strict by design: a client asking for a symbol it will never receive
    // quotes for should learn that immediately, not silently get 12 of 13.
    const res = await GET(req('?tickers=XLK,XLE,not a ticker'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_ticker' })
  })

  it('rejects more than MAX_STREAM_TICKERS symbols with 400', async () => {
    const tooMany = Array.from({ length: MAX_STREAM_TICKERS + 1 }, (_, i) => `AA${i}`)
    const res = await GET(req(`?tickers=${tooMany.join(',')}`))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'too_many_tickers' })
  })

  it('never calls upstream for a rejected request', async () => {
    await GET(req('?tickers=../etc'))
    await GET(req(''))
    expect(quoteMock).not.toHaveBeenCalled()
  })
})

describe('parseTickerParam — pure validation logic', () => {
  it('normalizes, upper-cases and de-duplicates', () => {
    const parsed = parseTickerParam('xlk,XLK, xle ,SPY')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.symbols).toEqual(['XLK', 'XLE', 'SPY'])
  })

  it('applies the shared US-index alias (VIX → ^VIX)', () => {
    const parsed = parseTickerParam('VIX')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.symbols).toEqual(['^VIX'])
  })

  it('accepts exactly MAX_STREAM_TICKERS symbols (boundary)', () => {
    const exact = Array.from({ length: MAX_STREAM_TICKERS }, (_, i) => `AA${i}`)
    const parsed = parseTickerParam(exact.join(','))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.symbols).toHaveLength(MAX_STREAM_TICKERS)
  })

  it('rejects null, empty and whitespace-only input', () => {
    for (const bad of [null, '', '   ']) {
      expect(parseTickerParam(bad).ok).toBe(false)
    }
  })

  it('the whole dashboard subscription is valid and fits the cap', () => {
    const parsed = parseTickerParam(DASHBOARD_TICKERS.join(','))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.symbols).toEqual(DASHBOARD_TICKERS)
  })
})

describe('GET /api/stream (multiplexed) — budget + cap contracts', () => {
  it('THE INVARIANT: maxDuration equals the streamBudget ceiling', () => {
    // The literal in the route cannot import the SSOT (Next reads route
    // segment config by static analysis and rejects a non-literal — a
    // build-only failure that neither tsc nor vitest can catch). This
    // assertion is what keeps the duplicated literal honest.
    expect(maxDuration).toBe(STREAM_MAX_DURATION_S)
  })

  it('server cap equals the client hook cap (MAX_LIVE_STREAMS)', () => {
    // A client that respects its own cap must never be rejected by the server.
    expect(MAX_STREAM_TICKERS).toBe(MAX_LIVE_STREAMS)
  })

  it('the singular route keeps its own maxDuration (the new route is additive)', async () => {
    const singular = await import('@/app/api/stream/[ticker]/route')
    expect(singular.maxDuration).toBe(STREAM_MAX_DURATION_S)
  })

  it('exports ONLY route-legal fields', async () => {
    // Next.js type-checks a route's export surface at build time: anything
    // that is not an HTTP method handler or a known route segment config
    // field fails with `"X" is not a valid Route export field`. This bit for
    // real on 2026-08-14 — the parser and the cap were first written as route
    // exports for testability; tsc AND the full vitest suite passed, and only
    // `next build` rejected it. Hence lib/api/streamTickers.ts, and hence this
    // test: it moves that failure from the build back into the suite.
    const routeModule = await import('@/app/api/stream/route')
    const LEGAL = new Set([
      'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
      'dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime',
      'preferredRegion', 'maxDuration', 'generateStaticParams',
    ])
    const illegal = Object.keys(routeModule).filter((k) => !LEGAL.has(k))
    expect(illegal).toEqual([])
  })
})

describe('GET /api/stream (multiplexed) — the multiplexing itself', () => {
  beforeEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    vi.clearAllMocks()
  })

  it('carries all 13 dashboard tickers on ONE response body', async () => {
    const { status, contentType, events } = await drainInitialBurst(
      `?tickers=${DASHBOARD_TICKERS.join(',')}`,
      '10.9.1.1',
    )
    expect(status).toBe(200)
    expect(contentType).toBe('text/event-stream')

    const quotes = events.filter((e) => e.event === 'quote')
    const tickers = quotes.map((e) => e.data.ticker)
    expect(new Set(tickers).size).toBe(DASHBOARD_TICKERS.length)
    expect(tickers).toEqual(expect.arrayContaining(DASHBOARD_TICKERS))

    // ONE batched upstream call for the whole subscription — not 13.
    expect(quoteMock).toHaveBeenCalledTimes(1)
    expect(quoteMock).toHaveBeenCalledWith(DASHBOARD_TICKERS, undefined, { validateResult: false })

    // Exactly one aggregated market_state, not one per ticker.
    expect(events.filter((e) => e.event === 'market_state')).toHaveLength(1)
  })

  it('emits the singular route’s quote payload shape (plus ticker)', async () => {
    const { events } = await drainInitialBurst('?tickers=SPY', '10.9.1.2')
    const quote = events.find((e) => e.event === 'quote')
    expect(quote).toBeDefined()
    expect(quote!.data).toMatchObject({
      ticker: 'SPY',
      price: 100,
      change: 1.5,
      changePct: 1.25,
      volume: 1_000,
    })
    expect(typeof quote!.data.marketOpen).toBe('boolean')
    expect(typeof quote!.data.timestamp).toBe('string')
  })

  it('a partial upstream response degrades per-ticker, not per-stream', async () => {
    // Yahoo does not guarantee one row per requested symbol. Rows are matched
    // back BY SYMBOL, so a short (and reordered) response must still label
    // prices correctly and must not kill the stream.
    quoteMock.mockImplementationOnce(async () => [
      { symbol: 'QQQ', regularMarketPrice: 555, regularMarketChange: -2, regularMarketChangePercent: -0.4 },
      { symbol: 'XLE', regularMarketPrice: 88, regularMarketChange: 1, regularMarketChangePercent: 0.5 },
    ])
    const { status, events } = await drainInitialBurst('?tickers=XLE,XLK,QQQ', '10.9.1.3')
    expect(status).toBe(200)
    const quotes = events.filter((e) => e.event === 'quote')
    expect(quotes).toHaveLength(2)
    expect(quotes.find((q) => q.data.ticker === 'QQQ')!.data.price).toBe(555)
    expect(quotes.find((q) => q.data.ticker === 'XLE')!.data.price).toBe(88)
    // The stream stays up and still announces market state.
    expect(events.some((e) => e.event === 'market_state')).toBe(true)
  })

  it('a total upstream failure degrades instead of dropping the connection', async () => {
    quoteMock.mockImplementation(async () => { throw new Error('yahoo down') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { status, events } = await drainInitialBurst('?tickers=XLK,XLE', '10.9.1.4')
      expect(status).toBe(200)
      expect(events.filter((e) => e.event === 'quote')).toHaveLength(0)
      expect(events.find((e) => e.event === 'degraded')?.data).toMatchObject({
        code: 'initial_quote_unavailable',
      })
      // Still announces market state — the client keeps the connection.
      expect(events.some((e) => e.event === 'market_state')).toBe(true)
    } finally {
      warn.mockRestore()
      quoteMock.mockReset()
    }
  })
})
