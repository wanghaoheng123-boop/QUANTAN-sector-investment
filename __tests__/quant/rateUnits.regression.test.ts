/**
 * `sharpeRatio` takes an ANNUAL rate; `sortinoRatio` takes a DAILY one.
 *
 * Q110-Q4f (2026-09-06) — two functions in the same SSOT file, adjacent in the
 * source, taking the same concept in different units, both parameters typed
 * `number`. I passed the daily rate to BOTH while delegating
 * `scripts/benchmark-enhanced.ts` to this module. That silently set Sharpe's
 * risk-free rate to 0.045/252 ≈ 1.8e-4 — effectively zero — and `tsc` was
 * clean, because there is nothing in `number` for it to object to.
 *
 * Branding the two rates as distinct types is the fix that would make the error
 * UNREPRESENTABLE, and it is still the better one; it is not done here because
 * it changes the contract at ~25 call sites including tests, which is a
 * migration rather than a drive-by. These guards are the cheap layer: they
 * cannot prevent the mistake, but they make it LOUD instead of silent, which is
 * the difference between a wrong number and a stack trace.
 *
 * The two ranges are cleanly separable, which is why a heuristic works at all:
 * no real annual risk-free rate is under 5 bps, and a daily one is about 2 bps.
 */
import { describe, it, expect } from 'vitest'
import { sharpeRatio, sortinoRatio } from '../../lib/quant/indicators'

const ANNUAL = 0.045
const DAILY = ANNUAL / 252 // ≈ 1.7857e-4
const returns = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? -0.008 : 0.005))

describe('rate units are caught at the boundary (Q110-Q4f)', () => {
  it('sharpeRatio REJECTS a daily rate passed as annual — the exact mistake made', () => {
    expect(() => sharpeRatio(returns, DAILY, 252)).toThrow(/implausibly small for an ANNUAL rate/)
  })

  it('sortinoRatio REJECTS an annual rate passed as a daily MAR', () => {
    expect(() => sortinoRatio(returns, ANNUAL, 252)).toThrow(/exceeds 1% PER DAY/)
  })

  it('each accepts the unit it actually documents', () => {
    // Reachability: guards that rejected everything would pass both cases above.
    expect(sharpeRatio(returns, ANNUAL, 252)).not.toBeNull()
    expect(sortinoRatio(returns, DAILY, 252)).not.toBeNull()
  })

  it('zero is legal on both — it means "no target", not a unit', () => {
    expect(sharpeRatio(returns, 0, 252)).not.toBeNull()
    expect(sortinoRatio(returns, 0, 252)).not.toBeNull()
  })

  it('the error names the sibling, so the reader learns the asymmetry', () => {
    // A guard that only says "bad input" leaves you to rediscover WHY the two
    // differ. Both messages point at the other function by name.
    expect(() => sharpeRatio(returns, DAILY, 252)).toThrow(/sortinoRatio takes a daily MAR/)
    expect(() => sortinoRatio(returns, ANNUAL, 252)).toThrow(/sharpeRatio takes the annual rate/)
  })

  it('what these guards CANNOT do — asserted, so green is not read as proof', () => {
    // The ranges only separate because real rates are small. A 2%/yr annual
    // rate divided by 252 is 7.9e-5 and IS caught; but an implausible-yet-legal
    // pairing inside both bands is not. A brand would catch it; a heuristic
    // never will.
    const insideBothBands = 0.005 // legal as a daily MAR, legal as an annual rate
    expect(() => sortinoRatio(returns, insideBothBands, 252)).not.toThrow()
    expect(() => sharpeRatio(returns, insideBothBands, 252)).not.toThrow()
  })
})
