/**
 * Shared data-shape types for warehouse OHLCV / quote rows.
 *
 * NOTE (2026-06-27): the `lib/data/providers` abstraction (Yahoo/Polygon/
 * AlphaVantage/Fred provider classes + dispatcher + fallback chain) was removed
 * as dead code — it had zero production callers (live routes call yahoo-finance2
 * directly; the backtest uses the JSON warehouse). These two interfaces are kept
 * because `lib/data/warehouse.ts` imports them as its row shapes.
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
