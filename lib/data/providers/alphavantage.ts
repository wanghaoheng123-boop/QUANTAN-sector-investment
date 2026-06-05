/**
 * Alpha Vantage data provider (free tier: 25 API calls/day).
 *
 * Requires environment variable: ALPHAVANTAGE_API_KEY
 * Free tier docs: https://www.alphavantage.co/documentation/
 */

import type { DataProvider, DailyBar, QuoteSnapshot } from './types'

const AV_BASE = 'https://www.alphavantage.co/query'

/** Timeout for all AlphaVantage fetch calls — prevents hung serverless workers. */
const FETCH_TIMEOUT_MS = 8_000

/**
 * Strict parse for PRICE-bearing fields (OHLC, quote price). AlphaVantage returns
 * 'N/A' for missing data → NaN. We must NOT substitute 0 here: a 0 price passes the
 * warehouse's non-finite filter as if real and injects a fake -100% bar into the
 * backtest. Returns null so the caller can SKIP the bar / return null instead.
 */
function parseFiniteOrNull(raw: string | undefined): number | null {
  const v = parseFloat(raw ?? '')
  return Number.isFinite(v) ? v : null
}

/**
 * Lenient parse for BENIGN fields (volume, change, changePct) where a 0 fallback
 * is harmless. AlphaVantage 'N/A' → 0 rather than letting NaN reach the warehouse.
 */
function toFiniteFloat(raw: string | undefined, fallback = 0): number {
  const v = parseFloat(raw ?? '')
  return Number.isFinite(v) ? v : fallback
}

function toFiniteInt(raw: string | undefined, fallback = 0): number {
  const v = parseInt(raw ?? '', 10)
  return Number.isFinite(v) ? v : fallback
}

export class AlphaVantageProvider implements DataProvider {
  readonly name = 'alpha-vantage'
  private readonly apiKey: string

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ALPHAVANTAGE_API_KEY ?? ''
  }

  isAvailable(): boolean {
    return this.apiKey.length > 0
  }

  async fetchDaily(ticker: string, startDate: Date | string): Promise<DailyBar[] | null> {
    if (!this.isAvailable()) return null
    try {
      const url = `${AV_BASE}?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${ticker}&outputsize=full&apikey=${this.apiKey}`
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return null
      const data = await res.json() as Record<string, unknown>

      const series = data['Time Series (Daily)'] as Record<string, Record<string, string>> | undefined
      if (!series) return null

      const fromDate = startDate instanceof Date
        ? startDate.toISOString().slice(0, 10)
        : startDate

      const bars: DailyBar[] = []
      for (const [date, values] of Object.entries(series)) {
        if (date < fromDate) continue
        // Skip any bar with a non-finite OHLC field rather than coercing to 0
        // (a 0 price would defeat the warehouse non-finite filter and inject a
        // fake bar). Volume is benign — 0 is an acceptable fallback.
        const open = parseFiniteOrNull(values['1. open'])
        const high = parseFiniteOrNull(values['2. high'])
        const low = parseFiniteOrNull(values['3. low'])
        const close = parseFiniteOrNull(values['5. adjusted close'])
        if (open === null || high === null || low === null || close === null) continue
        bars.push({
          date,
          open,
          high,
          low,
          close,
          volume: toFiniteInt(values['6. volume']),
        })
      }
      bars.sort((a, b) => a.date.localeCompare(b.date))
      return bars.length > 0 ? bars : null
    } catch {
      return null
    }
  }

  async fetchQuote(ticker: string): Promise<QuoteSnapshot | null> {
    if (!this.isAvailable()) return null
    try {
      const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${this.apiKey}`
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) return null
      const data = await res.json() as Record<string, unknown>
      const q = data['Global Quote'] as Record<string, string> | undefined
      if (!q || !q['05. price']) return null
      // Strict price: a non-finite price (e.g. 'N/A') must yield null, not 0.
      const price = parseFiniteOrNull(q['05. price'])
      if (price === null) return null
      return {
        ticker,
        price,
        change:    toFiniteFloat(q['09. change']),
        changePct: toFiniteFloat((q['10. change percent'] ?? '').replace('%', '')),
        volume:    toFiniteInt(q['06. volume']),
        updatedAt: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }
}

export const alphaVantageProvider = new AlphaVantageProvider()
