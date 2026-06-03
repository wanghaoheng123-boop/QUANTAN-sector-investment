import { NextResponse } from 'next/server'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { loadStockHistory } from '@/lib/backtest/dataLoader'
import { fetchHmmRegime } from '@/lib/quant/regimeHmmClient'

/**
 * GET /api/regime/[ticker]
 *
 * Returns 3-state regime (Bull/Normal/Bear) + posterior probabilities —
 * Python HMM sidecar when `QUANT_FRAMEWORK_URL` is set, vol-ratio rule
 * fallback otherwise.
 *
 * Phase 15 review (2026-05-24): rate-limited because the sidecar path
 * incurs an outbound HTTP fetch that an unauthenticated caller could fan
 * out across many tickers. Rate parity with /api/options.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: tickerParam } = await params
  // Rate-limit before any work so a request flood is cheap to reject.
  const rateLimitResponse = await applyRateLimit(req, 'regime', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const ticker = normalizeTicker(tickerParam)
  if (!ticker) {
    return NextResponse.json({ error: 'invalid_ticker' }, { status: 400 })
  }

  try {
    const rows = loadStockHistory(ticker)
    if (!rows?.length) {
      return NextResponse.json({ error: 'no_data' }, { status: 404 })
    }
    const closes = rows.map((r) => r.close)
    const result = await fetchHmmRegime(ticker, closes)
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
    })
  } catch (error) {
    console.error('[regime]', ticker, error)
    return NextResponse.json(
      {
        error: 'regime_failed',
        ...(sanitizeError(error) ? { details: sanitizeError(error) } : {}),
      },
      { status: 502 },
    )
  }
}
