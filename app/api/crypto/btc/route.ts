import { NextRequest, NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'

const KRAKEN_OHLC = 'https://api.kraken.com/0/public/OHLC'
const COINBASE_CANDLES = 'https://api.exchange.coinbase.com/products/BTC-USD/candles'
const SYMBOL = 'BTCUSD'

/** Kraken interval in minutes — see https://docs.kraken.com/api/docs/rest-api/get-ohlc-data */
const KRAKEN_INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1,
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

async function fetchWithTimeout(url: string, timeoutMs = 15_000, attempts = 3): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'QUANTAN/1.0' },
        signal: AbortSignal.timeout(timeoutMs),
      } as RequestInit)
      last = res
      if (res.ok) return res
      if ((res.status === 429 || res.status === 418) && attempt < attempts - 1) {
        const ra = res.headers.get('retry-after')
        const sec = ra ? Math.min(parseInt(ra, 10) || 0, 30) : 0
        await sleep(sec > 0 ? sec * 1000 : 500 * Math.pow(2, attempt))
        continue
      }
      if (attempt < attempts - 1 && res.status >= 500) {
        await sleep(400 * (attempt + 1))
        continue
      }
      return res
    } catch {
      if (attempt < attempts - 1) {
        await sleep(300 * (attempt + 1))
        continue
      }
    }
  }
  if (!last) throw new Error('All fetch attempts failed')
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
 * CoinGecko primary OHLC — globally accessible, no geo-blocking.
 * OHLC format: [timestamp_ms, open, high, low, close]
 * Volume is synthetic (1) — VWAP/OBV will be approximate.
 */
async function fetchCoinGeckoOhlc(binanceInterval: string, limit: number): Promise<CandleRow[] | null> {
  const days: Record<string, number | 'max'> = {
    '1m': 1,
    '5m': 1, '15m': 1, '1h': 7, '4h': 30,
    '1d': 365, '1w': 'max', '1M': 'max',
  }
  const d = days[binanceInterval] ?? 365
  const url = `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${d === 'max' ? 'max' : d}`

  const attempt = async (): Promise<CandleRow[] | null> => {
    try {
      const res = await fetchWithTimeout(url, 20_000, 2)
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
          if (![open, high, low, close].every(Number.isFinite)) return null
          return { time: Math.floor(tMs / 1000), open, high, low, close, volume: 1 }
        })
        .filter((c): c is CandleRow => c !== null)
        .filter(c => c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
      return candles.length ? candles : null
    } catch { return null }
  }

  try {
    let out = await attempt()
    if (out) return out
    await sleep(1500)
    out = await attempt()
    return out
  } catch { return null }
}

/**
 * Coinbase Exchange candles — public, no Binance. Granularity must be one of
 * 60, 300, 900, 3600, 21600, 86400 (no native 4h; caller skips).
 * Each row: [ time, low, high, open, close, volume ] (time in seconds).
 */
async function fetchCoinbaseOhlc(binanceInterval: string, limit: number): Promise<CandleRow[] | null> {
  const gran: Record<string, number | null> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': null,
    '1d': 86400,
    '1w': 86400,
    '1M': 86400,
  }
  const g = gran[binanceInterval]
  if (g == null) return null
  const endSec = Math.floor(Date.now() / 1000)
  const startSec = endSec - g * Math.min(limit, 300)
  const url = `${COINBASE_CANDLES}?granularity=${g}&start=${startSec}&end=${endSec}`
  try {
    const res = await fetchWithTimeout(url, 20_000, 2)
    if (!res.ok) return null
    const rows = (await res.json()) as unknown
    if (!Array.isArray(rows) || rows.length === 0) return null
    const candles = rows
      .map((row: unknown) => {
        if (!Array.isArray(row) || row.length < 6) return null
        const t = Number(row[0])
        const low = parseFloat(String(row[1]))
        const high = parseFloat(String(row[2]))
        const open = parseFloat(String(row[3]))
        const close = parseFloat(String(row[4]))
        const volume = parseFloat(String(row[5]))
        if (![open, high, low, close, volume].every(Number.isFinite)) return null
        return { time: t, open, high, low, close, volume }
      })
      .filter((c): c is CandleRow => c !== null)
      .filter(
        (c) =>
          c.high >= c.low &&
          c.high >= Math.max(c.open, c.close) &&
          c.low <= Math.min(c.open, c.close)
      )
      .sort((a, b) => a.time - b.time)
    const slice = candles.slice(-Math.min(limit, candles.length))
    return slice.length ? slice : null
  } catch {
    return null
  }
}

/**
 * Kraken OHLC — XBTUSD pair (reliable public REST).
 * Secondary fallback when CoinGecko fails.
 */
async function fetchKrakenOhlc(binanceInterval: string, limit: number): Promise<CandleRow[] | null> {
  const minutes = KRAKEN_INTERVAL_MINUTES[binanceInterval] ?? 1440
  const url = `${KRAKEN_OHLC}?pair=XBTUSD&interval=${minutes}`
  try {
    const res = await fetchWithTimeout(url, 20_000, 2)
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
      .filter(c => c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))
    return candles.length ? candles : null
  } catch { return null }
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
  '1d': '1d', '1w': '1w', '1M': '1M',
}

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // Rate limit: 30 req/min per IP
  const rateLimitResponse = applyRateLimit(req, 'crypto-btc', { maxRequests: 30, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  const { searchParams } = new URL(req.url)
  const interval = searchParams.get('interval') || '1d'
  const rawLimit = parseInt(searchParams.get('limit') || '500', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500
  const binanceInterval = INTERVAL_MAP[interval] || '1d'

  // ── 1m: CoinGecko OHLC is not true 1-minute — prefer Coinbase (60s) then Kraken ─
  if (binanceInterval === '1m') {
    const cb1 = await fetchCoinbaseOhlc('1m', limit)
    if (cb1?.length) {
      return NextResponse.json(
        {
          symbol: SYMBOL,
          interval: '1m',
          candles: cb1,
          source: 'Coinbase Exchange API (1m)',
        },
        { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
      )
    }
    const kr1 = await fetchKrakenOhlc('1m', limit)
    if (kr1?.length) {
      return NextResponse.json(
        {
          symbol: SYMBOL,
          interval: '1m',
          candles: kr1,
          source: 'Kraken Public API (1m)',
          note: 'Coinbase unavailable; served XBT/USD 1-minute OHLC from Kraken.',
        },
        { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
      )
    }
    const cg1 = await fetchCoinGeckoOhlc('1m', limit)
    if (cg1?.length) {
      return NextResponse.json(
        {
          symbol: SYMBOL,
          interval: '1m',
          candles: cg1,
          source: 'CoinGecko (coarse fallback)',
          note: 'True 1m unavailable; CoinGecko daily OHLC may be coarser than 1 minute.',
        },
        { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
      )
    }
    return NextResponse.json(
      {
        error: 'btc_data_unavailable',
        userMessage: '1-minute BTC OHLC could not be loaded. Try again or pick 5m.',
      },
      { status: 503 }
    )
  }

  // ── Primary: CoinGecko (globally accessible, no geo-blocking) ───────────────
  const cg = await fetchCoinGeckoOhlc(binanceInterval, limit)
  if (cg?.length) {
    return NextResponse.json(
      {
        symbol: SYMBOL,
        interval: binanceInterval,
        candles: cg,
        source: 'CoinGecko Public API (primary)',
      },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  }

  // ── Secondary: Kraken (when CoinGecko rate-limits or fails) ─
  const kr = await fetchKrakenOhlc(binanceInterval, limit)
  if (kr?.length) {
    return NextResponse.json(
      {
        symbol: SYMBOL,
        interval: binanceInterval,
        candles: kr,
        source: 'Kraken Public API (fallback)',
        note: 'CoinGecko was unavailable; served from Kraken XBT/USD (volume in base currency).',
      },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  }

  // ── Tertiary: Coinbase Exchange (no Binance; 4h not supported here) ─────────
  const cb = await fetchCoinbaseOhlc(binanceInterval, limit)
  if (cb?.length) {
    return NextResponse.json(
      {
        symbol: SYMBOL,
        interval: binanceInterval,
        candles: cb,
        source: 'Coinbase Exchange API (fallback)',
        note: 'CoinGecko and Kraken were unavailable; served BTC-USD candles from Coinbase.',
      },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  }

  // ── All sources failed ─────────────────────────────────────────────────────
  return NextResponse.json(
    {
      error: 'btc_data_unavailable',
      userMessage:
        'BTC OHLC could not be loaded from CoinGecko, Kraken, or Coinbase from this server. Open the BTC page in your browser — it will try CoinGecko directly and periodic refresh.',
    },
    { status: 503 }
  )
}
