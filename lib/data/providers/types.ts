/**
 * Data provider abstraction layer.
 *
 * All data sources implement the `DataProvider` interface so callers can
 * swap or chain providers without changing business logic.
 */

export interface DailyBar {
  date: string   // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface QuoteSnapshot {
  ticker: string
  price: number
  change: number
  changePct: number
  volume?: number
  marketCap?: number
  updatedAt: string  // ISO timestamp
}

export interface MacroSeries {
  /** FRED series ID, e.g. "FEDFUNDS", "CPIAUCSL" */
  seriesId: string
  observations: Array<{ date: string; value: number | null }>
  units: string
  frequency: string
}

/**
 * Standard interface all data providers must implement.
 *
 * Implementors should return null (not throw) when data is unavailable
 * to allow fallback chaining.
 */
export interface DataProvider {
  /** Human-readable name for logging/debugging. */
  readonly name: string

  /**
   * Quick health check — returns false if the provider is misconfigured
   * or known to be rate-limited.  Should be cheap (no network call).
   */
  isAvailable(): boolean

  /**
   * Fetch daily OHLCV bars for `ticker` from `startDate` to today.
   * Returns null if unavailable (rate limit, missing data, network error).
   *
   * @param startDate ISO date string or Date object
   */
  fetchDaily(ticker: string, startDate: Date | string): Promise<DailyBar[] | null>

  /**
   * Fetch the latest real-time or delayed quote.
   * Returns null on any error.
   */
  fetchQuote(ticker: string): Promise<QuoteSnapshot | null>
}

/**
 * Optional extension for providers that supply macro/economic data.
 */
export interface MacroDataProvider extends DataProvider {
  fetchMacroSeries(seriesId: string, startDate?: Date | string): Promise<MacroSeries | null>
}
