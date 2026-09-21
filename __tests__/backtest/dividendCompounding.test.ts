import { describe, it, expect } from 'vitest'
import { computeBuyAndHoldReturn, type OhlcvRow } from '@/lib/backtest/core'
import { markSynthetic, unwrapSynthetic } from '@/lib/synthetic'

/**
 * Q-126 — every dividend reinvestment site did `shares += dividend / close`,
 * buying the distribution on exactly ONE share however many were held. Only
 * the first distribution ever compounded.
 *
 * Oracle: an independent cash/share ledger. Prices here are split-adjusted and
 * NOT dividend-adjusted (scripts/fetchBacktestData.mjs takes yahoo's `close`,
 * not `adjclose`, and attaches each cash dividend to its ex-date bar), so
 * reinvesting the cash is the documented convention and not a double count.
 *
 * Fixtures are __SYNTHETIC__ unit inputs, never research evidence.
 */

const rows = (specs: Array<{ close: number; dividend?: number }>): OhlcvRow[] =>
  unwrapSynthetic(markSynthetic(specs.map((s, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: s.close, high: s.close, low: s.close, close: s.close, volume: 1000,
    ...(s.dividend ? { dividend: s.dividend } : {}),
  }))), 'Q126 unit test only')

/** Independent ledger: reinvest each distribution across ALL shares held. */
function oracle(specs: Array<{ close: number; dividend?: number }>): number {
  let shares = 1
  for (let i = 1; i < specs.length; i++) {
    const d = specs[i].dividend ?? 0
    if (d > 0 && specs[i].close > 0) shares += (shares * d) / specs[i].close
  }
  return (shares * specs[specs.length - 1].close - specs[0].close) / specs[0].close
}

describe('Q-126 — dividends compound across every share held', () => {
  it('THE REPORTED CASE: three bars at 100, dividend 10 on each of the last two', () => {
    const spec = [{ close: 100 }, { close: 100, dividend: 10 }, { close: 100, dividend: 10 }]
    // Was 20% — one share's dividend each time. Reinvesting both gives 1.1*1.1-1.
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(1.1 * 1.1 - 1, 12)
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(oracle(spec), 12)
    expect(computeBuyAndHoldReturn(rows(spec))).not.toBeCloseTo(0.20, 6)
  })

  it('matches an independent ledger with two distributions at UNEQUAL prices', () => {
    const spec = [{ close: 100 }, { close: 80, dividend: 4 }, { close: 125, dividend: 5 }]
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(oracle(spec), 12)
  })

  it('CONTROL: a zero-dividend series is unchanged', () => {
    const spec = [{ close: 100 }, { close: 110 }, { close: 120 }]
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(0.20, 12)
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(oracle(spec), 12)
  })

  it('CONTROL: a SINGLE distribution is identical under both conventions', () => {
    // This is why the bug survived: with one dividend, `+= d/close` and
    // `*= 1 + d/close` agree exactly, because shares is still 1.
    const spec = [{ close: 100 }, { close: 100, dividend: 10 }]
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(0.10, 12)
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(oracle(spec), 12)
  })

  it('ignores non-positive dividends and non-positive closes', () => {
    const spec = [{ close: 100 }, { close: 100, dividend: 0 }, { close: 100 }]
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(0, 12)
  })

  it('WHAT THIS CANNOT DO — asserted, so a green run is not read as a proof', () => {
    // Reinvestment happens at the EX-DATE bar's close with no tax, no
    // fractional-share limit and no execution cost. It is a convention, not a
    // claim about what a real holder would have received.
    const spec = [{ close: 100 }, { close: 100, dividend: 10 }, { close: 100, dividend: 10 }]
    expect(computeBuyAndHoldReturn(rows(spec))).toBeCloseTo(0.21, 12)
  })
})
