import { describe, it, expect } from 'vitest'
import { validateQuote, validateOhlcvSeries } from '@/lib/qa/dataValidator'

describe('Quote Validation', () => {
  it('perfect quote gets score 100', () => {
    const report = validateQuote('AAPL', {
      price: 185.50,
      change: 2.30,
      changePct: 1.25,
      volume: 50_000_000,
      high52w: 200,
      low52w: 140,
      pe: 28,
      quoteTime: new Date().toISOString(),
    })
    expect(report.score).toBe(100)
    expect(report.issues).toHaveLength(0)
  })

  it('null price is an error', () => {
    const report = validateQuote('TEST', { price: null })
    expect(report.issues.some(i => i.severity === 'error')).toBe(true)
    expect(report.score).toBeLessThan(100)
  })

  it('NaN price is an error', () => {
    const report = validateQuote('TEST', { price: NaN })
    expect(report.issues.some(i => i.severity === 'error')).toBe(true)
  })

  it('zero price is an error', () => {
    const report = validateQuote('TEST', { price: 0 })
    expect(report.issues.some(i => i.severity === 'error')).toBe(true)
  })

  it('extreme daily change is a warning', () => {
    const report = validateQuote('TEST', { price: 100, changePct: 25 })
    expect(report.issues.some(i => i.field === 'changePct' && i.severity === 'warning')).toBe(true)
  })

  it('zero volume is info', () => {
    const report = validateQuote('TEST', { price: 100, volume: 0 })
    expect(report.issues.some(i => i.field === 'volume' && i.severity === 'info')).toBe(true)
  })

  it('stale quote is a warning', () => {
    const staleTime = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const report = validateQuote('TEST', { price: 100, quoteTime: staleTime })
    expect(report.issues.some(i => i.field === 'quoteTime')).toBe(true)
  })
})

describe('OHLCV Series Validation', () => {
  it('empty series is an error', () => {
    const issues = validateOhlcvSeries('TEST', [])
    expect(issues.some(i => i.severity === 'error')).toBe(true)
  })

  it('clean series has no issues', () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({
      open: 100 + i * 0.1,
      high: 102 + i * 0.1,
      low: 99 + i * 0.1,
      close: 101 + i * 0.1,
      volume: 1_000_000,
    }))
    const issues = validateOhlcvSeries('TEST', bars)
    expect(issues).toHaveLength(0)
  })

  it('detects NaN values', () => {
    const bars = [
      { open: 100, high: 102, low: 99, close: NaN },
    ]
    const issues = validateOhlcvSeries('TEST', bars)
    expect(issues.some(i => i.message.includes('NaN'))).toBe(true)
  })

  it('detects high < low inversion', () => {
    const bars = [
      { open: 100, high: 95, low: 102, close: 100 },
    ]
    const issues = validateOhlcvSeries('TEST', bars)
    expect(issues.some(i => i.message.includes('inversion'))).toBe(true)
  })

  it('detects extreme single-day moves', () => {
    const bars = [
      { open: 100, high: 102, low: 99, close: 100 },
      { open: 100, high: 160, low: 98, close: 150 }, // +50%
    ]
    const issues = validateOhlcvSeries('TEST', bars)
    expect(issues.some(i => i.message.includes('Extreme move'))).toBe(true)
  })
})
