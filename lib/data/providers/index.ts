/**
 * Data provider factory with automatic fallback chain.
 *
 * Priority order: Yahoo Finance → Polygon.io → Alpha Vantage
 *
 * Yahoo is always tried first (free, no key). Polygon and AlphaVantage
 * are only used if their API keys are configured AND Yahoo fails.
 */

export type { DataProvider, MacroDataProvider, DailyBar, QuoteSnapshot, MacroSeries } from './types'
export { YahooProvider, yahooProvider } from './yahoo'
export { PolygonProvider, polygonProvider } from './polygon'
export { AlphaVantageProvider, alphaVantageProvider } from './alphavantage'
export { FredProvider, fredProvider } from './fred'

import { yahooProvider } from './yahoo'
import { polygonProvider } from './polygon'
import { alphaVantageProvider } from './alphavantage'
import { fredProvider } from './fred'
import type { DataProvider, DailyBar, QuoteSnapshot } from './types'

/**
 * Fetches daily bars using the first available provider in the chain.
 * Logs which provider succeeded.
 */
export async function fetchDailyWithFallback(
  ticker: string,
  startDate: Date | string,
): Promise<DailyBar[] | null> {
  const providers: DataProvider[] = [yahooProvider, polygonProvider, alphaVantageProvider]

  for (const provider of providers) {
    if (!provider.isAvailable()) continue
    const result = await provider.fetchDaily(ticker, startDate)
    if (result && result.length > 0) {
      return result
    }
  }
  return null
}

/**
 * Fetches a real-time/delayed quote using the first available provider.
 */
export async function fetchQuoteWithFallback(ticker: string): Promise<QuoteSnapshot | null> {
  const providers: DataProvider[] = [yahooProvider, polygonProvider, alphaVantageProvider]

  for (const provider of providers) {
    if (!provider.isAvailable()) continue
    const result = await provider.fetchQuote(ticker)
    if (result) return result
  }
  return null
}

/** FRED macro data — always uses the FRED provider directly. */
export { fredProvider as macroProvider }
