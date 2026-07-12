/**
 * Backtest engine — pure computation, no API calls, no side effects.
 * Used by Next.js API routes and the CLI runner.
 */

import type { OhlcBar } from '@/lib/quant/indicators'
import { resolveBacktestSignal, DEFAULT_CONFIG, type BacktestConfig } from './signals'
import { sortinoRatio, atrArray as atr } from '@/lib/quant/indicators'
import { getRiskFreeRateSync } from '@/lib/quant/riskFreeRate'
import { LABEL_MATCHED_EXIT_CONFIG } from './exitRules'
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
  // F-4 (2026-07-06, owner-directed): win/loss classification is NET of the
  // round-trip transaction cost (2 × 11 bps/side ≈ 22 bps of entry notional),
  // so the backtest page's "net-profitable after those costs" Win Rate copy is
  // literally true. Previously a trade with 0 < pnl ≤ 22 bps counted as a win
  // even though it lost money after costs. `pnlPct` itself stays the raw price
  // move (it feeds profitFactor / avgTradeReturn and the trade log).
  const netPnlPct = pnlPct - 2 * TX_COST_PCT_PER_SIDE
  if (netPnlPct > 0) { state.tradeWins++; state.grossProfit += pnlPct }
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

  // D2 (2026-07-11): row index of the open position's entry FILL bar (i+1 at
  // the signal bar), for the label-matched time exit below. −1 when flat.
  // Mirrors the portfolio engine's OpenPosition.entryIdx convention (F-11).
  let entryFillBar = -1

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

    // ── D2 (2026-07-11): label-matched TIME EXIT — the only position-level exit ──
    // The former ATR-adaptive stop + trailing/break-even stops are RETIRED.
    // Measured on frozen data they inverted the dip edge (buy weakness, then
    // stop exactly where pullback noise lives): without them the engine's net
    // trade WR went 24.0% → 54.13% and total return 1× → 3.3× (R1 acceptance
    // experiment, reviews/RETHINK-2026-07-11/ + `npm run experiment:stop-removal`).
    // Positions exit after LABEL_MATCHED_EXIT_CONFIG.maxHoldDays bars (20 —
    // the horizon the published label WR is measured on): observed at today's
    // close, FILLED at tomorrow's open (T+1 symmetry with entries, same
    // convention as the portfolio engine's time_exit). The portfolio-level
    // max-drawdown circuit breaker below remains active.
    if (state.openTrade && entryFillBar >= 0 &&
        i - entryFillBar >= LABEL_MATCHED_EXIT_CONFIG.maxHoldDays) {
      // A corrupt next-open (0/NaN) cannot be traded: hold one more bar
      // (mirrors the entry-side guard) instead of poisoning the curve.
      if (Number.isFinite(nextOpen) && nextOpen > 0) {
        closePosition(state, nextOpen)
        entryFillBar = -1
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
      closePosition(state, nextOpen)
      entryFillBar = -1
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
      // D2: fill bar for the label-matched time exit (entry fills at open i+1).
      entryFillBar = i + 1
      // Q1-C-1: pass entryPrice — position just opened at this price (mark-to-market = cost basis).
      state.equityHistory.push(currentEquity(state, entryPrice))

    } else {
      // Q1-C-1: HOLD (and, since D4 2026-07-11, SELL) — pass signalPrice so
      // equity reflects open-position mark-to-market.
      //
      // D4: the falling-knife SELL no longer exits positions. Verified on
      // frozen data (C6, `npm run experiment:sell-check`): bars where the SSOT
      // emits SELL have HIGHER forward 20d net WR than the always-buy base
      // rate in EVERY sample year — as a long-only exit it systematically sold
      // before rebounds; retiring it is no-regression (R4). The SELL signal
      // remains published for display/alerting; it just no longer drives the
      // engine's exits.
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
