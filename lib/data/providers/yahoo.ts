/**
 * Yahoo Finance data provider.
 *
 * Wraps yahoo-finance2 to implement the DataProvider interface.
 * This is the primary (free-tier) provider — always available, no API key needed.
 */

import YahooFinance from 'yahoo-finance2'
import type { DataProvider, DailyBar, QuoteSnapshot } from './types'

const yahooFinance = new YahooFinance()

function toIso(d: Date | string): string {
  if (typeof d === 'string') return d
  return d.toISOString().slice(0, 10)
}

export class YahooProvider implements DataProvider {
  readonly name = 'yahoo-finance2'

  isAvailable(): boolean {
    return true  // yahoo-finance2 requires no API key
  }

  async fetchDaily(ticker: string, startDate: Date | string): Promise<DailyBar[] | null> {
    try {
      const period1 = startDate instanceof Date ? startDate : new Date(startDate)
      const chart = await yahooFinance.chart(ticker, { period1, interval: '1d' })
      const quotes = chart?.quotes ?? []
      const bars: DailyBar[] = []
      for (const q of quotes) {
        if (q.close == null || q.close <= 0) continue
        const date = q.date instanceof Date
          ? q.date.toISOString().slice(0, 10)
          : String(q.date).slice(0, 10)
        bars.push({
          date,
          open:   q.open  ?? q.close,
          high:   q.high  ?? q.close,
          low:    q.low   ?? q.close,
          close:  q.close,
          volume: q.volume ?? 0,
        })
      }
      return bars.length > 0 ? bars : null
    } catch {
      return null
    }
  }

  async fetchQuote(ticker: string): Promise<QuoteSnapshot | null> {
    try {
      const q = await yahooFinance.quote(ticker)
      if (!q || q.regularMarketPrice == null) return null
      return {
        ticker,
        price: q.regularMarketPrice,
        change: q.regularMarketChange ?? 0,
        changePct: q.regularMarketChangePercent ?? 0,
        volume: q.regularMarketVolume ?? undefined,
        marketCap: typeof q.marketCap === 'number' ? q.marketCap : undefined,
        updatedAt: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }
}

/** Singleton instance — reuse across the app. */
export const yahooProvider = new YahooProvider()
