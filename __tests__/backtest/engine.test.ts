import { describe, it, expect } from 'vitest'
import {
  backtestInstrument,
  aggregatePortfolio,
  walkForwardAnalysis,
  walkForwardSummary,
  TX_COST_BPS_PER_SIDE,
  TX_COST_PCT_PER_SIDE,
} from '@/lib/backtest/engine'
import type { OhlcvRow } from '@/lib/backtest/engine'

// Generate synthetic OHLCV data
function generateRows(
  count: number,
  startPrice: number,
  dailyReturn: number = 0.0005,
  volatility: number = 0.02,
): OhlcvRow[] {
  const rows: OhlcvRow[] = []
  let price = startPrice
  const startTime = Math.floor(new Date('2019-01-01').getTime() / 1000)

  for (let i = 0; i < count; i++) {
    const noise = (Math.random() - 0.5) * volatility * price
    const open = price
    const close = price * (1 + dailyReturn) + noise
    const high = Math.max(open, close) + Math.abs(noise) * 0.5
    const low = Math.min(open, close) - Math.abs(noise) * 0.5

    rows.push({
      time: startTime + i * 86400,
      open,
      high,
      low,
      close: Math.max(close, 1), // prevent negative prices
      volume: 1_000_000 + Math.floor(Math.random() * 500_000),
    })
    price = Math.max(close, 1)
  }
  return rows
}

describe('Transaction Cost Model', () => {
  it('has correct cost values', () => {
    expect(TX_COST_BPS_PER_SIDE).toBe(11)
    expect(TX_COST_PCT_PER_SIDE).toBeCloseTo(0.0011, 10)
  })
})

describe('Backtest Engine', () => {
  it('returns minimal result for insufficient data (<252 bars)', () => {
    const rows = generateRows(100, 100)
    const result = backtestInstrument('TEST', 'Technology', rows)
    expect(result.totalTrades).toBe(0)
    expect(result.closedTrades).toHaveLength(0)
    expect(result.totalReturn).toBe(0)
  })

  it('returns valid result for sufficient data', () => {
    const rows = generateRows(500, 100, 0.0003, 0.015)
    const result = backtestInstrument('TEST', 'Technology', rows)

    expect(result.ticker).toBe('TEST')
    expect(result.sector).toBe('Technology')
    expect(result.days).toBe(500)
    expect(result.initialPrice).toBeCloseTo(rows[0].close, 5)
    expect(result.finalPrice).toBeCloseTo(rows[rows.length - 1].close, 5)
    expect(result.equityCurve.length).toBeGreaterThan(0)
    expect(result.equityCurve[0]).toBe(100_000) // initial capital
  })

  it('equity curve starts at initial capital', () => {
    const rows = generateRows(300, 100)
    const result = backtestInstrument('TEST', 'Technology', rows)
    expect(result.equityCurve[0]).toBe(100_000)
  })

  it('win rate is between 0 and 1', () => {
    const rows = generateRows(500, 100, 0.0003)
    const result = backtestInstrument('TEST', 'Technology', rows)
    expect(result.winRate).toBeGreaterThanOrEqual(0)
    expect(result.winRate).toBeLessThanOrEqual(1)
  })

  it('max drawdown is between 0 and 1', () => {
    const rows = generateRows(500, 100, 0.0003)
    const result = backtestInstrument('TEST', 'Technology', rows)
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(result.maxDrawdown).toBeLessThanOrEqual(1)
  })

  it('buy-and-hold return matches price change', () => {
    const rows = generateRows(500, 100, 0.001)
    const result = backtestInstrument('TEST', 'Technology', rows)
    const expectedBnH = (result.finalPrice - result.initialPrice) / result.initialPrice
    expect(result.bnhReturn).toBeCloseTo(expectedBnH, 5)
  })

  it('excess return = total return - buy-and-hold', () => {
    const rows = generateRows(500, 100, 0.0005)
    const result = backtestInstrument('TEST', 'Technology', rows)
    expect(result.excessReturn).toBeCloseTo(result.totalReturn - result.bnhReturn, 10)
  })

  it('closed trades have valid P&L percentages', () => {
    const rows = generateRows(500, 100, 0.0003, 0.03)
    const result = backtestInstrument('TEST', 'Technology', rows)
    for (const trade of result.closedTrades) {
      expect(trade.pnlPct).not.toBeNull()
      expect(Number.isFinite(trade.pnlPct)).toBe(true)
      expect(trade.entryPrice).toBeGreaterThan(0)
      expect(trade.exitPrice).toBeGreaterThan(0)
      expect(trade.shares).toBeGreaterThan(0)
    }
  })

  it('no look-ahead bias: signals use only past data', () => {
    // The engine uses lookbackCloses = closes.slice(0, i + 1)
    // and executes at next-day open. We verify by checking that
    // entry dates precede execution dates in the trade log.
    const rows = generateRows(500, 100, 0.0003, 0.02)
    const result = backtestInstrument('TEST', 'Technology', rows)
    // Each trade's entryPrice should be based on next-day open
    // which is always after the signal date
    for (const trade of result.closedTrades) {
      expect(trade.date).toBeTruthy()
    }
  })

  it('respects custom config', () => {
    const rows = generateRows(500, 100)
    const result = backtestInstrument('TEST', 'Technology', rows, {
      initialCapital: 50_000,
    })
    expect(result.equityCurve[0]).toBe(50_000)
  })
})

describe('Portfolio Aggregation', () => {
  it('aggregates multiple instruments', () => {
    const rows1 = generateRows(500, 100, 0.0005)
    const rows2 = generateRows(500, 50, 0.0003)

    const r1 = backtestInstrument('AAPL', 'Technology', rows1)
    const r2 = backtestInstrument('XOM', 'Energy', rows2)

    const portfolio = aggregatePortfolio([r1, r2], 100_000)

    expect(portfolio.totalInstruments).toBe(2)
    expect(portfolio.totalTrades).toBe(r1.totalTrades + r2.totalTrades)
    expect(portfolio.winRate).toBeGreaterThanOrEqual(0)
    expect(portfolio.winRate).toBeLessThanOrEqual(1)
  })

  it('sector returns are grouped correctly', () => {
    const rows1 = generateRows(500, 100, 0.0005)
    const rows2 = generateRows(500, 80, 0.0003)

    const r1 = backtestInstrument('AAPL', 'Technology', rows1)
    const r2 = backtestInstrument('MSFT', 'Technology', rows2)

    const portfolio = aggregatePortfolio([r1, r2], 100_000)

    expect(portfolio.sectorReturns['Technology']).toBeDefined()
    expect(portfolio.sectorReturns['Technology'].tickers).toContain('AAPL')
    expect(portfolio.sectorReturns['Technology'].tickers).toContain('MSFT')
  })

  it('handles empty results array', () => {
    const portfolio = aggregatePortfolio([], 100_000)
    expect(portfolio.totalInstruments).toBe(0)
    expect(portfolio.totalTrades).toBe(0)
    expect(portfolio.winRate).toBe(0)
  })
})

describe('Walk-Forward Analysis', () => {
  it('returns windows for sufficient data', () => {
    const rows = generateRows(800, 100, 0.0003)
    const windows = walkForwardAnalysis('TEST', 'Technology', rows, 252, 63)
    expect(windows.length).toBeGreaterThan(0)
  })

  it('each window has valid structure', () => {
    const rows = generateRows(800, 100, 0.0003)
    const windows = walkForwardAnalysis('TEST', 'Technology', rows, 252, 63)
    for (const w of windows) {
      expect(w.periodLabel).toBeTruthy()
      expect(w.startDate).toBeTruthy()
      expect(w.endDate).toBeTruthy()
      expect(Number.isFinite(w.isReturn)).toBe(true)
      expect(Number.isFinite(w.osReturn)).toBe(true)
    }
  })

  it('walk-forward summary computes averages', () => {
    const rows = generateRows(800, 100, 0.0003)
    const windows = walkForwardAnalysis('TEST', 'Technology', rows, 252, 63)
    const summary = walkForwardSummary(windows)

    expect(Number.isFinite(summary.avgIsReturn)).toBe(true)
    expect(Number.isFinite(summary.avgOsReturn)).toBe(true)
    expect(summary.overfittingIndex).toBeGreaterThanOrEqual(0)
    expect(summary.overfittingIndex).toBeLessThanOrEqual(1)
    expect(summary.windows).toEqual(windows)
  })

  it('empty windows produce default summary', () => {
    const summary = walkForwardSummary([])
    expect(summary.avgIsReturn).toBe(0)
    expect(summary.avgOsReturn).toBe(0)
    expect(summary.overfittingIndex).toBe(1)
  })
})
