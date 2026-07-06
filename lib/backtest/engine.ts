/**
 * Backtest engine — portfolio aggregation + walk-forward re-exports.
 * Single-instrument loop lives in `lib/backtest/core.ts` (breaks engine↔walkForward cycle).
 */

import { sortinoRatio } from '@/lib/quant/indicators'
import { getRiskFreeRateSync } from '@/lib/quant/riskFreeRate'
import { tradingDaysPerYear } from './core'

export {
  TX_COST_BPS_PER_SIDE,
  TX_COST_PCT_PER_SIDE,
  computeBuyAndHoldReturn,
  backtestInstrument,
  tradingDaysPerYear,
} from './core'
export type { OhlcvRow, Trade, BacktestResult } from './core'

import type { BacktestResult } from './core'

// ─── Portfolio aggregator ─────────────────────────────────────────────────────

export interface PortfolioSummary {
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number
  winRate: number
  profitFactor: number
  avgTradeReturn: number
  totalTrades: number
  totalInstruments: number
  sectorReturns: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
  instruments: BacktestResult[]
  initialCapital: number
  finalCapital: number
  alpha: number  // Portfolio return minus B&H return
  /** Equal-weight average buy-and-hold return across the combinable constituents. */
  bnhAvg: number
  /**
   * Tickers dropped from the portfolio aggregation because their equity curve is
   * too short to join the common-window combine (≤ MIN_COMBINE_LEN points) —
   * typically recently-listed instruments that core.ts returned as a < 252-bar
   * STUB. Surfaced so callers can disclose them instead of the summary silently
   * collapsing to zeros. See aggregatePortfolio.
   */
  excludedTickers: string[]
}

/**
 * Minimum equity-curve length for a result to participate in the portfolio
 * combine. Matches the `minLen > MIN_COMBINE_LEN` window gate below. core.ts
 * emits a length-1 stub curve for < 252-bar instruments, so this also filters
 * those out — any real backtest (≥ 252 bars) yields ≫ 30 curve points.
 */
const MIN_COMBINE_LEN = 30

export function aggregatePortfolio(results: BacktestResult[], initialCapital: number): PortfolioSummary {
  // ── Exclude stub / short-history results before ANY aggregation ─────────────
  // The route's inclusion gate is only `rows.length >= 100`
  // (app/api/backtest/route.ts), but core.ts returns a length-1 STUB equityCurve
  // (`[initialCapital]`) for any instrument with < 252 bars. Such a stub cannot
  // join the end-aligned equity-curve combine — previously its length-1 curve
  // dragged `minLen` down to 1, failed the `minLen > 30` gate, and silently
  // collapsed the ENTIRE portfolio summary to zeros (totalReturn / finalCapital
  // = 0, Sharpe/Sortino null, alpha = -bnhAvg). We drop those results here and
  // DISCLOSE them via `excludedTickers`, so one recently-listed ticker can no
  // longer zero the portfolio. This makes the route's >=100 gate and the
  // engine's 252-bar stub threshold agree. For a full-history universe the
  // partition is a no-op (every curve ≫ MIN_COMBINE_LEN) → published WR /
  // benchmark numbers are unchanged.
  const combinable = results.filter(r => r.equityCurve.length > MIN_COMBINE_LEN)
  const excludedTickers = results
    .filter(r => r.equityCurve.length <= MIN_COMBINE_LEN)
    .map(r => r.ticker)

  const allTrades = combinable.flatMap(r => r.closedTrades)
  const winningTrades = allTrades.filter(t => (t.pnlPct ?? 0) > 0)
  const winRate = allTrades.length > 0 ? winningTrades.length / allTrades.length : 0
  const grossProfit = winningTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(allTrades.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = allTrades.length > 0 ? allTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / allTrades.length : 0

  // Sector aggregation
  const sectorMap: Record<string, { sumRet: number; sumAnn: number; tickers: string[]; count: number }> = {}
  for (const r of combinable) {
    if (!sectorMap[r.sector]) sectorMap[r.sector] = { sumRet: 0, sumAnn: 0, tickers: [], count: 0 }
    sectorMap[r.sector].sumRet += r.totalReturn
    sectorMap[r.sector].sumAnn += r.annualizedReturn
    sectorMap[r.sector].tickers.push(r.ticker)
    sectorMap[r.sector].count++
  }
  const sectorReturns: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }> = {}
  for (const [sector, data] of Object.entries(sectorMap)) {
    sectorReturns[sector] = {
      totalReturn: data.sumRet / Math.max(data.count, 1),
      annReturn: data.sumAnn / Math.max(data.count, 1),
      tickers: data.tickers,
    }
  }

  // Combine per-instrument equity curves over their COMMON window by END-alignment.
  // BacktestResult.equityCurve is a bare number[] (no dates), and every curve runs
  // through its final bar ("now"), so the k-th-from-last points line up by calendar
  // for same-exchange instruments. Using the common (min-length) window is the correct
  // equal-weight portfolio semantics — the portfolio only exists once ALL constituents
  // are tradeable — and it fixes the prior bug of forward-padding shorter curves with a
  // flat (zero-volatility) tail, which understated portfolio vol and inflated Sharpe.
  // RESIDUAL (documented follow-up): exact per-date alignment across MIXED trading
  // calendars (crypto 7d/wk vs equity 5d/wk) needs dated equity curves — add an
  // `equityDates` field to BacktestResult. Annualization below uses the portfolio calendar.
  const minLen = combinable.length > 0
    ? Math.min(...combinable.map(r => r.equityCurve.length))
    : 0

  // Portfolio annualization: 365 if ANY constituent trades 7 days/wk (crypto), else 252.
  // Mirrors runPortfolioBacktest; replaces the prior hardcoded 252.
  const annDays = combinable.some(r => tradingDaysPerYear(r.ticker, r.sector) === 365) ? 365 : 252

  let sharpe: number | null = null
  let sortino: number | null = null
  let truePortfolioReturn = 0
  let truePortfolioAnnReturn = 0
  let combinedFinalEquity = 0
  let combinedInitialEquity = 0
  let portfolioMaxDdFromCurve = 0
  let portfolioMaxDdComputed = false

  if (minLen > MIN_COMBINE_LEN && combinable.length > 0) {
    // End-aligned sum over the common window → combinedEquity is strictly positive
    // (sum of positive equities) at every point, so no findIndex/padding needed.
    const combinedEquity: number[] = new Array(minLen).fill(0)
    for (const r of combinable) {
      const curve = r.equityCurve
      const offset = curve.length - minLen
      for (let k = 0; k < minLen; k++) {
        combinedEquity[k] += curve[offset + k]
      }
    }

    const initialCombined = combinedEquity[0]
    const finalCombined = combinedEquity[minLen - 1]
    combinedInitialEquity = initialCombined
    combinedFinalEquity = finalCombined
    truePortfolioReturn = initialCombined > 0 ? (finalCombined - initialCombined) / initialCombined : 0
    const years = (minLen - 1) / annDays
    truePortfolioAnnReturn = years > 0 ? ((1 + truePortfolioReturn) ** (1 / years) - 1) : 0

    let peak = combinedEquity[0]
    let maxDd = 0
    for (let i = 0; i < minLen; i++) {
      if (combinedEquity[i] > peak) peak = combinedEquity[i]
      if (peak > 0) {
        const dd = (peak - combinedEquity[i]) / peak
        if (dd > maxDd) maxDd = dd
      }
    }
    portfolioMaxDdFromCurve = maxDd
    portfolioMaxDdComputed = true

    const portfolioDailyReturns: number[] = []
    for (let i = 1; i < minLen; i++) {
      if (combinedEquity[i - 1] > 0) {
        const ret = (combinedEquity[i] - combinedEquity[i - 1]) / combinedEquity[i - 1]
        if (Number.isFinite(ret)) portfolioDailyReturns.push(ret)
      }
    }

    if (portfolioDailyReturns.length > 30) {
      const n = portfolioDailyReturns.length
      const mean = portfolioDailyReturns.reduce((a, b) => a + b, 0) / n
      const variance = portfolioDailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1)
      const sd = Math.sqrt(Math.max(variance, 0))
      const rfD = getRiskFreeRateSync() / annDays
      if (sd > 1e-10) {
        sharpe = ((mean - rfD) / sd) * Math.sqrt(annDays)
      }
      sortino = sortinoRatio(portfolioDailyReturns, rfD, annDays)
    }
  }

  const maxDrawdown = portfolioMaxDdComputed
    ? portfolioMaxDdFromCurve
    : Math.max(...combinable.map(r => r.maxDrawdown), 0)

  // F-2: measure B&H over the SAME end-aligned common window as the combine
  // above. The old full-history per-instrument bnhReturn average compared
  // MISMATCHED windows (each instrument's entire history — warmup included —
  // vs the portfolio's common min-length window), skewing alpha whenever
  // histories have unequal lengths. Falls back to the legacy full-history
  // average when aligned curves are unavailable (synthetic fixtures / stubs)
  // or the combine didn't run.
  let bnhAvgAligned: number | null = null
  if (minLen > MIN_COMBINE_LEN && combinable.length > 0 &&
      combinable.every(r => r.bnhCurve != null && r.bnhCurve.length === r.equityCurve.length)) {
    let sum = 0
    let ok = true
    for (const r of combinable) {
      const curve = r.bnhCurve as number[]
      const start = curve[curve.length - minLen]
      const end = curve[curve.length - 1]
      if (!(start > 0) || !Number.isFinite(end)) { ok = false; break }
      sum += (end - start) / start
    }
    if (ok) bnhAvgAligned = sum / combinable.length
  }
  const bnhAvg = bnhAvgAligned ?? (combinable.reduce((s, r) => s + r.bnhReturn, 0) / Math.max(combinable.length, 1))
  const alpha = truePortfolioReturn - bnhAvg
  const finalCapital = combinedFinalEquity

  return {
    totalReturn: truePortfolioReturn,
    annualizedReturn: truePortfolioAnnReturn,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown,
    winRate,
    profitFactor,
    avgTradeReturn,
    totalTrades: allTrades.length,
    totalInstruments: combinable.length,
    sectorReturns,
    instruments: results,
    initialCapital: combinedInitialEquity,
    finalCapital,
    alpha,
    bnhAvg,
    excludedTickers,
  }
}

export {
  computeOosRatio,
  walkForwardAnalysis,
  walkForwardSummary,
} from './walkForward'
export type { WFWWindow, WalkForwardSummary } from './walkForward'
