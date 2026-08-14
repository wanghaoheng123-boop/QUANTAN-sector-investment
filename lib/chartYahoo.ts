/**
 * Yahoo Finance chart helpers — intraday alignment for 1m / 3m / 5m bars.
 */

export const STOCK_CHART_RANGES = [
  '1m', '3m', '5m', '15m', '1H', '4H', '1D', '1W', '1M', '3M', '6M', '1Y', '2Y', '5Y', 'ALL',
] as const

export type StockChartRange = (typeof STOCK_CHART_RANGES)[number]

/** Ranges that should poll so candles stay near live quotes / session data. */
export function isStockIntradayPollRange(range: string): boolean {
  return new Set(['1m', '3m', '5m', '15m', '1H', '4H', '1D', '1W']).has(range)
}

/**
 * UX-22: does this range token render INTRADAY bars? SSOT for the chart's
 * "INTRADAY / DAILY+ BARS" badge.
 *
 * Deliberately NOT `isStockIntradayPollRange`. That predicate answers a
 * different question — "should this range poll?" — and so includes `1D` and
 * `1W`, which app/api/chart/[ticker]/route.ts serves as `interval: '1d'`:
 * daily bars over a short lookback, polled because they track the live
 * session. Labelling those "INTRADAY" would trade one wrong badge for another.
 *
 * Mirrors the interval switch in app/api/chart/[ticker]/route.ts, which stays
 * the authority on what is actually fetched (1m→1m, 3m→3m aggregated from 1m,
 * 5m→5m, 15m→15m, 1H/4H→1h, 1D/1W/1M/3M/6M/1Y→1d, 2Y/5Y→1wk, ALL→1mo).
 * Keep the two in sync; an unknown token falls through to DAILY+, matching the
 * route's `default: interval = '1d'`.
 */
export function isIntradayBarRange(range: string): boolean {
  return new Set(['1m', '3m', '5m', '15m', '1H', '4H']).has(range)
}

/** Badge text for the chart's bar granularity — rendered as "{label} BARS". */
export function chartBarKindLabel(range: string): 'INTRADAY' | 'DAILY+' {
  return isIntradayBarRange(range) ? 'INTRADAY' : 'DAILY+'
}

type YahooQuote = {
  date: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

/** Bucket 1-minute Yahoo quotes into N-minute OHLCV (used for 3m when Yahoo has no native 3m). */
export function aggregateMinuteQuotesToN(
  quotes: YahooQuote[],
  groupMinutes: number
): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> {
  const sec = groupMinutes * 60
  const buckets = new Map<
    number,
    { open: number; high: number; low: number; close: number; volume: number }
  >()

  const sorted = [...quotes].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (const q of sorted) {
    if (q.close === null || q.open === null || q.high === null || q.low === null) continue
    const t = Math.floor(q.date.getTime() / 1000)
    const key = Math.floor(t / sec) * sec
    const ex = buckets.get(key)
    if (!ex) {
      buckets.set(key, {
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      })
    } else {
      ex.high = Math.max(ex.high, q.high)
      ex.low = Math.min(ex.low, q.low)
      ex.close = q.close
      ex.volume += q.volume ?? 0
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, v]) => ({
      time,
      open: v.open,
      high: v.high,
      low: v.low,
      close: v.close,
      volume: v.volume,
    }))
}
