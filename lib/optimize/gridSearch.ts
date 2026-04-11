/**
 * Strategy parameter optimizer — exhaustive grid search with walk-forward validation.
 *
 * Architecture:
 *   1. Define a parameter grid (cartesian product of discrete values per param).
 *   2. For each combination, run the provided `evaluate` function over the
 *      in-sample window of the price series (walk-forward: train N bars, test M bars).
 *   3. Rank combinations by the chosen objective metric (Sharpe, CAGR, etc.).
 *   4. Return the top-K results with out-of-sample metrics.
 *
 * Design decisions:
 *   - Pure synchronous computation — no I/O inside the optimizer.
 *   - The `evaluate` function is caller-supplied, keeping the optimizer agnostic
 *     to strategy logic (SMA crossover, RSI, ML ensemble, etc.).
 *   - Overfitting guard: mandatory out-of-sample (OOS) window; in-sample (IS)
 *     results are reported alongside OOS to expose is/oos degradation.
 *   - Progress callback: grid searches can be large — emit progress so callers
 *     can update a UI or log to console.
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

/** Axis: a single named parameter with an array of candidate values. */
export interface ParamAxis<T = number | string | boolean> {
  name: string
  values: T[]
}

/** A concrete parameter combination produced by the cartesian product. */
export type ParamSet = Record<string, number | string | boolean>

/** Performance metrics returned by the evaluate function. */
export interface BacktestMetrics {
  /** Annualized Sharpe ratio (risk-free = 0 by convention). */
  sharpe: number
  /** Compound Annual Growth Rate. */
  cagr: number
  /** Maximum drawdown (decimal, e.g. 0.25 = 25%). */
  maxDrawdown: number
  /** Percentage of winning trades. */
  winRate: number
  /** Total number of trades. */
  tradeCount: number
  /** Profit factor = gross profit / gross loss (0 if no losing trades). */
  profitFactor: number
  /** Any additional metrics the strategy wants to surface. */
  extra?: Record<string, number>
}

/**
 * Function signature for a strategy evaluator.
 *
 * @param closes   Daily closing prices (oldest → newest)
 * @param params   Concrete parameter set to evaluate
 * @returns        Performance metrics, or null if the params produce invalid results
 */
export type EvaluateFn = (closes: number[], params: ParamSet) => BacktestMetrics | null

/** Configuration for a walk-forward optimization run. */
export interface GridSearchConfig {
  /** Parameter axes to search (cartesian product = all combinations). */
  axes: ParamAxis[]
  /** Objective metric used for ranking. Default: 'sharpe'. */
  objective?: keyof BacktestMetrics
  /** Minimum number of in-sample bars (default: 252). */
  inSampleBars?: number
  /** Minimum number of out-of-sample bars (default: 63). */
  outOfSampleBars?: number
  /** Top-K results to return (default: 10). */
  topK?: number
  /** Called after each combination completes. */
  onProgress?: (completed: number, total: number) => void
}

export interface GridSearchResult {
  params: ParamSet
  inSample: BacktestMetrics
  outOfSample: BacktestMetrics | null
  /** IS/OOS Sharpe degradation (IS - OOS). High = overfitting. */
  sharpeDegradation: number | null
  rank: number
}

export interface GridSearchReport {
  results: GridSearchResult[]
  bestParams: ParamSet
  bestInSample: BacktestMetrics
  bestOutOfSample: BacktestMetrics | null
  totalCombinations: number
  validCombinations: number
  /** Wall-clock ms taken for the grid search. */
  elapsedMs: number
}

// ────────────────────────────────────────────────────────────────
// Cartesian product
// ────────────────────────────────────────────────────────────────

export function cartesianProduct(axes: ParamAxis[]): ParamSet[] {
  if (axes.length === 0) return [{}]
  const [first, ...rest] = axes
  const restProduct = cartesianProduct(rest)
  const result: ParamSet[] = []
  for (const val of first.values) {
    for (const combo of restProduct) {
      result.push({ [first.name]: val, ...combo })
    }
  }
  return result
}

// ────────────────────────────────────────────────────────────────
// Metric extraction helper
// ────────────────────────────────────────────────────────────────

function getMetricValue(metrics: BacktestMetrics, key: keyof BacktestMetrics): number {
  const v = metrics[key]
  if (typeof v === 'number') return v
  if (key === 'extra') return 0
  return 0
}

// ────────────────────────────────────────────────────────────────
// Grid search engine
// ────────────────────────────────────────────────────────────────

/**
 * Run an exhaustive parameter grid search with walk-forward validation.
 *
 * @param closes   Full price series (IS + OOS combined)
 * @param evaluate Strategy evaluation function
 * @param config   Search configuration
 */
export function gridSearch(
  closes: number[],
  evaluate: EvaluateFn,
  config: GridSearchConfig,
): GridSearchReport {
  const {
    axes,
    objective = 'sharpe',
    inSampleBars = 252,
    outOfSampleBars = 63,
    topK = 10,
    onProgress,
  } = config

  const minRequired = inSampleBars + outOfSampleBars
  if (closes.length < minRequired) {
    throw new Error(
      `Insufficient data: need ${minRequired} bars, got ${closes.length}. ` +
      `Reduce inSampleBars (${inSampleBars}) or outOfSampleBars (${outOfSampleBars}).`
    )
  }

  const combinations = cartesianProduct(axes)
  const total = combinations.length

  if (total === 0) {
    throw new Error('Grid produced 0 combinations — check your axes.')
  }

  const isCloses  = closes.slice(0, inSampleBars)
  const oosCloses = closes.slice(inSampleBars, inSampleBars + outOfSampleBars)

  const startMs = Date.now()
  const candidates: Array<{ params: ParamSet; is: BacktestMetrics; oos: BacktestMetrics | null }> = []

  for (let i = 0; i < combinations.length; i++) {
    const params = combinations[i]
    const isMetrics = evaluate(isCloses, params)
    if (isMetrics === null) {
      onProgress?.(i + 1, total)
      continue
    }

    const oosMetrics = evaluate(oosCloses, params)
    candidates.push({ params, is: isMetrics, oos: oosMetrics })
    onProgress?.(i + 1, total)
  }

  // Sort by IS objective metric (descending)
  candidates.sort((a, b) => getMetricValue(b.is, objective) - getMetricValue(a.is, objective))

  const topResults: GridSearchResult[] = candidates.slice(0, topK).map((c, idx) => {
    const isVal  = getMetricValue(c.is, objective)
    const oosVal = c.oos ? getMetricValue(c.oos, objective) : null
    return {
      params: c.params,
      inSample: c.is,
      outOfSample: c.oos,
      sharpeDegradation: oosVal != null ? isVal - oosVal : null,
      rank: idx + 1,
    }
  })

  const best = topResults[0]

  return {
    results: topResults,
    bestParams: best?.params ?? {},
    bestInSample: best?.inSample ?? {} as BacktestMetrics,
    bestOutOfSample: best?.outOfSample ?? null,
    totalCombinations: total,
    validCombinations: candidates.length,
    elapsedMs: Date.now() - startMs,
  }
}

// ────────────────────────────────────────────────────────────────
// Built-in simple SMA crossover evaluator
// (reference implementation — useful for testing & as a template)
// ────────────────────────────────────────────────────────────────

/**
 * Evaluates a basic SMA crossover strategy.
 *
 * Expected params: { fastPeriod: number, slowPeriod: number }
 *
 * Signal: BUY when fast crosses above slow; SELL when fast crosses below slow.
 * Sizing: 100% invested on BUY, 100% cash on SELL (no shorting).
 */
export function smaCrossoverEvaluator(closes: number[], params: ParamSet): BacktestMetrics | null {
  const fastPeriod = params['fastPeriod'] as number
  const slowPeriod = params['slowPeriod'] as number

  if (!Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod)) return null
  if (fastPeriod >= slowPeriod) return null
  if (closes.length < slowPeriod + 2) return null

  // Compute SMAs
  function sma(arr: number[], period: number, idx: number): number {
    let sum = 0
    for (let i = idx - period + 1; i <= idx; i++) sum += arr[i]
    return sum / period
  }

  const dailyReturns: number[] = []
  let inPosition = false
  let tradeCount = 0
  let wins = 0
  let entryPrice = 0
  let grossProfit = 0
  let grossLoss = 0

  for (let i = slowPeriod; i < closes.length - 1; i++) {
    const fastNow  = sma(closes, fastPeriod, i)
    const fastPrev = sma(closes, fastPeriod, i - 1)
    const slowNow  = sma(closes, slowPeriod, i)
    const slowPrev = sma(closes, slowPeriod, i - 1)

    const crossedAbove = fastPrev <= slowPrev && fastNow > slowNow
    const crossedBelow = fastPrev >= slowPrev && fastNow < slowNow

    if (crossedAbove && !inPosition) {
      inPosition = true
      entryPrice = closes[i + 1]
    } else if (crossedBelow && inPosition) {
      inPosition = false
      const exitPrice = closes[i + 1]
      const tradeReturn = (exitPrice - entryPrice) / entryPrice
      tradeCount++
      if (tradeReturn > 0) { wins++; grossProfit += tradeReturn }
      else                  { grossLoss += Math.abs(tradeReturn) }
    }

    const ret = inPosition
      ? Math.log(closes[i + 1] / closes[i])
      : 0
    dailyReturns.push(ret)
  }

  if (dailyReturns.length < 20) return null

  const mean   = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
  const varR   = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(dailyReturns.length - 1, 1)
  const stdDev = Math.sqrt(varR)
  const sharpe = stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252)
  const cagr   = Math.exp(mean * 252) - 1

  // Drawdown
  let peak = 0, equity = 0, maxDD = 0
  for (const r of dailyReturns) {
    equity += r
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDD) maxDD = dd
  }

  return {
    sharpe,
    cagr,
    maxDrawdown: maxDD,
    winRate: tradeCount > 0 ? wins / tradeCount : 0,
    tradeCount,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss,
  }
}
