import { NextResponse } from 'next/server'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
export const dynamic = 'force-dynamic'

const BYBIT_BASE = 'https://api.bybit.com'
const OKX_BASE = 'https://www.okx.com'

let _cache: { data: Record<string, unknown>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5_000

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function safeFetchJson<T>(
  url: string,
  label: string,
  maxAttempts = 3
): Promise<{ data: T | null; error: string | null; status: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'QUANTAN/1.0' },
        signal: AbortSignal.timeout(10_000),
      } as RequestInit)
      if (res.ok) {
        const data = (await res.json()) as T
        return { data, error: null, status: 200 }
      }
      const text = await res.text().catch(() => '')
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < maxAttempts - 1) {
        const ra = res.headers.get('retry-after')
        const sec = ra ? Math.min(parseInt(ra, 10) || 0, 30) : 0
        await sleep(sec > 0 ? sec * 1000 : 400 * Math.pow(2, attempt))
        continue
      }
      return { data: null, error: `${label} HTTP ${res.status}: ${text.slice(0, 300)}`, status: res.status }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('timeout') || msg.includes('AbortError')) {
        if (attempt < maxAttempts - 1) {
          await sleep(300 * (attempt + 1))
          continue
        }
        return { data: null, error: `${label} timed out`, status: 408 }
      }
      if (attempt < maxAttempts - 1) {
        await sleep(300 * (attempt + 1))
        continue
      }
      return { data: null, error: `${label}: ${msg}`, status: 0 }
    }
  }
  return { data: null, error: `${label} exhausted retries`, status: 0 }
}

type BybitTickerList = { retCode?: number; result?: { list?: Array<Record<string, string>> } }
type BybitAccountRatio = { retCode?: number; result?: { list?: Array<{ buyRatio?: string; sellRatio?: string }> } }
type OkxLsr = { code?: string; data?: Array<[string, string]> }

export async function GET(request: Request) {
  const rateLimitResponse = await applyRateLimit(request, 'crypto-btc-metrics', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const now = Date.now()

  if (_cache && now < _cache.expiresAt) {
    return NextResponse.json(
      { ..._cache.data, _cached: true, source: 'Bybit + OKX (cached)' },
      { headers: { 'Cache-Control': 'public, max-age=5, stale-while-revalidate=10' } }
    )
  }

  const [tickRes, ratioRes, lsrRes] = await Promise.all([
    safeFetchJson<BybitTickerList>(
      `${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=BTCUSDT`,
      'bybit_tickers'
    ),
    safeFetchJson<BybitAccountRatio>(
      `${BYBIT_BASE}/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=1h&limit=1`,
      'bybit_account_ratio'
    ),
    safeFetchJson<OkxLsr>(
      `${OKX_BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC`,
      'okx_lsr'
    ),
  ])

  const tickBody = tickRes.data
  const t =
    tickBody?.retCode === 0 && tickBody?.result?.list?.[0] ? tickBody.result.list[0] : undefined
  const ar =
    ratioRes.data?.retCode === 0 && ratioRes.data?.result?.list?.[0]
      ? ratioRes.data.result.list[0]
      : undefined
  const lsrArr = lsrRes.data?.data
  const lsrRow = Array.isArray(lsrArr) && lsrArr.length > 0 ? lsrArr[0] : null
  const lsrVal = lsrRow && lsrRow.length >= 2 ? parseFloat(lsrRow[1]) : NaN

  let longShortRatio: number | null = Number.isFinite(lsrVal) ? lsrVal : null
  let longAccountPct: number | null = null
  let shortAccountPct: number | null = null
  if (longShortRatio != null && longShortRatio >= 0) {
    longAccountPct = longShortRatio / (1 + longShortRatio)
    shortAccountPct = 1 / (1 + longShortRatio)
  }

  const fundingRate = t?.fundingRate != null ? parseFloat(t.fundingRate) : null
  const nextFundingMs = t?.nextFundingTime != null ? parseInt(t.nextFundingTime, 10) : NaN
  const nextFundingTime = Number.isFinite(nextFundingMs) ? new Date(nextFundingMs).toISOString() : null
  /** USD notional OI — matches prior UI scaling (÷1e9 → $B) */
  const openInterest = t?.openInterestValue != null ? parseFloat(t.openInterestValue) : null

  const takerBuyVolume = ar?.buyRatio != null ? parseFloat(ar.buyRatio) : null
  const takerSellVolume = ar?.sellRatio != null ? parseFloat(ar.sellRatio) : null

  const errors = [tickRes.error, ratioRes.error, lsrRes.error]
    .filter(Boolean)
    .map((e) => sanitizeError(e) ?? 'fetch_failed')

  const result = {
    fundingRate,
    nextFundingTime,
    openInterest,
    takerBuyVolume,
    takerSellVolume,
    longShortRatio,
    longAccountPct,
    shortAccountPct,
    _errors: errors.length > 0 ? errors : undefined,
    source: 'Bybit (linear) + OKX Rubik (long/short) + Bybit account-ratio (buy/sell)',
    fetchedAt: new Date().toISOString(),
  }

  if (t && (fundingRate != null || openInterest != null)) {
    _cache = { data: result, expiresAt: now + CACHE_TTL_MS }
  }

  if (!t) {
    const partial =
      longShortRatio != null
        ? 'Bybit tickers unreachable; long/short from OKX where available.'
        : 'Derivatives metrics could not be loaded from Bybit/OKX. Check network or try again shortly.'
    return NextResponse.json(
      {
        ...result,
        fundingRate: null,
        nextFundingTime: null,
        openInterest: null,
        takerBuyVolume: ar ? result.takerBuyVolume : null,
        takerSellVolume: ar ? result.takerSellVolume : null,
        degraded: true as const,
        userMessage: partial,
        source:
          longShortRatio != null
            ? 'OKX Rubik (partial) — Bybit unreachable'
            : 'Unavailable (Bybit/OKX unreachable)',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    { ...result, _cached: false },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
      },
    }
  )
}
