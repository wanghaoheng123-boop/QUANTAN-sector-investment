/** Align two close series by trading day key (YYYY-MM-DD). */

import { pearsonCorrelation } from './correlation'

export function alignCloses(
  datesA: string[],
  closesA: number[],
  datesB: string[],
  closesB: number[]
): { a: number[]; b: number[] } {
  const mapB = new Map<string, number>()
  for (let i = 0; i < datesB.length; i++) mapB.set(datesB[i], closesB[i])
  const a: number[] = []
  const b: number[] = []
  for (let i = 0; i < datesA.length; i++) {
    const d = datesA[i]
    const ca = closesA[i]
    const cb = mapB.get(d)
    if (cb != null && ca > 0 && cb > 0) {
      a.push(ca)
      b.push(cb)
    }
  }
  return { a, b }
}

/**
 * Per-bar LOG returns r_i = ln(c_i / c_{i-1}).
 *
 * Convention (Phase 14 Q2-M-1 doc'd): used here because the consumers are
 * Pearson correlation and other time-series statistics. Log returns are
 * additive over time and have a more symmetric distribution, which makes
 * the standard correlation/covariance moments better-behaved (especially
 * at long horizons).
 *
 * Reference: Tsay (2010) "Analysis of Financial Time Series" pp 3–7 —
 * "log returns aggregate over time, simple returns aggregate across
 * portfolios." Sister conventions:
 *   • `lib/quant/volatility.ts`, `lib/quant/regimeDetection.ts` — log
 *     returns (time-aggregation problem).
 *   • `lib/quant/indicators.ts::dailyReturns`, `trailingReturn` below —
 *     simple returns (portfolio-aggregation / cumulative-performance).
 */
export function logReturns(closes: number[]): number[] {
  const r: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]))
  }
  return r
}

/**
 * Pearson correlation with tail-aligned, length-tolerant inputs and a
 * minimum-sample gate (n ≥ 10) suitable for time-series usage.
 *
 * Phase 13 S2 fix: delegates to canonical `pearsonCorrelation` in
 * `lib/quant/correlation.ts` (which adds zero-variance + non-finite
 * guards). Previously this file had a separate inline implementation —
 * a single source-of-truth violation.
 */
export function correlation(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 10) return null
  return pearsonCorrelation(x.slice(-n), y.slice(-n))
}

/**
 * Total SIMPLE return over the last `days` trading sessions:
 *   r = c_last / c_{last-days} - 1
 *
 * Convention (Phase 14 Q2-M-1 doc'd): simple returns are correct here
 * because the consumers (relative-strength ranking, leadership analysis,
 * `excessReturn` below) are cumulative-performance measures that need to
 * compose multiplicatively across instruments / weights — i.e. the
 * portfolio-aggregation case in Tsay (2010) pp 3–7. Using log returns
 * here would silently distort percentile rankings whenever moves are
 * large (a +10% simple return is 0.0953 in log space — small at the bar
 * level, but the ordering of multi-month winners can flip).
 */
export function trailingReturn(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null
  const old = closes[closes.length - 1 - days]
  const last = closes[closes.length - 1]
  if (old <= 0) return null
  return last / old - 1
}

/** Stock return minus benchmark return (same window). */
export function excessReturn(
  stockCloses: number[],
  benchCloses: number[],
  days: number
): number | null {
  const rs = trailingReturn(stockCloses, days)
  const rb = trailingReturn(benchCloses, days)
  if (rs == null || rb == null) return null
  return rs - rb
}

export interface RelativeStrengthRow {
  ticker: string
  ratio: number              // last close / SPY last close, raw scale
  ratio1mAgo: number | null  // ratio 21 trading days ago
  pct1m: number | null       // % change in ratio over 1m (positive = outperforming)
  pct3m: number | null       // % change in ratio over 3m (~63 trading days)
  pct6m: number | null       // % change in ratio over 6m (~126 trading days)
  rank: number
}

/**
 * Compute relative-strength rows for each ticker vs SPY (the benchmark).
 * Uses ratio = price / SPY_price; positive % change in ratio = outperformance.
 *
 * @param tickerCloses  Map of ticker → daily closes (oldest → newest)
 * @param spyCloses     SPY daily closes (oldest → newest), same date alignment expected
 * @returns Sorted by 1-month relative strength descending, with rank assigned
 */
export function relativeStrengthVsBenchmark(
  tickerCloses: Record<string, number[]>,
  spyCloses: number[],
): RelativeStrengthRow[] {
  if (spyCloses.length < 22) return []

  const spyLast = spyCloses[spyCloses.length - 1]
  const spy1mAgo = spyCloses[spyCloses.length - 22] ?? null
  const spy3mAgo = spyCloses[spyCloses.length - 64] ?? null
  const spy6mAgo = spyCloses[spyCloses.length - 127] ?? null

  if (!(spyLast > 0)) return []

  const rows: Omit<RelativeStrengthRow, 'rank'>[] = []
  for (const [ticker, closes] of Object.entries(tickerCloses)) {
    if (!closes || closes.length < 22) continue
    const last = closes[closes.length - 1]
    if (!(last > 0)) continue

    const ratio = last / spyLast

    const computeRatio = (priceAgo: number | null | undefined, spyAgo: number | null) =>
      priceAgo != null && priceAgo > 0 && spyAgo != null && spyAgo > 0 ? priceAgo / spyAgo : null

    const ratio1m = computeRatio(closes[closes.length - 22], spy1mAgo)
    const ratio3m = computeRatio(closes[closes.length - 64], spy3mAgo)
    const ratio6m = computeRatio(closes[closes.length - 127], spy6mAgo)

    const pct1m = ratio1m != null ? (ratio - ratio1m) / ratio1m : null
    const pct3m = ratio3m != null ? (ratio - ratio3m) / ratio3m : null
    const pct6m = ratio6m != null ? (ratio - ratio6m) / ratio6m : null

    rows.push({ ticker, ratio, ratio1mAgo: ratio1m, pct1m, pct3m, pct6m })
  }

  rows.sort((a, b) => (b.pct1m ?? -Infinity) - (a.pct1m ?? -Infinity))
  return rows.map((r, i) => ({ ...r, rank: i + 1 }))
}
