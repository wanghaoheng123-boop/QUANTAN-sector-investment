/**
 * GET /api/darkpool/[ticker]
 *
 * Short interest and share counts for a ticker, from Yahoo Finance
 * (`quoteSummary.defaultKeyStatistics`), plus the quote.
 *
 * Q-149: this header used to say Yahoo provides "`marketStore` — Finra
 * BATS/OTCQX off-exchange %". It does not: no yahoo-finance2 module carries
 * off-exchange volume, and the fields this route read for it did not exist, so
 * the figure was null on every request. The route now reads only fields the
 * vendor interfaces declare (lib/darkpool.ts) and says off-exchange volume is
 * not published by this source.
 */

import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { parseQuoteTime } from '@/lib/format'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { DEGRADED_CACHE_CONTROL } from '@/lib/api/reliability'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { normalizedChangePercent } from '@/lib/yahooQuoteFields'
import {
  NO_QUOTE_NOTE,
  NO_SHORT_INTEREST_NOTE,
  NO_SHORT_INTEREST_TYPES,
  buildDarkPoolMetrics,
  hasShortInterestData,
  type DarkPoolAnalysis,
  type PricePoint,
} from '@/lib/darkpool'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'




function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function buildAnalysis(
  ticker: string,
  quote: PricePoint,
  keyStats: Record<string, unknown>,
  rawQuote: Record<string, unknown>,
): DarkPoolAnalysis {
  const now = Date.now()
  const metrics = buildDarkPoolMetrics(keyStats, rawQuote, now)

  // Phase 14 (R4-H-4): a populated EQUITY quote with NO float field is schema
  // drift, so it is logged for alerting. Q-149: this fired on every request (the
  // field it read did not exist), and then on every float the builder WITHHELD
  // (Q149-D3) — an alert that is always on hides the drift it is for. A withheld
  // float is visible in the response as `floatWithheld`; it is not drift.
  if (rawQuote.quoteType === 'EQUITY' && quote.price != null && keyStats.floatShares === undefined) {
    console.warn(JSON.stringify({
      event: 'darkpool.shares_float_missing',
      ticker,
      keyStatsHasSharesOutstanding: keyStats.sharesOutstanding !== undefined,
      fetchedAt: new Date(now).toISOString(),
    }))
  }

  // Red-team L9: say only what was observed — the route does not know the
  // security type.
  return {
    ticker,
    fetchedAt: new Date(now).toISOString(),
    quote,
    metrics,
    statusNote: hasShortInterestData(metrics) ? null : NO_SHORT_INTEREST_NOTE,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse<DarkPoolAnalysis | { error: string }>> {
  // Phase 13 S2: rate-limit + canonical ticker validation.
  const rateLimitResponse = await applyRateLimit(req, 'darkpool', {
    maxRequests: 30,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse as unknown as NextResponse<{ error: string }>

  const { ticker: tickerParam } = await params
  const ticker = normalizeTicker(tickerParam || '')
  if (!ticker) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
  }

  try {
    // Parallel fetch: quote + quoteSummary
    const [quoteResult, summaryResult] = await Promise.allSettled([
      yahooFinance.quote(ticker),
      yahooFinance.quoteSummary(ticker, {
        modules: ['defaultKeyStatistics'],
      }),
    ]) as [
      PromiseSettledResult<unknown>,
      PromiseSettledResult<unknown>,
    ]

    // ── Price ────────────────────────────────────────────
    // Q149-D4: for a symbol Yahoo does not know, quote() RESOLVES to undefined.
    // Dereferencing it threw, and the catch answered 502 "failed" for a ticker
    // that simply has no quote.
    const quoteValue = quoteResult.status === 'fulfilled' ? quoteResult.value : null
    const q = (quoteValue && typeof quoteValue === 'object' ? quoteValue : {}) as Record<string, unknown>
    const noQuote = quoteResult.status === 'fulfilled' && Object.keys(q).length === 0

    const rawPrice = safeNum(q.regularMarketPrice ?? q.currentPrice)
    const rawChange = safeNum(q.regularMarketChange)
    const rawChangePct = safeNum(
      (q as Record<string, unknown>).regularMarketChangePercent
    )

    // Phase 14 wave 24 (Pattern C): every numeric field emitted to the UI must
    // be finite. Q-140: a missing value is null, not 0 — the old "explicit 0"
    // fallback put a measured-looking zero on the wire. Consumers guard with
    // Number.isFinite / != null.
    const finiteOrNull = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null

    const price: PricePoint =
      rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0
        ? {
            price: rawPrice,
            change: finiteOrNull(rawChange),
            // Red-team Q145-R5: the percent was taken raw, so a decimal-form
            // row (0.016 meaning 1.6%) rendered +0.02%. It goes through the
            // same normaliser as /api/prices and both streams.
            changePct: rawChangePct != null || rawChange != null
              ? normalizedChangePercent(rawChangePct, rawChange, rawPrice)
              : null,
            quoteTime: parseQuoteTime(q.regularMarketTime),
          }
        : {
            price: null,
            change: null,
            changePct: null,
            quoteTime: null,
          }

    // ── Summary modules ───────────────────────────────────
    const summary =
      summaryResult.status === 'fulfilled'
        ? (summaryResult.value as Record<string, unknown>)
        : {}

    const keyStats = (
      (summary.defaultKeyStatistics as Record<string, unknown>) ??
      {}
    ) as Record<string, unknown>

    const analysis = buildAnalysis(ticker, price, keyStats, q)

    // Q-140 (I2): a FAILED fetch is not "no data for this security type". With
    // Yahoo down this used to say "Dark pool metrics are not available for this
    // security type (ETF, ADR, or OTC)" — a wrong explanation for an outage.
    const quoteFailed = quoteResult.status === 'rejected'
    // Q149-D5: Yahoo has no key statistics for a crypto pair, a currency, an
    // index or a fund, and rejects the request. That is an absence, not an outage
    // to "try again shortly".
    const summaryFailed = summaryResult.status === 'rejected' && !NO_SHORT_INTEREST_TYPES.has(String(q.quoteType))
    if (noQuote) {
      analysis.statusNote = NO_QUOTE_NOTE
    } else if (quoteFailed || summaryFailed) {
      analysis.degraded = true
      analysis.statusNote = quoteFailed && summaryFailed
        ? 'The market-data feed failed for this ticker; try again shortly.'
        : quoteFailed
          ? 'The price quote failed to load; the short-interest figures below are shown without it.'
          : 'The short-interest figures failed to load; try again shortly.'
    }

    return NextResponse.json(analysis, {
      headers: {
        'Cache-Control': analysis.degraded ? DEGRADED_CACHE_CONTROL : 's-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error(`[DarkPool API] ${ticker}:`, err)
    // Phase 13 S2 fix (F4.8): never leak raw error in production response.
    const details = sanitizeError(err)
    return NextResponse.json(
      {
        error: 'Failed to fetch dark pool data',
        ...(details ? { details } : {}),
      } as unknown as DarkPoolAnalysis,
      { status: 502 }
    )
  }
}
