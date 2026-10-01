/**
 * Shared types for the dark pool analytics API — the ONE definition.
 * Imported by the route, DarkPoolPanel and the sector/stock pages. (Q-140: the
 * route used to declare its own copy, and the two had drifted.)
 */

export interface DarkPoolMetric {
  offExchangePct: number | null
  onExchangePct: number | null
  offExchangeShares: number | null
  totalShares: number | null
  sharesShorted: number | null
  shortFloatPct: number | null
  daysToCover: number | null
  avgDailyVolume: number | null
  sharesOutstanding: number | null
  sharesFloat: number | null
}

/**
 * Q-140 (I2): the quote is nullable. The route used to fall back to "an
 * explicit 0 (never NaN)" when Yahoo failed — a measured-looking zero on the
 * wire. Unknown is null.
 */
export interface PricePoint {
  price: number | null
  change: number | null
  changePct: number | null
  quoteTime: string | null
}

export interface DarkPoolAnalysis {
  ticker: string
  fetchedAt: string
  quote: PricePoint
  metrics: DarkPoolMetric
  /** Whether Yahoo had meaningful dark-pool data for this ticker */
  hasRealData: boolean
  /** Human-readable diagnostic when no real data, or why the fetch failed */
  statusNote: string | null
  /** Q-140: set when a Yahoo FETCH failed — distinct from "no data exists". */
  degraded?: boolean
}
