/**
 * Backtest data loaders — used by API routes.
 * Uses yahoo-finance2 npm package (same as rest of codebase).
 * All functions are pure (no side effects).
 */

import type { OhlcBar } from '@/lib/quant/technicals'
import YahooFinance from 'yahoo-finance2'

export interface OhlcvRow extends OhlcBar {
  time: number // Unix seconds
  volume: number
}

// Singleton — one YahooFinance instance per cold-start
let _yf: InstanceType<typeof YahooFinance> | null = null
function getYf(): InstanceType<typeof YahooFinance> {
  if (!_yf) _yf = new YahooFinance()
  return _yf
}

/**
 * Load daily OHLCV history for a stock ticker via yahoo-finance2.
 *
 * @param ticker  e.g. "AAPL", "NVDA"
 * @param days    Calendar days to fetch (default 1825 = ~5 years)
 */
export async function loadStockHistory(
  ticker: string,
  days = 1825,
): Promise<OhlcvRow[]> {
  const yf = getYf()
  const period1 = new Date(Date.now() - days * 86_400_000)
  const result = await yf.chart(ticker, {
    period1,
    interval: '1d',
  })

  if (!result?.quotes || result.quotes.length === 0) {
    throw new Error(`No historical data for ${ticker}`)
  }

  const rows: OhlcvRow[] = []
  for (const q of result.quotes) {
    if (q.date == null || q.open == null || q.high == null ||
        q.low == null || q.close == null) continue
    const time = Math.floor(new Date(q.date).getTime() / 1000)
    rows.push({
      time,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume ?? 0,
    })
  }
  rows.sort((a, b) => a.time - b.time)
  return rows
}

/**
 * Load daily BTC/USD OHLCV from CoinGecko.
 * CoinGecko's OHLC endpoint returns [timestamp, open, high, low, close] in milliseconds.
 *
 * @param days  Calendar days (default 1825 = ~5 years)
 */
export async function loadBtcHistory(days = 1825): Promise<OhlcvRow[]> {
  const url =
    `https://api.coingecko.com/api/v3/coins/bitcoin/ohlc` +
    `?vs_currency=usd&days=${days}`

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`CoinGecko BTC OHLC HTTP ${res.status}`)
  const raw = await res.json()
  const rawRows = Array.isArray(raw) ? raw : []

  const out: OhlcvRow[] = []
  for (const row of rawRows) {
    if (!Array.isArray(row) || row.length < 5) continue
    const [t, o, h, l, c] = row
    if (!Number.isFinite(Number(t))) continue
    out.push({
      time: Math.floor(Number(t) / 1000),
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: 0,
    })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/** Convert OhlcvRow[] to close price array. */
export function closesFromRows(rows: OhlcvRow[]): number[] {
  return rows.map(r => r.close)
}

/** Convert OhlcvRow[] to OhlcBar[] (strip time/volume). */
export function barsFromRows(rows: OhlcvRow[]): OhlcBar[] {
  return rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
}
