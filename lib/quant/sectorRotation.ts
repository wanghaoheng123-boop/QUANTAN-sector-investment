/**
 * Sector rotation scoring.
 *
 * Ranks GICS sectors by a composite of:
 *   - Momentum: 40% × 3mo return + 30% × 6mo return + 30% × 12mo return
 *               minus the 1-month return as a crash filter
 *   - Mean-reversion boost: RSI(14) oversold → positive boost
 *
 * Composite = 0.6 × momentum + 0.4 × meanReversionBoost
 *
 * Top 3 sectors → OVERWEIGHT, bottom 3 → UNDERWEIGHT, rest → NEUTRAL.
 *
 * Reuses `rsiLatest` from indicators.ts; SECTORS/SECTOR_ETFS from sectors.ts.
 */

import { rsiLatest } from './indicators'
import { SECTORS } from '../sectors'

export type SectorSignal = 'OVERWEIGHT' | 'NEUTRAL' | 'UNDERWEIGHT'

export interface SectorScore {
  sector: string
  etf: string
  composite: number
  momentum: number
  meanReversion: number
  rank: number
  signal: SectorSignal
}

/**
 * Returns the percentage return of `closes` over the last `days` trading days.
 * Returns null if there aren't enough bars (distinguishes from a valid zero return).
 */
function periodReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null
  const start = closes[closes.length - days - 1]
  const end   = closes[closes.length - 1]
  return start > 0 ? (end - start) / start : null
}

/**
 * Momentum score = 40% × 3mo + 30% × 6mo + 30% × 12mo − 1mo crash filter.
 * Trading-day approximate periods: 63d, 126d, 252d, 21d.
 * Null components contribute 0 (treated as neutral), preventing downward bias.
 */
export function momentumScore(closes: number[]): number {
  const ret3mo  = periodReturn(closes, 63)
  const ret6mo  = periodReturn(closes, 126)
  const ret12mo = periodReturn(closes, 252)
  const ret1mo  = periodReturn(closes, 21)

  return 0.40 * (ret3mo ?? 0) + 0.30 * (ret6mo ?? 0) + 0.30 * (ret12mo ?? 0) - (ret1mo ?? 0)
}

/**
 * Mean-reversion boost from RSI(14):
 *   RSI < 30  → +0.10  (oversold → strong boost)
 *   RSI < 40  → +0.05
 *   RSI > 70  → -0.05
 *   RSI > 80  → -0.10  (overbought → penalty)
 *   otherwise → 0
 */
export function meanReversionBoost(closes: number[]): number {
  const rsi = rsiLatest(closes, 14)
  if (rsi == null) return 0
  if (rsi < 30) return  0.10
  if (rsi < 40) return  0.05
  if (rsi > 80) return -0.10
  if (rsi > 70) return -0.05
  return 0
}

/**
 * Scores and ranks all sectors (or a custom ETF→closes map).
 *
 * @param etfData  Map of ETF ticker → daily closes array (oldest → newest)
 * @param topN     Number of sectors to label OVERWEIGHT (default 3)
 * @param bottomN  Number of sectors to label UNDERWEIGHT (default 3)
 */
export function sectorScores(
  etfData: Record<string, number[]>,
  topN = 3,
  bottomN = 3,
): SectorScore[] {
  // Build ETF → sector name lookup from SECTORS
  const etfToSector = new Map<string, string>(SECTORS.map((s) => [s.etf, s.name]))

  const scored: Array<Omit<SectorScore, 'rank' | 'signal'>> = []

  for (const [etf, closes] of Object.entries(etfData)) {
    if (!closes || closes.length < 22) continue  // need at least 1 month
    const momentum = momentumScore(closes)
    const meanReversion = meanReversionBoost(closes)
    const composite = 0.6 * momentum + 0.4 * meanReversion
    scored.push({
      sector: etfToSector.get(etf) ?? etf,
      etf,
      composite,
      momentum,
      meanReversion,
    })
  }

  // Sort descending by composite
  scored.sort((a, b) => b.composite - a.composite)

  return scored.map((s, i) => {
    const rank = i + 1
    let signal: SectorSignal = 'NEUTRAL'
    if (rank <= topN) {
      signal = 'OVERWEIGHT'
    } else if (rank > scored.length - bottomN) {
      signal = 'UNDERWEIGHT'
    }
    return { ...s, rank, signal }
  })
}
