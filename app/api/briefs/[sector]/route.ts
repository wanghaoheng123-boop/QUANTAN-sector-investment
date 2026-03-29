/**
 * GET /api/briefs/[sector]
 *
 * Live Intelligence Brief for a sector — sourced entirely from Yahoo Finance.
 *
 * Each brief is dynamically generated and includes:
 *   • Live price, session change, 52-week range position
 *   • Live analyst consensus (buy/hold/sell ratings)
 *   • Top holdings performance
 *   • Sector ETF key statistics
 *   • Live news headlines
 *   • Embedded signals (derived from real price/metric data)
 *
 * No mock data, no hardcoded values.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require('yahoo-finance2').default
import { NextRequest, NextResponse } from 'next/server'
import { SECTORS } from '@/lib/sectors'

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface BriefSignal {
  key: string
  value: string
  impact: 'positive' | 'negative' | 'neutral'
}

export interface SectorBrief {
  id: string
  sector: string
  sectorName: string
  fetchedAt: string
  lastUpdated: string | null

  // Live price data
  price: number
  change: number
  changePct: number
  quoteTime: string | null

  // 52-week context
  high52w: number | null
  low52w: number | null
  priceVsHighPct: number | null
  priceVsLowPct: number | null

  // Analyst consensus
  analystRating: string | null
  analystCount: number | null
  targetPrice: number | null
  currentVsTargetPct: number | null

  // Key ETF statistics
  volume: number | null
  avgVolume: number | null
  avgVolume10d: number | null
  marketCap: string | null
  peRatio: number | null
  forwardPe: number | null
  pegRatio: number | null
  priceToBook: number | null
  dividendYield: number | null
  beta: number | null

  // Holdings-derived data
  holdings: { ticker: string; weight: string; price: number; change: number; changePct: number }[]
  holdingsAvgChange: number

  // Live news
  news: {
    title: string
    publisher: string
    publishedAt: string | null
    snippet: string | null
    link: string
    tickers: string[]
  }[]

  // Derived signals
  signals: BriefSignal[]

  // Human-readable summary (computed from real data)
  summary: string

  // Metadata
  source: string
  dataQuality: 'live' | 'partial' | 'unavailable'
  dataQualityNote: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function parseQuoteTime(ts: unknown): string | null {
  if (ts == null) return null
  if (ts instanceof Date) return ts.toISOString()
  if (typeof ts === 'string') {
    const d = new Date(ts)
    return Number.isFinite(d.getTime()) ? d.toISOString() : null
  }
  if (typeof ts === 'number') {
    const ms = ts > 1e12 ? ts : ts * 1000
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
  }
  return null
}

function formatLargeNum(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}

function fetchWithFallback<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback)
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { sector: string } }
): Promise<NextResponse<SectorBrief | { error: string }>> {
  const slug = (params.sector || '').trim()
  const sectorMeta = SECTORS.find(s => s.slug === slug)

  if (!sectorMeta) {
    return NextResponse.json({ error: `Unknown sector: ${slug}` }, { status: 404 })
  }

  const etf = sectorMeta.etf
  const now = new Date()

  // Parallel fetch: ETF quote, ETF summary stats, holdings quotes, news
  const [etfQuote, etfSummary, newsResult] = await Promise.allSettled([
    fetchWithFallback(yf.quote(etf), null),
    fetchWithFallback(
      yf.quoteSummary(etf, {
        modules: ['defaultKeyStatistics', 'financialData', 'recommendationTrend', 'earningsTrend'],
      }),
      null
    ),
    fetchWithFallback(
      yf.search(etf, { newsCount: 8 }),
      null
    ),
  ])

  // ── ETF Quote ──────────────────────────────────────────────────────────────
  const q = (etfQuote.status === 'fulfilled' ? etfQuote.value : null) as Record<string, unknown> | null

  const price = safeNum(q?.regularMarketPrice ?? q?.currentPrice) ?? 0
  const change = safeNum(q?.regularMarketChange) ?? 0
  const rawChangePct = safeNum((q as Record<string, unknown>)?.regularMarketChangePercent as number)
  const changePct = rawChangePct ?? (price > 0 && change !== 0 ? (100 * change) / price : 0)
  const quoteTime = parseQuoteTime(q?.regularMarketTime)
  const volume = safeNum(q?.regularVolume)
  const avgVolume = safeNum((q as Record<string, unknown>)?.averageDailyVolume as number)
  const marketCapRaw = safeNum(q?.marketCap)
  const marketCap = marketCapRaw ? formatLargeNum(marketCapRaw) : null
  const high52w = safeNum(q?.fiftyTwoWeekHigh)
  const low52w = safeNum(q?.fiftyTwoWeekLow)
  const priceVsHighPct = high52w && high52w > 0 ? -((high52w - price) / high52w) * 100 : null
  const priceVsLowPct = low52w && low52w > 0 ? ((price - low52w) / low52w) * 100 : null

  // ── ETF Summary ────────────────────────────────────────────────────────────
  const etfSummaryData = (etfSummary.status === 'fulfilled' ? etfSummary.value : null) as Record<string, unknown> | null
  const keyStats = (etfSummaryData?.defaultKeyStatistics ?? {}) as Record<string, unknown>
  const finData = (etfSummaryData?.financialData ?? {}) as Record<string, unknown>
  const recTrend = (etfSummaryData?.recommendationTrend ?? {}) as Record<string, unknown>

  const peRatio = safeNum(keyStats?.trailingPE)
  const forwardPe = safeNum(keyStats?.forwardPE)
  const pegRatio = safeNum(keyStats?.pegRatio)
  const priceToBook = safeNum(keyStats?.priceToBook)
  const beta = safeNum(keyStats?.beta)
  const avgVolume10d = safeNum(keyStats?.averageDailyVolume10Day)
  const dividendYield = safeNum(keyStats?.dividendYield)

  // Analyst data
  let analystRating: string | null = null
  let analystCount: number | null = null
  let targetPrice: number | null = null
  let currentVsTargetPct: number | null = null

  if (recTrend && typeof recTrend === 'object') {
    const trends = (recTrend as Record<string, unknown>).trend as Array<Record<string, unknown>> | undefined
    if (Array.isArray(trends) && trends.length > 0) {
      const current = trends[0] as Record<string, unknown>
      analystCount = safeNum(current.strongBuy as number) ?? 0 + (safeNum(current.buy as number) ?? 0) + (safeNum(current.hold as number) ?? 0) + (safeNum(current.sell as number) ?? 0) + (safeNum(current.strongSell as number) ?? 0)
      const strongBuy = safeNum(current.strongBuy as number) ?? 0
      const buy = safeNum(current.buy as number) ?? 0
      const hold = safeNum(current.hold as number) ?? 0
      const sell = safeNum(current.sell as number) ?? 0
      const strongSell = safeNum(current.strongSell as number) ?? 0
      const total = strongBuy + buy + hold + sell + strongSell
      if (total > 0) {
        if ((strongBuy + buy) / total > 0.6) analystRating = 'BUY'
        else if ((sell + strongSell) / total > 0.4) analystRating = 'SELL'
        else analystRating = 'HOLD'
      }
    }
  }

  const targetRaw = safeNum(finData?.targetPrice as number)
  if (targetRaw && price > 0) {
    targetPrice = targetRaw
    currentVsTargetPct = ((price - targetRaw) / targetRaw) * 100
  }

  // ── Holdings ───────────────────────────────────────────────────────────────
  const holdingsData = sectorMeta.topHoldings.slice(0, 5)
  const holdingsQuotes = await Promise.allSettled(
    holdingsData.map(t => yf.quote(t))
  )

  const holdings = holdingsData.map((ticker, i) => {
    const r = holdingsQuotes[i]
    const qh = (r.status === 'fulfilled' ? r.value : null) as Record<string, unknown> | null
    return {
      ticker,
      weight: '—',
      price: safeNum(qh?.regularMarketPrice ?? qh?.currentPrice) ?? 0,
      change: safeNum(qh?.regularMarketChange) ?? 0,
      changePct: safeNum((qh as Record<string, unknown>)?.regularMarketChangePercent as number) ?? 0,
    }
  }).filter(h => h.price > 0)

  const holdingsAvgChange = holdings.length > 0
    ? holdings.reduce((s, h) => s + h.changePct, 0) / holdings.length
    : 0

  // ── News ──────────────────────────────────────────────────────────────────
  const n = (newsResult.status === 'fulfilled' ? newsResult.value : null) as Record<string, unknown> | null
  const rawNews = (n?.news as Array<Record<string, unknown>> | undefined) ?? []
  const news = rawNews.slice(0, 6).map((item: Record<string, unknown>) => ({
    title: String(item.title ?? ''),
    publisher: String(item.publisher ?? 'Unknown'),
    publishedAt: item.publishedAt ? String(item.publishedAt) : null,
    snippet: item.summary ? String(item.summary).slice(0, 200) : null,
    link: String(item.link ?? ''),
    tickers: Array.isArray(item.relatedTickers) ? (item.relatedTickers as string[]).slice(0, 5) : [],
  }))

  // ── Derived signals ───────────────────────────────────────────────────────
  const signals: BriefSignal[] = []

  if (priceVsHighPct !== null) {
    signals.push({
      key: '52W Range Position',
      value: priceVsHighPct >= -5
        ? `${priceVsHighPct.toFixed(1)}% from high — near overbought zone`
        : `${priceVsHighPct.toFixed(1)}% below 52W high`,
      impact: priceVsHighPct >= -10 ? 'positive' : 'neutral',
    })
  }

  if (analystRating) {
    signals.push({
      key: 'Analyst Consensus',
      value: `${analystRating}${analystCount ? ` (${analystCount} analysts)` : ''}`,
      impact: analystRating === 'BUY' ? 'positive' : analystRating === 'SELL' ? 'negative' : 'neutral',
    })
  }

  if (targetPrice && currentVsTargetPct !== null) {
    signals.push({
      key: 'Price vs Target',
      value: `${currentVsTargetPct >= 0 ? '+' : ''}${currentVsTargetPct.toFixed(1)}% vs $${targetPrice.toFixed(0)} target`,
      impact: currentVsTargetPct < -10 ? 'positive' : currentVsTargetPct > 10 ? 'negative' : 'neutral',
    })
  }

  if (peRatio !== null) {
    signals.push({
      key: 'Trailing P/E',
      value: peRatio > 0 ? `$${peRatio.toFixed(1)}` : '—',
      impact: peRatio > 40 ? 'negative' : peRatio < 15 ? 'positive' : 'neutral',
    })
  }

  if (dividendYield !== null) {
    signals.push({
      key: 'Dividend Yield',
      value: dividendYield > 0 ? `${(dividendYield * 100).toFixed(2)}%` : '—',
      impact: 'neutral',
    })
  }

  if (beta !== null) {
    signals.push({
      key: 'Beta (vs S&P 500)',
      value: beta.toFixed(2),
      impact: beta > 1.3 ? 'negative' : beta < 0.8 ? 'positive' : 'neutral',
    })
  }

  signals.push({
    key: 'Sector ETF',
    value: `${etf} · $${price.toFixed(2)}`,
    impact: 'neutral',
  })

  // ── Summary text ──────────────────────────────────────────────────────────
  let dataQuality: 'live' | 'partial' | 'unavailable' = 'live'
  let dataQualityNote: string | null = null
  const missingCount = [price === 0, !high52w, !peRatio, news.length === 0].filter(Boolean).length

  if (missingCount >= 3) {
    dataQuality = 'unavailable'
    dataQualityNote = 'Insufficient data from Yahoo Finance for this sector ETF. Market may be closed or ticker not supported.'
  } else if (missingCount >= 1) {
    dataQuality = 'partial'
    dataQualityNote = `Some data points unavailable (${missingCount} field(s) missing). Market may be in pre/post-market phase.`
  }

  const sessionDir = changePct > 0.1 ? 'up' : changePct < -0.1 ? 'down' : 'flat'
  const briefSummaryText = `${sectorMeta.name} sector (${etf}) is ${sessionDir} ${Math.abs(changePct).toFixed(2)}% today at $${price.toFixed(2)}. ` +
    (analystRating
      ? `Analyst consensus is ${analystRating}${targetPrice ? ` with $${targetPrice.toFixed(0)} target` : ''}. `
      : '') +
    (priceVsHighPct !== null
      ? `Trading ${Math.abs(priceVsHighPct).toFixed(1)}% ${priceVsHighPct < 0 ? 'below' : 'above'} 52-week high. `
      : '') +
    `${holdings.length} of ${holdingsData.length} top holdings loaded. ` +
    `${news.length} live headlines sourced from Yahoo Finance.`

  const brief: SectorBrief = {
    id: `${slug}-${now.toISOString().slice(0, 10)}`,
    sector: slug,
    sectorName: sectorMeta.name,
    fetchedAt: now.toISOString(),
    lastUpdated: quoteTime,
    price,
    change,
    changePct,
    quoteTime,
    high52w,
    low52w,
    priceVsHighPct,
    priceVsLowPct,
    analystRating,
    analystCount,
    targetPrice,
    currentVsTargetPct,
    volume,
    avgVolume: avgVolume ?? avgVolume10d,
    avgVolume10d,
    marketCap,
    peRatio,
    forwardPe,
    pegRatio,
    priceToBook,
    dividendYield,
    beta,
    holdings,
    holdingsAvgChange,
    news,
    signals,
    summary: briefSummaryText,
    source: 'Yahoo Finance',
    dataQuality,
    dataQualityNote,
  }

  return NextResponse.json(brief, {
    headers: {
      'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
    },
  })
}
