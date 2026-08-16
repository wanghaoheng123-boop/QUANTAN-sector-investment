/**
 * Runtime behaviour of the I3 synthetic guard (Q-088).
 *
 * The first version of this guard was a no-op: `assertSyntheticAccepted(true, …)`
 * took a caller-supplied boolean literal, so it could never fire, and its test
 * exercised a `false` branch that no call site produced. These tests are written
 * against the VALUE instead — every assertion here fails if the marker stops
 * being carried at runtime.
 */
import { describe, it, expect } from 'vitest'
import { generateDarkPoolPrints } from '@/lib/mockData'
import {
  isSynthetic,
  markSynthetic,
  unwrapSynthetic,
  assertNotSynthetic,
} from '@/lib/synthetic'

describe('the synthetic marker exists at runtime, not just in the type system', () => {
  it('generateDarkPoolPrints returns a value carrying __SYNTHETIC__', () => {
    const wrapped = generateDarkPoolPrints('XLK')
    // The previous type-only brand was erased at build time — Object.keys on
    // the old output contained no marker at all. This is the regression guard.
    expect(Object.keys(wrapped)).toContain('__SYNTHETIC__')
    expect(isSynthetic(wrapped)).toBe(true)
  })

  it('the marker survives a JSON round-trip', () => {
    const revived = JSON.parse(JSON.stringify(generateDarkPoolPrints('XLK')))
    expect(isSynthetic(revived)).toBe(true)
  })

  it('rejects plain values that were never marked', () => {
    expect(isSynthetic([{ time: '10:00', size: 1 }])).toBe(false)
    expect(isSynthetic(null)).toBe(false)
    expect(isSynthetic(undefined)).toBe(false)
    expect(isSynthetic('__SYNTHETIC__')).toBe(false)
    expect(isSynthetic({ __SYNTHETIC__: false })).toBe(false)
  })
})

describe('unwrapSynthetic — fires on real data, which is the whole point', () => {
  it('throws when handed a value with no marker (a real-data rewire)', () => {
    const realLookingPrints = [
      { time: '14:58:00', ticker: 'AAPL', size: 334_000, price: 305.4 },
    ] as never
    expect(() => unwrapSynthetic(realLookingPrints, 'DarkPoolPanel.prints')).toThrow(/\[I3\]/)
  })

  it('names the surface so the failure is actionable', () => {
    expect(() => unwrapSynthetic(null as never, 'DarkPoolPanel.prints')).toThrow(
      /DarkPoolPanel\.prints/,
    )
  })

  it('points at the invariant and the ticket', () => {
    expect(() => unwrapSynthetic(null as never, 'X')).toThrow(/I3[\s\S]*CLAUDE\.md[\s\S]*Q-088/)
  })

  it('returns the underlying value when the marker is present', () => {
    expect(unwrapSynthetic(markSynthetic([1, 2, 3]), 'test')).toEqual([1, 2, 3])
  })
})

describe('assertNotSynthetic — guards chart/signal/backtest boundaries', () => {
  it('throws when synthetic data reaches a real-data-only surface', () => {
    expect(() => assertNotSynthetic(generateDarkPoolPrints('XLK'), 'KLineChart.candles')).toThrow(
      /\[I3\]/,
    )
  })

  it('names the surface that was about to be poisoned', () => {
    expect(() => assertNotSynthetic(markSynthetic([]), 'backtest.priceSeries')).toThrow(
      /backtest\.priceSeries/,
    )
  })

  it('passes real data through untouched', () => {
    expect(() => assertNotSynthetic([{ close: 305.4 }], 'KLineChart.candles')).not.toThrow()
  })
})

describe('generateDarkPoolPrints — determinism (house style)', () => {
  it('is deterministic: same ticker produces identical output', () => {
    // Seeded Mulberry32. If this fails, SSR and client render disagree and
    // React throws a hydration mismatch.
    expect(generateDarkPoolPrints('XLK')).toEqual(generateDarkPoolPrints('XLK'))
  })

  it('differs across tickers (the seed is actually used)', () => {
    // Without this, a degenerate seed returning one series for every input
    // would make the determinism test above pass vacuously.
    expect(generateDarkPoolPrints('XLK')).not.toEqual(generateDarkPoolPrints('XLE'))
  })

  it('honours the count argument', () => {
    expect(unwrapSynthetic(generateDarkPoolPrints('XLK', 5), 'test')).toHaveLength(5)
  })

  it('returns prints sorted by time descending', () => {
    const times = unwrapSynthetic(generateDarkPoolPrints('XLK'), 'test').map((p) => p.time)
    expect(times).toEqual([...times].sort((a, b) => b.localeCompare(a)))
  })
})
