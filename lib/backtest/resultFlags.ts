import type { BacktestResult } from './core'

/**
 * Q-136 — an instrument that never opened a position because every BUY signal
 * was worth less than one whole unit at the per-position allocation.
 *
 * Its flat equity curve is the sizing rule refusing to trade, not a strategy
 * result, so the portfolio aggregate excludes it and the UI labels it rather
 * than printing "0.0%" and an excess return the strategy never had a chance
 * to earn. One definition, read by the aggregator and the table.
 *
 * A leaf module (type-only import) so client components can use it.
 */
export function isUntradeable(r: Pick<BacktestResult, 'totalTrades' | 'unaffordableEntries'>): boolean {
  return r.totalTrades === 0 && (r.unaffordableEntries ?? 0) > 0
}
