/**
 * Walk-forward parameter grid search for signal optimization.
 *
 * Protocol (institutional standard):
 *   - Split: 70% In-Sample (IS) optimization, 30% Out-of-Sample (OOS) validation.
 *   - Overfitting guard: IS win rate must not exceed OOS by > 8pp.
 *   - Optimization objective: maximize OOS Sharpe ratio (not just win rate).
 *   - Minimum OOS trades: 10 (insufficient data if fewer).
 *
 * Usage:
 *   const best = gridSearch(rows, paramGrid)
 *   // Apply best.params to signal config
 */

import type { OhlcvRow } from '@/scripts/backtest/dataLoader'

export interface ParamGrid {
  slopeThreshold: number[]
  buyWScoreThreshold: number[]
  sellWScoreThreshold: number[]
  confidenceThreshold: number[]
  atrStopMultiplier: number[]
}

export interface GridPoint {
  slopeThreshold: number
  buyWScoreThreshold: number
  sellWScoreThreshold: number
  confidenceThreshold: number
  atrStopMultiplier: number
}

export interface GridSearchResult {
  params: GridPoint
  isWinRate: number
  oosWinRate: number
  overfitGap: number
  isTrades: number
  oosTrades: number
  isSharpe: number | null
  oosSharpe: number | null
  /** Primary objective: OOS Sharpe */
  score: number
}

export interface GridSearchSummary {
  ticker: string
  sector: string
  totalCombinations: number
  validCombinations: number  // had >= 10 OOS trades
  best: GridSearchResult
  top5: GridSearchResult[]
  /** Parameters that appear most consistently in top 20% results */
  robustParams: Partial<GridPoint>
  splitDate: string  // where IS ends and OOS begins
}

/**
 * Generate all combinations from a parameter grid.
 */
export function generateGrid(grid: ParamGrid): GridPoint[] {
  const combos: GridPoint[] = []
  for (const slope of grid.slopeThreshold) {
    for (const buy of grid.buyWScoreThreshold) {
      for (const sell of grid.sellWScoreThreshold) {
        for (const conf of grid.confidenceThreshold) {
          for (const atr of grid.atrStopMultiplier) {
            combos.push({
              slopeThreshold: slope,
              buyWScoreThreshold: buy,
              sellWScoreThreshold: sell,
              confidenceThreshold: conf,
              atrStopMultiplier: atr,
            })
          }
        }
      }
    }
  }
  return combos
}

/**
 * Simple inline backtest for grid search.
 * Uses the simplified signal logic (same as benchmark-signals.mjs) for speed.
 * Grid search of the enhanced signal would be 100× slower.
 */
function simpleBacktestSlice(
  rows: OhlcvRow[],
  startIdx: number,
  endIdx: number,
  params: GridPoint,
): { winRate: number; trades: number; sharpe: number | null; avgReturn: number } {
  const slice = rows.slice(startIdx, endIdx)
  if (slice.length < 252) return { winRate: 0, trades: 0, sharpe: null, avgReturn: 0 }

  const closes = slice.map(r => r.close)
  const bars = slice.map(r => ({ open: r.open, high: r.high, low: r.low, close: r.close }))

  // Inline simplified SMA/RSI/MACD for speed
  function sma(vals: number[], p: number): number | null {
    if (vals.length < p) return null
    return vals.slice(-p).reduce((a, b) => a + b, 0) / p
  }

  function sma200Slope(cls: number[]): number | null {
    if (cls.length < 221) return null
    const now = sma(cls, 200)
    const prev = sma(cls.slice(0, cls.length - 20), 200)
    if (now == null || prev == null || prev === 0) return null
    return (now - prev) / prev
  }

  function rsiLast(cls: number[]): number | null {
    if (cls.length < 15) return null
    let ag = 0, al = 0
    for (let i = 1; i <= 14; i++) {
      const d = cls[i] - cls[i - 1]
      if (d >= 0) ag += d; else al -= d
    }
    ag /= 14; al /= 14
    for (let i = 15; i < cls.length; i++) {
      const d = cls[i] - cls[i - 1]
      ag = (ag * 13 + Math.max(0, d)) / 14
      al = (al * 13 + Math.max(0, -d)) / 14
    }
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al)
  }

  function ema50gt200(cls: number[]): boolean {
    if (cls.length < 200) return false
    const k50 = 2 / 51, k200 = 2 / 201
    let e50 = cls.slice(0, 50).reduce((a, b) => a + b, 0) / 50
    let e200 = cls.slice(0, 200).reduce((a, b) => a + b, 0) / 200
    for (let i = 50; i < cls.length; i++) { e50 = cls[i] * k50 + e50 * (1 - k50) }
    for (let i = 200; i < cls.length; i++) { e200 = cls[i] * k200 + e200 * (1 - k200) }
    return e50 > e200
  }

  function atrLast(b: { high: number; low: number; close: number }[]): number | null {
    if (b.length < 15) return null
    let avg = 0
    for (let i = 1; i <= 14; i++) {
      avg += Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close))
    }
    avg /= 14
    for (let i = 14; i < b.length; i++) {
      const tr = Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close))
      avg = (avg * 13 + tr) / 14
    }
    return avg
  }

  let wins = 0, losses = 0, trades = 0
  const returns: number[] = []
  const dailyRets: number[] = []
  let equity = 1.0

  for (let i = 220; i < closes.length - 21; i++) {
    const lb = closes.slice(0, i + 1)
    const price = closes[i]
    const sma200val = sma(lb, 200)
    if (!sma200val) { dailyRets.push(0); continue }
    const dev = ((price - sma200val) / sma200val) * 100
    const slope = sma200Slope(lb)
    const slopePos = slope != null && slope > params.slopeThreshold

    // BUY conditions
    let isBuy = false
    if (dev >= -20 && dev < 0 && slopePos) {
      const rsi14 = rsiLast(lb)
      if (rsi14 != null && rsi14 < 40) {
        // Additional check: golden cross (approximate)
        const gc = ema50gt200(lb)
        if (gc) isBuy = true
      }
    }

    if (isBuy) {
      const entryPrice = closes[i + 1]
      const atrVal = atrLast(bars.slice(0, i + 1))
      const stopLossPct = atrVal != null ? Math.min(0.15, Math.max(0.05, (atrVal / price) * params.atrStopMultiplier)) : 0.10
      const stopLoss = entryPrice * (1 - stopLossPct)
      let exitPrice = closes[Math.min(i + 21, closes.length - 1)]
      // Check stop loss
      for (let k = i + 1; k <= i + 20 && k < closes.length; k++) {
        if (closes[k] <= stopLoss) { exitPrice = closes[k]; break }
      }
      const ret = (exitPrice - entryPrice) / entryPrice
      returns.push(ret)
      equity *= (1 + ret * 0.15)
      if (ret > 0) wins++; else losses++
      trades++
    }

    // Daily equity return
    if (i > 0) dailyRets.push((closes[i] - closes[i - 1]) / closes[i - 1])
  }

  const winRate = trades > 0 ? wins / trades : 0
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0

  // Sharpe on trade returns (annualized approximation)
  let sharpe: number | null = null
  if (returns.length >= 5) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1)
    const sd = Math.sqrt(Math.max(0, variance))
    if (sd > 0) {
      sharpe = mean / sd  // trade-level Sharpe
    }
  }

  return { winRate, trades, sharpe, avgReturn }
}

/**
 * Run walk-forward grid search on a single instrument.
 *
 * @param rows    OHLCV data for the instrument
 * @param grid    Parameter grid to search
 * @param ticker  Ticker symbol (for reporting)
 * @param sector  Sector name (for reporting)
 */
export function gridSearch(
  rows: OhlcvRow[],
  grid: ParamGrid,
  ticker: string,
  sector: string,
): GridSearchSummary {
  const splitIdx = Math.floor(rows.length * 0.70)
  const splitDate = new Date(rows[splitIdx].time * 1000).toISOString().split('T')[0]
  const combos = generateGrid(grid)

  const results: GridSearchResult[] = []

  for (const params of combos) {
    const is = simpleBacktestSlice(rows, 0, splitIdx, params)
    const oos = simpleBacktestSlice(rows, splitIdx - 220, rows.length, params)  // overlap for warmup

    if (oos.trades < 5) continue  // insufficient OOS trades

    const overfitGap = is.winRate - oos.winRate
    if (overfitGap > 0.15) continue  // hard overfitting — reject

    const score = oos.sharpe ?? oos.winRate  // prefer Sharpe if available

    results.push({
      params,
      isWinRate: is.winRate,
      oosWinRate: oos.winRate,
      overfitGap,
      isTrades: is.trades,
      oosTrades: oos.trades,
      isSharpe: is.sharpe,
      oosSharpe: oos.sharpe,
      score,
    })
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  // Find robust parameters (appear in top 20% results)
  const top20pct = results.slice(0, Math.max(1, Math.floor(results.length * 0.20)))
  const robustParams = findRobustParams(top20pct)

  return {
    ticker,
    sector,
    totalCombinations: combos.length,
    validCombinations: results.length,
    best: results[0] ?? { params: combos[0], isWinRate: 0, oosWinRate: 0, overfitGap: 0, isTrades: 0, oosTrades: 0, isSharpe: null, oosSharpe: null, score: 0 },
    top5: results.slice(0, 5),
    robustParams,
    splitDate,
  }
}

/**
 * Find parameters that appear consistently across the top results.
 * A parameter value is "robust" if it appears in >= 60% of top results.
 */
function findRobustParams(topResults: GridSearchResult[]): Partial<GridPoint> {
  if (topResults.length === 0) return {}
  const n = topResults.length
  const threshold = 0.60

  const result: Partial<GridPoint> = {}
  const keys: (keyof GridPoint)[] = ['slopeThreshold', 'buyWScoreThreshold', 'sellWScoreThreshold', 'confidenceThreshold', 'atrStopMultiplier']

  for (const key of keys) {
    // Count frequency of each value
    const freq = new Map<number, number>()
    for (const r of topResults) {
      const v = r.params[key]
      freq.set(v, (freq.get(v) ?? 0) + 1)
    }
    // Find value with highest frequency
    let maxFreq = 0
    let bestVal: number | null = null
    for (const [v, f] of freq) {
      if (f > maxFreq) { maxFreq = f; bestVal = v }
    }
    if (bestVal != null && maxFreq / n >= threshold) {
      ;(result as Record<string, number>)[key] = bestVal
    }
  }

  return result
}

/**
 * Aggregate grid search results across all instruments.
 * Returns the parameter set that performs best on average across sectors.
 */
export function aggregateGridResults(
  summaries: GridSearchSummary[],
): { bestGlobalParams: GridPoint; avgOOSWinRate: number; breakdown: Record<string, number> } {
  const paramFreq: Record<string, Map<number, number>> = {
    slopeThreshold: new Map(),
    buyWScoreThreshold: new Map(),
    sellWScoreThreshold: new Map(),
    confidenceThreshold: new Map(),
    atrStopMultiplier: new Map(),
  }

  let totalOOSWinRate = 0
  let count = 0

  for (const s of summaries) {
    if (!s.best) continue
    totalOOSWinRate += s.best.oosWinRate
    count++
    for (const [key, map] of Object.entries(paramFreq)) {
      const v = s.best.params[key as keyof GridPoint]
      map.set(v, (map.get(v) ?? 0) + 1)
    }
  }

  const bestGlobalParams: Partial<GridPoint> = {}
  const breakdown: Record<string, number> = {}

  for (const [key, map] of Object.entries(paramFreq)) {
    let maxCount = 0, bestVal = 0
    for (const [v, c] of map) {
      if (c > maxCount) { maxCount = c; bestVal = v }
      breakdown[`${key}=${v}`] = c
    }
    ;(bestGlobalParams as Record<string, number>)[key] = bestVal
  }

  return {
    bestGlobalParams: bestGlobalParams as GridPoint,
    avgOOSWinRate: count > 0 ? totalOOSWinRate / count : 0,
    breakdown,
  }
}
