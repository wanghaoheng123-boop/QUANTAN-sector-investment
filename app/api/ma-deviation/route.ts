import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { SECTORS } from '@/lib/sectors'
import { sma, rsi, ma200Regime } from '@/lib/quant/technicals'
import { sanitizeError } from '@/lib/api/sanitize'

const yahooFinance = new YahooFinance()

// 5-minute server-side cache — balances freshness vs Yahoo rate limits
const _cache = new Map<string, { data: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

const TICKERS = [
  ...SECTORS.map((s) => ({ ticker: s.etf, name: s.name, color: s.color, icon: s.icon, slug: s.slug })),
  { ticker: 'SPY', name: 'S&P 500', color: '#3b82f6', icon: '🇺🇸', slug: 'spy' },
  { ticker: 'QQQ', name: 'Nasdaq-100', color: '#8b5cf6', icon: '💻', slug: 'qqq' },
]

export async function GET() {
  const now = Date.now()
  const cached = _cache.get('ma-deviation')
  if (cached && now < cached.expiresAt) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  }

  try {
    const period1 = new Date()
    period1.setDate(period1.getDate() - 310) // ~310 calendar days → ~220 trading days

    const allTickers = TICKERS.map((t) => t.ticker)

    // Fetch all charts in parallel
    const chartResults = await Promise.allSettled(
      allTickers.map((ticker) =>
        yahooFinance.chart(ticker, { period1, interval: '1d' })
      )
    )

    const rows = TICKERS.map((meta, idx) => {
      const result = chartResults[idx]
      if (result.status === 'rejected') {
        return {
          ticker: meta.ticker,
          name: meta.name,
          color: meta.color,
          icon: meta.icon,
          slug: meta.slug,
          price: null,
          sma200: null,
          regime: null,
          error: 'fetch_failed',
        }
      }

      const quotes = result.value?.quotes?.filter(
        (c: any) => c.close != null && c.close > 0
      ) ?? []

      if (quotes.length < 10) {
        return {
          ticker: meta.ticker,
          name: meta.name,
          color: meta.color,
          icon: meta.icon,
          slug: meta.slug,
          price: null,
          sma200: null,
          regime: null,
          error: 'insufficient_data',
        }
      }

      const closes: number[] = quotes.map((c: any) => c.close as number)
      const price = closes[closes.length - 1]
      const sma200val = sma(closes, 200)
      const rsi14val = rsi(closes, 14)
      const regime = ma200Regime(price, closes, rsi14val)

      return {
        ticker: meta.ticker,
        name: meta.name,
        color: meta.color,
        icon: meta.icon,
        slug: meta.slug,
        price,
        sma200: sma200val,
        sma50: sma(closes, 50),
        rsi14: rsi14val,
        tradingDays: closes.length,
        regime,
      }
    })

    const payload = {
      rows,
      computedAt: new Date().toISOString(),
      disclaimer:
        'Deviation zones and forward return context are based on historical analysis of S&P 500 / sector ETF daily data (1990–2024). Not investment advice. Past performance is not indicative of future results.',
    }

    _cache.set('ma-deviation', { data: payload, expiresAt: now + CACHE_TTL_MS })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch (error) {
    console.error('[MA Deviation API]', error)
    // Phase 16 audit (2026-05-24): replaced `details: String(error)` which
    // would leak stack traces + file paths in production (CWE-209). The SSOT
    // sanitizeError returns undefined in production and the message in dev.
    const details = sanitizeError(error)
    return NextResponse.json(
      {
        error: 'Failed to compute MA deviation data',
        ...(details ? { details } : {}),
      },
      { status: 500 },
    )
  }
}
