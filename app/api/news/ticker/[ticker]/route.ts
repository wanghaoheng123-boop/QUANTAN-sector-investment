/**
 * GET /api/news/ticker/[ticker]
 *
 * Live news for a specific stock ticker from Yahoo Finance.
 */

import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface NewsItem {
  title: string
  publisher: string
  link: string
  publishedAt: string | null
  snippet: string | null
  ticker: string
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
): Promise<NextResponse<{ news: NewsItem[]; ticker: string; fetchedAt: string } | { error: string }>> {
  const ticker = (params.ticker || '').trim().toUpperCase()
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  try {
    const result = await yahooFinance.search(ticker, {
      newsCount: 15,
    })

    const news: NewsItem[] = (
      (result as Record<string, unknown>)?.news as Array<Record<string, unknown>> | undefined
    )?.map(item => ({
      title: String(item.title ?? ''),
      publisher: String(item.publisher ?? 'Unknown'),
      link: String(item.link ?? ''),
      publishedAt: (item.publishedAt as string) || null,
      snippet: item.summary ? String(item.summary).slice(0, 300) : null,
      ticker,
    })) ?? []

    return NextResponse.json(
      { news, ticker, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    console.error(`[News API] ticker=${ticker}:`, err)
    return NextResponse.json({ error: 'Failed to fetch news', details: String(err) }, { status: 502 })
  }
}
