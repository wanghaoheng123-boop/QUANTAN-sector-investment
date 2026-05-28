/**
 * Canonical benchmark evaluator — a simplified, tunable dip-buy *replay* used
 * for fast in-memory parameter search by optimize-batch.ts (no subprocess per
 * combo).
 *
 * ⚠️ This is a RESEARCH PROXY, NOT the production signal. The production
 * canonical path is `resolveBacktestSignal()` (see lib/backtest/SIGNAL_SSOT.md)
 * benchmarked by scripts/benchmark-signals.ts. A high replay WR here is a lead
 * for further investigation, not a production result — the two signals are
 * different implementations. Do not wire `DEFAULT_CANONICAL_PARAMS` into any
 * production code path; they exist only to seed the optimizer's search.
 */

export interface CanonicalSignalParams {
  /** Min 200SMA slope (fraction) for BUY */
  slopeThreshold: number
  /** RSI must be below this for BUY */
  rsiBuyMax: number
  /** SMA deviation lower bound (%) for dip zone */
  dipLowerPct: number
  /** SMA deviation upper bound (%) for dip zone */
  dipUpperPct: number
  /** Deviation % triggering SELL (overbought) */
  overboughtSellPct: number
  /** Deviation % for falling-knife SELL */
  fallingKnifeLowerPct: number
  /** Slope below this triggers falling-knife SELL */
  fallingKnifeSlope: number
  /** Forward hold period in trading days */
  holdDays: number
}

/** Pre-2026-05-26 production baseline (57.26% WR). */
export const LEGACY_CANONICAL_PARAMS: CanonicalSignalParams = {
  slopeThreshold: 0.005,
  rsiBuyMax: 40,
  dipLowerPct: -20,
  dipUpperPct: -2,
  overboughtSellPct: 20,
  fallingKnifeLowerPct: -15,
  fallingKnifeSlope: -0.005,
  holdDays: 20,
}

/**
 * Best replay-WR param set found by batch iter-199 (rounded). RESEARCH SEED ONLY
 * — these are the optimizer's best guess against the replay proxy, never promoted
 * to production (the auto-promote-to-.mjs step was removed; see PR #24 review).
 */
export const DEFAULT_CANONICAL_PARAMS: CanonicalSignalParams = {
  slopeThreshold: 0.01,
  rsiBuyMax: 36,
  dipLowerPct: -24,
  dipUpperPct: -4,
  overboughtSellPct: 22,
  fallingKnifeLowerPct: -15,
  fallingKnifeSlope: -0.008,
  holdDays: 29,
}

export interface CandleRow {
  close: number
}

export interface CanonicalBenchResult {
  aggregateWinRate: number
  avgWinRatePerInstrument: number
  totalBuySignals: number
  totalWins: number
  totalLosses: number
  instrumentsWithTrades: number
  totalInstruments: number
  avgReturnPerSignal: number
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  return values.slice(-period).reduce((a, b) => a + b, 0) / period
}

function rsi(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN)
  if (closes.length < period + 1) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

function sma200Slope(closes: number[]): number | null {
  if (closes.length < 221) return null
  const now = sma(closes, 200)
  const prev = sma(closes.slice(0, closes.length - 20), 200)
  if (now == null || prev == null || prev === 0) return null
  return (now - prev) / prev
}

function sma200Dev(price: number, sma200val: number): number | null {
  if (!Number.isFinite(sma200val) || sma200val <= 0) return null
  return ((price - sma200val) / sma200val) * 100
}

export type SignalAction = 'BUY' | 'SELL' | 'HOLD'

export function generateCanonicalSignal(
  closes: number[],
  i: number,
  params: CanonicalSignalParams,
): SignalAction {
  if (i < 200) return 'HOLD'
  const lookback = closes.slice(0, i + 1)
  const sma200val = sma(lookback, 200)
  if (sma200val == null) return 'HOLD'
  const price = closes[i]
  const dev = sma200Dev(price, sma200val)
  const slope = sma200Slope(lookback)
  const rsiVals = rsi(lookback)
  const rsi14 = rsiVals[rsiVals.length - 1]

  if (dev == null) return 'HOLD'

  const slopePos = slope != null && slope > params.slopeThreshold
  if (dev >= params.dipLowerPct && dev < params.dipUpperPct && slopePos) {
    if (Number.isFinite(rsi14) && rsi14 < params.rsiBuyMax) return 'BUY'
  }
  if (dev > params.overboughtSellPct) return 'SELL'
  if (dev < params.fallingKnifeLowerPct && (slope == null || slope < params.fallingKnifeSlope)) {
    return 'SELL'
  }
  return 'HOLD'
}

export function evaluateCanonicalBenchmark(
  datasets: Array<{ ticker: string; closes: number[] }>,
  params: CanonicalSignalParams = DEFAULT_CANONICAL_PARAMS,
): CanonicalBenchResult {
  let totalBuySignals = 0
  let totalWins = 0
  let totalLosses = 0
  let instrumentsWithTrades = 0
  const allReturns: number[] = []
  const perInstrumentWR: number[] = []

  const hold = params.holdDays

  for (const { closes } of datasets) {
    if (closes.length < 252) continue

    let wins = 0
    let losses = 0
    let buyCount = 0

    for (let i = 200; i < closes.length - hold - 1; i++) {
      const signal = generateCanonicalSignal(closes, i, params)
      if (signal === 'BUY') {
        buyCount++
        const entryPrice = closes[i + 1]
        const exitPrice = closes[Math.min(i + hold + 1, closes.length - 1)]
        const ret = (exitPrice - entryPrice) / entryPrice
        allReturns.push(ret)
        if (ret > 0) wins++
        else losses++
      }
    }

    if (buyCount > 0) {
      instrumentsWithTrades++
      perInstrumentWR.push(wins / buyCount)
    }
    totalBuySignals += buyCount
    totalWins += wins
    totalLosses += losses
  }

  const aggregateWinRate = totalBuySignals > 0 ? totalWins / totalBuySignals : 0
  const avgWinRatePerInstrument =
    perInstrumentWR.length > 0
      ? perInstrumentWR.reduce((a, b) => a + b, 0) / perInstrumentWR.length
      : 0
  const avgReturnPerSignal =
    allReturns.length > 0 ? allReturns.reduce((a, b) => a + b, 0) / allReturns.length : 0

  return {
    aggregateWinRate,
    avgWinRatePerInstrument,
    totalBuySignals,
    totalWins,
    totalLosses,
    instrumentsWithTrades,
    totalInstruments: datasets.length,
    avgReturnPerSignal,
  }
}
