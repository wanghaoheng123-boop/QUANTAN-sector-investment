/**
 * Intermarket correlation analysis.
 *
 * Computes rolling correlations between a target asset and four benchmark
 * series (SPY, ^VIX, UUP, TLT) over 63-day (3mo) and 252-day (1yr) windows,
 * then classifies the current market regime.
 *
 * Reuses `alignCloses`, `logReturns`, `correlation` from relativeStrength.ts.
 */

import { alignCloses, logReturns, correlation } from './relativeStrength'

export const INTERMARKET_BENCHMARKS = ['SPY', '^VIX', 'UUP', 'TLT'] as const
export type BenchmarkTicker = typeof INTERMARKET_BENCHMARKS[number]

export interface CorrelationEntry {
  /** Pearson correlation over the 63-day window, or null if insufficient data. */
  corr63d: number | null
  /** Pearson correlation over the 252-day window, or null if insufficient data. */
  corr252d: number | null
}

export type CorrelationMap = Record<BenchmarkTicker, CorrelationEntry>

export type IntermarketRegime = 'risk_on' | 'risk_off' | 'mixed'

export interface IntermarketResult {
  correlations: CorrelationMap
  regime: IntermarketRegime
}

/**
 * Computes correlations between target closes and each benchmark.
 *
 * @param closes  Target asset daily closes (oldest → newest)
 * @param dates   Corresponding trading dates (YYYY-MM-DD)
 * @param benchmarks  Map of benchmark ticker → { closes, dates }
 */
export function intermarketCorrelations(
  closes: number[],
  dates: string[],
  benchmarks: Partial<Record<BenchmarkTicker, { closes: number[]; dates: string[] }>>,
): CorrelationMap {
  const result = {} as CorrelationMap

  for (const ticker of INTERMARKET_BENCHMARKS) {
    const bench = benchmarks[ticker]
    if (!bench) {
      result[ticker] = { corr63d: null, corr252d: null }
      continue
    }

    const aligned = alignCloses(dates, closes, bench.dates, bench.closes)
    const lrA = logReturns(aligned.a)
    const lrB = logReturns(aligned.b)
    const n = Math.min(lrA.length, lrB.length)

    result[ticker] = {
      corr63d:  n >= 63  ? correlation(lrA.slice(-63),  lrB.slice(-63))  : null,
      corr252d: n >= 252 ? correlation(lrA.slice(-252), lrB.slice(-252)) : null,
    }
  }

  return result
}

/**
 * Classifies the current market regime based on correlations:
 *
 * risk_on:  SPY corr63d > 0.5  AND  VIX corr63d < -0.3  (positive beta, fear is low)
 * risk_off: SPY corr63d < 0    AND  VIX corr63d > 0.3   (negative beta, fear is high)
 * mixed:    everything else
 */
export function classifyRegime(corrs: CorrelationMap): IntermarketRegime {
  const spyCorr = corrs['SPY'].corr63d
  const vixCorr = corrs['^VIX'].corr63d

  if (spyCorr != null && vixCorr != null) {
    if (spyCorr > 0.5 && vixCorr < -0.3) return 'risk_on'
    if (spyCorr < 0   && vixCorr > 0.3)  return 'risk_off'
  }
  return 'mixed'
}

/**
 * Convenience wrapper — computes correlations and regime in one call.
 */
export function analyzeIntermarket(
  closes: number[],
  dates: string[],
  benchmarks: Partial<Record<BenchmarkTicker, { closes: number[]; dates: string[] }>>,
): IntermarketResult {
  const correlations = intermarketCorrelations(closes, dates, benchmarks)
  const regime = classifyRegime(correlations)
  return { correlations, regime }
}
