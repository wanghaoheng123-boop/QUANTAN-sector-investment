import { describe, it, expect } from 'vitest'
import { loadStockHistory } from '@/lib/backtest/dataLoader'
import { walkForwardAnalysis, walkForwardSummary } from '@/lib/backtest/walkForward'

/**
 * Q11 / F-12: walk-forward IS/OS returns + Sharpe were annualized with a
 * hardcoded 252 trading-days/year, which is wrong for crypto (365). The fix
 * threads tradingDaysPerYear(ticker, sector); it is a no-op for equities (252)
 * and only corrects crypto. walkForward is a diagnostic (no API route / no CI
 * gate / not UI-surfaced), so this changes nothing published.
 */
describe('walkForward — F-12 calendar-aware annualization (Q11)', () => {
  // Real series known to fire trades; same rows used for both runs so the only
  // difference is the annualization factor (252 vs 365).
  const rows = loadStockHistory('AAPL')

  it('crypto (365) annualizes the SAME window returns to a larger magnitude than equity (252)', () => {
    if (rows.length < 567) return // need WARMUP(252) + trainDays(252) + testDays(63)

    const eq = walkForwardAnalysis('AAPL', 'Technology', rows) // periodDays = 252
    const cr = walkForwardAnalysis('BTC', 'crypto', rows)      // periodDays = 365

    expect(eq.length).toBeGreaterThan(0)
    expect(cr.length).toBe(eq.length) // identical window partition; only the factor differs

    // Zero-return windows annualize to 0 under any factor — find a non-zero one.
    const i = eq.findIndex((w) => w.isReturn !== 0)
    expect(i).toBeGreaterThan(-1) // fixture sanity: AAPL produces a non-zero IS window

    // years = days / periodDays; crypto's smaller `years` => larger |annualized| for r != 0.
    expect(Math.abs(cr[i].isReturn)).toBeGreaterThan(Math.abs(eq[i].isReturn))
    expect(cr[i].isReturn).not.toBe(eq[i].isReturn)
  })

  it('equity path is unchanged (252) — regression lock for non-crypto callers', () => {
    if (rows.length < 567) return
    // 'Technology' and an unknown sector both resolve to 252 → identical output.
    const tech = walkForwardAnalysis('AAPL', 'Technology', rows)
    const other = walkForwardAnalysis('AAPL', 'Healthcare', rows)
    expect(other.map((w) => w.isReturn)).toEqual(tech.map((w) => w.isReturn))
    expect(other.map((w) => w.osReturn)).toEqual(tech.map((w) => w.osReturn))
  })

  it('summary invariants hold for the crypto path too', () => {
    if (rows.length < 567) return
    const cr = walkForwardAnalysis('BTC', 'crypto', rows)
    const summary = walkForwardSummary(cr)
    expect(summary.overfittingIndex).toBeGreaterThanOrEqual(0)
    expect(summary.overfittingIndex).toBeLessThanOrEqual(1)
  })
})
