import { NextRequest, NextResponse } from 'next/server'

const BINANCE_BASE = 'https://api.binance.com'
const KRAKEN_OHLC = 'https://api.kraken.com/0/public/OHLC'
const SYMBOL = 'BTCUSDT'

/** Kraken interval in minutes — see https://docs.kraken.com/api/docs/rest-api/get-ohlc-data */
const KRAKEN_INTERVAL_MINUTES: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
  /** No native monthly bar — use daily (~720 bars max from Kraken). */
  '1M': 1440,
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function fetchKlines(url: string, maxAttempts = 3): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(15_000),
    } as RequestInit)
    last = res
    if (res.ok) return res
    if ((res.status === 429 || res.status === 418) && attempt < maxAttempts - 1) {
      const ra = res.headers.get('retry-after')
      const sec = ra ? Math.min(parseInt(ra, 10) || 0, 30) : 0
      await sleep(sec > 0 ? sec * 1000 : 500 * Math.pow(2, attempt))
      continue
    }
    if (attempt < maxAttempts - 1 && res.status >= 500) {
      await sleep(400 * (attempt + 1))
      continue
    }
    return res
  }
  return last!
}

type CandleRow = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * When Binance REST is geo-blocked or errors, Kraken public OHLC often still works from the same host.
 */
async function fetchKrakenOhlc(binanceInterval: string, limit: number): Promise<CandleRow[] | null> {
  const minutes = KRAKEN_INTERVAL_MINUTES[binanceInterval] ?? 1440
  const url = `${KRAKEN_OHLC}?pair=XBTUSD&interval=${minutes}`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      signal: AbortSignal.timeout(20_000),
    } as RequestInit)
    if (!res.ok) return null
    const data = (await res.json()) as { error?: string[]; result?: Record<string, unknown> }
    if (data.error?.length) return null
    const result = data.result
    if (!result || typeof result !== 'object') return null
    const pairKey = Object.keys(result).find((k) => k !== 'last')
    if (!pairKey) return null
    const rows = result[pairKey]
    if (!Array.isArray(rows) || rows.length === 0) return null
    const slice = rows.slice(-Math.min(limit, 720))
    const candles = slice
      .map((row: unknown) => {
        if (!Array.isArray(row) || row.length < 7) return null
        const t = Number(row[0])
        const open = parseFloat(String(row[1]))
        const high = parseFloat(String(row[2]))
        const low = parseFloat(String(row[3]))
        const close = parseFloat(String(row[4]))
        const volume = parseFloat(String(row[6]))
        return { time: t, open, high, low, close, volume }
      })
      .filter((c): c is CandleRow => c !== null)
      .filter((c) =>
        [c.open, c.high, c.low, c.close, c.volume].every((v) => Number.isFinite(v) && v >= 0) &&
        c.high >= c.low &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close)
      )
    return candles.length ? candles : null
  } catch (e) {
    console.error('[BTC API] Kraken fallback failed:', e)
    return null
  }
}

/** CoinGecko `days` → OHLC granularity varies; we slice to `limit` most recent bars. */
function coingeckoDaysParam(binanceInterval: string): number | 'max' {
  switch (binanceInterval) {
    case '5m':
    case '15m':
      return 1
    case '1h':
      return 7
    case '4h':
      return 30
    case '1d':
      return 365
    case '1w':
    case '1M':
      return 'max'
    default:
      return 365
  }
}

/**
 * Third REST fallback — wide geographic availability; rate-limited (retry once on 429).
 * OHLC has no volume — use synthetic volume so VWAP / histogram stay finite.
 */
async function fetchCoinGeckoOhlc(binanceInterval: string, limit: number): Promise<CandleRow[] | null> {
  const days = coingeckoDaysParam(binanceInterval)
  const daysStr = days === 'max' ? 'max' : String(days)
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${daysStr}`

  const attempt = async (): Promise<CandleRow[] | null> => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
      signal: AbortSignal.timeout(25_000),
    } as RequestInit)
    if (res.status === 429) return null
    if (!res.ok) return null
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows) || rows.length === 0) return null
    const slice = rows.slice(-Math.min(limit, rows.length))
    const candles = slice
      .map((row: unknown) => {
        if (!Array.isArray(row) || row.length < 5) return null
        const tMs = Number(row[0])
        const open = parseFloat(String(row[1]))
        const high = parseFloat(String(row[2]))
        const low = parseFloat(String(row[3]))
        const close = parseFloat(String(row[4]))
        return {
          time: Math.floor(tMs / 1000),
          open,
          high,
          low,
          close,
          volume: 1,
        }
      })
      .filter((c): c is CandleRow => c !== null)
      .filter((c) =>
        [c.open, c.high, c.low, c.close, c.volume].every((v) => Number.isFinite(v) && v >= 0) &&
        c.high >= c.low &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close)
      )
    return candles.length ? candles : null
  }

  try {
    let out = await attempt()
    if (out) return out
    await sleep(2000)
    out = await attempt()
    return out
  } catch (e) {
    console.error('[BTC API] CoinGecko fallback failed:', e)
    return null
  }
}

async function fetchFallbackCandles(binanceInterval: string, limit: number): Promise<{
  candles: CandleRow[]
  source: 'kraken' | 'coingecko'
} | null> {
  const kr = await fetchKrakenOhlc(binanceInterval, limit)
  if (kr?.length) return { candles: kr, source: 'kraken' }
  const cg = await fetchCoinGeckoOhlc(binanceInterval, limit)
  if (cg?.length) return { candles: cg, source: 'coingecko' }
  return null
}

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
    const res = await fetchKlines(url)

    if (!res.ok) {
      const text = await res.text()
      console.error(`[BTC API] Binance error ${res.status}: ${text}`)
      let parsed: { code?: number; msg?: string } | null = null
      try {
        parsed = JSON.parse(text) as { code?: number; msg?: string }
      } catch {
        /* plain text */
      }
      const msg = (parsed?.msg ?? '').toLowerCase()
      const geoRestricted =
        res.status === 451 ||
        msg.includes('restricted location') ||
        msg.includes('eligibility') ||
        msg.includes('service unavailable from a restricted')

      const fb = await fetchFallbackCandles(binanceInterval, limit)
      if (fb) {
        const note =
          fb.source === 'kraken'
            ? 'Binance REST was unavailable; served comparable OHLC from Kraken. Live price WebSocket may still use Binance and can fail separately in restricted regions.'
            : 'Binance and Kraken REST were unavailable; served OHLC from CoinGecko (volume is synthetic). Live WebSocket may still fail.'
        return NextResponse.json(
          {
            symbol: SYMBOL,
            interval: binanceInterval,
            candles: fb.candles,
            source:
              fb.source === 'kraken'
                ? 'Kraken Public API (fallback)'
                : 'CoinGecko Public API (fallback)',
            note,
            fallbackFrom: geoRestricted ? ('binance_geo_restricted' as const) : ('binance_http_error' as const),
          },
          { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
        )
      }

      if (geoRestricted) {
        return NextResponse.json(
          {
            error: 'binance_geo_restricted',
            userMessage:
              'Binance API is not available from this server region (or your network), and the Kraken fallback could not load candles. Options: deploy in a Binance-allowed region, use a VPN where legal, or try again later.',
            details: text,
          },
          { status: 451 }
        )
      }

      return NextResponse.json(
        {
          error: 'binance_api_error',
          userMessage: parsed?.msg ?? 'Binance returned an error for this request.',
          details: text,
        },
        { status: 502 }
      )
    }

    const data: unknown[] = (await res.json()) as unknown[]

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const candles = data
      .filter((k: unknown): k is unknown[] => Array.isArray(k) && k.length >= 6 && k[4] != null)
      .map((k: unknown[]) => ({
        time: Math.floor(Number(k[0]) / 1000), // Unix seconds for lightweight-charts
        open:   parseFloat(k[1]),
        high:   parseFloat(k[2]),
        low:    parseFloat(k[3]),
        close:  parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }))
      .filter((c) =>
        [c.open, c.high, c.low, c.close, c.volume].every((v) => Number.isFinite(v) && v >= 0) &&
        c.high >= c.low &&
        c.high >= Math.max(c.open, c.close) &&
        c.low <= Math.min(c.open, c.close)
      )

    return NextResponse.json(
      { symbol: SYMBOL, interval: binanceInterval, candles, source: 'Binance Public API' },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[BTC API] Error fetching BTC data from Binance:', error)
    try {
      const interval = new URL(req.url).searchParams.get('interval') || '1d'
      const rawLimit = parseInt(new URL(req.url).searchParams.get('limit') || '500', 10)
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500
      const binanceInterval = INTERVAL_MAP[interval] || '1d'
      const fb = await fetchFallbackCandles(binanceInterval, limit)
      if (fb) {
        return NextResponse.json(
          {
            symbol: SYMBOL,
            interval: binanceInterval,
            candles: fb.candles,
            source:
              fb.source === 'kraken'
                ? 'Kraken Public API (fallback)'
                : 'CoinGecko Public API (fallback)',
            note:
              fb.source === 'kraken'
                ? 'Binance request failed; served OHLC from Kraken instead.'
                : 'Binance/Kraken failed; served OHLC from CoinGecko (synthetic volume).',
            fallbackFrom: 'network_error' as const,
          },
          { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
        )
      }
    } catch {
      /* fall through */
    }
    return NextResponse.json(
      { error: 'Failed to fetch BTC data', details: String(error) },
      { status: 500 }
    )
  }
}
