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
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse<{ news: NewsItem[]; ticker: string; fetchedAt: string } | { error: string }>> {
  const rl = await applyRateLimit(req, 'news-ticker', { maxRequests: 30, windowSeconds: 60 })
  if (rl) return rl as NextResponse<{ error: string }>

  const { ticker: tickerParam } = await params
  const ticker = normalizeTicker(tickerParam)
  if (!ticker) {
    return NextResponse.json({ error: 'invalid_ticker' }, { status: 400 })
  }

  try {
    // validateResult:false — tolerate Yahoo's drifted SearchResult schema
    // (see /api/briefs/[sector]); news is display-only + null-guarded below.
    const result = await yahooFinance.search(ticker, {
      newsCount: 15,
    }, { validateResult: false })

    // I2 (fail closed): distinguish "the vendor returned no stories" from "the
    // vendor's shape changed and we can no longer find the stories". Under
    // validateResult:false — which exists BECAUSE Yahoo's SearchResult schema has
    // already drifted once — a moved `news` key would otherwise coalesce to []
    // and the UI would tell the user "No recent news found for this ticker on
    // Yahoo Finance", a false factual claim about the vendor (Q088-5).
    const rawNews = (result as Record<string, unknown>)?.news
    if (rawNews !== undefined && !Array.isArray(rawNews)) {
      console.error(`[News API] ticker=${ticker}: 'news' key present but not an array — vendor schema drift`)
      return NextResponse.json(
        { error: 'news_schema_drift', details: 'Upstream news payload had an unexpected shape.' },
        { status: 502 },
      )
    }
    if (rawNews === undefined) {
      console.error(`[News API] ticker=${ticker}: 'news' key absent from the search response — vendor schema drift`)
      return NextResponse.json(
        { error: 'news_schema_drift', details: 'Upstream news payload was missing the expected field.' },
        { status: 502 },
      )
    }

    const news: NewsItem[] = (rawNews as Array<Record<string, unknown>>)
      .map(item => {
        const link = String(item.link ?? '')
        return {
          title: String(item.title ?? '').slice(0, 300),
          publisher: String(item.publisher ?? 'Unknown').slice(0, 100),
          link,
          // Yahoo's SearchNews carries providerPublishTime (a Date), NOT publishedAt.
          // Reading the wrong key silently nulled every date, so the UI showed a
          // 'Live' badge over undated headlines and the only timestamp on screen
          // was our own fetch time — a three-year-old article looked identical to
          // one ten minutes old (Q088-4).
          publishedAt: item.providerPublishTime
            ? new Date(item.providerPublishTime as string | number | Date).toISOString()
            : null,
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
