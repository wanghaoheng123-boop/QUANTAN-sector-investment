/**
 * Risk Parity — inverse-volatility portfolio weighting.
 *
 * The classic "risk parity" approach allocates capital inversely proportional
 * to each asset's realized volatility so that every position contributes an
 * equal share of total portfolio risk.
 *
 * References:
 *   Bridgewater "All Weather" portfolio methodology.
 *   Qian, E. (2005). "Risk Parity Portfolios". PanAgora Asset Management.
 */

import { annualizedVolFromCloses } from '@/lib/quant/volatility'

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface RiskParityInput {
  ticker: string
  /** Daily closing prices, oldest → newest (≥ 20 bars recommended). */
  closes: number[]
}

export interface RiskParityWeight {
  ticker: string
  annualizedVol: number   // decimal, e.g. 0.22 = 22%
  rawInverseVol: number   // 1 / annualizedVol before normalization
  weight: number          // normalized weight summing to 1
  /** Suggested USD allocation given a total portfolio value. */
  allocation?: number
}

export interface RiskParityResult {
  weights: RiskParityWeight[]
  /** Weighted-average portfolio volatility (approximation, ignores correlation). */
  portfolioVol: number
  /** Herfindahl-Hirschman Index of weights (0 = maximally diverse, 1 = single asset). */
  hhi: number
}

// ────────────────────────────────────────────────────────────────
// Core
// ────────────────────────────────────────────────────────────────

const MIN_VOL = 0.01  // 1% floor to avoid division-by-zero on flat series

/**
 * Compute inverse-volatility weights for a set of assets.
 *
 * @param assets   Array of { ticker, closes }
 * @param totalValue  Optional portfolio value in USD — fills `allocation` field
 * @param volWindow  Number of trailing bars used for vol estimation (default: all)
 */
export function riskParityWeights(
  assets: RiskParityInput[],
  totalValue?: number,
  volWindow?: number,
): RiskParityResult {
  if (assets.length === 0) {
    return { weights: [], portfolioVol: 0, hhi: 0 }
  }

  const vols = assets.map(({ ticker, closes }) => {
    const slice = volWindow && volWindow < closes.length ? closes.slice(-volWindow) : closes
    const vol = Math.max(annualizedVolFromCloses(slice), MIN_VOL)
    return { ticker, vol }
  })

  const invVols = vols.map(({ ticker, vol }) => ({ ticker, vol, inv: 1 / vol }))
  const sumInv  = invVols.reduce((s, v) => s + v.inv, 0)

  const weights: RiskParityWeight[] = invVols.map(({ ticker, vol, inv }) => {
    const weight = inv / sumInv
    return {
      ticker,
      annualizedVol: vol,
      rawInverseVol: inv,
      weight,
      allocation: totalValue != null ? totalValue * weight : undefined,
    }
  })

  // Approximate portfolio vol (assumes independence — conservative lower bound)
  const portfolioVol = weights.reduce((s, w) => s + w.weight * w.annualizedVol, 0)

  // HHI of weights
  const hhi = weights.reduce((s, w) => s + w.weight * w.weight, 0)

  return { weights, portfolioVol, hhi }
}

/**
 * Rebalance deltas: given current allocations and new target weights,
 * compute the trades needed (positive = buy, negative = sell).
 *
 * @param current   Record of { ticker → current USD value }
 * @param targets   Output of `riskParityWeights` (with `allocation` filled)
 * @param threshold Minimum absolute change to act on (default 1% of portfolio)
 */
export function rebalanceDeltas(
  current: Record<string, number>,
  targets: RiskParityWeight[],
  threshold = 0.01,
): Array<{ ticker: string; deltaUsd: number; action: 'BUY' | 'SELL' | 'HOLD' }> {
  const totalTarget = targets.reduce((s, t) => s + (t.allocation ?? 0), 0)

  return targets
    .map((t) => {
      const currentVal = current[t.ticker] ?? 0
      const targetVal  = t.allocation ?? 0
      const delta = targetVal - currentVal
      const relChange = totalTarget > 0 ? Math.abs(delta) / totalTarget : 0
      const action = relChange < threshold ? 'HOLD' : delta > 0 ? 'BUY' : 'SELL'
      return { ticker: t.ticker, deltaUsd: delta, action } as const
    })
    .filter((d) => d.action !== 'HOLD')
}

/**
 * Equal-weight fallback — used when volatility data is insufficient.
 */
export function equalWeights(tickers: string[], totalValue?: number): RiskParityWeight[] {
  const n = tickers.length
  if (n === 0) return []
  return tickers.map((ticker) => ({
    ticker,
    annualizedVol: 0,
    rawInverseVol: 1,
    weight: 1 / n,
    allocation: totalValue != null ? totalValue / n : undefined,
  }))
}
