import { NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
import {
  LIQ_DETAIL_LIMIT,
  LIQ_INST_ID,
  liquidationFeedProblem,
  summariseLiquidations,
  type OkxLiqRow,
} from '@/lib/data/providers/okxLiquidations'

export const dynamic = 'force-dynamic'

const OKX_BASE = 'https://www.okx.com'

let _cache: { data: Record<string, unknown>; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000

/**
 * Q-138 — a failed feed is UNKNOWN, not zero. This used to answer with
 * `totalLiquidations: 0 … netDirection: 'NEUTRAL'` beside `degraded: true`, and
 * no client read `degraded`, so an OKX outage rendered as "0 liquidations,
 * $0.0M, NEUTRAL" — a calm market that nobody measured. Every figure is null
 * now. HTTP stays 200 so the client replaces the last good numbers with this
 * explicit unknown; failures this route never sees (the rate limiter's 429, a
 * platform 5xx, the client's own network error) are handled client-side by
 * `nextLiqState` in lib/liquidationDisplay.ts, which marks the numbers stale.
 */
function unavailable(source: string, userMessage: string, error?: unknown) {
  const detail = error === undefined ? undefined : sanitizeError(error)
  return NextResponse.json(
    {
      totalLiquidations: null,
      buyLiquidations: null,
      sellLiquidations: null,
      buyVolume: null,
      sellVolume: null,
      netDirection: null,
      windowStart: null,
      truncated: null,
      source,
      fetchedAt: new Date().toISOString(),
      degraded: true as const,
      userMessage,
      ...(detail ? { error: detail } : {}),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function GET(request: Request) {
  const rateLimitResponse = await applyRateLimit(request, 'crypto-btc-liquidations', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const now = Date.now()

  if (_cache && now < _cache.expiresAt) {
    return NextResponse.json(
      { ..._cache.data, _cached: true },
      { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
    )
  }

  try {
    const url = `${OKX_BASE}/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=${LIQ_DETAIL_LIMIT}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      signal: AbortSignal.timeout(12_000),
    } as RequestInit)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return unavailable('Unavailable (OKX unreachable)', `Liquidation history unavailable (HTTP ${res.status}).`, text)
    }

    const json = (await res.json()) as { code?: string; data?: OkxLiqRow[] }
    if (json.code !== '0' || !Array.isArray(json.data)) {
      return unavailable('OKX (no rows)', 'No liquidation data returned from OKX.')
    }

    const s = summariseLiquidations(json.data, now)
    // Red-team HIGH-1: a well-formed response can still be unusable (schema
    // drift, no row for the instrument, nothing counted). Fail closed.
    const problem = liquidationFeedProblem(s, now)
    if (problem) return unavailable('OKX (unusable response)', problem)

    const result = {
      totalLiquidations: s.totalLiquidations,
      buyLiquidations: s.buyLiquidations,
      sellLiquidations: s.sellLiquidations,
      buyVolume: s.buyVolume,
      sellVolume: s.sellVolume,
      netDirection: s.netDirection,
      windowStart: s.windowStart,
      truncated: s.truncated,
      source: `OKX public liquidation orders (${LIQ_INST_ID})`,
      fetchedAt: new Date().toISOString(),
    }

    _cache = { data: result, expiresAt: now + CACHE_TTL_MS }

    return NextResponse.json(
      { ...result, _cached: false },
      { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
    )
  } catch (error) {
    console.error('[BTC Liquidations API]', error)
    // Phase 16 audit: was `error: String(error)` (CWE-209 leak). SSOT
    // sanitizeError returns undefined in production so the production payload
    // omits the `error` field entirely; dev still sees details.
    return unavailable('Unavailable (error)', 'Liquidation feed failed to load.', error)
  }
}
