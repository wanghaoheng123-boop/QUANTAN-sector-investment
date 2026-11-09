import { NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
import { snapshotFromCoinGecko } from '@/lib/btcSnapshot'

export const dynamic = 'force-dynamic'

/**
 * Spot quote for BTC/USD when the browser has not yet received Coinbase ticker WS.
 * CoinGecko simple price — no API key for low-frequency server-side use.
 */
export async function GET(request: Request) {
  const rateLimitResponse = await applyRateLimit(request, 'crypto-btc-quote', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  try {
    const url =
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true'
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      signal: AbortSignal.timeout(15_000),
    } as RequestInit)
    if (!res.ok) {
      return NextResponse.json({ error: 'coingecko_http', status: res.status }, { status: 502 })
    }
    // Q-157: a missing percent or volume is null, not 0; CoinGecko gives no
    // absolute change, so change24h is derived from the percent (tickChange).
    const snapshot = snapshotFromCoinGecko(await res.json())
    if (!snapshot) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 502 })
    }
    return NextResponse.json(
      { ...snapshot, source: 'CoinGecko simple (REST)' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    // Phase 16 audit (2026-05-24): replaced `error: String(e)` (CWE-209 leak —
    // would emit Yahoo/CoinGecko stack traces in production). The SSOT
    // sanitizeError returns undefined in prod and the message in dev.
    console.error('[crypto/btc/quote]', e)
    const details = sanitizeError(e)
    return NextResponse.json(
      {
        error: 'crypto_quote_failed',
        ...(details ? { details } : {}),
      },
      { status: 500 },
    )
  }
}
