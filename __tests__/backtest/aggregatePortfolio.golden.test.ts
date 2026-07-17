/**
 * Q-075 wave 2 (2026-07-17) — golden tests for engine.aggregatePortfolio.
 *
 * The 2026-07-17 Stryker run left engine.ts at 35.32 (150 survived + 2
 * no-coverage) — the aggregator had NO direct tests. It is a pure function
 * over BacktestResult[], so every branch is pinnable with hand-crafted
 * inputs: end-aligned combine, F-4 net-win boundary, sector averaging,
 * stub exclusion, aligned-B&H alpha (F-2) and its fallback, crypto
 * annualization, and the Sharpe/Sortino window gates.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  aggregatePortfolio,
  TX_COST_PCT_PER_SIDE,
  backtestInstrument,
  computeBuyAndHoldReturn,
} from '@/lib/backtest/engine'
import type { BacktestResult, Trade, OhlcvRow } from '@/lib/backtest/engine'

function mkTrade(pnlPct: number): Trade {
  return {
    date: '2026-01-05', ticker: 'T', sector: 'S', action: 'BUY',
    entryPrice: 100, exitPrice: 100 * (1 + pnlPct), shares: 10,
    value: 1000, regime: 'FIRST_DIP', dipSignal: 'STRONG_DIP',
    confidence: 90, pnlPct, reason: 'test',
  }
}

function mkResult(over: Partial<BacktestResult> & { ticker: string }): BacktestResult {
  return {
    sector: 'Technology',
    initialPrice: 100, finalPrice: 110,
    totalReturn: 0.1, annualizedReturn: 0.05,
    sharpeRatio: 1, sortinoRatio: 1,
    maxDrawdown: 0.05, winRate: 0.5, profitFactor: 1.5, avgTradeReturn: 0.01,
    totalTrades: 0, closedTrades: [], openTrade: null,
    dailyReturns: [], equityCurve: [], bnhCurve: undefined,
    days: 300, confidenceAvg: 90, stopLossPct: 0.08,
    bnhReturn: 0.2, excessReturn: -0.1,
    ...over,
  }
}

/**
 * r1 (len 40): 100k ×10, 110k ×10, one-bar 99k dip, 121k ×19.
 * r2 (len 50): flat 200k — its first 10 points fall outside the common
 * window (offset = 10), pinning the end-alignment.
 * Combined (minLen 40): 300k ×10 → 310k ×10 → 299k → 321k ×19.
 */
function curves() {
  const c1: number[] = [
    ...Array(10).fill(100_000), ...Array(10).fill(110_000),
    99_000, ...Array(19).fill(121_000),
  ]
  const c2: number[] = Array(50).fill(200_000)
  return { c1, c2 }
}

describe('aggregatePortfolio — end-aligned combine goldens', () => {
  const { c1, c2 } = curves()
  // bnh over the common window: r1 uses curve[0]→end (len 40 = minLen);
  // r2's window starts at index 10 (50−40).
  const bnh1 = [...Array(20).fill(100), ...Array(20).fill(121)] // +21%
  const bnh2 = [...Array(10).fill(50), ...Array(30).fill(80), ...Array(10).fill(88)] // 80→88 = +10%
  const trades = [mkTrade(0.05), mkTrade(0.001), mkTrade(-0.02)]

  const r1 = mkResult({
    ticker: 'AAA', sector: 'Technology', equityCurve: c1, bnhCurve: bnh1,
    closedTrades: trades, totalReturn: 0.21, annualizedReturn: 0.11,
  })
  const r2 = mkResult({
    ticker: 'BBB', sector: 'Energy', equityCurve: c2, bnhCurve: bnh2,
    closedTrades: [], totalReturn: 0, annualizedReturn: 0,
  })
  const s = aggregatePortfolio([r1, r2], 200_000)

  it('combines end-aligned curves: return, annualization, drawdown', () => {
    expect(s.initialCapital).toBe(300_000)
    expect(s.finalCapital).toBe(321_000)
    expect(s.totalReturn).toBeCloseTo(21_000 / 300_000, 12)
    // years = 39/252 (both equities → 252d calendar)
    expect(s.annualizedReturn).toBeCloseTo(Math.pow(1.07, 252 / 39) - 1, 10)
    // peak 310k, trough 299k on the dip bar
    expect(s.maxDrawdown).toBeCloseTo(11_000 / 310_000, 12)
    expect(s.totalInstruments).toBe(2)
    expect(s.excludedTickers).toEqual([])
  })

  it('Sharpe matches an independent recomputation of the combined curve', () => {
    const combined = c1.map((v, k) => v + c2[k + 10])
    const rets: number[] = []
    for (let i = 1; i < combined.length; i++) rets.push(combined[i] / combined[i - 1] - 1)
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    const sd = Math.sqrt(rets.reduce((x, r) => x + (r - mean) ** 2, 0) / (rets.length - 1))
    const rfD = 0.045 / 252 // cold-cache constant / portfolio calendar
    expect(s.sharpeRatio).not.toBeNull()
    expect(s.sharpeRatio!).toBeCloseTo(((mean - rfD) / sd) * Math.sqrt(252), 10)
    expect(s.sortinoRatio).not.toBeNull()
  })

  it('F-4: a win must clear the ROUND-TRIP cost, not just zero', () => {
    // trades: +5% (win), +0.1% (gross win but ≤ 22 bps → NOT a win), −2% (loss)
    expect(TX_COST_PCT_PER_SIDE).toBeCloseTo(0.0011, 12)
    expect(s.totalTrades).toBe(3)
    expect(s.winRate).toBeCloseTo(1 / 3, 12)
    // grossProfit counts WINNING trades only; grossLoss counts pnl<0 only
    expect(s.profitFactor).toBeCloseTo(0.05 / 0.02, 12)
    expect(s.avgTradeReturn).toBeCloseTo((0.05 + 0.001 - 0.02) / 3, 12)
  })

  it('F-2: alpha uses the ALIGNED common-window B&H average', () => {
    expect(s.bnhAvg).toBeCloseTo((0.21 + 0.1) / 2, 12)
    expect(s.alpha).toBeCloseTo(21_000 / 300_000 - 0.155, 12)
  })

  it('sector table averages the per-result FIELDS per sector', () => {
    expect(s.sectorReturns.Technology).toEqual({
      totalReturn: 0.21, annReturn: 0.11, tickers: ['AAA'],
    })
    expect(s.sectorReturns.Energy).toEqual({
      totalReturn: 0, annReturn: 0, tickers: ['BBB'],
    })
  })

  it('any crypto constituent flips the portfolio calendar to 365d', () => {
    const r2c = mkResult({ ...r2, ticker: 'BTC', sector: 'Crypto', equityCurve: c2, bnhCurve: bnh2 })
    const sc = aggregatePortfolio([r1, r2c], 200_000)
    expect(sc.annualizedReturn).toBeCloseTo(Math.pow(1.07, 365 / 39) - 1, 10)
    expect(sc.totalReturn).toBeCloseTo(s.totalReturn, 12) // unannualized unchanged
  })
})

describe('aggregatePortfolio — stub exclusion and fallbacks', () => {
  const { c1 } = curves()

  it('drops ≤30-point curves, keeps 31-point ones (exact boundary)', () => {
    const real = mkResult({ ticker: 'REAL', equityCurve: c1, closedTrades: [mkTrade(0.05)] })
    const stub = mkResult({ ticker: 'STUB', equityCurve: [100_000] })
    const at30 = mkResult({ ticker: 'AT30', equityCurve: Array(30).fill(50_000) })
    const at31 = mkResult({ ticker: 'AT31', equityCurve: Array(31).fill(50_000) })
    const s = aggregatePortfolio([real, stub, at30, at31], 100_000)
    expect(s.excludedTickers).toEqual(['STUB', 'AT30'])
    expect(s.totalInstruments).toBe(2)
    // minLen becomes 31 (> MIN_COMBINE_LEN) → combine still runs
    expect(s.initialCapital).toBeGreaterThan(0)
    // stub trades are NOT aggregated
    expect(s.totalTrades).toBe(1)
    // instruments echoes the RAW input list (disclosure), not the filtered one
    expect(s.instruments).toHaveLength(4)
  })

  it('all-stub input collapses to explicit zeros, not NaN', () => {
    const s = aggregatePortfolio([mkResult({ ticker: 'S1', equityCurve: [1] })], 100_000)
    expect(s.totalReturn).toBe(0)
    expect(s.annualizedReturn).toBe(0)
    expect(s.sharpeRatio).toBeNull()
    expect(s.sortinoRatio).toBeNull()
    expect(s.maxDrawdown).toBe(0)
    expect(s.finalCapital).toBe(0)
    expect(s.bnhAvg).toBe(0)
    expect(s.alpha).toBe(0)
    expect(s.excludedTickers).toEqual(['S1'])
    expect(s.winRate).toBe(0)
    expect(s.profitFactor).toBe(0)
  })

  it('empty input yields the same explicit-zero shape', () => {
    const s = aggregatePortfolio([], 100_000)
    expect(s.totalReturn).toBe(0)
    expect(s.totalInstruments).toBe(0)
    expect(s.excludedTickers).toEqual([])
  })

  it('missing/mismatched bnhCurve falls back to full-history bnhReturn average', () => {
    const a = mkResult({ ticker: 'A', equityCurve: c1, bnhCurve: undefined, bnhReturn: 0.3 })
    const b = mkResult({ ticker: 'B', equityCurve: c1, bnhCurve: c1.slice(0, 20), bnhReturn: 0.1 })
    const s = aggregatePortfolio([a, b], 100_000)
    expect(s.bnhAvg).toBeCloseTo(0.2, 12) // (0.3 + 0.1) / 2 — legacy path
  })

  it('corrupt aligned-B&H window (non-positive start) falls back too', () => {
    const good = mkResult({ ticker: 'G', equityCurve: c1, bnhCurve: Array(40).fill(100), bnhReturn: 0.4 })
    const bad = mkResult({ ticker: 'Z', equityCurve: c1, bnhCurve: [0, ...Array(39).fill(100)], bnhReturn: 0.2 })
    const s = aggregatePortfolio([good, bad], 100_000)
    // bad's window start is curve[0] = 0 → aligned path aborts → field average
    expect(s.bnhAvg).toBeCloseTo(0.3, 12)
  })

  it('profitFactor edges: Infinity with wins and no losses; 0 with neither', () => {
    const wins = mkResult({ ticker: 'W', equityCurve: c1, closedTrades: [mkTrade(0.05)] })
    expect(aggregatePortfolio([wins], 1).profitFactor).toBe(Infinity)
    const flat = mkResult({ ticker: 'F', equityCurve: c1, closedTrades: [mkTrade(0.001)] })
    // 0.1% is a gross win under the F-4 net rule: no NET wins, no losses
    const sf = aggregatePortfolio([flat], 1)
    expect(sf.profitFactor).toBe(0)
    expect(sf.winRate).toBe(0)
  })
})

// ─── core.ts dividend accrual (F1.5) — bnhShares/bnhCurve goldens ────────────
// The 2026-07-17 shard left an 11-mutant cluster on core.ts:261-278 (warmup
// dividend accrual + in-loop accrual + bnhCurve push): every earlier fixture
// was dividend-free, so those lines were only length-tested. This fixture
// pays a $2 dividend every 50 bars and pins the accrued curve exactly.

describe('backtestInstrument — dividend-reinvested B&H goldens (production path)', () => {
  beforeEach(() => vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '0'))
  afterEach(() => vi.unstubAllEnvs())

  function divSeries(): OhlcvRow[] {
    const START_TIME = Date.UTC(2024, 0, 1) / 1000
    const closes: number[] = []
    let level = 100
    let g = 0.004
    for (let i = 0; i < 380; i++) {
      if (i > 0) level *= 1 + g
      if (i === 300) { level *= 0.64; g = 0.005 }
      closes.push(level)
    }
    return closes.map((close, i) => ({
      time: START_TIME + i * 86400,
      open: i === 0 ? close : closes[i - 1],
      high: Math.max(close, i === 0 ? close : closes[i - 1]) + 0.2,
      low: Math.min(close, i === 0 ? close : closes[i - 1]) - 0.2,
      close,
      volume: 1_000_000 + (i % 7) * 50_000,
      ...(i > 0 && i % 50 === 25 ? { dividend: 2 } : {}),
    }))
  }

  it('accrues warmup + in-loop dividends into bnhCurve at exact values', () => {
    const rows = divSeries()
    const res = backtestInstrument('AAPL', 'Technology', rows)
    // engine bnhReturn delegates to the canonical helper — exact identity
    expect(res.bnhReturn).toBe(computeBuyAndHoldReturn(rows))
    expect(res.bnhReturn).toBeCloseTo(2.409595, 5) // vs 2.143494 dividend-free
    expect(res.bnhCurve).toHaveLength(180)
    // bnhCurve[0] = shares-after-200-bar-warmup × close[200]: four ex-dates
    // (25/75/125/175) accrued before the walk begins
    expect(res.bnhCurve![0]).toBeCloseTo(234.423281, 5)
    expect(res.bnhCurve![50]).toBeCloseTo(287.271853, 5)
    expect(res.bnhCurve![179]).toBeCloseTo(339.263227, 5)
    // dividends touch only the B&H side — the strategy trade is unchanged
    expect(res.totalReturn).toBeCloseTo(0.052381, 5)
    expect(res.totalTrades).toBe(1)
    expect(res.excessReturn).toBeCloseTo(res.totalReturn - res.bnhReturn, 10)
  })
})
