import { NextRequest, NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'
import YahooFinance from 'yahoo-finance2'
import { fetchBloombergQuotesViaBridge, isBloombergBridgeConfigured } from '@/lib/data/bloomberg/bridgeClient'
import { mergeYahooAndBloomberg } from '@/lib/data/mergeQuotes'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'
import { errorResponse, withRetry } from '@/lib/api/reliability'

const yahooFinance = new YahooFinance()

function isoQuoteTime(q: { regularMarketTime?: unknown }): string | null {
  const t = q.regularMarketTime
  if (t instanceof Date) return t.toISOString()
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString()
  return null
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const queryTickers = url.searchParams.get('tickers')

  const tickers = queryTickers
    ? queryTickers.split(',').map((t) => {
        const u = decodeURIComponent(t.trim()).toUpperCase()
        return u === 'VIX' ? '^VIX' : u
      })
    : [...SECTORS.map((s) => s.etf), 'SPY', 'QQQ']

  try {
    const [results, bbMap] = await Promise.all([
      withRetry(() => yahooFinance.quote(tickers) as Promise<any[]>, { attempts: 2, timeoutMs: 7000, retryLabel: 'yahoo quote' }),
      isBloombergBridgeConfigured()
        ? fetchBloombergQuotesViaBridge(tickers).catch(() => null)
        : Promise.resolve(null),
    ])

    const yahooQuotes = results.map((q: any) => ({
      ticker: q.symbol,
      price: q.regularMarketPrice || 0,
      change: q.regularMarketChange || 0,
      changePct: normalizedChangePercent(
        q.regularMarketChangePercent,
        q.regularMarketChange,
        q.regularMarketPrice
      ),
      volume: q.regularMarketVolume || 0,
      high52w: q.fiftyTwoWeekHigh || 0,
      low52w: q.fiftyTwoWeekLow || 0,
      pe: q.trailingPE || 0,
      marketCap: q.marketCap ? (q.marketCap / 1e9).toFixed(1) + 'B' : 'N/A',
      quoteTime: isoQuoteTime(q),
    }))

    const quotes = mergeYahooAndBloomberg(yahooQuotes, bbMap)
    const bloombergTickers = quotes.filter((q) => q.dataSource === 'bloomberg').map((q) => q.ticker)

    return NextResponse.json(
      {
        quotes,
        timestamp: new Date().toISOString(),
        dataSources: {
          yahoo: true,
          bloombergBridge: Boolean(bbMap && bbMap.size > 0),
          bloombergTickers,
        },
      },
      { headers: { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[Prices API] Error fetching from Yahoo Finance:', error)
    return errorResponse('prices_fetch_failed', 'Failed to fetch live prices', String(error), 500)
  }
}
