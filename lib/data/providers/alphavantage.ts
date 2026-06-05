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
 * Parse a numeric string from an AlphaVantage field.
 * AlphaVantage returns 'N/A' for missing data; parseFloat/parseInt of those
 * produces NaN which propagates silently into the warehouse. Return the
 * provided fallback (default 0) for any non-finite result.
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
        bars.push({
          date,
          open:   toFiniteFloat(values['1. open']),
          high:   toFiniteFloat(values['2. high']),
          low:    toFiniteFloat(values['3. low']),
          close:  toFiniteFloat(values['5. adjusted close']),
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
      return {
        ticker,
        price:     toFiniteFloat(q['05. price']),
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
