/**
 * Backtest engine — pure computation, no API calls, no side effects.
 *
 * Walk-forward backtest using the combined signal from signals.ts.
 * Simulates a long-only portfolio with per-instrument position sizing,
 * stop-loss, and portfolio-level max-drawdown circuit breaker.
 */

import { combinedSignal, DEFAULT_CONFIG } from './signals'
import type { BacktestConfig } from './signals'
import { closesFromRows, barsFromRows } from './dataLoader'
import type { OhlcvRow } from './dataLoader'

export interface Trade {
  date: string
  ticker: string
  sector: string
  action: 'BUY' | 'SELL'
  entryPrice: number
  exitPrice: number
  shares: number
  value: number
  regime: string
  dipSignal: string
  confidence: number
  pnlPct: number | null
  reason: string
}

export interface BacktestResult {
  ticker: string
  sector: string
  initialPrice: number
  finalPrice: number
  totalReturn: number       // fraction, e.g. 0.2847 = +28.47%
  annualizedReturn: number   // CAGR fraction
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number       // fraction
  winRate: number          // fraction of closed profitable trades
  profitFactor: number     // gross profit / gross loss
  avgTradeReturn: number    // average closed trade return
  totalTrades: number
  closedTrades: Trade[]
  openTrade: Trade | null   // current open position if any
  dailyReturns: number[]    // equity curve daily returns
  equityCurve: number[]     // equity at each bar
  days: number
  confidenceAvg: number      // average signal confidence on entry
  stopLossPct: number
  bnhReturn: number         // buy-and-hold return for comparison
  excessReturn: number      // strategy - bnh (alpha)
}

interface PortfolioState {
  capital: number
  position: number   // shares held
  avgCost: number    // cost basis per share
  peakEquity: number
  equityHistory: number[]
  dailyReturns: number[]
  closedTrades: Trade[]
  openTrade: Trade | null
  stopLossPrice: number
  // Running stats for Kelly
  tradeWins: number
  tradeLosses: number
  totalWinValue: number
  totalLossValue: number
  confidenceSum: number
  confidenceCount: number
}

function newPortfolio(initialCapital: number): PortfolioState {
  return {
    capital: initialCapital,
    position: 0,
    avgCost: 0,
    peakEquity: initialCapital,
    equityHistory: [initialCapital],
    dailyReturns: [],
    closedTrades: [],
    openTrade: null,
    stopLossPrice: 0,
    tradeWins: 0,
    tradeLosses: 0,
    totalWinValue: 0,
    totalLossValue: 0,
    confidenceSum: 0,
    confidenceCount: 0,
  }
}

function equity(state: PortfolioState): number {
  if (state.position === 0) return state.capital
  return state.capital + state.position * state.avgCost
}

/**
 * Run a walk-forward backtest for a single instrument.
 */
export function backtestInstrument(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  config: Partial<BacktestConfig> = {},
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const initialCapital = cfg.initialCapital

  if (rows.length < 252) {
    // Need at least 1 year of data
    return {
      ticker, sector,
      initialPrice: rows[0]?.close ?? 0,
      finalPrice: rows[rows.length - 1]?.close ?? 0,
      totalReturn: 0,
      annualizedReturn: 0,
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
      avgTradeReturn: 0,
      totalTrades: 0,
      closedTrades: [],
      openTrade: null,
      dailyReturns: [],
      equityCurve: [initialCapital],
      days: 0,
      confidenceAvg: 0,
      stopLossPct: cfg.stopLossPct,
      bnhReturn: 0,
      excessReturn: 0,
    }
  }

  const closes = closesFromRows(rows)
  const bars = barsFromRows(rows)
  let state = newPortfolio(initialCapital)

  // Walk forward day by day
  for (let i = 200; i < rows.length; i++) {
    const row = rows[i]
    const date = new Date(row.time * 1000).toISOString().split('T')[0]
    const price = row.close
    const lookback = closes.slice(0, i + 1) // only data up to today
    const barLookback = bars.slice(0, i + 1)

    // Check stop-loss on open position
    if (state.openTrade !== null) {
      const sl = state.openTrade.action === 'BUY'
        ? state.openTrade.entryPrice * (1 - cfg.stopLossPct)
        : state.openTrade.entryPrice * (1 + cfg.stopLossPct)
      if ((state.openTrade.action === 'BUY' && price <= sl) ||
          (state.openTrade.action === 'SELL' && price >= sl)) {
        // Stop-loss triggered
        const pnlPct = state.openTrade.action === 'BUY'
          ? (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - price) / state.openTrade.entryPrice
        state.capital += state.position * price
        state.position = 0
        state.openTrade.exitPrice = price
        state.openTrade.pnlPct = pnlPct
        state.closedTrades.push({ ...state.openTrade })
        state.openTrade = null
        state.stopLossPrice = 0
        // Record daily return
        const eq = equity(state)
        if (state.equityHistory.length > 0) {
          const prev = state.equityHistory[state.equityHistory.length - 1]
          if (prev > 0) state.dailyReturns.push((eq - prev) / prev)
        }
        state.equityHistory.push(eq)
        continue
      }
    }

    // Check portfolio-level max drawdown
    const eq = equity(state)
    if (eq > state.peakEquity) state.peakEquity = eq
    const dd = (state.peakEquity - eq) / state.peakEquity
    if (dd >= cfg.maxDrawdownCap) {
      // Circuit breaker — close all positions
      if (state.openTrade !== null) {
        const pnlPct = state.openTrade.action === 'BUY'
          ? (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - price) / state.openTrade.entryPrice
        state.capital += state.position * price
        state.position = 0
        state.openTrade.exitPrice = price
        state.openTrade.pnlPct = pnlPct
        state.closedTrades.push({ ...state.openTrade })
        state.openTrade = null
        state.stopLossPrice = 0
      }
      const eqAfter = equity(state)
      const eqFinal = equity(state)
      if (state.equityHistory.length > 0) {
        const prev = state.equityHistory[state.equityHistory.length - 1]
        if (prev > 0) state.dailyReturns.push((eqFinal - prev) / prev)
      }
      state.equityHistory.push(eqFinal)
      continue
    }

    // Compute combined signal
    const signal = combinedSignal(ticker, date, price, lookback, barLookback, cfg)

    if (signal.action === 'BUY' && state.openTrade === null) {
      // Open BUY position
      const kellyFrac = Math.min(signal.KellyFraction, 0.50) // cap at 50%
      const allocation = state.capital * kellyFrac
      const shares = Math.floor(allocation / price)
      if (shares <= 0) {
        // Record equity even on no-trade day
        const eqNow = equity(state)
        if (state.equityHistory.length > 0) {
          const prev = state.equityHistory[state.equityHistory.length - 1]
          if (prev > 0) state.dailyReturns.push((eqNow - prev) / prev)
        }
        state.equityHistory.push(eqNow)
        continue
      }
      const cost = shares * price
      state.capital -= cost
      state.position += shares
      state.avgCost = price
      state.openTrade = {
        date,
        ticker,
        sector,
        action: 'BUY',
        entryPrice: price,
        exitPrice: 0,
        shares,
        value: cost,
        regime: signal.regime.label,
        dipSignal: signal.regime.dipSignal,
        confidence: signal.confidence,
        pnlPct: null,
        reason: signal.reason,
      }
      state.stopLossPrice = price * (1 - cfg.stopLossPct)
      state.confidenceSum += signal.confidence
      state.confidenceCount++

    } else if (signal.action === 'SELL' && state.openTrade !== null) {
      // Close position
      const proceeds = state.position * price
      const pnlPct = (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) {
        state.tradeWins++
        state.totalWinValue += proceeds
      } else {
        state.tradeLosses++
        state.totalLossValue += proceeds
      }
      state.capital += proceeds
      state.openTrade.exitPrice = price
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0
      state.openTrade = null
      state.stopLossPrice = 0

    } else {
      // No signal — hold equity
      const eqNow = equity(state)
      if (state.equityHistory.length > 0) {
        const prev = state.equityHistory[state.equityHistory.length - 1]
        if (prev > 0) state.dailyReturns.push((eqNow - prev) / prev)
      }
      state.equityHistory.push(eqNow)
    }
  }

  // Close any remaining open position at final price
  const finalPrice = rows[rows.length - 1].close
  if (state.openTrade !== null) {
    const pnlPct = (finalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
    if (pnlPct > 0) {
      state.tradeWins++; state.totalWinValue += state.position * finalPrice
    } else {
      state.tradeLosses++; state.totalLossValue += state.position * finalPrice
    }
    state.capital += state.position * finalPrice
    state.openTrade.exitPrice = finalPrice
    state.openTrade.pnlPct = pnlPct
    state.closedTrades.push({ ...state.openTrade })
    state.position = 0
    state.openTrade = null
  }

  // Final equity
  const finalEquity = state.capital
  const days = rows.length

  // Compute performance metrics
  const totalReturn = (finalEquity - initialCapital) / initialCapital
  const years = days / 252
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0

  // Buy-and-hold return
  const initialPrice = rows[0].close
  const bnhReturn = (finalPrice - initialPrice) / initialPrice

  // Max drawdown on equity curve
  let peak = initialCapital
  let maxDd = 0
  for (const eq of state.equityHistory) {
    if (eq > peak) peak = eq
    const dd = (peak - eq) / peak
    if (dd > maxDd) maxDd = dd
  }

  // Win rate
  const closed = state.closedTrades.filter(t => t.pnlPct !== null)
  const winningTrades = closed.filter(t => (t.pnlPct ?? 0) > 0)
  const winRate = closed.length > 0 ? winningTrades.length / closed.length : 0

  // Profit factor
  const grossProfit = closed.filter(t => (t.pnlPct ?? 0) > 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(closed.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  // Average trade return
  const avgTradeReturn = closed.length > 0
    ? closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closed.length
    : 0

  // Sharpe ratio (annualized)
  let sharpe: number | null = null
  if (state.dailyReturns.length > 30) {
    const mean = state.dailyReturns.reduce((a, b) => a + b, 0) / state.dailyReturns.length
    const variance = state.dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, state.dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    if (sd > 0) {
      const rfDaily = 0.04 / 252
      const excess = state.dailyReturns.map(x => x - rfDaily)
      const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length
      sharpe = (meanExcess / sd) * Math.sqrt(252)
    }
  }

  // Sortino ratio
  let sortino: number | null = null
  if (state.dailyReturns.length > 30) {
    const mean = state.dailyReturns.reduce((a, b) => a + b, 0) / state.dailyReturns.length
    const neg = state.dailyReturns.filter(x => x < 0)
    if (neg.length > 0) {
      const downSd = Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / neg.length)
      if (downSd > 0) {
        const rfDaily = 0.04 / 252
        sortino = ((mean - rfDaily) / downSd) * Math.sqrt(252)
      }
    }
  }

  const confidenceAvg = state.confidenceCount > 0 ? state.confidenceSum / state.confidenceCount : 0

  return {
    ticker,
    sector,
    initialPrice,
    finalPrice,
    totalReturn,
    annualizedReturn,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown: maxDd,
    winRate,
    profitFactor,
    avgTradeReturn,
    totalTrades: closed.length,
    closedTrades: closed,
    openTrade: state.openTrade,
    dailyReturns: state.dailyReturns,
    equityCurve: state.equityHistory,
    days,
    confidenceAvg,
    stopLossPct: cfg.stopLossPct,
    bnhReturn,
    excessReturn: totalReturn - bnhReturn,
  }
}

/**
 * Aggregate backtest results across multiple instruments into a portfolio summary.
 */
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
  sectorReturns: Record<string, { return: number; tickers: string[]; annReturn: number }>
  instruments: BacktestResult[]
  initialCapital: number
  finalCapital: number
}

export function aggregatePortfolio(results: BacktestResult[], initialCapital: number): PortfolioSummary {
  // Weighted average daily returns (equal weight per instrument)
  const minLen = Math.min(...results.map(r => r.dailyReturns.length))
  let combinedDailyReturns: number[] = []
  for (let i = 0; i < minLen; i++) {
    const avg = results.reduce((s, r) => s + (r.dailyReturns[i] ?? 0), 0) / results.length
    combinedDailyReturns.push(avg)
  }

  const totalReturn = (combinedDailyReturns.length > 0)
    ? combinedDailyReturns.reduce((s, r) => s * (1 + r), 1) - 1
    : 0

  const years = results.length > 0 ? (results[0].days / 252) : 0
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0

  // Portfolio-level metrics
  const maxDrawdown = Math.max(...results.map(r => r.maxDrawdown))
  const winningTrades = results.flatMap(r => r.closedTrades).filter(t => (t.pnlPct ?? 0) > 0)
  const allClosedTrades = results.flatMap(r => r.closedTrades)
  const winRate = allClosedTrades.length > 0 ? winningTrades.length / allClosedTrades.length : 0
  const grossProfit = winningTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0)
  const grossLoss = Math.abs(allClosedTrades.filter(t => (t.pnlPct ?? 0) < 0).reduce((s, t) => s + (t.pnlPct ?? 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = allClosedTrades.length > 0
    ? allClosedTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / allClosedTrades.length
    : 0

  // Sharpe on combined daily returns
  let sharpe: number | null = null
  if (combinedDailyReturns.length > 30) {
    const mean = combinedDailyReturns.reduce((a, b) => a + b, 0) / combinedDailyReturns.length
    const variance = combinedDailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, combinedDailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    if (sd > 0) {
      const rfDaily = 0.04 / 252
      sharpe = (((mean - rfDaily) / sd) * Math.sqrt(252))
    }
  }

  let sortino: number | null = null
  if (combinedDailyReturns.length > 30) {
    const mean = combinedDailyReturns.reduce((a, b) => a + b, 0) / combinedDailyReturns.length
    const neg = combinedDailyReturns.filter(x => x < 0)
    if (neg.length > 0) {
      const downSd = Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / neg.length)
      if (downSd > 0) {
        const rfDaily = 0.04 / 252
        sortino = ((mean - rfDaily) / downSd) * Math.sqrt(252)
      }
    }
  }

  // Sector aggregation
  const sectorMap: Record<string, { total: number; count: number; tickers: string[]; annTotal: number }> = {}
  for (const r of results) {
    if (!sectorMap[r.sector]) sectorMap[r.sector] = { total: 0, count: 0, tickers: [], annTotal: 0 }
    sectorMap[r.sector].total += r.totalReturn
    sectorMap[r.sector].annTotal += r.annualizedReturn
    sectorMap[r.sector].count++
    sectorMap[r.sector].tickers.push(r.ticker)
  }
  const sectorReturns: Record<string, { return: number; tickers: string[]; annReturn: number }> = {}
  for (const [sector, data] of Object.entries(sectorMap)) {
    sectorReturns[sector] = {
      return: data.total / data.count,
      tickers: data.tickers,
      annReturn: data.annTotal / data.count,
    }
  }

  const finalCapital = initialCapital * (1 + totalReturn)

  return {
    totalReturn,
    annualizedReturn,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown,
    winRate,
    profitFactor,
    avgTradeReturn,
    totalTrades: allClosedTrades.length,
    totalInstruments: results.length,
    sectorReturns,
    instruments: results,
    initialCapital,
    finalCapital,
  }
}
