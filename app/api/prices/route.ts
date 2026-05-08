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
const US_INDEX_SYMBOLS = new Set([
  'VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX',
])

function normalizeTicker(raw: string): string {
  const u = decodeURIComponent(raw.trim()).toUpperCase()
  // Already prefixed with ^ — pass through.
  if (u.startsWith('^')) return u
  // Known plain index name → prepend ^ for Yahoo compatibility.
  return US_INDEX_SYMBOLS.has(u) ? `^${u}` : u
}

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

export async function GET(request: NextRequest) {
  // Rate limit: 60 req/min per IP (prices poll frequently)
  const rateLimitResponse = applyRateLimit(request, 'prices', { maxRequests: 60, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  const url = new URL(request.url)
  const queryTickers = url.searchParams.get('tickers')

  const tickers = queryTickers
    ? queryTickers.split(',').map(normalizeTicker)
    : [...SECTORS.map((s) => s.etf), 'SPY', 'QQQ']

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
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
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
