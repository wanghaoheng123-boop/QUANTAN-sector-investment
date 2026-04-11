/**
 * Alpha Vantage data provider (free tier: 25 API calls/day).
 *
 * Requires environment variable: ALPHAVANTAGE_API_KEY
 * Free tier docs: https://www.alphavantage.co/documentation/
 */

import type { DataProvider, DailyBar, QuoteSnapshot } from './types'

const AV_BASE = 'https://www.alphavantage.co/query'

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
      const res = await fetch(url)
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
          open:   parseFloat(values['1. open']),
          high:   parseFloat(values['2. high']),
          low:    parseFloat(values['3. low']),
          close:  parseFloat(values['5. adjusted close']),
          volume: parseInt(values['6. volume'], 10),
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
      const res = await fetch(url)
      if (!res.ok) return null
      const data = await res.json() as Record<string, unknown>
      const q = data['Global Quote'] as Record<string, string> | undefined
      if (!q || !q['05. price']) return null
      return {
        ticker,
        price: parseFloat(q['05. price']),
        change: parseFloat(q['09. change'] ?? '0'),
        changePct: parseFloat((q['10. change percent'] ?? '0%').replace('%', '')),
        volume: parseInt(q['06. volume'] ?? '0', 10),
        updatedAt: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }
}

export const alphaVantageProvider = new AlphaVantageProvider()
