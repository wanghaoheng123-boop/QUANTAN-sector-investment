/**
 * Q01 regression: profit-factor display must not crash when the value arrives as
 * `null`. The engine reports an all-wins/no-losses profit factor as `Infinity`,
 * which `JSON.stringify`/`NextResponse.json` turns into `null` before the client
 * sees it — so the old `=== Infinity ? '∞' : pf.toFixed(2)` guard missed and
 * `null.toFixed(2)` crashed the AnalysisTab render.
 */
import { describe, it, expect } from 'vitest'
import { formatProfitFactor } from '@/lib/backtest/formatMetrics'

describe('formatProfitFactor (Q01)', () => {
  it('formats a finite profit factor to 2dp', () => {
    expect(formatProfitFactor(2.5)).toBe('2.50')
    expect(formatProfitFactor(0)).toBe('0.00')
    expect(formatProfitFactor(13.333)).toBe('13.33')
  })

  it('shows ∞ for null (the post-JSON form of Infinity) — the crash case', () => {
    expect(formatProfitFactor(null)).toBe('∞')
  })

  it('shows ∞ for Infinity and other non-finite values', () => {
    expect(formatProfitFactor(Infinity)).toBe('∞')
    expect(formatProfitFactor(NaN)).toBe('∞')
    expect(formatProfitFactor(undefined)).toBe('∞')
  })
})
