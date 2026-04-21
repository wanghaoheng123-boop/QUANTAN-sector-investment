import { AlphaVantageProvider } from './alphavantage'
import { PolygonProvider } from './polygon'
import { StooqProvider } from './stooq'
import type { DailyFetchOptions, DataProvider } from './types'
import { YahooProvider } from './yahoo'

export type { ChartInterval, DailyFetchOptions, DataProvider, ProviderDailyBar, ProviderQuote } from './types'
export { YahooProvider } from './yahoo'
export { PolygonProvider } from './polygon'
export { AlphaVantageProvider } from './alphavantage'
export { StooqProvider } from './stooq'
export { fetchFredObservations, isFredConfigured } from './fred'
export type { FredObservation } from './fred'
export { fetchVixHistory } from './cboe'
export type { VixHistoryRow } from './cboe'
export { fetchRecessionRanges, isRecession } from './nber'
export type { RecessionRange } from './nber'
export { fetchRecent13FFilings, isEdgarConfigured } from './edgar'
export type { Edgar13FFiling } from './edgar'
export { cotLegacyFuturesUrl } from './cftc'

/** Polygon → Alpha Vantage → Yahoo (paid providers optional; Yahoo always works). */
class ChainedEquityProvider implements DataProvider {
  readonly name = 'chain'

  constructor(private readonly providers: DataProvider[]) {}

  isAvailable(): boolean {
    return this.providers.some((p) => p.isAvailable())
  }

  async fetchDaily(symbol: string, opts: DailyFetchOptions) {
    for (const p of this.providers) {
      if (!p.isAvailable()) continue
      try {
        const rows = await p.fetchDaily(symbol, opts)
        if (rows && rows.length > 0) return rows
      } catch {
        /* try next */
      }
    }
    return null
  }

  async fetchQuote(symbol: string) {
    for (const p of this.providers) {
      if (!p.isAvailable()) continue
      try {
        const q = await p.fetchQuote(symbol)
        if (q) return q
      } catch {
        /* try next */
      }
    }
    return null
  }
}

let cached: DataProvider | null = null

export function getEquityDataProvider(): DataProvider {
  if (!cached) {
    cached = new ChainedEquityProvider([new PolygonProvider(), new AlphaVantageProvider(), new YahooProvider()])
  }
  return cached
}
