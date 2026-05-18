/**
 * Multi-instrument portfolio backtest engine.
 *
 * Simulates a portfolio holding up to maxPositions simultaneous positions.
 * Uses correlation-adjusted Kelly sizing and sector rotation for rebalancing.
 *
 * Key institutional features:
 *   - Simultaneous multi-stock positions (max 10 concurrent)
 *   - Max 20% single-position concentration
 *   - Correlation-adjusted Kelly (reduces size for correlated adds)
 *   - Monthly sector rotation rebalancing
 *   - Portfolio-level max drawdown circuit breaker
 *   - Enhanced exit rules (ATR stops, profit-taking, panic exits)
 */

import type { OhlcvRow } from '@/scripts/backtest/dataLoader'
import { enhancedCombinedSignal, DEFAULT_CONFIG } from '@/lib/backtest/signals'
import type { BacktestConfig, SectorGateConfig } from '@/lib/backtest/signals'
import { atrArray, sortinoRatio } from '@/lib/quant/indicators'
import { maxCorrelationVsPeers, correlationAdjustedKelly } from '@/lib/quant/correlation'
import { BACKTEST_RFR_ANNUAL } from '@/lib/quant/constants'
import {
  checkExitConditions, updatePosition, atrAdaptiveStop,
  DEFAULT_EXIT_CONFIG,
} from '@/lib/backtest/exitRules'
import type { OpenPosition, ExitConfig, ExitReason } from '@/lib/backtest/exitRules'
import { SECTOR_PROFILES } from '@/lib/optimize/sectorProfiles'

export interface PortfolioConfig extends BacktestConfig {
  maxPositions: number        // max concurrent positions (default 10)
  maxSinglePositionPct: number // max % of portfolio in one stock (default 0.20)
  monthlyRebalance: boolean   // rebalance based on sector rotation monthly
  correlationGate: number     // max correlation increase before reducing Kelly
  exit: ExitConfig
  /**
   * Per-ticker macro gate overrides. Phase 12-A: wires SECTOR_PROFILES into
   * enhancedCombinedSignal so per-sector gates (golden cross, TLT/yield curve,
   * threshold overrides) apply during portfolio backtests. Default: derived from
   * SECTOR_PROFILES on first call.
   */
  tickerSectorGates?: Record<string, SectorGateConfig>
}

export const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = {
  ...DEFAULT_CONFIG,
  maxPositions: 10,
  maxSinglePositionPct: 0.20,
  monthlyRebalance: false,
  correlationGate: 0.20,
  exit: DEFAULT_EXIT_CONFIG,
}

export interface PortfolioTrade {
  ticker: string
  sector: string
  entryDate: string
  exitDate: string
  entryPrice: number
  exitPrice: number
  shares: number
  pnlPct: number
  pnlDollar: number
  exitReason: ExitReason
  confidence: number
}

export interface PortfolioBacktestResult {
  initialCapital: number
  finalCapital: number
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number | null
  sortinoRatio: number | null
  maxDrawdown: number
  winRate: number
  profitFactor: number
  avgTradeReturn: number
  totalTrades: number
  maxConcurrentPositions: number
  avgConcurrentPositions: number
  trades: PortfolioTrade[]
  equityCurve: number[]
  dailyReturns: number[]
  sectorAttribution: Record<string, { trades: number; winRate: number; avgReturn: number }>
  exitReasonBreakdown: Record<ExitReason, number>
  varMetrics: { var95_1d: number | null; var99_1d: number | null }
}

interface LivePosition extends OpenPosition {
  capital: number  // capital allocated
}

/**
 * Run a multi-instrument walk-forward portfolio backtest.
 *
 * @param instrumentData  Record of ticker -> sorted OHLCV rows
 * @param sectorMap       Record of ticker -> sector name
 * @param config          Portfolio configuration
 */
export function runPortfolioBacktest(
  instrumentData: Record<string, OhlcvRow[]>,
  sectorMap: Record<string, string>,
  config: Partial<PortfolioConfig> = {},
): PortfolioBacktestResult {
  const cfg: PortfolioConfig = { ...DEFAULT_PORTFOLIO_CONFIG, ...config }
  const initialCapital = cfg.initialCapital

  // Align all instruments to the same date range
  const tickers = Object.keys(instrumentData)
  if (tickers.length === 0) {
    return emptyResult(initialCapital)
  }

  // Build a unified date index (union of all trading dates)
  const dateSet = new Set<number>()
  for (const rows of Object.values(instrumentData)) {
    for (const row of rows) dateSet.add(row.time)
  }
  const dates = Array.from(dateSet).sort()

  // Price lookup: ticker -> (date -> row index)
  const priceIndex: Record<string, Map<number, number>> = {}
  for (const [ticker, rows] of Object.entries(instrumentData)) {
    priceIndex[ticker] = new Map(rows.map((r, i) => [r.time, i]))
  }

  // Portfolio state
  let capital = initialCapital
  let peakEquity = initialCapital
  const equityHistory: number[] = [initialCapital]
  const dailyReturns: number[] = []
  const closedTrades: PortfolioTrade[] = []
  const openPositions = new Map<string, LivePosition>()
  let maxConcurrent = 0
  let concurrentSum = 0

  // Phase 13 S2 fix (F1.7): per-ticker rolling-return series populated each
  // bar; consumed by correlation-adjusted Kelly when sizing new BUYs.
  // Previously declared but never read or written — F1.7 falsely-advertised.
  const tickerDailyReturns: Record<string, number[]> = {}
  for (const ticker of tickers) tickerDailyReturns[ticker] = []
  // Retain only the most recent N samples to bound memory and bias correlation
  // toward recent regime. 63 ≈ 3 trading months — typical lookback in
  // institutional risk reports for short-term correlation.
  const CORRELATION_WINDOW = 63

  // Phase 14 wave 6: pre-seed correlation tape from the warm-up window so
  // the first ~20 trading days don't fail-closed via maxCorrelationVsPeers.
  // Without this, the tape is empty at di=220, maxCorrelationVsPeers
  // returns null for <20 history, and correlationAdjustedKelly fail-closes
  // to 0 — blocking ALL new positions for the first ~20 trading days.
  // Seed using the unified-date window so per-ticker indices stay consistent.
  const CORR_SEED_BARS = 25
  const seedStartDi = Math.max(0, 220 - CORR_SEED_BARS)
  for (const t of tickers) {
    const rows = instrumentData[t] ?? []
    const seed: number[] = []
    for (let i = seedStartDi + 1; i < 220 && i < dates.length; i++) {
      const prevTime = dates[i - 1]
      const currTime = dates[i]
      const prevIdx = priceIndex[t]?.get(prevTime)
      const currIdx = priceIndex[t]?.get(currTime)
      if (prevIdx == null || currIdx == null) continue
      const prev = rows[prevIdx]?.close
      const curr = rows[currIdx]?.close
      if (prev && curr && prev > 0 && Number.isFinite(curr) && Number.isFinite(prev)) {
        seed.push(curr / prev - 1)
      }
    }
    tickerDailyReturns[t] = seed
  }

  // Phase 12-A: Build per-ticker sector-gate map.
  // Resolution order:
  //   1) explicit cfg.tickerSectorGates override (per-ticker)
  //   2) SECTOR_PROFILES lookup by ticker membership (extracts gate-relevant subset)
  //   3) fallback: undefined (signal uses DEFAULT_CONFIG)
  const sectorGateByTicker: Record<string, SectorGateConfig> = (() => {
    const map: Record<string, SectorGateConfig> = {}
    for (const profile of Object.values(SECTOR_PROFILES)) {
      for (const t of profile.tickers) {
        map[t] = {
          goldenCrossGate: profile.goldenCrossGate,
          requirePositiveMomentum: profile.requirePositiveMomentum,
          buyWScoreThreshold: profile.buyWScoreThreshold,
          sellWScoreThreshold: profile.sellWScoreThreshold,
          slopeThreshold: profile.slopeThreshold,
          tlrGate: profile.tlrGate,
          // SectorProfile doesn't expose yieldCurveGate explicitly — Financials inherits
          // via a reasonable default at the call site if needed.
        }
      }
    }
    // Per-ticker overrides win.
    return { ...map, ...(cfg.tickerSectorGates ?? {}) }
  })()

  for (let di = 220; di < dates.length; di++) {
    const currentTime = dates[di]
    const currentDate = new Date(currentTime * 1000).toISOString().split('T')[0]

    let dayPnl = 0

    // F1.7: update per-ticker daily-return tape for correlation analysis.
    // Computed from the previous trading bar to avoid look-ahead bias —
    // any ticker without a prior bar at this date is skipped.
    for (const t of tickers) {
      const rows = instrumentData[t]
      const idx = priceIndex[t].get(currentTime)
      if (idx == null || idx < 1) continue
      const prev = rows[idx - 1].close
      const curr = rows[idx].close
      if (prev > 0 && Number.isFinite(curr) && Number.isFinite(prev)) {
        const r = (curr - prev) / prev
        const tape = tickerDailyReturns[t]
        tape.push(r)
        if (tape.length > CORRELATION_WINDOW) tape.shift()
      }
    }

    // ── Update open positions ────────────────────────────────────────────────
    for (const [ticker, pos] of openPositions) {
      const rows = instrumentData[ticker]
      const idx = priceIndex[ticker].get(currentTime)
      if (idx == null || idx < 1) continue

      const row = rows[idx]
      const price = row.close

      // Update highest price for trailing stop + last-known close for MTM (F1.19).
      const updatedPos = updatePosition(pos, price)
      openPositions.set(ticker, {
        ...pos,
        highestPrice: updatedPos.highestPrice,
        lastKnownClose: price,
      })

      // Compute current ATR%
      const recentBars = rows.slice(Math.max(0, idx - 20), idx + 1).map(r => ({
        open: r.open, high: r.high, low: r.low, close: r.close,
      }))
      const atrVals = atrArray(recentBars, 14)
      const currentATRPct = atrVals[atrVals.length - 1] > 0 && price > 0
        ? atrVals[atrVals.length - 1] / price
        : pos.entryATRPct

      // Get signal for exit check
      const lookback = rows.slice(0, idx + 1)
      const closes = lookback.map(r => r.close)
      const bars = lookback.map(r => ({ open: r.open, high: r.high, low: r.low, close: r.close }))
      const ohlcv = lookback.map(r => ({
        open: r.open, high: r.high, low: r.low, close: r.close,
        volume: r.volume ?? 0, time: r.time,
      }))

      let signalAction: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
      try {
        // Phase 12-A: pass per-ticker sector gate
        const sig = enhancedCombinedSignal(
          ticker, currentDate, price, closes, bars, ohlcv, cfg,
          sectorGateByTicker[ticker],
        )
        signalAction = sig.action
      } catch (err) {
        // Phase 14 wave 21: log the signal-generation error so a regression
        // (e.g. a NaN bar that throws inside an indicator) leaves a trace.
        // We still keep HOLD as the conservative fallback, but the warn
        // surfaces what would otherwise be a silent algorithm failure.
        console.warn(
          `[portfolioBacktest] signal generation failed for ${ticker} on ${currentDate}:`,
          err instanceof Error ? err.message : err,
        )
      }

      // Check exit conditions — F1.3 (Phase 13 S2): pass the full bar so
      // stop-loss and profit-target evaluation uses bar.low / bar.high
      // (intraday breach), not just bar.close.
      const exitCheck = checkExitConditions(
        pos, di, price, currentDate, currentATRPct, signalAction, cfg.exit,
        { open: row.open, high: row.high, low: row.low, close: row.close },
      )

      if (exitCheck) {
        const exitPrice = exitCheck.exitPrice
        const exitShares = exitCheck.isPartial
          ? Math.floor(pos.currentShares * exitCheck.partialFraction)
          : pos.currentShares

        // Phase 14 wave 7: skip zero-share partial exits.
        // Bug: small positions (currentShares = 1 with partialFraction = 0.5)
        // floor to exitShares = 0 but the prior code still pushed a "trade"
        // record (shares=0, pnlDollar=0) and flipped partialExitDone=true,
        // poisoning win-rate stats (zero-share trades count toward the
        // denominator) and stripping the position of its profit-target exit
        // path so it could only exit via trailing stop afterwards.
        if (exitCheck.isPartial && exitShares <= 0) {
          continue  // keep position intact, partialExitDone stays false
        }

        const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice
        const pnlDollar = exitShares * (exitPrice - pos.entryPrice)

        const exitTxCost = exitShares * exitPrice * 0.0011  // 11bps exit cost
        capital += (exitShares * exitPrice - exitTxCost)
        dayPnl += (pnlDollar - exitTxCost)

        closedTrades.push({
          ticker, sector: sectorMap[ticker] ?? 'Unknown',
          entryDate: pos.entryDate, exitDate: currentDate,
          entryPrice: pos.entryPrice, exitPrice,
          shares: exitShares, pnlPct, pnlDollar,
          exitReason: exitCheck.reason,
          confidence: pos.confidence,
        })

        if (exitCheck.isPartial) {
          openPositions.set(ticker, {
            ...pos,
            currentShares: pos.currentShares - exitShares,
            partialExitDone: true,
            // Update stop to break-even after partial profit-take
            stopLossPrice: Math.max(pos.stopLossPrice, pos.entryPrice),
          })
        } else {
          // F1.21 (Phase 13 S2): cleaned up dead state-machine code.
          // Previous version had a self-canceling -X +X capital adjustment plus
          // an empty `if (isPartial === false)` branch — leftovers from a bug
          // hunt. exitShares already equals pos.currentShares when !isPartial,
          // and capital was already credited for the full exit at line 250.
          openPositions.delete(ticker)
        }
      }
    }

    // ── Scan for new BUY signals ──────────────────────────────────────────────
    if (openPositions.size < cfg.maxPositions) {
      for (const ticker of tickers) {
        if (openPositions.has(ticker)) continue

        const rows = instrumentData[ticker]
        const idx = priceIndex[ticker].get(currentTime)
        if (idx == null || idx < 220) continue

        const row = rows[idx]
        const price = row.close

        const lookback = rows.slice(0, idx + 1)
        const closes = lookback.map(r => r.close)
        const bars = lookback.map(r => ({ open: r.open, high: r.high, low: r.low, close: r.close }))
        const ohlcv = lookback.map(r => ({
          open: r.open, high: r.high, low: r.low, close: r.close,
          volume: r.volume ?? 0, time: r.time,
        }))

        let sig
        try {
          // Phase 12-A: pass per-ticker sector gate
          sig = enhancedCombinedSignal(
            ticker, currentDate, price, closes, bars, ohlcv, cfg,
            sectorGateByTicker[ticker],
          )
        } catch { continue }

        if (sig.action !== 'BUY') continue

        // Portfolio-level max drawdown circuit breaker
        const currentEquity = capital + Array.from(openPositions.values()).reduce(
          (s, p) => {
            const pidx = priceIndex[p.ticker]?.get(currentTime)
            const prow = pidx != null ? instrumentData[p.ticker][pidx] : null
            return s + p.currentShares * (prow?.close ?? p.lastKnownClose ?? p.entryPrice)
          }, 0,
        )
        if (currentEquity > peakEquity) peakEquity = currentEquity
        const dd = (peakEquity - currentEquity) / peakEquity
        if (dd >= cfg.maxDrawdownCap) continue

        // F1.7: correlation-adjusted Kelly. Shrink the candidate's Kelly
        // fraction when its 63-day return profile is highly correlated with
        // any existing open position (Thorp 2006 §5). Below the gate the
        // base Kelly passes through unchanged.
        const candidateReturns = tickerDailyReturns[ticker] ?? []
        const peerReturns: number[][] = []
        for (const t of openPositions.keys()) {
          const peer = tickerDailyReturns[t]
          if (peer && peer.length > 0) peerReturns.push(peer)
        }
        const maxRho = peerReturns.length > 0
          ? maxCorrelationVsPeers(candidateReturns, peerReturns, 20)
          : 0
        const adjustedKelly = correlationAdjustedKelly(
          sig.KellyFraction,
          maxRho,
          cfg.correlationGate,
        )

        // F1.18 (Phase 13 S2): Kelly applies to bankroll (available cash),
        // concentration cap applies to total equity (cash + MTM positions).
        // Previously Kelly used currentEquity, allowing oversizing against
        // unrealized gains in other positions and risking negative capital
        // when cash < kelly*equity. (Thorp 2006 — Kelly is on bankroll.)
        const maxAllocation = Math.min(
          capital * adjustedKelly,
          currentEquity * cfg.maxSinglePositionPct,
        )
        // Defensive guard: never spend more than we have.
        const cashCap = Math.max(0, capital * 0.99)  // small buffer for tx cost
        const allowed = Math.min(maxAllocation, cashCap)
        if (allowed < price) continue

        const atrResult = atrAdaptiveStop(price, bars, cfg.exit.atrStopMultiplier)
        // F1.18: size shares from `allowed` (cash-bounded), not maxAllocation.
        const shares = Math.floor(allowed / price)
        if (shares <= 0) continue

        const txCost = shares * price * 0.0011  // 11bps entry cost
        capital -= (shares * price + txCost)
        openPositions.set(ticker, {
          ticker,
          sector: sectorMap[ticker] ?? 'Unknown',
          entryIdx: di,
          entryPrice: price,
          entryDate: currentDate,
          entryATRPct: atrResult.atrPct,
          stopLossPrice: atrResult.stopLossPrice,
          initialShares: shares,
          currentShares: shares,
          highestPrice: price,
          partialExitDone: false,
          confidence: sig.confidence,
          reason: sig.reason,
          capital: shares * price,
        })

        if (openPositions.size >= cfg.maxPositions) break
      }
    }

    // ── Track equity ─────────────────────────────────────────────────────────
    const posValue = Array.from(openPositions.values()).reduce((s, p) => {
      const pidx = priceIndex[p.ticker]?.get(currentTime)
      const prow = pidx != null ? instrumentData[p.ticker][pidx] : null
      return s + p.currentShares * (prow?.close ?? p.lastKnownClose ?? p.entryPrice)
    }, 0)
    const equity = capital + posValue
    if (equity > peakEquity) peakEquity = equity
    const dd = (peakEquity - equity) / peakEquity
    if (dd >= cfg.maxDrawdownCap) {
      // Portfolio circuit breaker — close all positions
      for (const [ticker, pos] of openPositions) {
        const pidx = priceIndex[ticker]?.get(currentTime)
        const prow = pidx != null ? instrumentData[ticker][pidx] : null
        const exitPrice = prow?.close ?? pos.lastKnownClose ?? pos.entryPrice
        capital += pos.currentShares * exitPrice * (1 - 0.0011)  // 11bps exit cost
        closedTrades.push({
          ticker, sector: sectorMap[ticker] ?? 'Unknown',
          entryDate: pos.entryDate, exitDate: currentDate,
          entryPrice: pos.entryPrice, exitPrice,
          shares: pos.currentShares,
          pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,
          pnlDollar: pos.currentShares * (exitPrice - pos.entryPrice),
          exitReason: 'max_drawdown',
          confidence: pos.confidence,
        })
      }
      openPositions.clear()
    }

    const finalEquity = capital + Array.from(openPositions.values()).reduce((s, p) => {
      const pidx = priceIndex[p.ticker]?.get(currentTime)
      const prow = pidx != null ? instrumentData[p.ticker][pidx] : null
      return s + p.currentShares * (prow?.close ?? p.lastKnownClose ?? p.entryPrice)
    }, 0)

    equityHistory.push(finalEquity)
    if (equityHistory.length > 1) {
      const prev = equityHistory[equityHistory.length - 2]
      if (prev > 0) dailyReturns.push((finalEquity - prev) / prev)
    }

    concurrentSum += openPositions.size
    if (openPositions.size > maxConcurrent) maxConcurrent = openPositions.size
  }

  // ── Close remaining positions ─────────────────────────────────────────────
  const finalDate = new Date(dates[dates.length - 1] * 1000).toISOString().split('T')[0]
  for (const [ticker, pos] of openPositions) {
    const rows = instrumentData[ticker]
    const lastRow = rows[rows.length - 1]
    const exitPrice = lastRow.close
    capital += pos.currentShares * exitPrice * (1 - 0.0011)  // 11bps exit cost
    closedTrades.push({
      ticker, sector: sectorMap[ticker] ?? 'Unknown',
      entryDate: pos.entryDate, exitDate: finalDate,
      entryPrice: pos.entryPrice, exitPrice,
      shares: pos.currentShares,
      pnlPct: (exitPrice - pos.entryPrice) / pos.entryPrice,
      pnlDollar: pos.currentShares * (exitPrice - pos.entryPrice),
      exitReason: 'end_of_data',
      confidence: pos.confidence,
    })
  }

  // ── Compute metrics ───────────────────────────────────────────────────────
  const finalCapital = capital
  const totalReturn = (finalCapital - initialCapital) / initialCapital
  const years = dates.length / 252
  const annualizedReturn = years > 0 ? (1 + totalReturn) ** (1 / years) - 1 : 0

  let peak2 = initialCapital, maxDd = 0
  for (const eq of equityHistory) {
    if (eq > peak2) peak2 = eq
    const d = (peak2 - eq) / peak2
    if (d > maxDd) maxDd = d
  }

  const winning = closedTrades.filter(t => t.pnlPct > 0)
  const winRate = closedTrades.length > 0 ? winning.length / closedTrades.length : 0
  const grossProfit = winning.reduce((s, t) => s + t.pnlPct, 0)
  const grossLoss = Math.abs(closedTrades.filter(t => t.pnlPct < 0).reduce((s, t) => s + t.pnlPct, 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  const avgTradeReturn = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + t.pnlPct, 0) / closedTrades.length : 0

  // Phase 13 S2 fix (F1.16): Sortino delegated to canonical indicators.ts impl.
  // Sharpe stays inline (no SSOT divergence to fix).
  let sharpe: number | null = null
  // F1.4 (Phase 13 S2 partial): rate sourced from canonical constant; FRED hookup TBD.
  const rfD = BACKTEST_RFR_ANNUAL / 252
  if (dailyReturns.length > 30) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
    const sd = Math.sqrt(Math.max(variance, 0))
    if (sd > 0) sharpe = ((mean - rfD) / sd) * Math.sqrt(252)
  }
  const sortino = sortinoRatio(dailyReturns, rfD, 252)

  // Sector attribution
  const sectorAttr: Record<string, { trades: number; wins: number; totalReturn: number }> = {}
  for (const t of closedTrades) {
    if (!sectorAttr[t.sector]) sectorAttr[t.sector] = { trades: 0, wins: 0, totalReturn: 0 }
    sectorAttr[t.sector].trades++
    if (t.pnlPct > 0) sectorAttr[t.sector].wins++
    sectorAttr[t.sector].totalReturn += t.pnlPct
  }
  const sectorAttribution: Record<string, { trades: number; winRate: number; avgReturn: number }> = {}
  for (const [s, d] of Object.entries(sectorAttr)) {
    sectorAttribution[s] = {
      trades: d.trades,
      winRate: d.trades > 0 ? d.wins / d.trades : 0,
      avgReturn: d.trades > 0 ? d.totalReturn / d.trades : 0,
    }
  }

  // Exit reason breakdown
  const exitBreakdown: Record<ExitReason, number> = {
    signal: 0, stop_loss: 0, time_exit: 0,
    profit_target: 0, panic_exit: 0, max_drawdown: 0, end_of_data: 0,
  }
  for (const t of closedTrades) exitBreakdown[t.exitReason]++

  // F1.20 (Phase 13 S2): VaR threshold raised so percentile estimates are
  // statistically stable. With N=30, 99% VaR sat at index 0 (worst single
  // observation) — a noisy point estimate. Per Jorion (2006) p119-122, ≥250
  // bars (~1y) is the institutional standard for stable historical 99% VaR;
  // 100 bars is acceptable for 95% VaR. Below those gates the field is null.
  const sortedReturns = dailyReturns.length > 0
    ? [...dailyReturns].sort((a, b) => a - b)
    : []
  const var95_1d = dailyReturns.length >= 100
    ? -sortedReturns[Math.floor(0.05 * dailyReturns.length)]
    : null
  const var99_1d = dailyReturns.length >= 250
    ? -sortedReturns[Math.floor(0.01 * dailyReturns.length)]
    : null

  return {
    initialCapital, finalCapital, totalReturn, annualizedReturn,
    sharpeRatio: sharpe, sortinoRatio: sortino, maxDrawdown: maxDd,
    winRate, profitFactor, avgTradeReturn,
    totalTrades: closedTrades.length,
    maxConcurrentPositions: maxConcurrent,
    avgConcurrentPositions: dates.length > 0 ? concurrentSum / dates.length : 0,
    trades: closedTrades,
    equityCurve: equityHistory,
    dailyReturns,
    sectorAttribution,
    exitReasonBreakdown: exitBreakdown,
    varMetrics: { var95_1d, var99_1d },
  }
}

function emptyResult(initialCapital: number): PortfolioBacktestResult {
  return {
    initialCapital, finalCapital: initialCapital, totalReturn: 0, annualizedReturn: 0,
    sharpeRatio: null, sortinoRatio: null, maxDrawdown: 0,
    winRate: 0, profitFactor: 0, avgTradeReturn: 0, totalTrades: 0,
    maxConcurrentPositions: 0, avgConcurrentPositions: 0,
    trades: [], equityCurve: [initialCapital], dailyReturns: [],
    sectorAttribution: {},
    exitReasonBreakdown: { signal: 0, stop_loss: 0, time_exit: 0, profit_target: 0, panic_exit: 0, max_drawdown: 0, end_of_data: 0 },
    varMetrics: { var95_1d: null, var99_1d: null },
  }
}
