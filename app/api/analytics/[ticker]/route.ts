import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { dailyReturns } from '@/lib/quant/technicals'
import { alignCloses, logReturns, correlation } from '@/lib/quant/relativeStrength'
import { hasPositiveClose } from '@/lib/quant/chartQuoteFilter'
import { errorResponse, withRetry } from '@/lib/api/reliability'
import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'

const yahooFinance = new YahooFinance()

// Phase 14 wave 24 (Pattern C): finite-or-null helper at the API boundary.
// typeof v === 'number' is true for NaN — without Number.isFinite the JSON
// emits NaN→null and the UI crashes on .toFixed; or emits Infinity which
// shows as a meaningless huge number.
const finiteOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Extra analytics (win rate, up/down days, beta proxy) — complements `/api/fundamentals`. */
export async function GET(_req: Request, { params }: { params: { ticker: string } }) {
  // Phase 16 audit (2026-05-24): strict ticker validation via SSOT
  // normalizeTicker (was permissive yahooSymbolFromParam — F7.3 risk).
  const symbol = normalizeTicker(params.ticker)
  if (!symbol) {
    return NextResponse.json({ error: 'Invalid ticker symbol' }, { status: 400 })
  }
  if (symbol.startsWith('^')) {
    return NextResponse.json({ error: 'Use a stock/ETF symbol for analytics.' }, { status: 422 })
  }

  const period1 = new Date()
  period1.setFullYear(period1.getFullYear() - 5)

  try {
    const [chart, spyChart, quote] = await Promise.all([
      withRetry(() => yahooFinance.chart(symbol, { period1, interval: '1d' }), { attempts: 2, timeoutMs: 9000, retryLabel: 'analytics chart' }),
      withRetry(() => yahooFinance.chart('SPY', { period1, interval: '1d' }), { attempts: 2, timeoutMs: 9000, retryLabel: 'spy chart' }),
      withRetry(() => yahooFinance.quote(symbol), { attempts: 2, timeoutMs: 6000, retryLabel: 'analytics quote' })
        .catch((err) => {
          // Phase 14 wave 24: log instead of silent null suppression so a
          // chronically failing quote endpoint is diagnosable.
          console.warn(JSON.stringify({ event: 'analytics.quote_fetch_failed', ticker: symbol, message: (err as Error)?.message }))
          return null
        }),
    ])

    const quotes = chart?.quotes?.filter(hasPositiveClose) ?? []
    const closes = quotes.map((c) => c.close!)
    const dates = quotes.map((c) =>
      c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10)
    )

    const spyQ = spyChart?.quotes?.filter(hasPositiveClose) ?? []
    const spyCloses = spyQ.map((c) => c.close!)
    const spyDates = spyQ.map((c) =>
      c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10)
    )

    const rets = dailyReturns(closes)
    const slice252 = rets.length >= 5 ? rets.slice(-Math.min(252, rets.length)) : []
    const winRate252 =
      slice252.length > 0 ? slice252.filter((x) => x > 0).length / slice252.length : null
    const avgDailyRet = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : null

    const aligned = alignCloses(dates, closes, spyDates, spyCloses)
    const lrA = logReturns(aligned.a)
    const lrB = logReturns(aligned.b)
    const n = Math.min(lrA.length, lrB.length)
    let betaProxy: number | null = null
    if (n >= 120) {
      const xa = lrA.slice(-252)
      const xb = lrB.slice(-252)
      const m = Math.min(xa.length, xb.length)
      const a = xa.slice(-m)
      const b = xb.slice(-m)
      const meanA = a.reduce((x, y) => x + y, 0) / m
      const meanB = b.reduce((x, y) => x + y, 0) / m
      let cov = 0
      let varB = 0
      for (let i = 0; i < m; i++) {
        const da = a[i] - meanA
        const db = b[i] - meanB
        cov += da * db
        varB += db * db
      }
      betaProxy = varB > 0 ? cov / varB : null
    }

    const corr1y = n >= 30 ? correlation(lrA.slice(-252), lrB.slice(-252)) : null

    const q = quote as { dividendYield?: number; averageDailyVolume3Month?: number } | null

    return NextResponse.json(
      {
        symbol,
        fetchedAt: new Date().toISOString(),
        historyDays: closes.length,
        // Phase 14 wave 24: all numeric outputs gated by finiteOrNull. The
        // computed values (winRate, beta, correlation) can produce NaN under
        // degenerate inputs (zero-variance series); typeof guards alone
        // accept NaN.
        winRate252d: finiteOrNull(winRate252),
        avgDailyReturn: finiteOrNull(avgDailyRet),
        betaVsSpyLogReturns: finiteOrNull(betaProxy),
        correlationVsSpy1y: finiteOrNull(corr1y),
        dividendYield: finiteOrNull(q?.dividendYield),
        avgVolume3m: finiteOrNull(q?.averageDailyVolume3Month),
        note:
          'Beta is a quick OLS slope on overlapping log returns vs SPY (~1y window when available), not Bloomberg-adjusted beta.',
      },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (e) {
    // Phase 14 wave 24: route raw error through sanitizeError instead of
    // String(e) so stack traces / internal hostnames don't leak in production.
    console.error('[Analytics API]', symbol, e)
    return errorResponse('analytics_failed', 'Analytics failed', sanitizeError(e) ?? 'analytics_failed', 502)
  }
}
