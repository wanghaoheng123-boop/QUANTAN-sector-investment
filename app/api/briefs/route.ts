/**
 * GET /api/briefs
 *
 * Live financial news sourced from Yahoo Finance across all 11 GICS sectors.
 * Aggregates top holdings news per sector, deduplicates, and returns fresh headlines.
 *
 * Yahoo Finance provides real-time news via `yf.search()` for each sector's top holdings.
 * Falls back gracefully if Yahoo returns no results or an error.
 */

import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
import { isSafeHttpUrl } from '@/lib/security/urlValidation'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Map sector slugs to their primary ETF ticker + top holdings for news search
const SECTOR_QUERY_MAP: Record<string, { name: string; tickers: string[]; color: string }> = {
  'technology':        { name: 'Technology',        tickers: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'AMD'], color: '#3b82f6' },
  'energy':            { name: 'Energy',             tickers: ['XOM', 'CVX', 'COP', 'EOG', 'SLB'], color: '#f59e0b' },
  'financials':        { name: 'Financials',         tickers: ['JPM', 'BAC', 'WFC', 'GS', 'MS'], color: '#10b981' },
  'healthcare':        { name: 'Healthcare',         tickers: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK'], color: '#ec4899' },
  'consumer-discretionary': { name: 'Consumer Disc.',  tickers: ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE'], color: '#f97316' },
  'industrials':       { name: 'Industrials',       tickers: ['GE', 'CAT', 'RTX', 'UNP', 'HON'], color: '#6366f1' },
  'communication':     { name: 'Communication',     tickers: ['META', 'GOOGL', 'NFLX', 'DIS', 'T'], color: '#8b5cf6' },
  'materials':         { name: 'Materials',          tickers: ['FCX', 'LIN', 'APD', 'NEM', 'DOW'], color: '#14b8a6' },
  'utilities':         { name: 'Utilities',          tickers: ['NEE', 'SO', 'DUK', 'AEP', 'PCG'], color: '#22c55e' },
  'real-estate':       { name: 'Real Estate',        tickers: ['PLD', 'AMT', 'EQIX', 'WELL', 'SPG'], color: '#f59e0b' },
  'consumer-staples':  { name: 'Consumer Staples',  tickers: ['PG', 'COST', 'WMT', 'PEP', 'KO'], color: '#06b6d4' },
}

export interface NewsBrief {
  id: string
  title: string
  summary: string
  sector: string
  sectorName: string
  sectorColor: string
  timestamp: string | null
  readTime: number
  tags: string[]
  link: string
  publisher: string
  tickers: string[]
}

function estimateReadTime(text: string): number {
  const words = text.split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

// Phase 14 (R4-H-2): per-call timeout for the Yahoo search fan-out. A
// single slow upstream ticker could otherwise stall the entire 33-call
// briefs payload (11 sectors × 3 tickers). 4s caps the worst-case wait;
// Yahoo p99 search latency is typically <1s.
const NEWS_FETCH_TIMEOUT_MS = 4000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

async function fetchNewsForTicker(ticker: string): Promise<NewsBrief[]> {
  const results: NewsBrief[] = []
  try {
    const searchResult = await withTimeout(
      yahooFinance.search(ticker, { newsCount: 5 }),
      NEWS_FETCH_TIMEOUT_MS,
      `briefs.search(${ticker})`,
    )
    if (!searchResult?.news || !Array.isArray(searchResult.news)) return results

    for (const item of searchResult.news as Record<string, unknown>[]) {
      const link = String(item.link ?? '')
      // Reject non-http(s) URLs entirely — see isSafeHttpUrl doc-comment.
      if (!isSafeHttpUrl(link)) continue

      const title = String(item.title ?? '')
      const snippet = item.summary ? String(item.summary).slice(0, 300) : title
      const publishedAt = item.publishedAt ? String(item.publishedAt) : null
      const relatedTickers: string[] = Array.isArray(item.relatedTickers)
        ? (item.relatedTickers as string[]).slice(0, 5)
        : []

      results.push({
        id: Buffer.from(link).toString('base64').slice(0, 16),
        title,
        summary: snippet,
        sector: '',
        sectorName: '',
        sectorColor: '',
        timestamp: publishedAt,
        readTime: estimateReadTime(snippet),
        tags: relatedTickers.slice(0, 4),
        link,
        publisher: String(item.publisher ?? 'Yahoo Finance'),
        tickers: relatedTickers,
      })
    }
  } catch (err) {
    // Phase 13 S2: previously silent. Per-ticker failures don't block other
    // results, but operators need a trail when news fetch is degraded.
    console.warn('[briefs] news fetch failed for', ticker, err)
  }
  return results
}

export async function GET(request: Request): Promise<NextResponse<{
  briefs: NewsBrief[]
  fetchedAt: string
  sectorCount: number
  source: string
  degraded?: boolean
} | { error: string }>> {
  // Phase 13 S2: rate-limit. This route fans out to ~33 yahoo search() calls
  // per request (11 sectors × 3 tickers each). Tighter limit to prevent
  // amplification of upstream load.
  const rateLimitResponse = applyRateLimit(request, 'briefs', {
    maxRequests: 6,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse as unknown as NextResponse<{ error: string }>

  try {
    const seenLinks = new Set<string>()
    const allBriefs: NewsBrief[] = []

    // Phase 14 (R4-H-2): fan-out amplification mitigation.
    //   • Promise.allSettled (not Promise.all) so a single timeout or
    //     reject doesn't poison the whole batch.
    //   • Per-call timeout via withTimeout() above caps tail latency.
    //   • Track per-ticker failures; if more than half of the 33 calls
    //     failed, surface `degraded: true` so clients can warn the user
    //     and refetch later instead of caching an impoverished payload
    //     for 5 minutes via the CDN.
    const sectorEntries = Object.entries(SECTOR_QUERY_MAP)
    let totalCalls = 0
    let failedCalls = 0
    const newsBySector = await Promise.all(
      sectorEntries.map(async ([slug, config]) => {
        const targetTickers = config.tickers.slice(0, 3)
        const settled = await Promise.allSettled(
          targetTickers.map(t => fetchNewsForTicker(t))
        )
        const sectorNews: NewsBrief[] = []
        for (const r of settled) {
          totalCalls++
          if (r.status === 'fulfilled') {
            sectorNews.push(...r.value)
          } else {
            failedCalls++
            console.warn('[briefs] sector ticker fetch failed', slug, r.reason)
          }
        }

        // Tag each brief with sector info
        return sectorNews.map(brief => ({
          ...brief,
          sector: slug,
          sectorName: config.name,
          sectorColor: config.color,
        }))
      })
    )
    const degraded = totalCalls > 0 && failedCalls * 2 > totalCalls

    // Flatten and deduplicate
    for (const sectorBriefs of newsBySector) {
      for (const brief of sectorBriefs) {
        if (seenLinks.has(brief.link)) continue
        seenLinks.add(brief.link)
        allBriefs.push(brief)
      }
    }

    // Sort by timestamp (most recent first)
    allBriefs.sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })

    return NextResponse.json(
      {
        briefs: allBriefs.slice(0, 20),
        fetchedAt: new Date().toISOString(),
        sectorCount: sectorEntries.length,
        source: 'Yahoo Finance',
        ...(degraded ? { degraded: true } : {}),
      },
      {
        headers: {
          // Phase 14 (R4-H-2): shorter CDN cache on degraded payloads so a
          // bad minute doesn't pin a poor result for the full window.
          'Cache-Control': degraded
            ? 's-maxage=30, stale-while-revalidate=60'
            : 's-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    console.error('[Briefs API]', err)
    // Phase 13 S2 fix (F4.8): sanitized error.
    return NextResponse.json(
      { error: 'Failed to fetch financial news', details: sanitizeError(err) ?? null },
      { status: 502 }
    )
  }
}
