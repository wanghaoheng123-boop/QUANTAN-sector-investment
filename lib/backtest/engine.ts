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
}

export function aggregatePortfolio(results: BacktestResult[], initialCapital: number): PortfolioSummary {
  const allTrades = results.flatMap(r => r.closedTrades)
  const winningTrades = allTrades.filter(t => (t.pnlPct ?? 0) > 0)
  const winRate = allTrades.length > 0 ? winningTrades.length / allTrades.length : 0
  const grossProfit = winningTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(allTrades.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = allTrades.length > 0 ? allTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / allTrades.length : 0

  // Sector aggregation
  const sectorMap: Record<string, { sumRet: number; sumAnn: number; tickers: string[]; count: number }> = {}
  for (const r of results) {
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
  const nonEmpty = results.filter(r => r.equityCurve.length > 0)
  const minLen = nonEmpty.length > 0
    ? Math.min(...nonEmpty.map(r => r.equityCurve.length))
    : 0

  // Portfolio annualization: 365 if ANY constituent trades 7 days/wk (crypto), else 252.
  // Mirrors runPortfolioBacktest; replaces the prior hardcoded 252.
  const annDays = nonEmpty.some(r => tradingDaysPerYear(r.ticker, r.sector) === 365) ? 365 : 252

  let sharpe: number | null = null
  let sortino: number | null = null
  let truePortfolioReturn = 0
  let truePortfolioAnnReturn = 0
  let combinedFinalEquity = 0
  let combinedInitialEquity = 0
  let portfolioMaxDdFromCurve = 0
  let portfolioMaxDdComputed = false

  if (minLen > 30 && nonEmpty.length > 0) {
    // End-aligned sum over the common window → combinedEquity is strictly positive
    // (sum of positive equities) at every point, so no findIndex/padding needed.
    const combinedEquity: number[] = new Array(minLen).fill(0)
    for (const r of nonEmpty) {
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
    : Math.max(...results.map(r => r.maxDrawdown), 0)

  const bnhAvg = results.reduce((s, r) => s + r.bnhReturn, 0) / Math.max(results.length, 1)
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
    totalInstruments: results.length,
    sectorReturns,
    instruments: results,
    initialCapital: combinedInitialEquity,
    finalCapital,
    alpha,
  }
}

export {
  computeOosRatio,
  walkForwardAnalysis,
  walkForwardSummary,
} from './walkForward'
export type { WFWWindow, WalkForwardSummary } from './walkForward'
