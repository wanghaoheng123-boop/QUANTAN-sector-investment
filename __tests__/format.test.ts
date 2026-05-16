import { describe, it, expect } from 'vitest'
import {
  safeFixed,
  formatCurrency,
  formatPercent,
  formatSignedNumber,
  formatCompactNumber,
} from '@/lib/format'

/**
 * Phase 13 S2 cross-cutting Pattern 3 audit — SSOT safe-numeric helpers.
 * Every UI surface that renders an upstream-sourced number now passes
 * through one of these helpers. Tests pin down the fallback contract so
 * a regression that lets `NaN` reach `.toFixed()` is caught immediately.
 */

describe('safeFixed (SSOT)', () => {
  it('returns the fixed-digit string for finite numbers', () => {
    expect(safeFixed(1.234, 2)).toBe('1.23')
    expect(safeFixed(-50.5, 1)).toBe('-50.5')
    expect(safeFixed(0, 2)).toBe('0.00')
    expect(safeFixed(0, 0)).toBe('0')
  })

  it('respects the digits parameter', () => {
    expect(safeFixed(3.14159, 4)).toBe('3.1416')
    expect(safeFixed(3.14159, 0)).toBe('3')
  })

  it('default digits = 2', () => {
    expect(safeFixed(1.23456)).toBe('1.23')
  })

  it('returns fallback "—" for null/undefined', () => {
    expect(safeFixed(null)).toBe('—')
    expect(safeFixed(undefined)).toBe('—')
  })

  it('returns fallback "—" for NaN / ±Infinity', () => {
    expect(safeFixed(NaN)).toBe('—')
    expect(safeFixed(Infinity)).toBe('—')
    expect(safeFixed(-Infinity)).toBe('—')
  })

  it('respects custom fallback', () => {
    expect(safeFixed(null, 2, 'N/A')).toBe('N/A')
    expect(safeFixed(NaN, 2, '')).toBe('')
  })
})

describe('formatCurrency', () => {
  it('renders $X.XX with thousands separators', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
    expect(formatCurrency(0.99)).toBe('$0.99')
  })

  it('returns "—" for non-finite', () => {
    expect(formatCurrency(NaN)).toBe('—')
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(undefined)).toBe('—')
    expect(formatCurrency(Infinity)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('multiplies by 100 and adds % suffix', () => {
    expect(formatPercent(0.05)).toBe('5.00%')
    expect(formatPercent(0.123)).toBe('12.30%')
  })

  it('signed=true adds + for positive only', () => {
    expect(formatPercent(0.05, 2, true)).toBe('+5.00%')
    expect(formatPercent(-0.05, 2, true)).toBe('-5.00%')
    expect(formatPercent(0, 2, true)).toBe('0.00%')
  })

  it('returns "—" for non-finite', () => {
    expect(formatPercent(NaN)).toBe('—')
    expect(formatPercent(Infinity)).toBe('—')
  })
})

describe('formatSignedNumber', () => {
  it('adds + prefix for positive', () => {
    expect(formatSignedNumber(5)).toBe('+5.00')
    expect(formatSignedNumber(-5)).toBe('-5.00')
    expect(formatSignedNumber(0)).toBe('0.00')
  })

  it('returns "—" for non-finite', () => {
    expect(formatSignedNumber(NaN)).toBe('—')
  })
})

describe('formatCompactNumber', () => {
  it('renders compact notation (K / M / B / T)', () => {
    expect(formatCompactNumber(1_500)).toBe('1.5K')
    expect(formatCompactNumber(2_300_000)).toBe('2.3M')
    expect(formatCompactNumber(3_500_000_000_000)).toBe('3.5T')
  })

  it('returns "—" for non-finite', () => {
    expect(formatCompactNumber(NaN)).toBe('—')
  })
})
