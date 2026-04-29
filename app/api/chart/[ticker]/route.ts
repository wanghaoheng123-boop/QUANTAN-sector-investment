import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { generateDarkPoolMarkers } from '@/lib/mockData'
import { aggregateMinuteQuotesToN } from '@/lib/chartYahoo'
import { applyRateLimit } from '@/lib/api/rateLimit'

const yahooFinance = new YahooFinance()

const _chartCache = new Map<
  string,
  { candles: any[]; darkPoolMarkers: any[]; expiresAt: number; range: string; interval: string }
>()
const CHART_CACHE_TTL_MS = 30_000
const CHART_CACHE_MAX_SIZE = 500

/** Evict oldest entries when cache exceeds max size (simple LRU via insertion order). */
function evictCacheIfNeeded() {
  while (_chartCache.size > CHART_CACHE_MAX_SIZE) {
    const firstKey = _chartCache.keys().next().value
    if (firstKey === undefined) break
    _chartCache.delete(firstKey)
  }
}

/** Yahoo chart `interval` values we use (library accepts string). */
type YahooInterval = '1m' | '2m' | '5m' | '15m' | '1h' | '2h' | '4h' | '1d' | '1wk' | '1mo'

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  // Rate limit: 60 req/min per IP
  const rateLimitResponse = applyRateLimit(req, 'chart', { maxRequests: 60, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  let ticker = params.ticker.toUpperCase()
  if (ticker === 'VIX') ticker = '^VIX'
  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') || '1Y'
  const cacheKey = `${ticker}:${range}`
  const now = Date.now()

  const cached = _chartCache.get(cacheKey)
  if (cached && now < cached.expiresAt) {
    return NextResponse.json(
      {
        ticker,
        candles: cached.candles,
        darkPoolMarkers: cached.darkPoolMarkers,
        range: cached.range,
        interval: cached.interval,
        _cached: true,
      },
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } }
    )
  }

  try {
    const period1 = new Date()
    let interval: YahooInterval = '1d'

    switch (range) {
      case '1m':
        period1.setDate(period1.getDate() - 2)
        interval = '1m'
        break
      case '3m': {
        period1.setDate(period1.getDate() - 10)
        const result3 = await yahooFinance.chart(ticker, { period1, interval: '1m' })
        if (!result3?.quotes?.length) {
          return NextResponse.json({ error: 'No historical data found for ticker' }, { status: 404 })
        }
        const agg = aggregateMinuteQuotesToN(result3.quotes as any, 3)
        const candles = agg.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }))
        const darkPoolMarkers = generateDarkPoolMarkers(
          candles.map((c) => ({ time: c.time as any, close: c.close })),
          ticker
        )
        evictCacheIfNeeded()
        _chartCache.set(cacheKey, {
          candles,
          darkPoolMarkers,
          expiresAt: now + CHART_CACHE_TTL_MS,
          range,
          interval: '3m (from 1m)',
        })
        return NextResponse.json(
          { ticker, candles, darkPoolMarkers, range, interval: '3m (from 1m)', _cached: false },
          {
            headers: {
              'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
              'CDN-Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
            },
          }
        )
      }
      case '5m':
        period1.setDate(period1.getDate() - 2)
        interval = '5m'
        break
      case '15m':
        period1.setDate(period1.getDate() - 3)
        interval = '15m'
        break
      case '1H':
        period1.setDate(period1.getDate() - 5)
        interval = '1h'
        break
      case '4H':
        period1.setDate(period1.getDate() - 15)
        interval = '1h'
        break
      case '1D':
        period1.setDate(period1.getDate() - 14)
        interval = '1d'
        break
      case '1W':
        period1.setDate(period1.getDate() - 30)
        interval = '1d'
        break
      case '1M':
        period1.setMonth(period1.getMonth() - 1)
        interval = '1d'
        break
      case '3M':
        period1.setMonth(period1.getMonth() - 3)
        interval = '1d'
        break
      case '6M':
        period1.setMonth(period1.getMonth() - 6)
        interval = '1d'
        break
      case '1Y':
        period1.setFullYear(period1.getFullYear() - 1)
        interval = '1d'
        break
      case '2Y':
        period1.setFullYear(period1.getFullYear() - 2)
        interval = '1wk'
        break
      case '5Y':
        period1.setFullYear(period1.getFullYear() - 5)
        interval = '1wk'
        break
      case 'ALL':
        period1.setFullYear(1970)
        interval = '1mo'
        break
      default:
        period1.setFullYear(period1.getFullYear() - 1)
        interval = '1d'
        break
    }

    const result = await yahooFinance.chart(ticker, { period1, interval })

    if (!result || !result.quotes || result.quotes.length === 0) {
      return NextResponse.json({ error: 'No historical data found for ticker' }, { status: 404 })
    }

    const isIntraday = ['1m', '2m', '5m', '15m', '1h', '2h', '4h'].includes(interval)
    const candles = result.quotes
      .filter((c: any) => c.close !== null)
      .map((c: any) => {
        const timeVal = isIntraday
          ? Math.floor(c.date.getTime() / 1000)
          : c.date.toISOString().split('T')[0]
        return { time: timeVal, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }
      })

    const darkPoolMarkers = generateDarkPoolMarkers(
      candles.map((c: { time: string | number; close: number }) => ({ time: c.time as any, close: c.close })),
      ticker
    )

    evictCacheIfNeeded()
    _chartCache.set(cacheKey, {
      candles,
      darkPoolMarkers,
      expiresAt: now + CHART_CACHE_TTL_MS,
      range,
      interval,
    })

    return NextResponse.json(
      { ticker, candles, darkPoolMarkers, range, interval, _cached: false },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          'CDN-Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        },
      }
    )
  } catch (error) {
    console.error(`[Chart API] Error fetching historical data for ${ticker}:`, error)
    return NextResponse.json({ error: 'Failed to fetch historical data', details: String(error) }, { status: 500 })
  }
}
