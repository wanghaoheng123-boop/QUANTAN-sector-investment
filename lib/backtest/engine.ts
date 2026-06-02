/**
 * Backtest engine — portfolio aggregation + walk-forward re-exports.
 * Single-instrument loop lives in `lib/backtest/core.ts` (breaks engine↔walkForward cycle).
 */

import { sortinoRatio } from '@/lib/quant/indicators'
import { getRiskFreeRateSync } from '@/lib/quant/riskFreeRate'

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

  const maxLen = results.length > 0
    ? Math.max(...results.map(r => r.equityCurve.length))
    : 0

  let sharpe: number | null = null
  let sortino: number | null = null
  let truePortfolioReturn = 0
  let truePortfolioAnnReturn = 0
  let combinedFinalEquity = 0
  let combinedInitialEquity = 0
  let portfolioMaxDdFromCurve = 0
  let portfolioMaxDdComputed = false

  if (maxLen > 30 && results.length > 0) {
    const combinedEquity: number[] = new Array(maxLen).fill(0)
    for (const r of results) {
      const curve = r.equityCurve
      if (curve.length === 0) continue
      const lastVal = curve[curve.length - 1]
      for (let i = 0; i < maxLen; i++) {
        combinedEquity[i] += i < curve.length ? curve[i] : lastVal
      }
    }

    const firstValid = combinedEquity.findIndex(v => v > 0)
    const lastValid = combinedEquity.length - 1 - [...combinedEquity].reverse().findIndex(v => v > 0)
    if (firstValid >= 0 && lastValid >= firstValid) {
      const initialCombined = combinedEquity[firstValid]
      const finalCombined = combinedEquity[lastValid]
      combinedInitialEquity = initialCombined
      combinedFinalEquity = finalCombined
      truePortfolioReturn = (finalCombined - initialCombined) / initialCombined
      const years = (lastValid - firstValid) / 252
      truePortfolioAnnReturn = years > 0 ? ((1 + truePortfolioReturn) ** (1 / years) - 1) : 0

      let peak = combinedEquity[firstValid]
      let maxDd = 0
      for (let i = firstValid; i <= lastValid; i++) {
        if (combinedEquity[i] > peak) peak = combinedEquity[i]
        if (peak > 0) {
          const dd = (peak - combinedEquity[i]) / peak
          if (dd > maxDd) maxDd = dd
        }
      }
      portfolioMaxDdFromCurve = maxDd
      portfolioMaxDdComputed = true

      const portfolioDailyReturns: number[] = []
      for (let i = firstValid + 1; i <= lastValid; i++) {
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
        const rfD = getRiskFreeRateSync() / 252
        if (sd > 1e-10) {
          sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
        }
        sortino = sortinoRatio(portfolioDailyReturns, rfD, 252)
      }
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
