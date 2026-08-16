/**
 * Runtime behaviour of the I3 synthetic guard (Q-088).
 *
 * The architecture test asserts the synthetic PATHS are gone. This one asserts
 * the guard that remains actually does something — a test that only checks the
 * happy path would pass against a no-op function.
 */
import { describe, it, expect } from 'vitest'
import {
  assertSyntheticAccepted,
  generateDarkPoolPrints,
} from '@/lib/mockData'

describe('assertSyntheticAccepted', () => {
  it('throws when a surface has not declared it accepts synthetic data', () => {
    expect(() => assertSyntheticAccepted(false, 'SomeChart.candles')).toThrow(/\[I3\]/)
  })

  it('names the offending surface so the failure is actionable', () => {
    expect(() => assertSyntheticAccepted(false, 'SomeChart.candles')).toThrow(
      /SomeChart\.candles/,
    )
  })

  it('points at the invariant and the ticket rather than just failing', () => {
    expect(() => assertSyntheticAccepted(false, 'X')).toThrow(/I3[\s\S]*CLAUDE\.md[\s\S]*Q-088/)
  })

  it('does not throw for a surface that accepts synthetic data', () => {
    expect(() => assertSyntheticAccepted(true, 'DarkPoolPanel.prints')).not.toThrow()
  })
})

describe('generateDarkPoolPrints — determinism (house style)', () => {
  it('is deterministic: same ticker produces byte-identical output', () => {
    // Seeded Mulberry32. If this ever fails, SSR and client render disagree
    // and React will throw a hydration mismatch.
    expect(generateDarkPoolPrints('XLK')).toEqual(generateDarkPoolPrints('XLK'))
  })

  it('differs across tickers (the seed is actually used)', () => {
    // Guards against a degenerate seed that returns the same series for every
    // input — which would make the determinism test above pass vacuously.
    expect(generateDarkPoolPrints('XLK')).not.toEqual(generateDarkPoolPrints('XLE'))
  })

  it('honours the count argument', () => {
    expect(generateDarkPoolPrints('XLK', 5)).toHaveLength(5)
  })

  it('returns prints sorted by time descending', () => {
    const times = generateDarkPoolPrints('XLK').map((p) => p.time)
    expect(times).toEqual([...times].sort((a, b) => b.localeCompare(a)))
  })
})
