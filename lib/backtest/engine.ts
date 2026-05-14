/**
 * Backtest engine — pure computation, no API calls, no side effects.
 * Used by Next.js API routes and the CLI runner.
 */

import type { OhlcBar } from '@/lib/quant/technicals'
import { enhancedCombinedSignal, DEFAULT_CONFIG, atr, type BacktestConfig } from './signals'
import { sortinoRatio } from '@/lib/quant/indicators'
import { BACKTEST_RFR_ANNUAL } from '@/lib/quant/constants'
import { evaluateStopHit } from './exitRules'

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

// Phase 13 S2 fix (F1.6): tickers that trade 7 days a week need 365-day
// annualization; equities use 252. The detection is conservative — only
// known crypto symbols and futures get 365. New crypto tickers default to
// 252 unless added here or passed explicitly via config.
const CRYPTO_TICKERS_365 = new Set(['BTC', 'BTC-USD', 'ETH', 'ETH-USD', 'SOL', 'SOL-USD'])

function tradingDaysPerYear(ticker: string, sector: string): number {
  if (CRYPTO_TICKERS_365.has(ticker.toUpperCase())) return 365
  if (sector?.toLowerCase() === 'crypto') return 365
  return 252
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
  const annualization = tradingDaysPerYear(ticker, sector)

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

    // ── ATR-adaptive stop-loss + trailing stop ──
    if (state.openTrade) {
      // ATR% at entry for adaptive stop (stored at entry)
      const atrAtEntry = state.openTrade.atrAtrPctAtEntry ?? 0.10
      // Adaptive stop: 1.5x ATR%, capped at 15%.
      // FIX P12-H2: Instrument-type-aware floor — ETF: 1.5% (XLK ATR ~1.8%, 3% was always active),
      // Stock: 3% (still too low for high-vol like NVDA but prevents trivial noise exits on ETFs).
      const ETF_STOP_FLOOR_TICKERS = ['XLK','XLE','XLV','XLF','XLI','XLU','XLB','XLP','XLY','XLRE','XLC','SPY','QQQ','TLT','UUP']
      const atrFloor = ETF_STOP_FLOOR_TICKERS.includes(ticker) ? 0.015 : 0.03
      const atrStopPct = Math.max(atrFloor, Math.min(0.15, 1.5 * atrAtEntry))
      const stopPx = state.openTrade.action === 'BUY'
        ? state.openTrade.entryPrice * (1 - atrStopPct)
        : state.openTrade.entryPrice * (1 + atrStopPct)

      // Trailing stop: track highest price after BUY entry
      if (state.openTrade.action === 'BUY') {
        const peakPrice = state.openTrade.highestPriceAfterEntry ?? state.openTrade.entryPrice
        state.openTrade.highestPriceAfterEntry = Math.max(peakPrice, signalPrice)
        // Profit measured from entry
        const profitFromEntry = (signalPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
        // Convert stored ATR% (at entry) back to dollar ATR: ATR% / 100 * entryPrice
        const atrAtEntryDollar = ((state.openTrade.atrAtrPctAtEntry ?? 10) / 100) * state.openTrade.entryPrice
        const twoAtrProfit = (2 * atrAtEntryDollar) / state.openTrade.entryPrice
        const fourAtrProfit = (4 * atrAtEntryDollar) / state.openTrade.entryPrice
        if (profitFromEntry >= twoAtrProfit) {
          // Raise stop to break-even + 0.5% buffer.
          // SSOT: F1.3 intraday-aware via evaluateStopHit primitive.
          const trailStopPx = state.openTrade.entryPrice * (1 + 0.005)
          const fillPrice = evaluateStopHit(rows[i], trailStopPx, 'long', 'stop')
          if (fillPrice != null) {
            const proceeds = state.position * fillPrice
            const txCost = proceeds * TX_COST_PCT_PER_SIDE
            const netProceeds = proceeds - txCost
            const pnlPct = (fillPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = fillPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state))
            continue
          }
        }
        // 4x ATR profit → tighten to lock in 1x ATR gain from entry price.
        // SSOT: F1.3 intraday-aware via evaluateStopHit primitive.
        if (profitFromEntry >= fourAtrProfit) {
          const lockStopPx = state.openTrade.entryPrice + atrAtEntryDollar  // lock 1x ATR from entry
          const fillPrice = evaluateStopHit(rows[i], lockStopPx, 'long', 'stop')
          if (fillPrice != null) {
            const proceeds = state.position * fillPrice
            const txCost = proceeds * TX_COST_PCT_PER_SIDE
            const netProceeds = proceeds - txCost
            const pnlPct = (fillPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
            if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
            else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
            state.capital += netProceeds
            state.openTrade.exitPrice = fillPrice
            state.openTrade.pnlPct = pnlPct
            state.closedTrades.push({ ...state.openTrade })
            state.position = 0; state.avgCost = 0; state.openTrade = null
            state.equityHistory.push(currentEquity(state))
            continue
          }
        }
      }

      // Primary stop-loss check — SSOT: F1.3 intraday-aware via the shared
      // evaluateStopHit primitive (single source of truth, also used by
      // lib/backtest/exitRules.ts's checkExitConditions). Previously each
      // path had its own copy of the bar.low/bar.high/gap-aware logic — a
      // hazard that already caused the same close-only bug to live in
      // two places. The primitive eliminates that future-regression risk.
      const tradeSide: 'long' | 'short' = state.openTrade.action === 'BUY' ? 'long' : 'short'
      const fillPrice = evaluateStopHit(rows[i], stopPx, tradeSide, 'stop')
      if (fillPrice != null) {
        const proceeds = state.position * fillPrice
        const txCost = proceeds * TX_COST_PCT_PER_SIDE
        const netProceeds = proceeds - txCost
        const pnlPct = state.openTrade.action === 'BUY'
          ? (fillPrice - state.openTrade.entryPrice) / state.openTrade.entryPrice
          : (state.openTrade.entryPrice - fillPrice) / state.openTrade.entryPrice
        if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
        else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
        state.capital += netProceeds
        state.openTrade.exitPrice = fillPrice
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
      state.equityHistory.push(currentEquity(state))
      continue
    }

    // ── Signal generation (uses today's close data, no look-ahead) ──
    const lookbackOhlcv = rows.slice(0, i + 1)
    const signal = enhancedCombinedSignal(ticker, signalDate, signalPrice, lookbackCloses, lookbackBars, lookbackOhlcv, cfg)

    if (signal.action === 'BUY' && !state.openTrade) {
      const kellyFrac = Math.min(signal.KellyFraction, 0.50)
      const allocation = state.capital * kellyFrac
      // Long entries: pay slightly above the open (adverse selection / friction).
      const entryPrice = nextOpen * (1 + ENTRY_SLIPPAGE_BPS / 10000)
      const shares = Math.floor(allocation / entryPrice)
      if (shares <= 0) {
        state.equityHistory.push(currentEquity(state))
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
        // FIX P12-H3: Use atrVals[i-1] (prior bar) not atrVals[i] — signal bar's own TR not yet closed
        atrAtrPctAtEntry: Number.isFinite(atrVals[Math.max(0, i - 1)]) ? (atrVals[Math.max(0, i - 1)] / signalPrice) * 100 : 0.10,
        highestPriceAfterEntry: entryPrice,
      }
      state.confidenceSum += signal.confidence
      state.confidenceCount++
      state.equityHistory.push(currentEquity(state))

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
      state.equityHistory.push(currentEquity(state))

    } else {
      state.equityHistory.push(currentEquity(state))
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
  // F1.6 (Phase 13 S2): annualization uses tradingDaysPerYear() — 252 for
  // equities, 365 for crypto. Previously hardcoded 252 understated crypto
  // Sharpe by sqrt(252/365) ≈ 17% and overstated annualized return by ~4-5%/yr.
  const years = days / annualization
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

  // Sharpe (annualized, daily). F1.6: annualization param matches instrument.
  let sharpe: number | null = null
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const v = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(v, 0))
    if (sd > 1e-10) {
      const rfD = BACKTEST_RFR_ANNUAL / annualization
      sharpe = ((mean - rfD) / sd) * Math.sqrt(annualization)
    }
  }

  // Sortino: delegated to canonical lib/quant/indicators.ts:sortinoRatio.
  // Phase 13 S2 fix (F2.1 + F1.16 + F1.6): consolidated three divergent implementations
  // (engine.ts, portfolioBacktest.ts, indicators.ts) into the single canonical impl.
  // Uses MAR = rfDaily, n_d denominator (Sortino & van der Meer 1991),
  // and minimum n_d ≥ 30 (Bacon 2008 p107). Annualization matches instrument.
  // F1.4 (Phase 13 S2 partial): rate sourced from canonical constant; FRED hookup TBD.
  const rfDaily = BACKTEST_RFR_ANNUAL / annualization
  const sortino = sortinoRatio(dailyReturns, rfDaily, annualization)

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
  // Phase 13 S2 fix (F1.2): portfolio max DD computed from the combined equity
  // curve (correct), not Math.max of individual instrument DDs (overstates by
  // 3-10× because diversification staggers per-instrument DDs in time).
  // Reference: Magdon-Ismail & Atiya (2004); Bacon (2008) p102-105.
  let portfolioMaxDdFromCurve = 0
  let portfolioMaxDdComputed = false

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

      // F1.2: max drawdown of the combined portfolio curve (true portfolio DD).
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

      // Compute daily returns from combined equity (for Sharpe/Sortino)
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
        const rfD = BACKTEST_RFR_ANNUAL / 252
        if (sd > 1e-10) {
          sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
        }
        // Phase 13 S2: portfolio Sortino delegated to canonical impl in indicators.ts
        sortino = sortinoRatio(portfolioDailyReturns, rfD, 252)
      }
    }
  }

  // F1.2 (Phase 13 S2 fix): use the curve-based portfolio max DD.
  // Falls back to max-of-individual-DDs only when combinedEquity construction
  // produced no valid window (e.g. zero or single-instrument empty results).
  // The fallback path matches prior behavior to avoid regressions on degenerate inputs.
  const maxDrawdown = portfolioMaxDdComputed
    ? portfolioMaxDdFromCurve
    : Math.max(...results.map(r => r.maxDrawdown), 0)

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
  const rfD = BACKTEST_RFR_ANNUAL / 252
  return ((mean - rfD) / sd) * Math.sqrt(252)
}

/**
 * Walk-forward analysis via trade attribution.
 *
 * Phase 13 S2 fix (F1.1) — Architectural rework:
 *
 *   PREVIOUS BUG: this function ran `backtestInstrument(testRows)` with
 *   `testRows` of length `testDays = 63`. But `backtestInstrument` short-
 *   circuits when `rows.length < 252` (the 200-bar warmup gate plus 52-bar
 *   minimum signal generation), so the test-window result was always
 *   identically zero. `oosRatio` and `overfittingIndex` were therefore
 *   meaningless — every window reported osReturn=0 regardless of
 *   strategy performance, giving false confidence in OOS robustness.
 *
 *   FIXED APPROACH: run a SINGLE backtest on the full series (which has
 *   sufficient warmup), then partition the resulting trades into IS/OS
 *   windows by entry date. Window return is the sum of trade pnlPct for
 *   trades whose entry date falls within the window. Annualized to a
 *   per-year rate using the window's calendar length.
 *
 *   Note on parameter optimisation: this codebase uses fixed sector-
 *   profile parameters (no per-window re-optimisation), so the strict
 *   "walk-forward optimisation" interpretation (Pardo 2008) doesn't
 *   apply. The function answers "how stable is this strategy across
 *   non-overlapping time windows?" rather than "how much does parameter
 *   re-optimisation overfit?" Sufficient for the platform's stability
 *   diagnostic needs.
 *
 *   Reference: Pardo, R. (2008). The Evaluation and Optimization of
 *   Trading Strategies, 2e. Wiley. Ch.11 (Walk-Forward Analysis).
 */
export function walkForwardAnalysis(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  trainDays = 252,
  testDays = 63,
): WFWWindow[] {
  const windows: WFWWindow[] = []
  const n = rows.length

  // Need at least one full IS window past the engine's 252-bar warmup.
  const WARMUP = 252
  if (n < WARMUP + trainDays + testDays) return windows

  // Single backtest on full series — produces all trades + equity curve.
  // Note: even when zero trades fire, we still emit windows with 0/0
  // returns so the temporal scaffolding (window labels, dates) is
  // populated for downstream UI tabs that expect a non-empty array.
  const fullResult = backtestInstrument(ticker, sector, rows)
  const trades = fullResult.closedTrades

  // Map row index → ISO date string for window boundary lookups.
  const dateAt = (idx: number) =>
    new Date(rows[idx].time * 1000).toISOString().slice(0, 10)

  // Pre-bucket trades by entry-date for O(N) windowing.
  const sortedTrades = [...trades].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  )

  let trainStart = WARMUP
  while (trainStart + trainDays + testDays <= n) {
    const trainEnd = trainStart + trainDays
    const testEnd = trainEnd + testDays

    const trainStartDate = dateAt(trainStart)
    const trainEndDate = dateAt(trainEnd - 1)
    const testStartDate = dateAt(trainEnd)
    const testEndDate = dateAt(testEnd - 1)

    // Trade-attribution: sum pnlPct of trades entering inside each window.
    let isReturnSum = 0
    let osReturnSum = 0
    for (const t of sortedTrades) {
      if (t.date < trainStartDate) continue
      if (t.date > testEndDate) break
      const pnl = t.pnlPct ?? 0
      if (t.date <= trainEndDate) {
        isReturnSum += pnl
      } else if (t.date >= testStartDate) {
        osReturnSum += pnl
      }
    }

    const isAnn = annualized(isReturnSum, trainDays)
    const osAnn = annualized(osReturnSum, testDays)

    // Sharpe per window: compute from equityHistory slice. equityHistory[0]
    // is initial capital (set BEFORE the loop), and the loop pushes one
    // entry per iteration starting at row index 200. Index mapping:
    //   row i (i ≥ 200) ↔ equityHistory[i - 199].
    const histStart = Math.max(0, trainStart - 199)
    const histTrainEnd = Math.max(histStart, trainEnd - 199)
    const histTestEnd = Math.max(histTrainEnd, testEnd - 199)
    const isReturns = sliceDailyReturns(fullResult.equityCurve, histStart, histTrainEnd)
    const osReturns = sliceDailyReturns(fullResult.equityCurve, histTrainEnd, histTestEnd)
    const isSharpe = windowSharpe(isReturns)
    const osSharpe = windowSharpe(osReturns)

    const oosRatio = isAnn !== 0 ? Math.min(2, Math.max(-1, osAnn / isAnn)) : 0

    windows.push({
      periodLabel: `${trainStartDate.slice(0, 7)} – ${testEndDate.slice(0, 7)}`,
      startDate: trainStartDate,
      endDate: testEndDate,
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

/** Compute daily returns from an equity-curve slice [a, b). */
function sliceDailyReturns(equityCurve: number[], a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a + 1; i < b && i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]
    if (prev > 0) {
      const r = (equityCurve[i] - prev) / prev
      if (Number.isFinite(r)) out.push(r)
    }
  }
  return out
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
