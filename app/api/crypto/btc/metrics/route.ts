import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const BINANCE_SPOT_BASE = 'https://api.binance.com'
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com'

// In-memory cache with TTL to avoid hammering Binance API
// Each entry: { data, expiresAt }
let _cache: { data: any; expiresAt: number } | null = null
const CACHE_TTL_MS = 5_000 // 5-second TTL — safe for high-frequency traders

interface BinanceResponse<T> {
  data: T | null
  error: string | null
  status: number
}

type FundingResp = { lastFundingRate?: string; fundingRate?: string; nextFundingTime?: number }
type OpenInterestResp = { openInterest?: string }
type TakerRatioResp = Array<{ buyVol?: string; sellVol?: string }>
type LongShortResp = Array<{ longShortRatio?: string; longAccount?: string; shortAccount?: string }>

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** Binance may return 429/418; respect Retry-After when present. */
async function safeBinanceFetch<T>(url: string, label: string, maxAttempts = 3): Promise<BinanceResponse<T>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'QUANTAN/1.0' },
        signal: AbortSignal.timeout(8_000),
      } as RequestInit)
      if (res.ok) {
        const data = await res.json() as T
        return { data, error: null, status: 200 }
      }
      const text = await res.text().catch(() => '')
      const retryable = res.status === 429 || res.status === 418 || res.status >= 500
      if (retryable && attempt < maxAttempts - 1) {
        const ra = res.headers.get('retry-after')
        const sec = ra ? Math.min(parseInt(ra, 10) || 0, 30) : 0
        await sleep(sec > 0 ? sec * 1000 : 400 * Math.pow(2, attempt))
        continue
      }
      // Keep enough of the body for downstream "restricted" checks; 451 is detected via status too.
      return { data: null, error: `${label} HTTP ${res.status}: ${text.slice(0, 400)}`, status: res.status }
    } catch (err: any) {
      const msg = err?.message ?? String(err)
      if (msg.includes('timeout') || msg.includes('AbortError')) {
        if (attempt < maxAttempts - 1) {
          await sleep(300 * (attempt + 1))
          continue
        }
        return { data: null, error: `${label} timed out after 8s`, status: 408 }
      }
      if (attempt < maxAttempts - 1) {
        await sleep(300 * (attempt + 1))
        continue
      }
      return { data: null, error: `${label} network error: ${msg}`, status: 0 }
    }
  }
  return { data: null, error: `${label} exhausted retries`, status: 0 }
}

export async function GET() {
  const now = Date.now()

  // Serve stale cache while refreshing in background (stale-while-revalidate)
  if (_cache && now < _cache.expiresAt) {
    return NextResponse.json(
      { ..._cache.data, _cached: true, source: 'Binance Public API' },
      { headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=10' } }
    )
  }

  const symbol = 'BTCUSDT'

  // Fire all 4 requests in parallel — reduces total latency from ~800ms to ~200ms
  const [fundRes, oiRes, tvRes, lsRes] = await Promise.all([
    safeBinanceFetch<FundingResp>(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`, 'funding'),
    safeBinanceFetch<OpenInterestResp>(`${BINANCE_FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`, 'openInterest'),
    safeBinanceFetch<TakerRatioResp>(
      `${BINANCE_FUTURES_BASE}/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=1`,
      'takerVol'
    ),
    safeBinanceFetch<LongShortResp>(
      `${BINANCE_FUTURES_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`,
      'longShort'
    ),
  ])

  const errors = [fundRes.error, oiRes.error, tvRes.error, lsRes.error].filter(Boolean)
  const allFailed = errors.length === 4
  const geoRestricted =
    errors.some((e) => (e ?? '').toLowerCase().includes('restricted')) ||
    [fundRes, oiRes, tvRes, lsRes].some((r) => r.status === 451)

  const result = {
    fundingRate:    fundRes.data ? parseFloat(fundRes.data.lastFundingRate ?? fundRes.data.fundingRate ?? '0') : null,
    nextFundingTime: fundRes.data?.nextFundingTime ? new Date(fundRes.data.nextFundingTime).toISOString() : null,
    openInterest:   oiRes.data?.openInterest ? parseFloat(oiRes.data.openInterest) : null,
    takerBuyVolume: tvRes.data && tvRes.data.length > 0 && tvRes.data[0].buyVol ? parseFloat(tvRes.data[0].buyVol) : null,
    takerSellVolume: tvRes.data && tvRes.data.length > 0 && tvRes.data[0].sellVol ? parseFloat(tvRes.data[0].sellVol) : null,
    longShortRatio:   lsRes.data && lsRes.data.length > 0 && lsRes.data[0].longShortRatio ? parseFloat(lsRes.data[0].longShortRatio) : null,
    longAccountPct:   lsRes.data && lsRes.data.length > 0 && lsRes.data[0].longAccount ? parseFloat(lsRes.data[0].longAccount) : null,
    shortAccountPct:  lsRes.data && lsRes.data.length > 0 && lsRes.data[0].shortAccount ? parseFloat(lsRes.data[0].shortAccount) : null,
    _errors: errors.length > 0 ? errors : undefined,
    source: 'Binance Futures Public API',
    fetchedAt: new Date().toISOString(),
    ...(geoRestricted && {
      binanceGeoRestricted: true as const,
      userMessage:
        'Binance blocked this request (region/network). Metrics may be empty until the server can reach Binance from an allowed location.',
    }),
  }

  // Cache the result (even partial) to prevent thundering-herd on rate-limited API
  if (!allFailed) {
    _cache = { data: result, expiresAt: now + CACHE_TTL_MS }
  }

  if (allFailed) {
    const degraded = {
      ...result,
      userMessage:
        result.userMessage ??
        'Derivatives metrics are temporarily unavailable from Binance. Charting and price can continue via fallback providers.',
      degraded: true as const,
      source: 'Unavailable (Binance blocked/unreachable)',
    }
    return NextResponse.json(
      { ...degraded, _cached: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    { ...result, _cached: false },
    {
      status: 200,
      headers: {
        // Allow CDN caching for 5s, serve stale while revalidating for 10s
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
      },
    }
  )
}
