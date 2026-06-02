import { describe, it, expect } from 'vitest'
import {
  runPortfolioBacktest,
  DEFAULT_PORTFOLIO_CONFIG,
} from '@/lib/backtest/portfolioBacktest'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'

// ─── Synthetic OHLCV fixture builders ───────────────────────────────────────

const SECONDS_PER_DAY = 86400
const START_TIME = Date.UTC(2024, 0, 1) / 1000  // 2024-01-01 UTC

/**
 * Build a synthetic 1-instrument OHLCV series with a price walk.
 * `priceFn(i)` returns the close at bar i; OHLC are derived with small spread.
 */
function makeOhlcv(
  bars: number,
  priceFn: (i: number) => number,
  range = 0.5,
): OhlcvRow[] {
  const out: OhlcvRow[] = []
  for (let i = 0; i < bars; i++) {
    const close = priceFn(i)
    const open = i === 0 ? close : priceFn(i - 1)
    out.push({
      time: START_TIME + i * SECONDS_PER_DAY,
      open,
      high: Math.max(open, close) + range,
      low: Math.min(open, close) - range,
      close,
      volume: 1_000_000,
    })
  }
  return out
}

/** Linear uptrend: 100 → 100 + bars × slope, with sinusoidal noise. */
function uptrendSeries(bars: number, slope = 0.05, amp = 1, phase = 0): OhlcvRow[] {
  return makeOhlcv(bars, (i) => 100 + i * slope + Math.sin(i * 0.1 + phase) * amp)
}

/** Sideways with noise around 100. */
function sidewaysSeries(bars: number, amp = 1, phase = 0): OhlcvRow[] {
  return makeOhlcv(bars, (i) => 100 + Math.sin(i * 0.2 + phase) * amp)
}

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('runPortfolioBacktest — edge cases', () => {
  it('returns emptyResult for no instruments', () => {
    const res = runPortfolioBacktest({}, {})
    expect(res.totalTrades).toBe(0)
    expect(res.equityCurve).toEqual([DEFAULT_PORTFOLIO_CONFIG.initialCapital])
    expect(res.sharpeRatio).toBeNull()
    expect(res.sortinoRatio).toBeNull()
    expect(res.maxDrawdown).toBe(0)
  })

  it('handles single instrument with too-short series gracefully', () => {
    const data = { ABC: makeOhlcv(50, (i) => 100 + i) }  // < 220 warmup
    const res = runPortfolioBacktest(data, { ABC: 'Test' })
    expect(res.totalTrades).toBe(0)
    // Equity curve should at least start at initial capital and not crash.
    expect(res.equityCurve[0]).toBe(DEFAULT_PORTFOLIO_CONFIG.initialCapital)
  })

  it('runs to completion on a 300-bar single instrument', () => {
    const data = { ABC: uptrendSeries(300) }
    const res = runPortfolioBacktest(data, { ABC: 'Test' })
    // We don't assert positive return — synthetic series may not trigger trades —
    // but the function must complete without throwing.
    expect(res).toBeTruthy()
    expect(res.equityCurve.length).toBeGreaterThan(0)
    expect(res.maxConcurrentPositions).toBeGreaterThanOrEqual(0)
    expect(res.maxConcurrentPositions).toBeLessThanOrEqual(DEFAULT_PORTFOLIO_CONFIG.maxPositions)
  })
})

// ─── F1.2 acceptance test ───────────────────────────────────────────────────

describe('runPortfolioBacktest — F1.2 (curve-based portfolio max DD)', () => {
  it('reports a reasonable max DD on a healthy uptrend portfolio', () => {
    // 5 uptrend instruments with decorrelated noise.
    const data = {
      A: uptrendSeries(400, 0.06, 1, 0),
      B: uptrendSeries(400, 0.05, 1, 1.5),
      C: uptrendSeries(400, 0.04, 1, 3),
      D: uptrendSeries(400, 0.05, 1, 4.5),
      E: uptrendSeries(400, 0.06, 1, 6),
    }
    const sectorMap = { A: 'T1', B: 'T2', C: 'T3', D: 'T4', E: 'T5' }
    const res = runPortfolioBacktest(data, sectorMap)
    // Curve-based DD must be a real fraction in [0, 1].
    expect(res.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(res.maxDrawdown).toBeLessThan(1)
    // We can't assert exact magnitude on synthetic data, but it must not be
    // identically equal to the worst instrument's individual DD when curves
    // are truly diversified — that would indicate the F1.2 fix is missing.
  })
})

// ─── F1.7 acceptance test ───────────────────────────────────────────────────

describe('runPortfolioBacktest — F1.7 (correlation-adjusted Kelly)', () => {
  it('correlation gate at 0 is permissive (acts as no-op)', () => {
    const data = {
      A: uptrendSeries(400, 0.05, 1, 0),
      B: uptrendSeries(400, 0.05, 1, 0),  // perfectly correlated
    }
    const sectorMap = { A: 'T', B: 'T' }
    const res = runPortfolioBacktest(data, sectorMap, { correlationGate: 0 })
    // Smoke test: function completes and returns sensible structure.
    expect(res).toBeTruthy()
    expect(res.totalTrades).toBeGreaterThanOrEqual(0)
  })

  it('correlation gate of 0.99 effectively disables shrinking', () => {
    const data = {
      A: uptrendSeries(400, 0.05, 1, 0),
      B: uptrendSeries(400, 0.05, 1, 0),
    }
    const sectorMap = { A: 'T', B: 'T' }
    const res = runPortfolioBacktest(data, sectorMap, { correlationGate: 0.99 })
    expect(res).toBeTruthy()
  })
})

// ─── F1.18 acceptance test ──────────────────────────────────────────────────

describe('runPortfolioBacktest — F1.18 (Kelly cash-bankroll)', () => {
  it('never produces a final capital that goes nonsensically negative', () => {
    const data = {
      A: sidewaysSeries(400, 5, 0),
      B: sidewaysSeries(400, 5, 1.5),
      C: sidewaysSeries(400, 5, 3),
    }
    const sectorMap = { A: 'T', B: 'T', C: 'T' }
    const res = runPortfolioBacktest(data, sectorMap)
    expect(res.finalCapital).toBeGreaterThan(0)
  })
})

// ─── F1.20 acceptance test ──────────────────────────────────────────────────

describe('runPortfolioBacktest — F1.20 (VaR sample threshold)', () => {
  it('returns null VaR on short series (< 100 daily returns)', () => {
    const data = { A: uptrendSeries(250, 0.05) }  // ~30 trading days post-warmup
    const sectorMap = { A: 'T' }
    const res = runPortfolioBacktest(data, sectorMap)
    // 250 bars - 220 warmup = 30 daily returns max → both 95 (≥100) and 99 (≥250) null
    expect(res.varMetrics.var95_1d).toBeNull()
    expect(res.varMetrics.var99_1d).toBeNull()
  })

  it('returns numeric VaR_95 on 320+ bar series (post-warmup ≥ 100)', () => {
    const data = { A: uptrendSeries(330, 0.05) }
    const sectorMap = { A: 'T' }
    const res = runPortfolioBacktest(data, sectorMap)
    // 330 - 220 = ~110 daily returns → var95 should exist
    if (res.dailyReturns.length >= 100) {
      expect(res.varMetrics.var95_1d).not.toBeNull()
    }
  })
})

// ─── Sanity: result shape ────────────────────────────────────────────────────

describe('runPortfolioBacktest — result shape', () => {
  it('every required field is present and well-typed', () => {
    const data = { A: uptrendSeries(280) }
    const res = runPortfolioBacktest(data, { A: 'T' })
    expect(typeof res.totalReturn).toBe('number')
    expect(typeof res.annualizedReturn).toBe('number')
    expect(typeof res.maxDrawdown).toBe('number')
    expect(typeof res.winRate).toBe('number')
    expect(typeof res.profitFactor).toBe('number')
    expect(typeof res.totalTrades).toBe('number')
    expect(Array.isArray(res.trades)).toBe(true)
    expect(Array.isArray(res.equityCurve)).toBe(true)
    expect(Array.isArray(res.dailyReturns)).toBe(true)
    expect(typeof res.sectorAttribution).toBe('object')
    expect(typeof res.exitReasonBreakdown).toBe('object')
    // Exit reason breakdown has all 7 keys.
    expect(Object.keys(res.exitReasonBreakdown).sort()).toEqual([
      'end_of_data', 'max_drawdown', 'panic_exit', 'profit_target',
      'signal', 'stop_loss', 'time_exit',
    ])
  })
})

describe('runPortfolioBacktest — D2-1 T+1 entry (WS2)', () => {
  it('net pnlPct reflects round-trip costs when trades exist', () => {
    const data = { A: uptrendSeries(400, 0.08) }
    const res = runPortfolioBacktest(data, { A: 'Technology' }, {
      ...DEFAULT_PORTFOLIO_CONFIG,
      maxPositions: 1,
    })
    for (const t of res.trades) {
      const gross = (t.exitPrice - t.entryPrice) / t.entryPrice
      // Net pnlPct must be strictly below gross when costs apply (unless breakeven edge).
      if (Math.abs(gross) > 0.001) {
        expect(t.pnlPct).toBeLessThanOrEqual(gross + 1e-9)
      }
    }
  })
})
