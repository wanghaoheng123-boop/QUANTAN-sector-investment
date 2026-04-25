/**
 * Backtest engine — pure computation, no API calls, no side effects.
 * Used by Next.js API routes and the CLI runner.
 */

import type { OhlcBar } from '@/lib/quant/technicals'
import { combinedSignal, DEFAULT_CONFIG, atr, type BacktestConfig } from './signals'

// ─── Transaction cost model ─────────────────────────────────────────────────────
// Applied per side (entry OR exit) to reflect realistic execution costs.
// Source: Interactive Brokers ~$0.005/share + 0.05% spread + 0.5bps mid-price slippage
// For a $100 stock: 0.005/100 = 0.005% commission + 0.05% spread + 0.05% slippage ≈ 0.11% = 11bps per side
// Total round-trip cost = 22 bps (11 bps entry + 11 bps exit).
//
// TIERED MODEL (FIX E2/E3): Instrument-type spreads vary significantly.
// Large-cap ETFs (SPY, QQQ, XLK): ~1-2 bps round-trip
// Large-cap stocks (AAPL, MSFT): ~2-3 bps round-trip
// Mid/small cap: ~8-15 bps round-trip
// We use 11 bps per side as a conservative average for large/mid-caps.
// For a more accurate model, use instrument-specific costs.
export const TX_COST_BPS_PER_SIDE = 11  // basis points per side (entry OR exit)
export const TX_COST_PCT_PER_SIDE = TX_COST_BPS_PER_SIDE / 10000  // as decimal
// Total round-trip = 2 × TX_COST_PCT_PER_SIDE

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
  /** Bar index i at which the trade was opened. Used for time-based exit cap. */
  entryBarIndex?: number
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

// Mark-to-market: open positions valued at the latest observed close price,
// not entry/avgCost. Without this, equityHistory is piecewise-flat between
// trade events, suppressing daily volatility and producing absurd Sharpe.
function currentEquity(state: PortfolioState, markPrice: number): number {
  return state.capital + state.position * markPrice
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
  // FIX C2 (Critical): Signal at today's close, execute at TOMORROW's open.
  // This eliminates the same-day look-ahead bias where signal and execution
  // used the same day's close price (physically impossible in live trading).
  // Institutional standard: signal end-of-day, execute at next-day open.
  // We also add realistic open-price slippage of 2 bps for execution friction.
  const ENTRY_SLIPPAGE_BPS = 2  // 2 bps added to entry price (realistic friction)

  for (let i = 200; i < rows.length - 1; i++) {
    const signalDate = new Date(rows[i].time * 1000).toISOString().split('T')[0]
    // Use today's close for signal generation (data available at close)
    const signalPrice = rows[i].close
    // Execute at TOMORROW's open price (realistic execution model)
    const nextOpen = rows[i + 1].open
    // Entry price + slippage is computed only when opening a BUY (after signal below).
    // OhlcvRow has no `action`; using rows[i].action was always undefined and forced
    // the sell branch (downward slippage), biasing long entries optimistically.
    // Use only data up to today (no look-ahead bias in signal)
    const lookbackCloses = closes.slice(0, i + 1)
    const lookbackBars = bars.slice(0, i + 1)

      // ── ATR-adaptive stop-loss + two-stage trailing stop ──
    if (state.openTrade) {
      // atrAtEntryPct is a FRACTION (0.02 = 2% ATR), not a percentage.
      const atrAtEntryPct = state.openTrade.atrAtrPctAtEntry ?? 0.02
      // Config-driven ATR parameters: floor 3%, ceiling 15%, multiplier 1.5×
      const atrStopPct = Math.max(0.03, Math.min(0.15, 1.5 * atrAtEntryPct))
      const stopPx = state.openTrade.action === 'BUY'
        ? state.openTrade.entryPrice * (1 - atrStopPct)
        : state.openTrade.entryPrice * (1 + atrStopPct)

      // Trailing stop: track peak after BUY entry, measure profit from peak
      if (state.openTrade.action === 'BUY') {
        const peakPrice = state.openTrade.highestPriceAfterEntry ?? state.openTrade.entryPrice
        state.openTrade.highestPriceAfterEntry = Math.max(peakPrice, signalPrice)
        const peak = state.openTrade.highestPriceAfterEntry!

        // Dollar ATR at entry
        // Dollar ATR = fraction × entry price (atrAtEntryPct is already a fraction).
        const atrAtEntryDollar = atrAtEntryPct * state.openTrade.entryPrice
        // Profit measured from the running peak (not from entry)
        const profitFromPeak = peak > 0 ? (peak - state.openTrade.entryPrice) / state.openTrade.entryPrice : 0

        // Stage 2 (6× ATR profit): exit if peak − 1.5× ATR is violated
        // More profitable exit — checked FIRST so it takes priority
        // Widened from 4×/1× to 6×/1.5× to let winners run through normal pullbacks.
        const trailLockMultiplier = 1.5
        if (profitFromPeak >= 6 * atrAtEntryPct) {
          const lockStopPx = peak - trailLockMultiplier * atrAtEntryDollar
          if (signalPrice <= lockStopPx) {
            const proceeds = state.position * signalPrice
            const txCost = proceeds * TX_COST_PCT_PER_SIDE
            const netProceeds = proceeds - txCost
            const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = signalPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state, signalPrice))
            continue
          }
        }

        // Stage 1 (3× ATR profit): raise stop to entry + 1× ATR (lock 1R profit)
        // Widened from 2×ATR/break-even to 3×ATR/+1ATR: survives normal pullbacks.
        if (profitFromPeak >= 3 * atrAtEntryPct) {
          const trailStopPx = state.openTrade.entryPrice + atrAtEntryDollar
          if (signalPrice <= trailStopPx) {
            const proceeds = state.position * signalPrice
            const txCost = proceeds * TX_COST_PCT_PER_SIDE
            const netProceeds = proceeds - txCost
            const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = signalPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state, signalPrice))
            continue
          }
        }
      }

      // NOTE: Time-based exit cap (60 bars, +1×ATR threshold) was tested
      // 2026-04-25 and slightly hurt OOS Sharpe (−0.115 → −0.138) despite
      // raising win-rate. Kept the entryBarIndex field for future experiments.
      // See docs/SESSION_PROGRESS_2026-04-25.md Priority 2.

      // Primary stop-loss check (exits at today's close)
      if ((state.openTrade.action === 'BUY' && signalPrice <= stopPx) ||
          (state.openTrade.action === 'SELL' && signalPrice >= stopPx)) {
        const proceeds = state.position * signalPrice
        const txCost = proceeds * TX_COST_PCT_PER_SIDE
        const netProceeds = proceeds - txCost
        const pnlPct = state.openTrade.action === 'BUY'
          ? (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - signalPrice) / state.openTrade.entryPrice
        if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
        else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
        state.capital += netProceeds
        state.openTrade.exitPrice = signalPrice
        state.openTrade.pnlPct = pnlPct
        state.closedTrades.push({ ...state.openTrade })
        state.position = 0; state.avgCost = 0; state.openTrade = null
        const eq = currentEquity(state, signalPrice)
        state.equityHistory.push(eq)
        continue
      }
    }

    // ── Portfolio max-drawdown circuit breaker ──
    const eq = currentEquity(state, signalPrice)
    if (eq > state.peakEquity) state.peakEquity = eq
    const dd = (state.peakEquity - eq) / state.peakEquity
    if (dd >= cfg.maxDrawdownCap && state.openTrade) {
      const proceeds = state.position * signalPrice
      const txCost = proceeds * TX_COST_PCT_PER_SIDE
      const netProceeds = proceeds - txCost
      const pnlPct = state.openTrade.action === 'BUY'
        ? (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
        : (state.openTrade.entryPrice - signalPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.capital += netProceeds
      state.openTrade.exitPrice = signalPrice
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentEquity(state, signalPrice))
      continue
    }

    // ── Signal generation (uses today's close data, no look-ahead) ──
    const signal = combinedSignal(ticker, signalDate, signalPrice, lookbackCloses, lookbackBars, cfg)

    if (signal.action === 'BUY' && !state.openTrade) {
      const kellyFrac = Math.min(signal.KellyFraction, cfg.maxPositionWeight)
      const allocation = state.capital * kellyFrac
      // Long entries: pay slightly above the open (adverse selection / friction).
      const entryPrice = nextOpen * (1 + ENTRY_SLIPPAGE_BPS / 10000)
      const shares = Math.floor(allocation / entryPrice)
      if (shares <= 0) {
        state.equityHistory.push(currentEquity(state, signalPrice))
        continue
      }
      const costBasis = shares * entryPrice
      const txCost = costBasis * TX_COST_PCT_PER_SIDE
      state.capital -= (costBasis + txCost)  // buy at next-open + slippage + transaction cost
      state.position += shares
      state.avgCost = entryPrice
      state.openTrade = {
        date: signalDate, ticker, sector,
        action: 'BUY',
        entryPrice: entryPrice,
        exitPrice: 0,
        shares, value: costBasis,
        regime: signal.regime.label, dipSignal: signal.regime.dipSignal,
        confidence: signal.confidence, pnlPct: null, reason: signal.reason,
        // Store as FRACTION (e.g. 0.02 = 2% ATR). All downstream exit math
        // (atrStopPct cap, trail triggers) assumes fraction units.
        atrAtrPctAtEntry: Number.isFinite(atrVals[i]) && signalPrice > 0 ? atrVals[i] / signalPrice : 0.02,
        highestPriceAfterEntry: entryPrice,
        entryBarIndex: i,
      }
      state.confidenceSum += signal.confidence
      state.confidenceCount++
      state.equityHistory.push(currentEquity(state, signalPrice))

    } else if (signal.action === 'SELL' && state.openTrade) {
      // SELL exits at today's close (signal price) — realistic same-day exit on regime shift
      const proceeds = state.position * signalPrice
      const txCost = proceeds * TX_COST_PCT_PER_SIDE
      const netProceeds = proceeds - txCost
      const pnlPct = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
      if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
      else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
      state.capital += netProceeds
      state.openTrade.exitPrice = signalPrice
      state.openTrade.pnlPct = pnlPct
      state.closedTrades.push({ ...state.openTrade })
      state.position = 0; state.avgCost = 0; state.openTrade = null
      state.equityHistory.push(currentEquity(state, signalPrice))

    } else {
      state.equityHistory.push(currentEquity(state, signalPrice))
    }
  }

  // ── Close remaining open position at final price ──
  const finalPrice = rows[rows.length - 1].close
  if (state.openTrade) {
    const proceeds = state.position * finalPrice
    const txCost = proceeds * TX_COST_PCT_PER_SIDE
    const netProceeds = proceeds - txCost
    const pnlPct = (finalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
    if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
    else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
    state.capital += netProceeds
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

  // Sortino: downside deviation uses MAR-aligned denominator
  // FIX C1 (Critical): Denominator must be total observations N, not count of negative returns.
  // Correct formula: DSd = sqrt(sum(min(0, r_i - MAR)^2) / N)
  // where MAR = risk-free daily rate = rfAnnual / 252
  // This ensures Sortino is comparable to Sharpe (both use same MAR).
  let sortino: number | null = null
  if (dailyReturns.length > 30) {
    const rfD = 0.04 / 252
    // Compute downside deviations: only negative excess returns count
    const downsideDevs = dailyReturns.map(r => Math.min(0, r - rfD))
    const negDevs = downsideDevs.filter(x => x < 0)
    if (negDevs.length > 0) {
      // Use total N as denominator (correct formula), not negDevs.length
      const n = dailyReturns.length
      const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / n
      const dsd = Math.sqrt(downsideVariance)
      if (dsd > 1e-10) {
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
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

/** Sample std (unbiased) for return series. */
function sampleStdReturns(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(Math.max(variance, 0))
}

/** Compound non-overlapping 5-day blocks into weekly total returns (≈ trading week). */
function dailyReturnsToWeeklyBlocks(daily: number[]): number[] {
  const w: number[] = []
  for (let i = 0; i < daily.length; i += 5) {
    const chunk = daily.slice(i, Math.min(i + 5, daily.length))
    if (chunk.length < 3) continue
    let acc = 1
    for (const r of chunk) acc *= 1 + r
    w.push(acc - 1)
  }
  return w
}

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

  // FIX C2/C3: Compute TRUE portfolio-level metrics from combined equity curve.
  // Each instrument has its own equity curve starting at `initialCapital`.
  // For portfolio metrics, we combine them into a single "virtual portfolio" curve.
  // Callers that need day-aligned summation (e.g. `scripts/backtest-matrix.ts`) should
  // pass results whose histories were built on the same calendar days — use
  // `alignOhlcvSeries` before `backtestInstrument` so each index matches one session date.
  //
  // FIX C3: Use maximum common length (all instruments must have that many days)
  // rather than minimum, to avoid discarding instruments with longer histories.
  // Instruments with shorter data contribute to the period they cover.
  const maxLen = results.length > 0
    ? Math.max(...results.map(r => r.equityCurve.length))
    : 0

  let sharpe: number | null = null
  let sortino: number | null = null
  let truePortfolioReturn = 0
  let truePortfolioAnnReturn = 0
  let combinedFinalEquity = 0
  let combinedInitialEquity = 0

  if (maxLen > 30 && results.length > 0) {
    // Combine all equity curves into a single portfolio equity curve.
    // Each equity curve starts at initialCapital. We sum the $ values.
    // This represents a portfolio with equal dollar allocation to each instrument.
    // Carry forward each instrument's last equity after its series ends so shorter
    // histories (e.g. stocks ~252d/yr vs BTC ~365d/yr) do not drop to zero and
    // create a fake cliff in combined portfolio equity.
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

      // ── Daily returns from MTM combined equity ─────────────────────────
      // After the MTM fix in `currentEquity`, the combined equity curve already
      // reflects market-value moves on open positions, so raw daily diffs are
      // honest. The previous "credit rfD on idle days" kludge was masking the
      // MTM bug (it was essentially never firing once equity moved daily, and
      // when it did fire it inflated mean returns). Removed — daily returns are
      // computed directly from MTM equity.
      const rfD = 0.04 / 252
      const portfolioDailyReturns: number[] = []
      let idleDays = 0
      for (let i = firstValid + 1; i <= lastValid; i++) {
        if (combinedEquity[i - 1] > 0) {
          const rawRet = (combinedEquity[i] - combinedEquity[i - 1]) / combinedEquity[i - 1]
          if (!Number.isFinite(rawRet)) continue
          if (Math.abs(rawRet) < 1e-9) idleDays++
          portfolioDailyReturns.push(rawRet)
        }
      }
      const utilization = portfolioDailyReturns.length > 0
        ? 1 - idleDays / portfolioDailyReturns.length
        : 0

      if (portfolioDailyReturns.length > 30) {
        const n = portfolioDailyReturns.length
        const mean = portfolioDailyReturns.reduce((a, b) => a + b, 0) / n
        const variance = portfolioDailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1)
        const sd = Math.sqrt(Math.max(variance, 0))
        if (sd > 1e-10) {
          sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
        }
        // Sortino: use downside deviation relative to rfD
        const downsideDevs = portfolioDailyReturns.map(r => Math.min(0, r - rfD))
        const negDevs = downsideDevs.filter(x => x < 0)
        if (negDevs.length > 0) {
          const downsideVariance = negDevs.reduce((s, x) => s + x * x, 0) / n
          const dsd = Math.sqrt(downsideVariance)
          if (dsd > 1e-10) {
            sortino = ((mean - rfD) / dsd) * Math.sqrt(252)
          }
        }

        // Low-vol fallback: use weekly blocks if annual vol < 3%
        // (cash-adjusted returns reduce this, but keep for safety)
        const annVolDaily = sd * Math.sqrt(252)
        if (annVolDaily < 0.03 && sd > 1e-10) {
          const weekly = dailyReturnsToWeeklyBlocks(portfolioDailyReturns)
          const rfW = 1.04 ** (1 / 52) - 1
          if (weekly.length >= 12) {
            const wm = weekly.reduce((a, b) => a + b, 0) / weekly.length
            const wsd = sampleStdReturns(weekly)
            if (wsd > 1e-10) {
              sharpe = ((wm - rfW) / wsd) * Math.sqrt(52)
            }
            const wDown = weekly.map(r => Math.min(0, r - rfW))
            const wNeg = wDown.filter(x => x < 0)
            if (wNeg.length > 0) {
              const wdv = wNeg.reduce((s, x) => s + x * x, 0) / weekly.length
              const wdsd = Math.sqrt(wdv)
              if (wdsd > 1e-10) {
                sortino = ((wm - rfW) / wdsd) * Math.sqrt(52)
              }
            }
          }
        }
      }
      void utilization  // available for future portfolio-level utilization reporting
    }
  }

  // For max drawdown, use maximum across all instruments
  const maxDrawdown = Math.max(...results.map(r => r.maxDrawdown), 0)

  // Average B&H return across instruments
  const bnhAvg = results.reduce((s, r) => s + r.bnhReturn, 0) / Math.max(results.length, 1)
  // alpha = strategy portfolio return - B&H portfolio return
  const alpha = truePortfolioReturn - bnhAvg

  // finalCapital for the COMBINED portfolio (sum of all instruments' final values)
  const finalCapital = combinedFinalEquity

  return {
    totalReturn: truePortfolioReturn,    // FIX C2: True portfolio return, not simple average
    annualizedReturn: truePortfolioAnnReturn,  // FIX C2: True annualized portfolio return
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
    initialCapital: combinedInitialEquity,  // Combined initial equity
    finalCapital,
    alpha,  // Portfolio alpha vs B&H
  }
}

// ─── Walk-Forward Analysis ──────────────────────────────────────────────────────
// Splits data into N in-sample (training) and out-of-sample (testing) windows.
// This is the gold standard for detecting overfitting: if IS ≫ OOS, the strategy
// is likely curve-fit. Robust strategies show similar metrics in both periods.

export interface WFWWindow {
  periodLabel: string
  startDate: string
  endDate: string
  isReturn: number      // in-sample annualized return
  isSharpe: number | null
  osReturn: number      // out-of-sample annualized return
  osSharpe: number | null
  oosRatio: number      // OOS/IS ratio (1.0 = perfect out-of-sample, <0.5 = overfit suspicion)
}

function annualized(totalReturn: number, days: number): number {
  const years = days / 252
  return years > 0 ? ((1 + totalReturn) ** (1 / years) - 1) : 0
}

function windowSharpe(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 30) return null
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const variance = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
  const sd = Math.sqrt(Math.max(variance, 0))
  if (sd < 1e-10) return null
  const rfD = 0.04 / 252
  return ((mean - rfD) / sd) * Math.sqrt(252)
}

export function walkForwardAnalysis(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  trainDays = 252,
  testDays = 63,
  config: Partial<BacktestConfig> = {},
): WFWWindow[] {
  // trainDays = 1 year in-sample, testDays = 1 quarter out-of-sample
  const windows: WFWWindow[] = []
  const n = rows.length
  let trainStart = 0

  while (trainStart + trainDays + testDays <= n) {
    const trainEnd = trainStart + trainDays
    const testEnd = trainEnd + testDays

    const trainRows = rows.slice(trainStart, trainEnd)
    const testRows = rows.slice(trainEnd, testEnd)

    if (trainRows.length < 100 || testRows.length < 20) break

    const trainResult = backtestInstrument(ticker, sector, trainRows, config)
    const testResult = backtestInstrument(ticker, sector, testRows, config)

    const isAnn = annualized(trainResult.totalReturn, trainRows.length)
    const osAnn = annualized(testResult.totalReturn, testRows.length)
    const isSharpe = windowSharpe(trainResult.dailyReturns)
    const osSharpe = windowSharpe(testResult.dailyReturns)
    const oosRatio = isAnn !== 0 ? Math.min(2, Math.max(-1, osAnn / isAnn)) : 0

    windows.push({
      periodLabel: `${new Date(trainRows[0].time * 1000).toISOString().slice(0, 7)} – ${new Date(testRows[testRows.length - 1].time * 1000).toISOString().slice(0, 7)}`,
      startDate: new Date(trainRows[0].time * 1000).toISOString().split('T')[0],
      endDate: new Date(testRows[testRows.length - 1].time * 1000).toISOString().split('T')[0],
      isReturn: isAnn,
      isSharpe,
      osReturn: osAnn,
      osSharpe,
      oosRatio,
    })

    trainStart += testDays
  }

  return windows
}

export interface WalkForwardSummary {
  avgIsReturn: number
  avgOsReturn: number
  avgIsSharpe: number | null
  avgOsSharpe: number | null
  avgOosRatio: number
  overfittingIndex: number   // 0 = perfectly robust, 1 = fully overfit (IS ≫ OS)
  windows: WFWWindow[]
}

export function walkForwardSummary(windows: WFWWindow[]): WalkForwardSummary {
  if (windows.length === 0) {
    return { avgIsReturn: 0, avgOsReturn: 0, avgIsSharpe: null, avgOsSharpe: null, avgOosRatio: 0, overfittingIndex: 1, windows }
  }
  const avgIsReturn = windows.reduce((s, w) => s + w.isReturn, 0) / windows.length
  const avgOsReturn = windows.reduce((s, w) => s + w.osReturn, 0) / windows.length
  const avgIsSharpe = windows.reduce((s, w) => s + (w.isSharpe ?? 0), 0) / windows.length
  const avgOsSharpe = windows.reduce((s, w) => s + (w.osSharpe ?? 0), 0) / windows.length
  const avgOosRatio = windows.reduce((s, w) => s + w.oosRatio, 0) / windows.length
  // overfittingIndex: 0 = IS ≈ OS, > 0.5 = suspicious overfitting
  const overfittingIndex = avgIsReturn > 0
    ? Math.max(0, Math.min(1, (avgIsReturn - avgOsReturn) / (Math.abs(avgIsReturn) + 0.001)))
    : 0

  return { avgIsReturn, avgOsReturn, avgIsSharpe: Number.isFinite(avgIsSharpe) ? avgIsSharpe : null, avgOsSharpe: Number.isFinite(avgOsSharpe) ? avgOsSharpe : null, avgOosRatio, overfittingIndex, windows }
}
