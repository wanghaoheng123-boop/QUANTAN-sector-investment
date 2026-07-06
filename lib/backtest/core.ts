/**
 * Backtest engine — pure computation, no API calls, no side effects.
 * Used by Next.js API routes and the CLI runner.
 */

import type { OhlcBar } from '@/lib/quant/indicators'
import { resolveBacktestSignal, DEFAULT_CONFIG, type BacktestConfig } from './signals'
import { sortinoRatio, atrArray as atr } from '@/lib/quant/indicators'
import { getRiskFreeRateSync } from '@/lib/quant/riskFreeRate'
import { evaluateStopHit } from './exitRules'
import { costBpsPerSide, DEFAULT_EXECUTION_COSTS } from './executionModel'

// ─── Transaction cost model (SSOT: lib/backtest/executionModel.ts) ───────────
/** Basis points per side (entry OR exit); matches benchmark label net costs. */
export const TX_COST_BPS_PER_SIDE = costBpsPerSide(DEFAULT_EXECUTION_COSTS)
export const TX_COST_PCT_PER_SIDE = TX_COST_BPS_PER_SIDE / 10000

export interface OhlcvRow extends OhlcBar {
  time: number
  volume: number
  /** Optional cash dividend per bar (Q-021). Yahoo split-adjusted close embeds most dividend effect. */
  dividend?: number
}

/** Total-return buy-and-hold including optional per-bar dividends (F1.5). */
export function computeBuyAndHoldReturn(rows: OhlcvRow[]): number {
  if (rows.length < 2) return 0
  const initial = rows[0].close
  if (initial <= 0) return 0
  let shares = 1
  for (let i = 1; i < rows.length; i++) {
    const div = rows[i].dividend ?? 0
    if (div > 0 && rows[i].close > 0) shares += div / rows[i].close
  }
  const finalValue = shares * rows[rows.length - 1].close
  return (finalValue - initial) / initial
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
  /**
   * Buy-and-hold value curve (dividends reinvested, scale-free) pushed at the
   * SAME cadence as equityCurve — bnhCurve[k] and equityCurve[k] mark the same
   * bar. Lets the portfolio aggregator compare strategy vs B&H over the SAME
   * end-aligned common window (F-2). Absent on < 252-bar stubs.
   */
  bnhCurve?: number[]
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

/**
 * Mark-to-market equity.
 *
 * Q1-C-1 (Phase 14 S1): previously returned `capital + position * avgCost`
 * (cost basis), meaning equity never changed while a position was open. The
 * drawdown circuit breaker therefore fired only AFTER an exit, not while the
 * position was bleeding.
 *
 * Correct formula: `capital + position × currentMarketPrice`.
 * When no position is held (`position = 0`), both expressions are identical.
 *
 * Citation: Bacon, C. R. (2008). *Practical Risk-Adjusted Performance
 * Measurement*. Wiley. p 9 — "market value of holdings at today's prices".
 *
 * @param currentPrice  Latest bar close price for open-position mark-to-market.
 *                      Omit (or pass undefined) only when position is flat.
 */
function currentEquity(state: PortfolioState, currentPrice?: number): number {
  const positionValue = state.position > 0 && currentPrice != null && Number.isFinite(currentPrice)
    ? state.position * currentPrice
    : state.position * state.avgCost
  return state.capital + positionValue
}

/**
 * Close the current open position at `fillPrice` and book the trade.
 *
 * Phase 14 wave 35 (SSOT extraction): this exit-bookkeeping sequence was
 * INLINED FIVE TIMES in this file (trailing stop, 4× ATR lock stop, primary
 * stop, DD circuit breaker, SELL signal). The 12-line block was the largest
 * regression-hazard pattern in the engine — every copy is a place where a
 * future fix would have to be duplicated, and where the SAME bug could live
 * in N places (we saw this exact pattern with the F1.3 intraday-stop fix
 * during Phase 13, which had to be applied in two places).
 *
 * This helper handles:
 *   1. Compute proceeds, transaction cost, net proceeds
 *   2. Compute realized pnl% (side-aware — long vs short)
 *   3. Update tradeWins/Losses + grossProfit/Loss aggregates
 *   4. Credit capital
 *   5. Stamp openTrade with exitPrice + pnlPct
 *   6. Push the closed trade onto closedTrades
 *   7. Reset position / avgCost / openTrade to flat
 *   8. Push the new equity-history row (mark-to-market with the post-exit
 *      position, which is flat — so `currentEquity(state)` is exact)
 *
 * @param state      PortfolioState (mutated in place — internal helper only).
 * @param fillPrice  The realised exit fill (already gap-aware from
 *                   `evaluateStopHit` where applicable).
 * @returns true when an exit happened; false if there was no open trade
 *                (defensive — callers gate on state.openTrade before calling).
 */
function closePosition(state: PortfolioState, fillPrice: number): boolean {
  const open = state.openTrade
  if (!open) return false
  const proceeds = state.position * fillPrice
  const txCost = proceeds * TX_COST_PCT_PER_SIDE
  const netProceeds = proceeds - txCost
  const pnlPct = open.action === 'BUY'
    ? (fillPrice - open.entryPrice) / open.entryPrice
    : (open.entryPrice - fillPrice) / open.entryPrice
  if (pnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
  else { state.tradeLosses++; state.grossLoss += Math.abs(pnlPct) }
  state.capital += netProceeds
  open.exitPrice = fillPrice
  open.pnlPct = pnlPct
  state.closedTrades.push({ ...open })
  state.position = 0
  state.avgCost = 0
  state.openTrade = null
  state.equityHistory.push(currentEquity(state))
  return true
}

// Phase 13 S2 fix (F1.6): tickers that trade 7 days a week need 365-day
// annualization; equities use 252. The detection is conservative — only
// known crypto symbols and futures get 365. New crypto tickers default to
// 252 unless added here or passed explicitly via config.
const CRYPTO_TICKERS_365 = new Set(['BTC', 'BTC-USD', 'ETH', 'ETH-USD', 'SOL', 'SOL-USD'])

export function tradingDaysPerYear(ticker: string, sector: string): number {
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
  // Execution friction (spread + slippage + commission) is carried SOLELY by
  // `txCost` = TX_COST_PCT_PER_SIDE (executionModel SSOT, 11 bps/side incl. a
  // 2 bps slippage component). F-9 fix (2026-07-06): the former 2 bps
  // ENTRY_SLIPPAGE_BPS price markup double-counted that slippage at entry
  // (~13 bps vs the 11 bps/side SSOT) and broke entry/exit symmetry — exits
  // fill at raw next-open with the same 11 bps/side cost.

  // F-2: B&H curve index-aligned with equityHistory. equityHistory gets exactly
  // one push per loop iteration (every branch, incl. the `continue` paths, pushes
  // once) after its [initialCapital] seed — so pushing the B&H mark once at the
  // top of each iteration keeps bnhCurve[k] ↔ equityHistory[k] by construction.
  // Dividends from the 200-bar warmup are accumulated into the starting shares.
  let bnhShares = 1
  for (let k = 1; k <= 200; k++) {
    const div = rows[k].dividend ?? 0
    if (div > 0 && rows[k].close > 0) bnhShares += div / rows[k].close
  }
  const bnhCurve: number[] = [bnhShares * rows[200].close]

  for (let i = 200; i < rows.length - 1; i++) {
    if (i > 200) {
      const div = rows[i].dividend ?? 0
      if (div > 0 && rows[i].close > 0) bnhShares += div / rows[i].close
    }
    bnhCurve.push(bnhShares * rows[i].close)
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
      // ATR% at entry for adaptive stop (stored at entry, PERCENT scale: e.g. 1.5 = 1.5%).
      // Q1-H-4 (Phase 14 S1): both reads now use the same fallback of 1.0 (1% ATR).
      // The prior code had two inconsistent fallbacks: 0.10 and 10.
      const atrAtEntryPct = state.openTrade.atrAtrPctAtEntry ?? 1.0
      // Adaptive stop: 1.5x ATR%, capped at 15%.
      // Q1-H-4 (Phase 14 S1 Critical fix): atrAtrPctAtEntry is stored as PERCENTAGE (0–100 scale,
      // e.g. 1.5 for a 1.5% ATR) because line L321 multiplies by 100. The prior code computed
      //   1.5 * atrAtEntry  (treating the value as a decimal fraction)
      // which for a typical 1.5% ATR gave  1.5 × 1.5 = 2.25 → capped to 0.15 (15%) always.
      // The stop was therefore ALWAYS 15%, never adaptive. Correct formula divides by 100:
      //   1.5 × (atrPct / 100) → 0.0225 (2.25%) → above ETF floor (1.5%), below stock floor (3%) so
      //   the floor controls for low-volatility ETFs and the 1.5×ATR value controls for stocks.
      //
      // Citation: Wilder (1978) "New Concepts in Technical Trading Systems" ch.3 — ATR-based
      // stop placement at 1–3× ATR measured in price units (dollars), not percentage-of-percentage.
      const ETF_STOP_FLOOR_TICKERS = ['XLK','XLE','XLV','XLF','XLI','XLU','XLB','XLP','XLY','XLRE','XLC','SPY','QQQ','TLT','UUP']
      const atrFloor = ETF_STOP_FLOOR_TICKERS.includes(ticker) ? 0.015 : 0.03
      const atrStopPct = Math.max(atrFloor, Math.min(0.15, 1.5 * atrAtEntryPct / 100))
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
        const atrAtEntryDollar = (atrAtEntryPct / 100) * state.openTrade.entryPrice
        const twoAtrProfit = (2 * atrAtEntryDollar) / state.openTrade.entryPrice
        const fourAtrProfit = (4 * atrAtEntryDollar) / state.openTrade.entryPrice
        if (profitFromEntry >= twoAtrProfit) {
          // Raise stop to break-even + 0.5% buffer.
          // SSOT: F1.3 intraday-aware via evaluateStopHit primitive.
          const trailStopPx = state.openTrade.entryPrice * (1 + 0.005)
          const fillPrice = evaluateStopHit(rows[i], trailStopPx, 'long', 'stop')
          if (fillPrice != null) {
            closePosition(state, fillPrice)
            continue
          }
        }
        // 4x ATR profit → tighten to lock in 1x ATR gain from entry price.
        // SSOT: F1.3 intraday-aware via evaluateStopHit primitive.
        if (profitFromEntry >= fourAtrProfit) {
          const lockStopPx = state.openTrade.entryPrice + atrAtEntryDollar  // lock 1x ATR from entry
          const fillPrice = evaluateStopHit(rows[i], lockStopPx, 'long', 'stop')
          if (fillPrice != null) {
            closePosition(state, fillPrice)
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
        closePosition(state, fillPrice)
        continue
      }
    }

    // ── Portfolio max-drawdown circuit breaker ──
    // Q1-C-1: pass signalPrice so open-position loss is reflected mark-to-market.
    const eq = currentEquity(state, signalPrice)
    if (eq > state.peakEquity) state.peakEquity = eq
    const dd = (state.peakEquity - eq) / state.peakEquity
    if (dd >= cfg.maxDrawdownCap && state.openTrade) {
      // T+1 exit symmetry: the drawdown breach is OBSERVED at today's close (eq
      // above uses signalPrice), but the exit FILL is at TOMORROW's open
      // (nextOpen) — exactly like BUY entries. A same-bar close fill would be
      // look-ahead: you cannot transact at a close you have only just observed.
      // (Mirrors the SELL-signal correction below.)
      closePosition(state, nextOpen)
      continue
    }

    // ── Signal generation (uses today's close data, no look-ahead) ──
    const lookbackOhlcv = rows.slice(0, i + 1)
    const signal = resolveBacktestSignal(ticker, signalDate, signalPrice, lookbackCloses, lookbackBars, lookbackOhlcv, cfg)

    if (signal.action === 'BUY' && !state.openTrade) {
      const kellyFrac = Math.min(signal.KellyFraction, 0.50)
      const allocation = state.capital * kellyFrac
      // Long entries fill at the raw next-open; friction is in txCost below (F-9).
      const entryPrice = nextOpen
      // Guard a corrupt next-open (0 / NaN / Infinity): sizing on it makes `shares`
      // Infinity or NaN — and the `shares <= 0` check below misses BOTH — which then
      // poisons `capital` and the entire equity curve / totalReturn with NaN. A bar
      // that can't be priced can't be traded: mark-to-market at today's close and skip.
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        state.equityHistory.push(currentEquity(state, signalPrice))
        continue
      }
      const shares = Math.floor(allocation / entryPrice)
      if (shares <= 0) {
        state.equityHistory.push(currentEquity(state))
        continue
      }
      const costBasis = shares * entryPrice
      // F-9 FIXED (2026-07-06, owner-directed re-baseline): entry fills at raw
      // next-open; `txCost` = 11 bps/side (executionModel SSOT, incl. slippage)
      // is the single source of friction — symmetric with the exit side.
      const txCost = costBasis * TX_COST_PCT_PER_SIDE
      state.capital -= (costBasis + txCost)  // buy at next-open + transaction cost
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
        // Q1-H-4: fallback is 1.0 (1% ATR) — consistent with the percent-scale convention.
        atrAtrPctAtEntry: Number.isFinite(atrVals[Math.max(0, i - 1)]) ? (atrVals[Math.max(0, i - 1)] / signalPrice) * 100 : 1.0,
        highestPriceAfterEntry: entryPrice,
      }
      state.confidenceSum += signal.confidence
      state.confidenceCount++
      // Q1-C-1: pass entryPrice — position just opened at this price (mark-to-market = cost basis).
      state.equityHistory.push(currentEquity(state, entryPrice))

    } else if (signal.action === 'SELL' && state.openTrade) {
      // T+1 exit symmetry: the SELL signal is computed from today's close, so the
      // fill happens at TOMORROW's open (nextOpen) — exactly like BUY entries
      // (L339). Previously this exited at signalPrice (today's close), which is
      // look-ahead: signal and fill shared the same close, a price you cannot
      // trade at once it has printed. Entries already filled at next-open; this
      // removes the entry/exit asymmetry and re-baselines WR — see
      // invariants-baseline.md §1b. Both sides now fill at the raw next-open;
      // the 11 bps/side cost in closePosition / at entry carries the slippage
      // component (executionModel.ts) — no price-level bump on either side (F-9).
      // Phase 14 wave 35: bookkeeping via the shared closePosition primitive.
      closePosition(state, nextOpen)

    } else {
      // Q1-C-1: HOLD — pass signalPrice so equity reflects open-position mark-to-market.
      state.equityHistory.push(currentEquity(state, signalPrice))
    }
  }

  // ── Close remaining open position at final price ──
  // Phase 14 wave 35: bookkeeping via the shared closePosition primitive.
  const finalPrice = rows[rows.length - 1].close
  if (state.openTrade) {
    closePosition(state, finalPrice)
    // Mirror closePosition's equityHistory push so bnhCurve stays index-aligned.
    const div = rows[rows.length - 1].dividend ?? 0
    if (div > 0 && finalPrice > 0) bnhShares += div / finalPrice
    bnhCurve.push(bnhShares * finalPrice)
  }

  const finalEquity = state.capital
  const days = rows.length
  // F1.6 (Phase 13 S2): annualization uses tradingDaysPerYear() — 252 for
  // equities, 365 for crypto. Previously hardcoded 252 understated crypto
  // Sharpe by sqrt(252/365) ≈ 17% and overstated annualized return by ~4-5%/yr.
  const years = days / annualization
  const totalReturn = (finalEquity - initialCapital) / initialCapital
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0
  const bnhReturn = computeBuyAndHoldReturn(rows)

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
      const rfD = getRiskFreeRateSync() / annualization
      sharpe = ((mean - rfD) / sd) * Math.sqrt(annualization)
    }
  }

  // Sortino: delegated to canonical lib/quant/indicators.ts:sortinoRatio.
  // Phase 13 S2 fix (F2.1 + F1.16 + F1.6): consolidated three divergent implementations
  // (engine.ts, portfolioBacktest.ts, indicators.ts) into the single canonical impl.
  // Uses MAR = rfDaily, n_d denominator (Sortino & van der Meer 1991),
  // and minimum n_d ≥ 30 (Bacon 2008 p107). Annualization matches instrument.
  // F1.4 (Phase 13 S2 partial): rate sourced from canonical constant; FRED hookup TBD.
  const rfDaily = getRiskFreeRateSync() / annualization
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
    bnhCurve,
    days, confidenceAvg: state.confidenceCount > 0 ? state.confidenceSum / state.confidenceCount : 0,
    stopLossPct: cfg.stopLossPct,
    bnhReturn, excessReturn: totalReturn - bnhReturn,
  }
}
