/**
 * Trading days per year by instrument, for annualisation.
 *
 * Phase 13 S2 fix (F1.6): tickers that trade 7 days a week need 365-day
 * annualization; equities use 252. The detection is conservative — only
 * known crypto symbols get 365. New crypto tickers default to 252 unless
 * added here or their sector is 'crypto'.
 *
 * Its own module (Q-139) so a client component can read it without importing
 * lib/backtest/core.ts and, through it, the whole signal stack.
 */
const CRYPTO_TICKERS_365 = new Set(['BTC', 'BTC-USD', 'ETH', 'ETH-USD', 'SOL', 'SOL-USD'])

export function tradingDaysPerYear(ticker: string, sector: string): number {
  if (CRYPTO_TICKERS_365.has(ticker.toUpperCase())) return 365
  if (sector?.toLowerCase() === 'crypto') return 365
  return 252
}
