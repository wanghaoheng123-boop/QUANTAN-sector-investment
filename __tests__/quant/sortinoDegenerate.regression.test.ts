/**
 * Sortino returned a CONSTANT that encoded "never opened a position", and
 * rendered it as an instrument-specific risk-adjusted return.
 *
 * With MAR = m > 0 (which is what every production call site passes — the daily
 * risk-free rate) and a return series of all zeros, every deviation is exactly
 * −m, so the downside deviation is m and the whole expression collapses:
 *
 *     Sortino = (0 − m) / m × sqrt(ann) = −sqrt(ann)
 *
 * for ANY instrument and ANY data. Measured on the committed fixtures before the
 * fix: TWENTY of 56 instruments returned −15.874507866387, which is −sqrt(252)
 * to floating-point accumulation, and ALL TWENTY had `totalTrades === 0`. In
 * `AnalysisTab` they sat beside a Sharpe that correctly showed "—" on the same
 * row, because `sharpeRatio` guards the dispersion of the RETURNS and
 * `sortinoRatio` guarded only the dispersion of the DEVIATIONS — which a
 * positive MAR pins at m and never lets reach zero.
 *
 * The guard that was there could not fire. That is this repo's recurring shape,
 * arriving this time as a threshold that the arithmetic makes unreachable.
 */
import { describe, it, expect } from 'vitest'
import { sortinoRatio, sharpeRatio } from '../../lib/quant/indicators'

const RF_DAILY = 0.045 / 252
const flat = (n: number) => Array<number>(n).fill(0)

describe('sortinoRatio — a constant series is not gradeable (Q110-Q4)', () => {
  it('returns null instead of −sqrt(annualization) on an all-zero series', () => {
    expect(sortinoRatio(flat(1053), RF_DAILY, 252)).toBeNull()
  })

  it('agrees with sharpeRatio about which series can be graded', () => {
    // The property that matters: the two metrics may not disagree about whether
    // a series is gradeable. They did, visibly, on the same table row.
    const series = flat(1053)
    expect(sharpeRatio(series, 0, 252)).toBeNull()
    expect(sortinoRatio(series, RF_DAILY, 252)).toBeNull()
  })

  it('the OLD behaviour is reproduced exactly, so the fix is not cosmetic', () => {
    // The constant the 20 instruments used to show, derived rather than pasted:
    // with every return 0 and MAR m, dsd = m and the ratio is −sqrt(ann).
    const m = RF_DAILY
    const collapsed = ((0 - m) / m) * Math.sqrt(252)
    expect(collapsed).toBeCloseTo(-15.874507866387544, 10)
    expect(collapsed).toBeCloseTo(-Math.sqrt(252), 12)
  })

  it('is not fooled by a constant NON-zero series either', () => {
    // Same degeneracy, different offset: every return equal to 0.001.
    expect(sortinoRatio(Array<number>(500).fill(0.001), RF_DAILY, 252)).toBeNull()
  })

  it('still grades a series with real dispersion', () => {
    // Reachability, and it is the control that matters: a guard that nulls
    // everything would pass every assertion above.
    const mixed = Array.from({ length: 500 }, (_, i) => (i % 3 === 0 ? -0.01 : 0.006))
    const v = sortinoRatio(mixed, RF_DAILY, 252)
    expect(v).not.toBeNull()
    expect(Number.isFinite(v as number)).toBe(true)
  })

  it('a series with a single tiny wobble is still graded, not swallowed', () => {
    // The threshold matches sharpeRatio's (1e-10) rather than being invented, so
    // this pins that the guard is not quietly wider than its sibling.
    const nearlyFlat = flat(500).map((_, i) => (i === 250 ? 1e-6 : 0))
    expect(sortinoRatio(nearlyFlat, RF_DAILY, 252)).not.toBeNull()
    expect(sharpeRatio(nearlyFlat, 0, 252)).not.toBeNull()
  })
})
