import { NextRequest, NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import YahooFinance from 'yahoo-finance2'
import { fetchBloombergQuotesViaBridge, isBloombergBridgeConfigured } from '@/lib/data/bloomberg/bridgeClient'
import { mergeYahooAndBloomberg } from '@/lib/data/mergeQuotes'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'
import { errorResponse, withRetry } from '@/lib/api/reliability'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { formatCompactNumber } from '@/lib/format'

const yahooFinance = new YahooFinance()

// Phase 13 S2 fix (F4.10): expanded index-symbol normalization. Previously only
// `VIX` was mapped to `^VIX`; other US-index plain forms silently failed upstream
// with empty results.
//
// Phase 14 wave 22: import the canonical, strict normalizeTicker from
// @/lib/api/sanitize so every API route applies the same character whitelist
// (Q3-H-3 hardening from Phase 13). The prior in-file normalizer skipped
// the character whitelist — a caller could pass arbitrary characters
// (slashes, quotes, parens) that bypassed the F7.3 ticker-validation
// regression hardening present in the other routes. The strict version
// returns `null` for invalid input; we then drop or 400 on the request.
import { normalizeTicker as strictNormalizeTicker } from '@/lib/api/sanitize'

// Phase 13 S2 fix (F4.6): explicit number-or-null. Falsy fallback to 0 silently
// hid yahoo errors as "$0.00" on the UI.
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isoQuoteTime(q: { regularMarketTime?: unknown }): string | null {
  const t = q.regularMarketTime
  if (t instanceof Date) return t.toISOString()
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString()
  return null
}

/**
 * Public endpoint, no authentication required (F7.10 — Phase 13 S2 doc).
 *
 * Returns live or near-live prices for the requested tickers. Backed by
 * yahoo-finance2 with an optional Bloomberg-bridge upgrade when the
 * `BLOOMBERG_BRIDGE_URL` env var is configured.
 *
 * Rate-limit: 60 req/min per IP (per-process bucket — F4.3 distributed
 * implementation deferred to S3 with Vercel KV).
 *
 * Caching strategy (F4.9 — Phase 13 S2):
 *   The endpoint is rate-limited and caches at the CDN edge for 3 seconds
 *   with `stale-while-revalidate` for a further 5 seconds. This caps the
 *   downstream load on yahoo-finance2 — the previous `no-store` policy
 *   meant N concurrent users polling at 5s each fired N×M yahoo calls
 *   per 5-second window.  Edge-cache reduces upstream QPS by ~Nx.
 *
 *   Note: 3 seconds is below the SWR client-side `dedupingInterval`
 *   (2.5s) and the `refreshInterval` (5s) so freshness from a user's
 *   perspective is unchanged. Per the Phase 12 plan note,
 *   "5s = standard institutional cadence" — 3s edge TTL is well within.
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 req/min per IP (prices poll frequently).
  const rateLimitResponse = applyRateLimit(request, 'prices', { maxRequests: 60, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  const url = new URL(request.url)
  const queryTickers = url.searchParams.get('tickers')

  // Phase 14: cap ticker count per request. Yahoo's `quote` endpoint accepts
  // arbitrary list lengths but each ticker = upstream work; an unbounded
  // request can exhaust the per-IP rate limit on Yahoo and our own retry
  // budget. Cite: OWASP API4:2023 — Unrestricted Resource Consumption.
  const MAX_TICKERS_PER_REQUEST = 50
  if (queryTickers) {
    const split = queryTickers.split(',')
    if (split.length > MAX_TICKERS_PER_REQUEST) {
      return NextResponse.json(
        { error: 'too_many_tickers', message: `Maximum ${MAX_TICKERS_PER_REQUEST} tickers per request` },
        { status: 400 },
      )
    }
  }

  // Phase 14 wave 22: strict per-token validation. Each ticker passes through
  // the canonical normalizeTicker that enforces the F7.3 character whitelist
  // (`^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?`). Invalid tokens are
  // dropped. If every supplied ticker is invalid, return 400 so the caller
  // sees the typed-error envelope instead of an empty `quotes: []`.
  const tickers = queryTickers
    ? (() => {
        const raw = queryTickers.split(',')
        const cleaned: string[] = []
        for (const t of raw) {
          const norm = strictNormalizeTicker(t)
          if (norm) cleaned.push(norm)
        }
        return cleaned
      })()
    : [...SECTORS.map((s) => s.etf), 'SPY', 'QQQ']

  if (queryTickers && tickers.length === 0) {
    return NextResponse.json(
      { error: 'invalid_tickers', message: 'No valid ticker symbols in request.' },
      { status: 400 },
    )
  }

  // F4.1 (Phase 13 S2): Bloomberg-bridge fetch was previously wrapped in a
  // silent .catch(() => null), so when the bridge degraded the response
  // showed `dataSource: 'yahoo'` with no signal that bloomberg was meant to
  // be primary. Now we capture the failure as a structured outcome and
  // expose `bloombergStatus` in the response so clients can display a
  // "bloomberg degraded" banner without breaking the data flow.
  type BridgeOutcome =
    | { ok: true; map: Awaited<ReturnType<typeof fetchBloombergQuotesViaBridge>> | null }
    | { ok: false; error: string }

  const bridgeConfigured = isBloombergBridgeConfigured()
  const bridgePromise: Promise<BridgeOutcome> = bridgeConfigured
    ? fetchBloombergQuotesViaBridge(tickers).then(
        (map) => ({ ok: true as const, map }),
        (e) => {
          console.warn('[Prices API] Bloomberg bridge failed:', e instanceof Error ? e.message : String(e))
          return { ok: false as const, error: e instanceof Error ? e.message : 'bridge unreachable' }
        },
      )
    : Promise.resolve({ ok: true as const, map: null })

  try {
    const [raw, bridgeOutcome] = await Promise.all([
      withRetry(() => yahooFinance.quote(tickers), { attempts: 2, timeoutMs: 7000, retryLabel: 'yahoo quote' }),
      bridgePromise,
    ])
    const bbMap = bridgeOutcome.ok ? bridgeOutcome.map : null
    const bloombergStatus: 'ok' | 'degraded' | 'not_configured' = !bridgeConfigured
      ? 'not_configured'
      : bridgeOutcome.ok ? 'ok' : 'degraded'

    // yahooFinance.quote() returns a single object for one ticker, array for multiple.
    const results = Array.isArray(raw) ? raw : [raw]

    const yahooQuotes = results.map((q: any) => ({
      ticker: q.symbol,
      price: num(q.regularMarketPrice),
      change: num(q.regularMarketChange),
      changePct: normalizedChangePercent(
        q.regularMarketChangePercent,
        q.regularMarketChange,
        q.regularMarketPrice
      ),
      volume: num(q.regularMarketVolume),
      high52w: num(q.fiftyTwoWeekHigh),
      low52w: num(q.fiftyTwoWeekLow),
      pe: num(q.trailingPE),
      // Phase 13 S2 fix (F4.7): formatCompactNumber handles trillions and sub-billions
      // correctly. Previously: AAPL $3.5T rendered as "3500.0B"; small caps as "0.3B".
      marketCap: q.marketCap ? formatCompactNumber(q.marketCap) : 'N/A',
      quoteTime: isoQuoteTime(q),
    }))

    const quotes = mergeYahooAndBloomberg(yahooQuotes, bbMap)
    const bloombergTickers = quotes.filter((q) => q.dataSource === 'bloomberg').map((q) => q.ticker)

    return NextResponse.json(
      {
        quotes,
        timestamp: new Date().toISOString(),
        dataSources: {
          // Phase 13 S2 fix (F4.11): yahoo flag now reflects actual coverage
          // rather than hardcoded `true`.
          yahoo: yahooQuotes.length > 0,
          bloombergBridge: Boolean(bbMap && bbMap.size > 0),
          bloombergTickers,
          // F4.1 (Phase 13 S2): explicit bridge status — clients can render
          // "Bloomberg degraded" banner without inspecting bloombergTickers.
          bloombergStatus,
        },
      },
      {
        headers: {
          // F4.9 (Phase 13 S2): edge-cache for 3s + serve stale for 5s while
          // revalidating. Per-user freshness is unchanged because the SWR
          // client uses 5s refresh + 2.5s dedup.
          'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
          'CDN-Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5',
          // Browser MUST NOT cache (per-user data changes constantly).
          'Vary': 'Accept-Encoding',
        },
      }
    )
  } catch (error) {
    console.error('[Prices API] Error fetching from Yahoo Finance:', error)
    // Sanitize error before returning (CWE-209) — don't leak stack traces / file paths.
    const safeMessage = process.env.NODE_ENV === 'production'
      ? undefined
      : (error instanceof Error ? error.message : String(error))
    return errorResponse('prices_fetch_failed', 'Failed to fetch live prices', safeMessage, 500)
  }
}
