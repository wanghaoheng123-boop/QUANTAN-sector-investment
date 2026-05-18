/**
 * GET /api/news/ticker/[ticker]
 *
 * Live news for a specific stock ticker from Yahoo Finance.
 *
 * Phase 14 wave 25 hardening (matches the sector route):
 *   - Rate limit (30 req/min/IP) — Yahoo search is expensive; unprotected
 *     polling was a DoS amplifier.
 *   - Strict ticker validation via the canonical normalizeTicker — was
 *     permissive (trim+uppercase only), no char whitelist.
 *   - Link safety — drop news items whose `link` isn't a valid http(s) URL
 *     so the UI's `<a href={link}>` can't render a `javascript:` payload.
 *   - sanitizeError + length-capped strings prevent stack-trace / oversized
 *     field leakage.
 */

import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { isSafeHttpUrl } from '@/lib/security/urlValidation'

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
  const rl = applyRateLimit(req, 'news-ticker', { maxRequests: 30, windowSeconds: 60 })
  if (rl) return rl as NextResponse<{ error: string }>

  const ticker = normalizeTicker(params.ticker)
  if (!ticker) {
    return NextResponse.json({ error: 'invalid_ticker' }, { status: 400 })
  }

  try {
    const result = await yahooFinance.search(ticker, {
      newsCount: 15,
    })

    const news: NewsItem[] = (
      ((result as Record<string, unknown>)?.news as Array<Record<string, unknown>> | undefined) ?? []
    )
      .map(item => {
        const link = String(item.link ?? '')
        return {
          title: String(item.title ?? '').slice(0, 300),
          publisher: String(item.publisher ?? 'Unknown').slice(0, 100),
          link,
          publishedAt: (item.publishedAt as string) || null,
          snippet: item.summary ? String(item.summary).slice(0, 300) : null,
          ticker,
        }
      })
      .filter((n) => isSafeHttpUrl(n.link))

    return NextResponse.json(
      { news, ticker, fetchedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    console.error(`[News API] ticker=${ticker}:`, err)
    return NextResponse.json(
      { error: 'Failed to fetch news', details: sanitizeError(err) ?? 'fetch_failed' },
      { status: 502 },
    )
  }
}
