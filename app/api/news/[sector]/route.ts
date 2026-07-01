/**
 * GET /api/news/[sector]
 *
 * Live news headlines sourced from Yahoo Finance for a given sector ETF.
 *
 * Yahoo Finance provides real-time news via `yf.search()` with the sector ETF
 * as the query ticker. Each item includes title, publisher, link, and publish time.
 *
 * Falls back gracefully if Yahoo returns no results or an error.
 */

import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
import { isSafeHttpUrl } from '@/lib/security/urlValidation'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map sector slugs to their primary ETF ticker + top holdings for news search
const SECTOR_QUERY_MAP: Record<string, { etf: string; tickers: string[] }> = {
  'technology':        { etf: 'XLK', tickers: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD'] },
  'energy':            { etf: 'XLE', tickers: ['XOM', 'CVX', 'COP', 'EOG', 'SLB'] },
  'financials':        { etf: 'XLF', tickers: ['JPM', 'BAC', 'WFC', 'GS', 'MS'] },
  'healthcare':        { etf: 'XLV', tickers: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK'] },
  'consumer-discretionary': { etf: 'XLY', tickers: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'] },
  'industrials':       { etf: 'XLI', tickers: ['GE', 'CAT', 'RTX', 'UNP', 'HON'] },
  'communication':     { etf: 'XLC', tickers: ['META', 'GOOGL', 'NFLX', 'DIS', 'T'] },
  'materials':         { etf: 'XLB', tickers: ['FCX', 'LIN', 'APD', 'NEM', 'DOW'] },
  'utilities':         { etf: 'XLU', tickers: ['NEE', 'SO', 'DUK', 'AEP', 'PCG'] },
  'real-estate':       { etf: 'XLRE', tickers: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG'] },
  'consumer-staples':  { etf: 'XLP', tickers: ['PG', 'COST', 'WMT', 'PEP', 'KO'] },
}

// Yahoo Finance news item shape
export interface NewsItem {
  title: string
  publisher: string
  link: string
  publishedAt: string | null   // ISO 8601
  snippet: string | null
  sector: string
  tickers: string[]
}
async function fetchNewsForTickers(tickers: string[], sector: string): Promise<NewsItem[]> {
  const seen = new Set<string>()
  const results: NewsItem[] = []

  for (const ticker of tickers.slice(0, 5)) {
    if (results.length >= 10) break
    try {
      // validateResult:false — tolerate Yahoo's drifted SearchResult schema
      // (see /api/briefs/[sector]); news is display-only + null-guarded below.
      const result = await yahooFinance.search(ticker, {
        newsCount: 4,
      }, { validateResult: false }) as { news?: unknown[] }  // untyped (validateResult:false); guarded below
      if (!result?.news || !Array.isArray(result.news)) continue

      for (const item of result.news as Record<string, unknown>[]) {
        const link = String(item.link ?? '')
        // Phase 14 wave 25: validate news links are http(s) before emitting.
        // The UI renders these as <a href={link}>; without validation, an
        // upstream `javascript:` / `data:` link is an XSS vector. Drop
        // unsafe URLs entirely rather than passing them through.
        if (!link || seen.has(link) || !isSafeHttpUrl(link)) continue
        seen.add(link)
        results.push({
          title: String(item.title ?? '').slice(0, 300),
          publisher: String(item.publisher ?? 'Unknown').slice(0, 100),
          link,
          publishedAt: (item.publishedAt as string) || null,
          snippet: item.summary ? String(item.summary).slice(0, 200) : null,
          sector,
          tickers: Array.isArray(item.relatedTickers) ? (item.relatedTickers as string[]).slice(0, 5) : [],
        })
      }
    } catch (err) {
      // Phase 14 wave 25: log instead of silent continue. A failed search
      // for one ticker shouldn't kill the whole loop, but a chronic Yahoo
      // outage was previously invisible.
      console.warn(JSON.stringify({
        event: 'news.sector_ticker_search_failed',
        sector,
        ticker,
        message: (err as Error)?.message,
      }))
      continue
    }
  }

  return results
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sector: string }> }
): Promise<NextResponse<{ news: NewsItem[]; sector: string; fetchedAt: string; source: string } | { error: string }>> {
  // Phase 14 wave 25: rate limit (30 req/min/IP). News fans out to 5 Yahoo
  // search calls per request — unprotected polling could saturate the upstream
  // and inflate Vercel function bills.
  const rl = await applyRateLimit(req, 'news-sector', { maxRequests: 30, windowSeconds: 60 })
  if (rl) return rl as NextResponse<{ error: string }>

  const { sector: sectorParam } = await params
  const sector = (sectorParam || '').trim()
  if (!sector) {
    return NextResponse.json({ error: 'sector is required' }, { status: 400 })
  }

  // Phase 14 wave 25: validate sector against the allow-list BEFORE echoing
  // it back in the response. Without this, a client could pass any string
  // and have it reflected in fetchedAt JSON — minor XSS surface (JSON-safe
  // but still incorrect data flow).
  if (!(sector in SECTOR_QUERY_MAP)) {
    return NextResponse.json({ error: `Unknown sector: ${sector}` }, { status: 404 })
  }

  try {
    const queryConfig = SECTOR_QUERY_MAP[sector]
    const tickers = queryConfig?.tickers ?? []

    const news = await fetchNewsForTickers(tickers, sector)

    return NextResponse.json(
      {
        news: news.slice(0, 10),
        sector,
        fetchedAt: new Date().toISOString(),
        source: 'Yahoo Finance',
      },
      {
        headers: {
          'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    console.error(`[News API] sector=${sector}:`, err)
    // Phase 14 wave 25: sanitizeError instead of raw String(err) so stack
    // traces / internal hostnames don't leak to clients in production.
    return NextResponse.json(
      { error: 'Failed to fetch news', details: sanitizeError(err) ?? 'fetch_failed' },
      { status: 502 },
    )
  }
}
