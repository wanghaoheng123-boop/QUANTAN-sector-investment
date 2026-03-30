import { NextRequest, NextResponse } from 'next/server'

const BINANCE_BASE = 'https://api.binance.com'
const SYMBOL = 'BTCUSDT'

// Supported intervals (compatible with lightweight-charts Time)
const INTERVAL_MAP: Record<string, string> = {
  '5m':  '5m', '15m': '15m', '1h': '1h',  '4h': '4h',
  '1d':  '1d', '1w':  '1w',  '1M':  '1M',
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const interval = searchParams.get('interval') || '1d'
  const rawLimit = parseInt(searchParams.get('limit') || '500', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500

  const binanceInterval = INTERVAL_MAP[interval] || '1d'

  try {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${binanceInterval}&limit=${limit}`
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    } as RequestInit)

    if (!res.ok) {
      const text = await res.text()
      console.error(`[BTC API] Binance error ${res.status}: ${text}`)
      return NextResponse.json({ error: 'Binance API error', details: text }, { status: 502 })
    }

    const data: any[] = await res.json()

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const candles = data
      .filter((k: any[]) => k && k.length >= 6 && k[4] !== null)
      .map((k: any[]) => ({
        time: Math.floor(Number(k[0]) / 1000), // Unix seconds for lightweight-charts
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }))

    return NextResponse.json(
      { symbol: SYMBOL, interval: binanceInterval, candles, source: 'Binance Public API' },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[BTC API] Error fetching BTC data from Binance:', error)
    return NextResponse.json(
      { error: 'Failed to fetch BTC data', details: String(error) },
      { status: 500 }
    )
  }
}
