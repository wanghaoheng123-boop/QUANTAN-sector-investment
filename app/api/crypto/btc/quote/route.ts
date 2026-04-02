import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Spot quote for BTC/USD when the browser has not yet received Coinbase ticker WS.
 * CoinGecko simple price — no API key for low-frequency server-side use.
 */
export async function GET() {
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
    const data = (await res.json()) as {
      bitcoin?: { usd?: number; usd_24h_change?: number; usd_24h_vol?: number }
    }
    const b = data.bitcoin
    if (!b?.usd || !Number.isFinite(b.usd)) {
      return NextResponse.json({ error: 'invalid_payload' }, { status: 502 })
    }
    const changePct24h = typeof b.usd_24h_change === 'number' ? b.usd_24h_change : 0
    const price = b.usd
    const pct = changePct24h / 100
    const change24h = pct === 0 ? 0 : price - price / (1 + pct)
    return NextResponse.json(
      {
        price,
        changePct24h,
        change24h,
        high24h: null,
        low24h: null,
        volume24h: typeof b.usd_24h_vol === 'number' ? b.usd_24h_vol : 0,
        source: 'CoinGecko simple (REST)',
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
