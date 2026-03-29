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
      const result = await yahooFinance.search(ticker, {
        newsCount: 4,
      })
      if (!result?.news || !Array.isArray(result.news)) continue

      for (const item of result.news as Record<string, unknown>[]) {
        const link = String(item.link ?? '')
        if (!link || seen.has(link)) continue
        seen.add(link)
        results.push({
          title: String(item.title ?? ''),
          publisher: String(item.publisher ?? 'Unknown'),
          link,
          publishedAt: (item.publishedAt as string) || null,
          snippet: item.summary ? String(item.summary).slice(0, 200) : null,
          sector,
          tickers: Array.isArray(item.relatedTickers) ? (item.relatedTickers as string[]).slice(0, 5) : [],
        })
      }
    } catch {
      continue
    }
  }

  return results
}

export async function GET(
  req: NextRequest,
  { params }: { params: { sector: string } }
): Promise<NextResponse<{ news: NewsItem[]; sector: string; fetchedAt: string; source: string } | { error: string }>> {
  const sector = (params.sector || '').trim()
  if (!sector) {
    return NextResponse.json({ error: 'sector is required' }, { status: 400 })
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
    return NextResponse.json({ error: 'Failed to fetch news', details: String(err) }, { status: 502 })
  }
}
