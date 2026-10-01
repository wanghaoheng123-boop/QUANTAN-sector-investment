/**
 * Sector Intelligence Brief builder — SSOT for /api/briefs/[sector] AND for the
 * two server components that render briefs.
 *
 * WHY THIS MODULE EXISTS (UX-26, Platform Excellence 2026-08-15).
 *
 * Both `app/briefs/page.tsx` and `app/briefs/sector/[sector]/page.tsx` used to
 * be server components that fetched THEIR OWN site over HTTP —
 * `fetch(`${appBaseUrl()}/api/briefs/${slug}`)` — to reach the builder that
 * lived inside the route handler. That SSR self-fetch is the outage:
 *
 *   • The list page fanned out 11 network round-trips per page view, each one
 *     leaving the serverless function, crossing the public edge, and re-entering
 *     the same deployment. Anything sitting on that hop — deployment protection,
 *     an auth redirect, a wrong origin from `VERCEL_URL` (the deployment host,
 *     not the production alias) — fails the internal request while the very same
 *     route answers 200 to an external client. That is exactly what production
 *     showed on 2026-08-15.
 *   • The detail page compounded it (see `getSectorBriefSafe` below).
 *
 * A server component has no reason to speak HTTP to itself. It runs in the same
 * process as the route handler; it can call the builder. So the builder moved
 * here, the route handler became a thin HTTP wrapper over it, and both pages
 * import it directly. There is no internal hop left to fail.
 *
 * The data itself is sourced entirely from Yahoo Finance:
 *   • Live price, session change, 52-week range position
 *   • Live analyst consensus (buy/hold/sell ratings)
 *   • Top holdings performance
 *   • Sector ETF key statistics
 *   • Live news headlines
 *   • Embedded signals (derived from real price/metric data)
 *
 * No mock data, no hardcoded values.
 */

import YahooFinance from 'yahoo-finance2'
import { SECTORS } from '@/lib/sectors'
import { parseQuoteTime } from '@/lib/format'
import { isSafeHttpUrl } from '@/lib/security/urlValidation'

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

  // Live price data. Q-140: null when the quote is unavailable — never 0.
  price: number | null
  change: number | null
  changePct: number | null
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
  holdings: { ticker: string; weight: string; price: number; change: number | null; changePct: number | null }[]
  /** Mean daily change of the holdings that reported one; null when none did. */
  holdingsAvgChange: number | null

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

// ─── Upstream seam ─────────────────────────────────────────────────────────────

/**
 * The three Yahoo calls a brief needs, as an injectable seam.
 *
 * Tests pass fakes so the builder is exercised without a network (Yahoo 403s
 * from CI and from most local machines). Production passes
 * `defaultBriefFetchers()`. Keeping the seam explicit — rather than
 * `vi.mock('yahoo-finance2')` — also means the assertions survive mutation
 * testing, since the fakes are ordinary values rather than module-graph magic.
 */
export interface BriefFetchers {
  quote(symbol: string): Promise<unknown>
  quoteSummary(symbol: string, options: { modules: string[] }): Promise<unknown>
  search(symbol: string, options: { newsCount: number }): Promise<unknown>
}

let _yf: InstanceType<typeof YahooFinance> | null = null

/** Lazily constructed so importing this module (e.g. from a test) costs nothing. */
function yahoo(): InstanceType<typeof YahooFinance> {
  if (!_yf) _yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  return _yf
}

function defaultBriefFetchers(): BriefFetchers {
  // Bound to a local named `yf` on purpose: the repo's schema-drift class guard
  // scans for `yf.search(` / `yahooFinance.search(` call sites, and a call
  // spelled `yahoo().search(` would be invisible to it.
  const yf = yahoo()
  return {
    quote: (symbol) => yf.quote(symbol) as Promise<unknown>,
    quoteSummary: (symbol, options) =>
      yf.quoteSummary(symbol, options as never) as Promise<unknown>,
    // validateResult:false — Yahoo's SearchResult response has drifted from
    // yahoo-finance2 v3's schema, so validation throws (news silently dropped +
    // log spam). News is display-only and each field is null-guarded downstream,
    // so accept Yahoo's raw result instead of failing the whole news fetch.
    search: (symbol, options) =>
      yf.search(symbol, options, { validateResult: false }) as Promise<unknown>,
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function formatLargeNum(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toFixed(0)}`
}

/**
 * Phase 14 wave 8: log fallback usage so operators can detect when Yahoo
 * is returning errors for a brief's component fetches. Prior version
 * silently swallowed everything — a chronically failing fetch looked
 * indistinguishable from a healthy "no data on this ticker" response.
 */
function fetchWithFallback<T>(p: Promise<T>, fallback: T, label?: string, failures?: string[]): Promise<T> {
  return p.catch((err: unknown) => {
    if (label) {
      console.warn(JSON.stringify({
        event: 'briefs.fetch_fallback',
        label,
        message: (err as Error)?.message,
      }))
    }
    // Q-140: record that this component FAILED, so the brief can say "the
    // feed failed" rather than guess at why a field is empty.
    if (failures && label) failures.push(label)
    return fallback
  })
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build one sector's brief straight from Yahoo.
 *
 * Returns `null` for an unknown slug — the HTTP wrapper turns that into a 404,
 * the pages turn it into a "Sector not found" panel. Yahoo failures do NOT
 * produce null: they produce a brief whose `dataQuality` is `partial` or
 * `unavailable`, so callers can distinguish "no such sector" from "provider is
 * degraded" without inspecting an error string.
 */
export async function buildSectorBrief(
  slug: string,
  fetchers: BriefFetchers = defaultBriefFetchers(),
): Promise<SectorBrief | null> {
  const normalized = (slug || '').trim()
  const sectorMeta = SECTORS.find(s => s.slug === normalized)
  if (!sectorMeta) return null

  const etf = sectorMeta.etf
  const now = new Date()

  // Parallel fetch: ETF quote, ETF summary stats, holdings quotes, news.
  // Phase 14 wave 8: labels added so any fallback usage is observable.
  const failures: string[] = []
  const [etfQuote, etfSummary, newsResult] = await Promise.allSettled([
    fetchWithFallback(fetchers.quote(etf), null, 'quote', failures),
    fetchWithFallback(
      fetchers.quoteSummary(etf, {
        modules: ['defaultKeyStatistics', 'financialData', 'recommendationTrend', 'earningsTrend'],
      }),
      null,
      'summary',
      failures,
    ),
    fetchWithFallback(
      fetchers.search(etf, { newsCount: 8 }),
      null,
      'news',
      failures,
    ),
  ])

  // ── ETF Quote ──────────────────────────────────────────────────────────────
  const q = (etfQuote.status === 'fulfilled' ? etfQuote.value : null) as Record<string, unknown> | null

  // Q-140 (I2): these defaulted to 0, so a failed quote rendered "$0.00" and
  // "flat 0.00% today" as if measured. Unknown is null.
  const rawPrice = safeNum(q?.regularMarketPrice ?? q?.currentPrice)
  const price = rawPrice != null && rawPrice > 0 ? rawPrice : null
  const change = price != null ? safeNum(q?.regularMarketChange) : null
  const rawChangePct = safeNum((q as Record<string, unknown>)?.regularMarketChangePercent as number)
  const changePct = rawChangePct ?? (price != null && change != null ? (100 * change) / price : null)
  const quoteTime = parseQuoteTime(q?.regularMarketTime)
  // A4-1: yahoo-finance2 Quote exposes regularMarketVolume (quote.d.ts:234) and
  // averageDailyVolume3Month (:275) — the prior `regularVolume`/`averageDailyVolume`
  // keys don't exist on the type, so both were always null.
  const volume = safeNum(q?.regularMarketVolume)
  const avgVolume = safeNum((q as Record<string, unknown>)?.averageDailyVolume3Month as number)
  const marketCapRaw = safeNum(q?.marketCap)
  const marketCap = marketCapRaw ? formatLargeNum(marketCapRaw) : null
  const high52w = safeNum(q?.fiftyTwoWeekHigh)
  const low52w = safeNum(q?.fiftyTwoWeekLow)
  const priceVsHighPct = price != null && high52w && high52w > 0 ? -((high52w - price) / high52w) * 100 : null
  const priceVsLowPct = price != null && low52w && low52w > 0 ? ((price - low52w) / low52w) * 100 : null

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
      analystCount = (safeNum(current.strongBuy as number) ?? 0) + (safeNum(current.buy as number) ?? 0) + (safeNum(current.hold as number) ?? 0) + (safeNum(current.sell as number) ?? 0) + (safeNum(current.strongSell as number) ?? 0)
      const strongBuy = safeNum(current.strongBuy as number) ?? 0
      const buy = safeNum(current.buy as number) ?? 0
      const hold = safeNum(current.hold as number) ?? 0
      const sell = safeNum(current.sell as number) ?? 0
      const strongSell = safeNum(current.strongSell as number) ?? 0
      const total = strongBuy + buy + hold + sell + strongSell
      if (total > 0) {
        // R4-M-3 (Phase 14): use >= so exact-threshold ties (e.g. 60% bullish)
        // land on the "stronger consensus" side. Strict-greater would silently
        // demote a 60/40 buy-vs-rest split to HOLD, which contradicts the
        // semantics of the threshold ("strong consensus AT 60%+").
        if ((strongBuy + buy) / total >= 0.6) analystRating = 'BUY'
        else if ((sell + strongSell) / total >= 0.4) analystRating = 'SELL'
        else analystRating = 'HOLD'
      }
    }
  }

  const targetRaw = safeNum(finData?.targetPrice as number)
  if (targetRaw && price != null) {
    targetPrice = targetRaw
    currentVsTargetPct = ((price - targetRaw) / targetRaw) * 100
  }

  // ── Holdings ───────────────────────────────────────────────────────────────
  const holdingsData = sectorMeta.topHoldings.slice(0, 5)
  const holdingsQuotes = await Promise.allSettled(
    holdingsData.map(t => fetchers.quote(t))
  )

  const holdings = holdingsData.map((ticker, i) => {
    const r = holdingsQuotes[i]
    const qh = (r.status === 'fulfilled' ? r.value : null) as Record<string, unknown> | null
    return {
      ticker,
      weight: '—',
      price: safeNum(qh?.regularMarketPrice ?? qh?.currentPrice) ?? 0,
      // Q-140: a missing change is unknown, not "unchanged".
      change: safeNum(qh?.regularMarketChange),
      changePct: safeNum((qh as Record<string, unknown>)?.regularMarketChangePercent as number),
    }
  }).filter(h => h.price > 0) // a holding with no price is dropped, not shown at $0

  const reportedChanges = holdings.map(h => h.changePct).filter((v): v is number => v != null)
  const holdingsAvgChange = reportedChanges.length > 0
    ? reportedChanges.reduce((s, v) => s + v, 0) / reportedChanges.length
    : null

  // ── News ──────────────────────────────────────────────────────────────────
  // Phase 13 S2 — XSS supply-chain defense via @/lib/security/urlValidation
  // (SSOT). The client renders the link in <a href={item.link}>, which would
  // execute `javascript:` or `data:` URIs from a hostile upstream. Drop
  // items with unsafe schemes entirely.
  const n = (newsResult.status === 'fulfilled' ? newsResult.value : null) as Record<string, unknown> | null
  const rawNews = (n?.news as Array<Record<string, unknown>> | undefined) ?? []
  const news = rawNews
    .slice(0, 6)
    .map((item: Record<string, unknown>) => ({
      title: String(item.title ?? ''),
      publisher: String(item.publisher ?? 'Unknown'),
      publishedAt: item.publishedAt ? String(item.publishedAt) : null,
      snippet: item.summary ? String(item.summary).slice(0, 200) : null,
      link: String(item.link ?? ''),
      tickers: Array.isArray(item.relatedTickers) ? (item.relatedTickers as string[]).slice(0, 5) : [],
    }))
    .filter((item) => isSafeHttpUrl(item.link))

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
      // A ratio, not a price: this rendered "$31.2".
      value: peRatio > 0 ? `${peRatio.toFixed(1)}×` : '—',
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
    value: price != null ? `${etf} · $${price.toFixed(2)}` : `${etf} · —`,
    impact: 'neutral',
  })

  // ── Data quality ──────────────────────────────────────────────────────────
  // Q-091 / Q-140: the note used to GUESS at a cause ("Market may be closed or
  // ticker not supported", "Market may be in pre/post-market phase") — wrong
  // for an outage, and Yahoo returns quotes when the market is closed anyway.
  // And an empty news list counted as a missing data point, so a quiet news
  // day downgraded the brief. Now: a FAILED fetch is said to have failed; a
  // missing field is named; no news is not a fault.
  let dataQuality: 'live' | 'partial' | 'unavailable' = 'live'
  let dataQualityNote: string | null = null
  const missing = [
    price == null ? 'price' : null,
    high52w == null ? '52-week range' : null,
    peRatio == null ? 'P/E' : null,
  ].filter((x): x is string => x != null)

  if (failures.includes('quote')) {
    dataQuality = 'unavailable'
    dataQualityNote = `The price feed failed for ${etf}; try again shortly.`
  } else if (price == null) {
    dataQuality = 'unavailable'
    dataQualityNote = `Yahoo Finance returned no price for ${etf}.`
  } else if (failures.length > 0 || missing.length > 0) {
    dataQuality = 'partial'
    const failed = failures.map((f) => (f === 'summary' ? 'valuation statistics' : f === 'news' ? 'headlines' : f))
    dataQualityNote = [
      failed.length ? `Failed to load: ${failed.join(', ')}.` : null,
      missing.length ? `Not reported by Yahoo Finance: ${missing.join(', ')}.` : null,
    ].filter(Boolean).join(' ')
  }

  // ── Summary text ──────────────────────────────────────────────────────────
  const sessionDir = changePct == null ? null : changePct > 0.1 ? 'up' : changePct < -0.1 ? 'down' : 'flat'
  const briefSummaryText = (price != null && changePct != null && sessionDir
    ? `${sectorMeta.name} sector (${etf}) is ${sessionDir} ${Math.abs(changePct).toFixed(2)}% today at $${price.toFixed(2)}. `
    : `${sectorMeta.name} sector (${etf}): price unavailable. `) +
    (analystRating
      ? `Analyst consensus is ${analystRating}${targetPrice ? ` with $${targetPrice.toFixed(0)} target` : ''}. `
      : '') +
    (priceVsHighPct !== null
      ? `Trading ${Math.abs(priceVsHighPct).toFixed(1)}% ${priceVsHighPct < 0 ? 'below' : 'above'} 52-week high. `
      : '') +
    `${holdings.length} of ${holdingsData.length} top holdings loaded. ` +
    `${news.length} live headlines sourced from Yahoo Finance.`

  return {
    id: `${normalized}-${now.toISOString().slice(0, 10)}`,
    sector: normalized,
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
}

// ─── Render-safe wrappers (used by the server components) ─────────────────────

/**
 * `buildSectorBrief` with every rejection flattened to `null`.
 *
 * UX-26b — THE BUG THIS REPLACES. The old detail page had:
 *
 *   ```ts
 *   try {
 *     const res = await fetch(...)
 *     if (!res.ok) return null
 *     return res.json()          // ← no await
 *   } catch { return null }
 *   ```
 *
 * `return promise` inside `try` does NOT route the promise's rejection to the
 * `catch`: the async function returns and adopts the promise only after the try
 * block has been left. So every FETCH-layer failure was handled (the `fetch` is
 * awaited) and every non-2xx was handled (`!res.ok`) — but a 2xx response with a
 * non-JSON body, which is precisely what an SSO/challenge page or a followed
 * redirect to the HTML app shell returns, made `res.json()` reject OUTSIDE the
 * catch and crashed the server render. That asymmetry is the whole reason the
 * list page merely went empty (its `Promise.allSettled` absorbed the same
 * rejection) while the detail page hard-errored with a digest.
 *
 * `return await` is the fix for that shape. The self-fetch is gone entirely, so
 * the JSON-parse class cannot recur — but the builder still talks to Yahoo, so
 * the wrapper keeps a real `await` inside the `try` and is unit-tested against a
 * rejecting fetcher to pin the semantics.
 */
export async function getSectorBriefSafe(
  slug: string,
  fetchers: BriefFetchers = defaultBriefFetchers(),
): Promise<SectorBrief | null> {
  try {
    return await buildSectorBrief(slug, fetchers)
  } catch (err) {
    console.warn(JSON.stringify({
      event: 'briefs.build_failed',
      slug,
      message: (err as Error)?.message,
    }))
    return null
  }
}

export interface AllBriefsResult {
  /** Briefs that built, sorted by top-holdings average change (best first). */
  briefs: SectorBrief[]
  /** Slugs whose builder threw outright — a QUANTAN-side failure, not a Yahoo one. */
  failedSlugs: string[]
}

/** Build every sector's brief. Never rejects; failures surface in `failedSlugs`. */
export async function getAllSectorBriefs(
  fetchers: BriefFetchers = defaultBriefFetchers(),
): Promise<AllBriefsResult> {
  const results = await Promise.allSettled(
    SECTORS.map(s => buildSectorBrief(s.slug, fetchers))
  )

  const briefs: SectorBrief[] = []
  const failedSlugs: string[] = []
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) briefs.push(r.value)
    else failedSlugs.push(SECTORS[i].slug)
  })

  // Unknown averages sort last rather than as if flat.
  briefs.sort((a, b) => (b.holdingsAvgChange ?? -Infinity) - (a.holdingsAvgChange ?? -Infinity))
  return { briefs, failedSlugs }
}

/**
 * Worst data quality across a set of briefs — what the "Live data" pill must
 * render (UX-26: the pill was a hardcoded green literal, so the page asserted
 * it was live in the same viewport where it said everything had failed).
 *
 * Worst-case rather than majority: one degraded sector in a list of eleven is
 * still a page the reader should not treat as fully live.
 */
export function aggregateDataQuality(
  briefs: SectorBrief[],
): 'live' | 'partial' | 'unavailable' {
  if (briefs.length === 0) return 'unavailable'
  if (briefs.some(b => b.dataQuality === 'unavailable')) return 'unavailable'
  if (briefs.some(b => b.dataQuality === 'partial')) return 'partial'
  return 'live'
}

/** The four states the /briefs header pill can be in. */
export type BriefsHealth = 'live' | 'partial' | 'unavailable' | 'internal'

/**
 * What the /briefs header pill must say, across BOTH failure axes.
 *
 * `aggregateDataQuality` only sees briefs that built, so on its own it would
 * report `live` while a sibling banner said six sectors failed to build — the
 * original UX-26 defect (a green "Live data from Yahoo Finance" pill in the
 * same viewport as the failure text) reintroduced through a data-driven route.
 *
 * A builder throw is OURS, and it outranks provider quality: `internal` is
 * checked first and its copy must not name Yahoo, because the page would
 * otherwise blame the provider for an application error — exactly what the
 * "All Yahoo Finance requests failed" copy did.
 */
export function briefsHealth(
  briefs: SectorBrief[],
  failedSlugs: string[],
): BriefsHealth {
  if (failedSlugs.length > 0) return 'internal'
  return aggregateDataQuality(briefs)
}
