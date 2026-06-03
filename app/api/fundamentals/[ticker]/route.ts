import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { buildFundamentalsPayload, type FundamentalsQuery } from '@/lib/quant/buildFundamentalsPayload'
import { fetchBloombergQuotesViaBridge, isBloombergBridgeConfigured } from '@/lib/data/bloomberg/bridgeClient'
import { hasPositiveClose } from '@/lib/quant/chartQuoteFilter'
import { errorResponse, withRetry } from '@/lib/api/reliability'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { applyRateLimit } from '@/lib/api/rateLimit'

const yahooFinance = new YahooFinance()

// D4-3 (inspection 2026-05-30): fundamentals fans out many Yahoo modules + an
// optional Bloomberg bridge call per request with no in-process cache. Cap
// per-IP request rate. 30 req / 60s mirrors the other Yahoo routes.
const FUNDAMENTALS_RATE_LIMIT = { maxRequests: 30, windowSeconds: 60 }

const MODULES = [
  'summaryProfile',
  'assetProfile',
  'financialData',
  'defaultKeyStatistics',
  'balanceSheetHistory',
  'incomeStatementHistory',
  'cashflowStatementHistory',
  'recommendationTrend',
  'upgradeDowngradeHistory',
  'calendarEvents',
  'earningsHistory',
] as const

export async function GET(req: NextRequest, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerParam } = await params
  const rateLimited = await applyRateLimit(req, 'fundamentals', FUNDAMENTALS_RATE_LIMIT)
  if (rateLimited) return rateLimited

  // Phase 16 audit (2026-05-24): strict ticker validation via SSOT
  // normalizeTicker. The prior yahooSymbolFromParam was permissive and would
  // forward any uppercased path-encoded string to Yahoo (F7.3 risk).
  const symbol = normalizeTicker(tickerParam)
  if (!symbol) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
  }
  // Phase 13 S2 cleanup: explicit parentheses on the index-skip predicate.
  // Without them, JS evaluates `&&` before `||` — works correctly today but
  // brittle to refactor. The intent is: skip if it's ^VIX or any short index.
  if (symbol === '^VIX' || (symbol.startsWith('^') && symbol.length <= 5)) {
    return NextResponse.json(
      { error: 'Fundamentals module is for equities/ETFs with statements, not broad indices.' },
      { status: 422 }
    )
  }

  const url = new URL(req.url)
  const q: FundamentalsQuery = {
    wacc: clamp(parseFloat(url.searchParams.get('wacc') || '0.09'), 0.04, 0.2),
    terminalGrowth: clamp(parseFloat(url.searchParams.get('tg') || '0.025'), 0, 0.05),
    gBear: clamp(parseFloat(url.searchParams.get('gBear') || '0.02'), -0.1, 0.2),
    gBase: clamp(parseFloat(url.searchParams.get('gBase') || '0.05'), -0.1, 0.25),
    gBull: clamp(parseFloat(url.searchParams.get('gBull') || '0.09'), -0.05, 0.35),
  }

  const period1 = new Date()
  period1.setDate(period1.getDate() - 800)

  try {
    const [summary, chart, spyChart, quoteRow] = await Promise.all([
      withRetry(
        () => yahooFinance.quoteSummary(symbol, { modules: [...MODULES] }) as Promise<Record<string, unknown>>,
        { attempts: 2, timeoutMs: 10_000, retryLabel: 'fundamentals summary' }
      ),
      // Phase 14 wave 8: replace silent .catch(() => null) with diagnostic logging.
      // Previously, three of the four Yahoo calls swallowed errors without ANY signal,
      // so operators couldn't distinguish "Yahoo returned no chart for this ticker"
      // from "Yahoo's chart endpoint is down" or "auth/quota error from yahoo-finance2".
      // We still return null on failure (fail-open is the right call here — the route
      // can still respond with summary-only data), but the failure is now visible.
      withRetry(() => yahooFinance.chart(symbol, { period1, interval: '1d' }), { attempts: 2, timeoutMs: 9000, retryLabel: 'fundamentals chart' })
        .catch((err) => {
          console.warn(JSON.stringify({ event: 'fundamentals.chart_fetch_failed', ticker: symbol, message: (err as Error)?.message }))
          return null
        }),
      withRetry(() => yahooFinance.chart('SPY', { period1, interval: '1d' }), { attempts: 2, timeoutMs: 9000, retryLabel: 'fundamentals spy chart' })
        .catch((err) => {
          console.warn(JSON.stringify({ event: 'fundamentals.spy_chart_fetch_failed', message: (err as Error)?.message }))
          return null
        }),
      withRetry(() => yahooFinance.quote(symbol), { attempts: 2, timeoutMs: 6000, retryLabel: 'fundamentals quote' })
        .catch((err) => {
          console.warn(JSON.stringify({ event: 'fundamentals.quote_fetch_failed', ticker: symbol, message: (err as Error)?.message }))
          return null
        }),
    ])

    const quotes = chart?.quotes?.filter(hasPositiveClose) ?? []
    const closes = quotes.map((c) => c.close!)
    const dates = quotes.map((c) => {
      const d = c.date
      return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
    })
    const ohlc = quotes.map((c) => {
      const cl = c.close!
      return {
        open: c.open ?? cl,
        high: c.high ?? cl,
        low: c.low ?? cl,
        close: cl,
      }
    })

    const spyQ = spyChart?.quotes?.filter(hasPositiveClose) ?? []
    const spyCloses = spyQ.map((c) => c.close!)
    const spyDates = spyQ.map((c) => {
      const d = c.date
      return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
    })

    const qAny = quoteRow as { regularMarketPrice?: number } | null
    const livePrice =
      typeof qAny?.regularMarketPrice === 'number' && qAny.regularMarketPrice > 0
        ? qAny.regularMarketPrice
        : closes.length
          ? closes[closes.length - 1]
          : null

    let bloombergSpot: number | null = null
    if (isBloombergBridgeConfigured()) {
      const bb = await fetchBloombergQuotesViaBridge([symbol])
      const row = bb?.get(symbol)
      if (row && row.price > 0) bloombergSpot = row.price
    }
    const displayPrice =
      bloombergSpot != null && bloombergSpot > 0 ? bloombergSpot : livePrice

    const payload = buildFundamentalsPayload(
      symbol,
      summary,
      closes,
      dates,
      ohlc,
      spyCloses,
      spyDates,
      displayPrice,
      q
    )

    return NextResponse.json(
      {
        ...payload,
        priceSources: {
          display: displayPrice,
          yahoo: livePrice,
          bloomberg: bloombergSpot,
        },
      },
      {
        headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' },
      }
    )
  } catch (e) {
    console.error('[Fundamentals API]', symbol, e)
    // Phase 13 S2 fix (F4.8): sanitize error for client (no stack/paths in prod).
    return errorResponse(
      'fundamentals_failed',
      `Failed to load fundamentals for ${symbol}`,
      sanitizeError(e),
      502,
    )
  }
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo
  return Math.min(hi, Math.max(lo, x))
}
