import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'
import { SECTORS } from '@/lib/sectors'
import { sma, rsi, ma200Regime } from '@/lib/quant/technicals'
import { applyRateLimit } from '@/lib/api/rateLimit'
import { sanitizeError } from '@/lib/api/sanitize'
import { withRetry } from '@/lib/api/reliability'

const yahooFinance = new YahooFinance()

// 5-minute server-side cache — balances freshness vs Yahoo rate limits
const _cache = new Map<string, { data: unknown; expiresAt: number; storedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

const TICKERS = [
  ...SECTORS.map((s) => ({ ticker: s.etf, name: s.name, color: s.color, icon: s.icon, slug: s.slug })),
  { ticker: 'SPY', name: 'S&P 500', color: '#3b82f6', icon: '🇺🇸', slug: 'spy' },
  { ticker: 'QQQ', name: 'Nasdaq-100', color: '#8b5cf6', icon: '💻', slug: 'qqq' },
]

export async function GET(request: Request) {
  // ~13 parallel Yahoo chart calls per request — same fan-out profile as sector-rotation.
  const rateLimitResponse = await applyRateLimit(request, 'ma-deviation', {
    maxRequests: 10,
    windowSeconds: 60,
  })
  if (rateLimitResponse) return rateLimitResponse

  const now = Date.now()
  const cached = _cache.get('ma-deviation')
  // I2 (Q110-P2, 2026-09-05) — a stored copy must say it is one. This route
  // served `_cache` verbatim with nothing in the payload marking it, so a
  // value up to the TTL old was indistinguishable from a live one. It was
  // invisible to the I2 guard because that guard's producer set was "routes
  // that already set `_cached`" — the violation defined itself out of scope.
  // `_cachedAt` carries the real age so the badge can show it rather than a bare
  // boolean: this cache runs to 5 minutes, and "how stale" is the useful signal.
  //
  // It is also the ONLY half that survives an HTTP cache. `Cache-Control` here
  // is `max-age=300`, so a browser or CDN can answer from its own store with a
  // body whose `_cached` was frozen as `false` when first computed — the boolean
  // goes stale, the timestamp does not, because an age is recomputed from the
  // clock on every render. Consumers must still fetch `no-store` to make the
  // boolean meaningful; a CDN hop remains a layer this flag cannot describe.
  if (cached && now < cached.expiresAt) {
    return NextResponse.json({ ...(cached.data as object), _cached: true, _cachedAt: cached.storedAt }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  }

  try {
    const period1 = new Date()
    // AL-4 (2026-08-15): this window was 310 calendar days, sized to the SMA
    // (200 bars) and not to the SLOPE. Measured against real trading dates,
    // 310 calendar days yields ~214 bars — below the 221 closes
    // `sma200Slope()` requires (lib/quant/indicators.ts) — so `slopePct` /
    // `slopePositive` came back null on EVERY row of this board, permanently.
    // 400 calendar days ≈ 275 trading bars, comfortable headroom over 221 even
    // across a holiday-heavy stretch. Keep this ≥ 360 calendar days — the floor
    // __tests__/api/maDeviationWindow.test.ts enforces. Below it the slope
    // silently goes null again and the whole board degrades to the
    // unknown-slope arm of ma200Regime.
    period1.setDate(period1.getDate() - 400)

    const allTickers = TICKERS.map((t) => t.ticker)

    // Fetch all charts in parallel
    const chartResults = await Promise.allSettled(
      allTickers.map((ticker) =>
        withRetry(
          () => yahooFinance.chart(ticker, { period1, interval: '1d' }),
          { attempts: 2, timeoutMs: 7000, retryLabel: `ma-deviation chart ${ticker}` },
        )
      )
    )

    const rows = TICKERS.map((meta, idx) => {
      const result = chartResults[idx]
      if (result.status === 'rejected') {
        return {
          ticker: meta.ticker,
          name: meta.name,
          color: meta.color,
          icon: meta.icon,
          slug: meta.slug,
          price: null,
          sma200: null,
          regime: null,
          error: 'fetch_failed',
        }
      }

      const quotes = result.value?.quotes?.filter(
        (c: any) => c.close != null && c.close > 0
      ) ?? []

      if (quotes.length < 10) {
        return {
          ticker: meta.ticker,
          name: meta.name,
          color: meta.color,
          icon: meta.icon,
          slug: meta.slug,
          price: null,
          sma200: null,
          regime: null,
          error: 'insufficient_data',
        }
      }

      const closes: number[] = quotes.map((c: any) => c.close as number)
      const price = closes[closes.length - 1]
      const sma200val = sma(closes, 200)
      const rsi14val = rsi(closes, 14)
      const regime = ma200Regime(price, closes, rsi14val)

      return {
        ticker: meta.ticker,
        name: meta.name,
        color: meta.color,
        icon: meta.icon,
        slug: meta.slug,
        price,
        sma200: sma200val,
        sma50: sma(closes, 50),
        rsi14: rsi14val,
        tradingDays: closes.length,
        regime,
      }
    })

    const payload = {
      rows,
      computedAt: new Date().toISOString(),
      disclaimer:
        'Deviation zones and forward return context are based on historical analysis of S&P 500 / sector ETF daily data (1990–2024). Not investment advice. Past performance is not indicative of future results.',
    }

    _cache.set('ma-deviation', { data: payload, expiresAt: now + CACHE_TTL_MS, storedAt: now })

    return NextResponse.json({ ...payload, _cached: false, _cachedAt: now }, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    })
  } catch (error) {
    console.error('[MA Deviation API]', error)
    // Phase 16 audit (2026-05-24): replaced `details: String(error)` which
    // would leak stack traces + file paths in production (CWE-209). The SSOT
    // sanitizeError returns undefined in production and the message in dev.
    const details = sanitizeError(error)
    return NextResponse.json(
      {
        error: 'Failed to compute MA deviation data',
        ...(details ? { details } : {}),
      },
      { status: 500 },
    )
  }
}
