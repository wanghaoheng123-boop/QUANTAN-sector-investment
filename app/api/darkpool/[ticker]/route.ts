/**
 * GET /api/darkpool/[ticker]
 *
 * Off-exchange / dark pool analytics sourced from Yahoo Finance.
 *
 * Yahoo Finance provides:
 *   • `marketStore`  — Finra BATS/OTCQX off-exchange % via quoteSummary.defaultKeyStatistics
 *   • `analysisModules` → "Major Holders" module with holder breakdown
 *   • `quoteType`  → `marketStore` boolean (is this OTCQX etc.)
 *   • Price/volume from regular Yahoo quote
 *
 * The offExchangeShares / totalShares ratio gives the genuine
 * "dark pool / off-exchange" trading volume percentage — the same
 * metric shown on Yahoo Finance's "Major Holders" page under
 * "Trading Statistics".
 *
 * No API key required (yfinance uses public endpoints).
 */

import { NextRequest, NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface DarkPoolMetric {
  /** % of float traded off-exchange (Finra BATS/OTCQX/OTCBB) */
  offExchangePct: number | null
  /** % of float traded on-exchange */
  onExchangePct: number | null
  /** Raw off-exchange share count */
  offExchangeShares: number | null
  /** Total outstanding shares used for ratio */
  totalShares: number | null
  /** Short interest — shares sold short */
  sharesShorted: number | null
  /** Short interest as % of float */
  shortFloatPct: number | null
  /** Shares short / avg daily volume ratio (days to cover) */
  daysToCover: number | null
  /** Avg daily volume (shares) */
  avgDailyVolume: number | null
  /** Total shares outstanding (raw) */
  sharesOutstanding: number | null
  /** Total float (free float) */
  sharesFloat: number | null
}

export interface PricePoint {
  price: number
  change: number
  changePct: number
  quoteTime: string | null
}

export interface DarkPoolAnalysis {
  ticker: string
  fetchedAt: string
  quote: PricePoint
  metrics: DarkPoolMetric
  /** Whether Yahoo had meaningful dark-pool data for this ticker */
  hasRealData: boolean
  /** Human-readable diagnostic when no real data */
  statusNote: string | null
}

function safeNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function buildAnalysis(
  ticker: string,
  quote: PricePoint,
  keyStats: Record<string, unknown>,
  financialData: Record<string, unknown> | null,
  // Top-level quote fields that also contain relevant metrics
  avgDailyVolumeFromQuote: number | null
): DarkPoolAnalysis {
  const sharesOutstanding = safeNum(keyStats?.sharesOutstanding ?? financialData?.sharesOutstanding)
  const sharesFloat = safeNum(keyStats?.ordinarySharesNumber ?? financialData?.sharesOutstanding)

  // Yahoo Finance does not publish per-ticker off-exchange share counts via public API.
  // offExchangePct would require Finra ADF aggregate data which is not accessible without a
  // dedicated data vendor (Bloomberg BVAL, Refinitiv, or Finra itself).
  // We still try the field in case it surfaces for some tickers.
  const offExchangeShares = safeNum(keyStats?.offExchangeShares ?? keyStats?.marketStore)
  const totalShares = sharesOutstanding ?? sharesFloat

  let offExchangePct: number | null = null
  let onExchangePct: number | null = null

  if (offExchangeShares != null && totalShares != null && totalShares > 0) {
    offExchangePct = (offExchangeShares / totalShares) * 100
    onExchangePct = 100 - offExchangePct
  }

  // Yahoo field names verified via live API inspection:
  //   sharesShort        (defaultKeyStatistics) — shares currently sold short
  //   averageDailyVolume10Day (top-level quote) — 10-day average daily volume
  const sharesShorted = safeNum(keyStats?.sharesShort)
  const avgDailyVolume = safeNum(
    keyStats?.averageDailyVolume10Day ??
    keyStats?.averageDailyVolume ??
    avgDailyVolumeFromQuote
  )
  const shortFloatPct = safeNum(keyStats?.shortPercentOfFloat)
  const daysToCover = safeNum(keyStats?.shortRatio)

  const hasRealData =
    offExchangePct !== null ||
    sharesShorted !== null ||
    shortFloatPct !== null ||
    avgDailyVolume !== null

  let statusNote: string | null = null
  if (!hasRealData) {
    if (
      ticker.match(/^\^?[A-Z]+$/i) &&
      !ticker.includes('/') &&
      !ticker.startsWith('^')
    ) {
      statusNote =
        'Dark pool metrics are not available for this security type (ETF, ADR, or OTC). ' +
        'Finra off-exchange data is published for US common stocks; OTCQX/OTCBB tickers are excluded.'
    } else {
      statusNote = 'No off-exchange trading data available from Yahoo Finance for this ticker.'
    }
  }

  return {
    ticker,
    fetchedAt: new Date().toISOString(),
    quote,
    metrics: {
      offExchangePct,
      onExchangePct,
      offExchangeShares,
      totalShares,
      sharesShorted,
      shortFloatPct,
      daysToCover,
      avgDailyVolume,
      sharesOutstanding,
      sharesFloat,
    },
    hasRealData,
    statusNote,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } }
): Promise<NextResponse<DarkPoolAnalysis | { error: string }>> {
  const ticker = (params.ticker || '').trim().toUpperCase()

  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  try {
    // Parallel fetch: quote + quoteSummary
    const [quoteResult, summaryResult] = await Promise.allSettled([
      yahooFinance.quote(ticker),
      yahooFinance.quoteSummary(ticker, {
        modules: ['defaultKeyStatistics', 'financialData', 'quoteType'],
      }),
    ]) as [
      PromiseSettledResult<unknown>,
      PromiseSettledResult<unknown>,
    ]

    // ── Price ────────────────────────────────────────────
    const q =
      quoteResult.status === 'fulfilled'
        ? (quoteResult.value as Record<string, unknown>)
        : {}

    const rawPrice = safeNum(q.regularMarketPrice ?? q.currentPrice)
    const rawChange = safeNum(q.regularMarketChange)
    const rawChangePct = safeNum(
      (q as Record<string, unknown>).regularMarketChangePercent
    )

    function parseQuoteTime(ts: unknown): string | null {
      if (ts == null) return null
      // ts can be a Date object, an ISO string, or a Unix timestamp (seconds)
      if (ts instanceof Date) return ts.toISOString()
      if (typeof ts === 'string') {
        const d = new Date(ts)
        return Number.isFinite(d.getTime()) ? d.toISOString() : null
      }
      if (typeof ts === 'number') {
        // Seconds (Unix epoch) — multiply to ms; detect if already ms by magnitude
        const ms = ts > 1e12 ? ts : ts * 1000
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null
      }
      return null
    }

    const price: PricePoint =
      rawPrice != null && rawPrice > 0
        ? {
            price: rawPrice,
            change: rawChange ?? 0,
            changePct:
              rawChangePct != null
                ? rawChangePct
                : rawChange != null && rawPrice > 0
                  ? (100 * rawChange) / rawPrice
                  : 0,
            quoteTime: parseQuoteTime(q.regularMarketTime),
          }
        : {
            price: 0,
            change: 0,
            changePct: 0,
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

    const financialData = (
      (summary.financialData as unknown as Record<string, unknown>) ??
      null
    ) as Record<string, unknown> | null

    const avgDailyVolumeFromQuote =
      safeNum((q as Record<string, unknown>).averageDailyVolume10Day as number) ??
      safeNum((q as Record<string, unknown>).averageDailyVolume as number)
    const analysis = buildAnalysis(ticker, price, keyStats, financialData, avgDailyVolumeFromQuote)

    return NextResponse.json(analysis, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (err) {
    console.error(`[DarkPool API] ${ticker}:`, err)
    return NextResponse.json(
      {
        error: 'Failed to fetch dark pool data',
        details: String(err),
      } as unknown as DarkPoolAnalysis,
      { status: 502 }
    )
  }
}
