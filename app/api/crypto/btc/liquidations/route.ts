import { NextResponse } from 'next/server'
import { sanitizeError } from '@/lib/api/sanitize'

export const dynamic = 'force-dynamic'

const OKX_BASE = 'https://www.okx.com'

let _cache: { data: Record<string, unknown>; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000

type OkxLiqRow = {
  details?: Array<{
    bkPx?: string
    sz?: string
    side?: string
    posSide?: string
    time?: string
    ts?: string
  }>
}

export async function GET() {
  const now = Date.now()

  if (_cache && now < _cache.expiresAt) {
    return NextResponse.json(
      { ..._cache.data, _cached: true },
      { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
    )
  }

  try {
    const url = `${OKX_BASE}/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100`
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      signal: AbortSignal.timeout(12_000),
    } as RequestInit)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json(
        {
          totalLiquidations: 0,
          buyLiquidations: 0,
          sellLiquidations: 0,
          buyVolume: 0,
          sellVolume: 0,
          netDirection: 'NEUTRAL',
          source: 'Unavailable (OKX unreachable)',
          fetchedAt: new Date().toISOString(),
          degraded: true as const,
          userMessage: `Liquidation history unavailable (HTTP ${res.status}).`,
          error: text.slice(0, 200),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const json = (await res.json()) as { code?: string; data?: OkxLiqRow[] }
    if (json.code !== '0' || !Array.isArray(json.data)) {
      return NextResponse.json(
        {
          totalLiquidations: 0,
          buyLiquidations: 0,
          sellLiquidations: 0,
          buyVolume: 0,
          sellVolume: 0,
          netDirection: 'NEUTRAL',
          source: 'OKX (no rows)',
          fetchedAt: new Date().toISOString(),
          degraded: true as const,
          userMessage: 'No liquidation data returned from OKX.',
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const ONE_DAY = 24 * 60 * 60 * 1000
    const flat: Array<{ price: number; sz: number; side: string; posSide: string; time: number }> = []
    for (const row of json.data) {
      for (const d of row.details ?? []) {
        const price = parseFloat(d.bkPx ?? '0')
        const sz = parseFloat(d.sz ?? '0')
        const time = parseInt(String(d.time ?? d.ts ?? '0'), 10)
        if (!Number.isFinite(price) || !Number.isFinite(sz) || sz <= 0) continue
        if (now - time > ONE_DAY) continue
        flat.push({
          price,
          sz,
          side: String(d.side ?? ''),
          posSide: String(d.posSide ?? ''),
          time,
        })
      }
    }

    /** Long liquidation: forced sell (close long). Short liquidation: forced buy (close short). */
    const longLiq = flat.filter((x) => x.posSide === 'long' && x.side === 'sell')
    const shortLiq = flat.filter((x) => x.posSide === 'short' && x.side === 'buy')

    const buyVolume = shortLiq.reduce((s, x) => s + x.price * x.sz, 0)
    const sellVolume = longLiq.reduce((s, x) => s + x.price * x.sz, 0)

    const netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL' =
      sellVolume > buyVolume ? 'LONG_BIAS' : buyVolume > sellVolume ? 'SHORT_BIAS' : 'NEUTRAL'

    const result = {
      totalLiquidations: flat.length,
      buyLiquidations: shortLiq.length,
      sellLiquidations: longLiq.length,
      buyVolume,
      sellVolume,
      netDirection,
      largeTradeCount: flat.length,
      source: 'OKX public liquidation orders (BTC-USDT-SWAP)',
      fetchedAt: new Date().toISOString(),
    }

    _cache = { data: result, expiresAt: now + CACHE_TTL_MS }

    return NextResponse.json(
      { ...result, _cached: false },
      { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
    )
  } catch (error) {
    console.error('[BTC Liquidations API]', error)
    return NextResponse.json(
      {
        totalLiquidations: 0,
        buyLiquidations: 0,
        sellLiquidations: 0,
        buyVolume: 0,
        sellVolume: 0,
        netDirection: 'NEUTRAL',
        source: 'Unavailable (error)',
        fetchedAt: new Date().toISOString(),
        degraded: true as const,
        userMessage: 'Liquidation feed failed to load.',
        // Phase 16 audit: was `error: String(error)` (CWE-209 leak). SSOT
        // sanitizeError returns undefined in production so the production
        // payload omits the `error` field entirely; dev still sees details
        // for diagnosability.
        ...(sanitizeError(error) ? { error: sanitizeError(error) } : {}),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
