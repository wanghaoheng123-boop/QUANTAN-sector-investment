import { describe, it, expect } from 'vitest'
import {
  evaluateSignalOutcomes,
  computeAccuracyReport,
  checkAccuracyAlerts,
} from '@/lib/qa/signalTracker'

describe('Signal Outcome Evaluation', () => {
  it('computes returns at 5d, 10d, 20d horizons', () => {
    const signals = [{
      ticker: 'AAPL',
      date: '2024-01-01',
      action: 'BUY' as const,
      confidence: 80,
      entryPrice: 100,
      regime: 'FIRST_DIP',
    }]
    // Future prices: stock goes up
    const futurePrices = new Map([
      ['AAPL', Array.from({ length: 25 }, (_, i) => 100 + (i + 1) * 0.5)],
    ])

    const tracked = evaluateSignalOutcomes(signals, futurePrices)
    expect(tracked[0].return5d).toBeCloseTo(0.025, 5) // (102.5 - 100) / 100
    expect(tracked[0].return10d).toBeCloseTo(0.05, 5)  // (105 - 100) / 100
    expect(tracked[0].return20d).toBeCloseTo(0.10, 5)  // (110 - 100) / 100
    expect(tracked[0].outcome5d).toBe('WIN')
    expect(tracked[0].outcome20d).toBe('WIN')
  })

  it('BUY with negative return is LOSS', () => {
    const signals = [{
      ticker: 'AAPL', date: '2024-01-01', action: 'BUY' as const,
      confidence: 70, entryPrice: 100, regime: 'FIRST_DIP',
    }]
    const futurePrices = new Map([
      ['AAPL', Array.from({ length: 25 }, (_, i) => 100 - (i + 1) * 0.5)],
    ])
    const tracked = evaluateSignalOutcomes(signals, futurePrices)
    expect(tracked[0].outcome5d).toBe('LOSS')
  })

  it('SELL with negative return is WIN', () => {
    const signals = [{
      ticker: 'AAPL', date: '2024-01-01', action: 'SELL' as const,
      confidence: 85, entryPrice: 100, regime: 'EXTREME_BULL',
    }]
    const futurePrices = new Map([
      ['AAPL', Array.from({ length: 25 }, (_, i) => 100 - (i + 1) * 0.3)],
    ])
    const tracked = evaluateSignalOutcomes(signals, futurePrices)
    expect(tracked[0].outcome20d).toBe('WIN')
  })

  it('insufficient future data returns PENDING', () => {
    const signals = [{
      ticker: 'AAPL', date: '2024-01-01', action: 'BUY' as const,
      confidence: 70, entryPrice: 100, regime: 'FIRST_DIP',
    }]
    const futurePrices = new Map([['AAPL', [101, 102, 103]]]) // only 3 days
    const tracked = evaluateSignalOutcomes(signals, futurePrices)
    expect(tracked[0].outcome5d).toBe('PENDING')
    expect(tracked[0].return5d).toBeNull()
  })
})

describe('Accuracy Report', () => {
  it('computes win rates correctly', () => {
    const signals = [
      { ticker: 'A', date: '1', action: 'BUY' as const, confidence: 80, entryPrice: 100, regime: 'X', outcome5d: 'WIN' as const, outcome10d: 'WIN' as const, outcome20d: 'WIN' as const, return5d: 0.02, return10d: 0.04, return20d: 0.08 },
      { ticker: 'B', date: '2', action: 'BUY' as const, confidence: 60, entryPrice: 100, regime: 'X', outcome5d: 'LOSS' as const, outcome10d: 'WIN' as const, outcome20d: 'WIN' as const, return5d: -0.01, return10d: 0.02, return20d: 0.05 },
      { ticker: 'C', date: '3', action: 'BUY' as const, confidence: 50, entryPrice: 100, regime: 'X', outcome5d: 'LOSS' as const, outcome10d: 'LOSS' as const, outcome20d: 'LOSS' as const, return5d: -0.03, return10d: -0.05, return20d: -0.08 },
    ]
    const report = computeAccuracyReport(signals)
    expect(report.totalSignals).toBe(3)
    expect(report.buySignals).toBe(3)
    expect(report.winRate5d).toBeCloseTo(1 / 3, 5) // 1 win out of 3
    expect(report.winRate10d).toBeCloseTo(2 / 3, 5)
    expect(report.winRate20d).toBeCloseTo(2 / 3, 5)
  })

  it('handles no signals gracefully', () => {
    const report = computeAccuracyReport([])
    expect(report.totalSignals).toBe(0)
    expect(report.winRate5d).toBeNull()
    expect(report.winRate20d).toBeNull()
  })

  it('HOLD signals are excluded from actionable count', () => {
    const signals = [
      { ticker: 'A', date: '1', action: 'HOLD' as const, confidence: 50, entryPrice: 100, regime: 'X', outcome5d: 'PENDING' as const, outcome10d: 'PENDING' as const, outcome20d: 'PENDING' as const },
    ]
    const report = computeAccuracyReport(signals)
    expect(report.buySignals).toBe(0)
    expect(report.sellSignals).toBe(0)
  })
})

describe('Accuracy Alerts', () => {
  it('alerts when win rate drops below threshold', () => {
    const report = {
      totalSignals: 100, buySignals: 80, sellSignals: 20,
      winRate5d: 0.40, winRate10d: 0.45, winRate20d: 0.48,
      avgReturn5d: -0.01, avgReturn10d: -0.005, avgReturn20d: 0.001,
      falsePositiveRate5d: 0.55, falsePositiveRate20d: 0.52,
      highConfidenceWinRate: 0.50, lowConfidenceWinRate: 0.60,
    }
    const alerts = checkAccuracyAlerts(report)
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts.some(a => a.includes('win rate'))).toBe(true)
    expect(alerts.some(a => a.includes('False positive'))).toBe(true)
    expect(alerts.some(a => a.includes('calibration'))).toBe(true)
  })

  it('no alerts for healthy metrics', () => {
    const report = {
      totalSignals: 100, buySignals: 80, sellSignals: 20,
      winRate5d: 0.65, winRate10d: 0.68, winRate20d: 0.72,
      avgReturn5d: 0.02, avgReturn10d: 0.035, avgReturn20d: 0.06,
      falsePositiveRate5d: 0.30, falsePositiveRate20d: 0.28,
      highConfidenceWinRate: 0.80, lowConfidenceWinRate: 0.55,
    }
    const alerts = checkAccuracyAlerts(report)
    expect(alerts).toHaveLength(0)
  })
})
