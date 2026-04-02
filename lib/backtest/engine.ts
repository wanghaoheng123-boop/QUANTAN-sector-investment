/**
 * Backtest engine — pure computation, no API calls, no side effects.
 * Used by Next.js API routes and the CLI runner.
 */

import type { OhlcBar } from '@/lib/quant/technicals'
import { combinedSignal, DEFAULT_CONFIG, atr, type BacktestConfig } from './signals'

export interface OhlcvRow extends OhlcBar {
  time: number
  volume: number
}

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
  atrAtrPctAtEntry?: number
  highestPriceAfterEntry?: number
}

export interface BacktestResult {
  ticker: string
  sector: string
  initialPrice: number
  finalPrice: number
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number
  winRate: number
  profitFactor: number
  avgTradeReturn: number
  totalTrades: number
  closedTrades: Trade[]
  openTrade: Trade | null
  dailyReturns: number[]
  equityCurve: number[]
  days: number
  confidenceAvg: number
  stopLossPct: number
  bnhReturn: number
  excessReturn: number
}

interface PortfolioState {
  capital: number
  position: number
  avgCost: number
  peakEquity: number
  equityHistory: number[]
  dailyReturns: number[]
  closedTrades: Trade[]
  openTrade: Trade | null
  tradeWins: number
  tradeLosses: number
  grossProfit: number
  grossLoss: number
  confidenceSum: number
  confidenceCount: number
}

function newPortfolio(initialCapital: number): PortfolioState {
  return {
    capital: initialCapital, position: 0, avgCost: 0,
    peakEquity: initialCapital,
    equityHistory: [initialCapital],
    dailyReturns: [],
    closedTrades: [],
    openTrade: null,
    tradeWins: 0, tradeLosses: 0,
    grossProfit: 0, grossLoss: 0,
    confidenceSum: 0, confidenceCount: 0,
  }
}

function currentEquity(state: PortfolioState): number {
  return state.capital + state.position * state.avgCost
}

/** Walk-forward backtest for a single instrument. */
export function backtestInstrument(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  config: Partial<BacktestConfig> = {},
): BacktestResult {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const initialCapital = cfg.initialCapital

  if (rows.length < 252) {
    return {
      ticker, sector,
      initialPrice: rows[0]?.close ?? 0, finalPrice: rows[rows.length - 1]?.close ?? 0,
      totalReturn: 0, annualizedReturn: 0, sharpeRatio: null, sortinoRatio: null,
      maxDrawdown: 0, winRate: 0, profitFactor: 0, avgTradeReturn: 0,
      totalTrades: 0, closedTrades: [], openTrade: null,
      dailyReturns: [], equityCurve: [initialCapital],
      days: rows.length, confidenceAvg: 0, stopLossPct: cfg.stopLossPct,
      bnhReturn: 0, excessReturn: 0,
    }
  }

  let state = newPortfolio(initialCapital)
  const closes = rows.map(r => r.close)
  const bars: OhlcBar[] = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))

  // Pre-compute ATR for all bars (14-period, no look-ahead)
  const atrVals = atr(bars, 14)

  // Walk forward day by day (need 200 bars warmup)
  for (let i = 200; i < rows.length; i++) {
    const row = rows[i]
    const date = new Date(row.time * 1000).toISOString().split('T')[0]
    const price = row.close
    // Use only data up to today (no look-ahead bias)
    const lookbackCloses = closes.slice(0, i + 1)
    const lookbackBars = bars.slice(0, i + 1)

    // ── ATR-adaptive stop-loss + trailing stop ──
    if (state.openTrade) {
      // ATR% at entry for adaptive stop
      const atrAtEntry = state.openTrade.atrAtrPctAtEntry ?? 0.10
      // Adaptive stop: 1.5x ATR%, floored at 5%, capped at 15%
      const atrStopPct = Math.max(0.05, Math.min(0.15, 1.5 * atrAtEntry))
      const stopPx = state.openTrade.action === 'BUY'
        ? state.openTrade.entryPrice * (1 - atrStopPct)
        : state.openTrade.entryPrice * (1 + atrStopPct)

      // Trailing stop: track highest price after BUY entry
      if (state.openTrade.action === 'BUY') {
        const peakPrice = state.openTrade.highestPriceAfterEntry ?? state.openTrade.entryPrice
        state.openTrade.highestPriceAfterEntry = Math.max(peakPrice, price)
        // Profit measured from entry
        const profitFromEntry = (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
        // 2x ATR profit → raise stop to break-even
        const atrVal = atrVals[i] ?? 0
        const twoAtrProfit = (2 * atrVal) / state.openTrade.entryPrice
        const fourAtrProfit = (4 * atrVal) / state.openTrade.entryPrice
        if (profitFromEntry >= twoAtrProfit) {
          // Raise stop to break-even
          const trailStopPx = state.openTrade.entryPrice * (1 + 0.005) // just above break-even
          if (price <= trailStopPx) {
            const pnlPct = (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
            state.capital += state.position * price
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.openTrade.exitPrice = price
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state))
            continue
          }
        }
        // 4x ATR profit → tighten to lock in 1x ATR gain
        if (profitFromEntry >= fourAtrProfit) {
          const lockStopPx = price - atrVal  // lock in 1x ATR profit
          if (price <= lockStopPx) {
            const pnlPct = (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
            state.capital += state.position * price
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.openTrade.exitPrice = price
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state))
            continue
          }
        }
      }

      // Primary stop-loss check
      if ((state.openTrade.action === 'BUY' && price <= stopPx) ||
          (state.openTrade.action === 'SELL' && price >= stopPx)) {
        const pnlPct = state.openTrade.action === 'BUY'
          ? (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - price) / state.openTrade.entryPrice
        state.capital += state.position * price
        if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
        else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
        state.openTrade.exitPrice = price
        state.openTrade.pnlPct = pnlPct
        state.closedTrades.push({ ...state.openTrade })
        state.position = 0; state.avgCost = 0; state.openTrade = null
        const eq = currentEquity(state)
        state.equityHistory.push(eq)
        continue
      }
    }

    // ── Portfolio max-drawdown circuit breaker ──
    const eq = currentEquity(state)
    if (eq > state.peakEquity) state.peakEquity = eq
    const dd = (state.peakEquity - eq) / state.peakEquity
    if (dd >= cfg.maxDrawdownCap && state.openTrade) {
      const pnlPct = state.openTrade.action === 'BUY'
        ? (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
        : (state.openTrade.entryPrice - price) / state.openTrade.entryPrice
      state.capital += state.position * price
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.openTrade.exitPrice = price
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentEquity(state))
      continue
    }

    // ── Signal generation ──
    const signal = combinedSignal(ticker, date, price, lookbackCloses, lookbackBars, cfg)

    if (signal.action === 'BUY' && !state.openTrade) {
      const kellyFrac = Math.min(signal.KellyFraction, 0.50)
      const allocation = state.capital * kellyFrac
      const shares = Math.floor(allocation / price)
      if (shares <= 0) {
        state.equityHistory.push(currentEquity(state))
        continue
      }
      state.capital -= shares * price
      state.position += shares
      state.avgCost = price
      state.openTrade = {
        date, ticker, sector,
        action: 'BUY',
        entryPrice: price,
        exitPrice: 0,
        shares, value: shares * price,
        regime: signal.regime.label, dipSignal: signal.regime.dipSignal,
        confidence: signal.confidence, pnlPct: null, reason: signal.reason,
        atrAtrPctAtEntry: Number.isFinite(atrVals[i]) ? (atrVals[i] / price) * 100 : 0.10,
        highestPriceAfterEntry: price,
      }
      state.confidenceSum += signal.confidence
      state.confidenceCount++
      state.equityHistory.push(currentEquity(state))

    } else if (signal.action === 'SELL' && state.openTrade) {
      const proceeds = state.position * price
      const pnlPct = (price - state.openTrade.entryPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.capital += proceeds
      state.openTrade.exitPrice = price
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentEquity(state))

    } else {
      state.equityHistory.push(currentEquity(state))
    }
  }

  // ── Close remaining open position at final price ──
  const finalPrice = rows[rows.length - 1].close
  if (state.openTrade) {
    const pnlPct = (finalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
    if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
    else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
    state.capital += state.position * finalPrice
    state.openTrade.exitPrice = finalPrice
    state.openTrade.pnlPct = pnlPct
    state.closedTrades.push({ ...state.openTrade })
    state.position = 0
  }

  const finalEquity = state.capital
  const days = rows.length
  const years = days / 252
  const totalReturn = (finalEquity - initialCapital) / initialCapital
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
  const bnhReturn = (finalPrice - rows[0].close) / rows[0].close

  // Equity curve metrics
  let peak = initialCapital, maxDd = 0
  for (const eq of state.equityHistory) {
    if (eq > peak) peak = eq
    const d = (peak - eq) / peak
    if (d > maxDd) maxDd = d
  }

  // Compute daily returns from equity curve (for Sharpe/Sortino)
  const dailyReturns: number[] = []
  for (let i = 1; i < state.equityHistory.length; i++) {
    const ret = (state.equityHistory[i] - state.equityHistory[i - 1]) / state.equityHistory[i - 1]
    if (Number.isFinite(ret)) dailyReturns.push(ret)
  }

  // Win rate
  const closed = state.closedTrades
  const winRate = closed.length > 0 ? state.tradeWins / closed.length : 0
  const profitFactor = state.grossLoss > 0 ? state.grossProfit / state.grossLoss : state.grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = closed.length > 0 ? closed.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / closed.length : 0

  // Sharpe (annualized, daily)
  let sharpe: number | null = null
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const v = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(v, 0))
    if (sd > 1e-10) {
      const rfD = 0.04 / 252
      sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
    }
  }

  // Sortino
  let sortino: number | null = null
  if (dailyReturns.length > 30) {
    const neg = dailyReturns.filter(x => x < 0)
    if (neg.length > 0) {
      const dsd = Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / neg.length)
      if (dsd > 1e-10) {
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
        const rfD = 0.04 / 252
        sortino = ((mean - rfD) / dsd) * Math.sqrt(252)
      }
    }
  }

  return {
    ticker, sector,
    initialPrice: rows[0].close, finalPrice,
    totalReturn, annualizedReturn,
    sharpeRatio: Number.isFinite(sharpe) ? sharpe : null,
    sortinoRatio: Number.isFinite(sortino) ? sortino : null,
    maxDrawdown: maxDd, winRate, profitFactor, avgTradeReturn,
    totalTrades: closed.length, closedTrades: closed,
    openTrade: null,
    dailyReturns,
    equityCurve: state.equityHistory,
    days, confidenceAvg: state.confidenceCount > 0 ? state.confidenceSum / state.confidenceCount : 0,
    stopLossPct: cfg.stopLossPct,
    bnhReturn, excessReturn: totalReturn - bnhReturn,
  }
}

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

  const maxDrawdown = Math.max(...results.map(r => r.maxDrawdown))
  const avgReturn = results.reduce((s, r) => s + r.totalReturn, 0) / Math.max(results.length, 1)
  const avgAnnReturn = results.reduce((s, r) => s + r.annualizedReturn, 0) / Math.max(results.length, 1)
  const bnhAvg = results.reduce((s, r) => s + r.bnhReturn, 0) / Math.max(results.length, 1)

  // Aggregate all daily returns across instruments for portfolio-level Sharpe/Sortino
  const allDailyReturns: number[] = []
  for (const r of results) {
    for (const d of r.dailyReturns) {
      if (Number.isFinite(d)) allDailyReturns.push(d)
    }
  }

  let sharpe: number | null = null
  let sortino: number | null = null
  if (allDailyReturns.length > 30) {
    const mean = allDailyReturns.reduce((a, b) => a + b, 0) / allDailyReturns.length
    const variance = allDailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, allDailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    if (sd > 1e-10) {
      const rfD = 0.04 / 252
      sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
    }
    const negReturns = allDailyReturns.filter(x => x < 0)
    if (negReturns.length > 0) {
      const dsd = Math.sqrt(negReturns.reduce((s, x) => s + x * x, 0) / negReturns.length)
      if (dsd > 1e-10) {
        const rfD = 0.04 / 252
        sortino = ((mean - rfD) / dsd) * Math.sqrt(252)
      }
    }
  }

  const finalCapital = initialCapital * (1 + avgReturn)

  return {
    totalReturn: avgReturn,
    annualizedReturn: avgAnnReturn,
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
    initialCapital,
    finalCapital,
  }
}
