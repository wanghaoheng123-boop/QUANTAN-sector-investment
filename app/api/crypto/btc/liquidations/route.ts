import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

// In-memory cache for liquidation data — 10-second TTL
let _cache: { data: any; expiresAt: number } | null = null
const CACHE_TTL_MS = 10_000

export async function GET() {
  const now = Date.now()

  if (_cache && now < _cache.expiresAt) {
    return NextResponse.json({ ..._cache.data, _cached: true }, {
      headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
    )
  }

  try {
    const forceOrdersRes = await fetch(
      'https://fapi.binance.com/fapi/v1/forceOrders?symbol=BTCUSDT&limit=200',
      {
        headers: { 'Accept': 'application/json', 'User-Agent': 'QUANTAN/1.0' },
        signal: AbortSignal.timeout(10_000),
      } as RequestInit
    )
    if (forceOrdersRes.ok) {
      const orders = (await forceOrdersRes.json()) as Array<{
        ap?: string
        q?: string
        S?: 'BUY' | 'SELL'
        time?: number
      }>
      const ONE_DAY = 24 * 60 * 60 * 1000
      const recent = orders.filter((o) => Number(o.time ?? 0) > now - ONE_DAY)
      const buys = recent.filter((o) => o.S === 'BUY')
      const sells = recent.filter((o) => o.S === 'SELL')
      const buyVolume = buys.reduce((s, o) => s + (parseFloat(o.ap ?? '0') * parseFloat(o.q ?? '0') || 0), 0)
      const sellVolume = sells.reduce((s, o) => s + (parseFloat(o.ap ?? '0') * parseFloat(o.q ?? '0') || 0), 0)

      const netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL' =
        buyVolume > sellVolume ? 'LONG_BIAS' : sellVolume > buyVolume ? 'SHORT_BIAS' : 'NEUTRAL'

      const result = {
        totalLiquidations: recent.length,
        buyLiquidations: buys.length,
        sellLiquidations: sells.length,
        buyVolume,
        sellVolume,
        netDirection,
        largeTradeCount: recent.length,
        source: 'Binance Futures forceOrders API',
        fetchedAt: new Date().toISOString(),
      }

      _cache = { data: result, expiresAt: now + CACHE_TTL_MS }

      return NextResponse.json(
        { ...result, _cached: false },
        { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=20' } }
      )
    }

    // Fallback when forceOrders is blocked: infer pressure from large spot prints.
    const res = await fetch(
      'https://api.binance.com/api/v3/trades?symbol=BTCUSDT&limit=500',
      {
        headers: { 'Accept': 'application/json', 'User-Agent': 'QUANTAN/1.0' },
        signal: AbortSignal.timeout(10_000),
      } as RequestInit
    )
    if (!res.ok) {
      return NextResponse.json(
        {
          totalLiquidations: 0,
          buyLiquidations: 0,
          sellLiquidations: 0,
          buyVolume: 0,
          sellVolume: 0,
          netDirection: 'NEUTRAL',
          source: 'Unavailable (Binance blocked/unreachable)',
          fetchedAt: new Date().toISOString(),
          degraded: true as const,
          userMessage:
            'Liquidations feed is unavailable from Binance in this region/network. Quant cards show neutral placeholders.',
          error: `Binance HTTP ${res.status}`,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      )
    }
    const trades: any[] = await res.json()

    const LARGE_THRESHOLD = 100_000
    const ONE_DAY = 24 * 60 * 60 * 1000

    const recentLarge = trades.filter(t => {
      const notional = parseFloat(t.price) * parseFloat(t.qty)
      return notional > LARGE_THRESHOLD && (now - t.time) < ONE_DAY
    })

    const buys = recentLarge.filter(t => t.isBuyerMaker === false)
    const sells = recentLarge.filter(t => t.isBuyerMaker === true)
    const buyVolume = buys.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.qty), 0)
    const sellVolume = sells.reduce((s, t) => s + parseFloat(t.price) * parseFloat(t.qty), 0)

    const netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL' =
      buyVolume > sellVolume ? 'LONG_BIAS' : sellVolume > buyVolume ? 'SHORT_BIAS' : 'NEUTRAL'

    const result = {
      totalLiquidations: recentLarge.length,
      buyLiquidations: buys.length,
      sellLiquidations: sells.length,
      buyVolume,
      sellVolume,
      netDirection,
      largeTradeCount: recentLarge.length,
      source: 'Binance spot trades proxy (fallback, not true liquidation tape)',
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
        source: 'Unavailable (Binance blocked/unreachable)',
        fetchedAt: new Date().toISOString(),
        degraded: true as const,
        userMessage:
          'Liquidations feed failed to load. Quant cards show neutral placeholders until Binance is reachable.',
        error: String(error),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
