/**
 * `maxDrawdown` reported a fraction of the real risk, and only ever downward.
 *
 * The bug: the largest ABSOLUTE drop was divided by the FINAL running peak
 * rather than the peak standing when that drop happened. Any series that fell
 * and then made a new high therefore understated its own worst drawdown — and
 * the error is one-directional, because the divisor can only grow.
 *
 * That is the modal shape for this repo's 2021-2026 window: crash in 2022,
 * recover by 2026. Measured on the committed fixtures BEFORE the fix:
 *
 *   NVDA  reported 23.4%   true 66.4%
 *   META  reported 37.1%   true 76.7%
 *   AMZN  reported 36.3%   true 55.7%
 *   TSLA  reported 61.6%   true 73.6%
 *
 * It is live at `lib/quant/buildFundamentalsPayload.ts` and re-exported through
 * `lib/quant/technicals.ts`, so those numbers reached users. A risk metric that
 * is systematically reassuring is worse than no risk metric at all — the PRIME
 * DIRECTIVE's product is calibrated confidence, and this sold the opposite.
 *
 * These tests carry an INDEPENDENT oracle rather than a pinned constant, so they
 * check the property and not a number someone can quietly re-baseline.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { maxDrawdown } from '../../lib/quant/indicators'

/** Peak-to-trough, measured against the peak standing at each point. */
function trueMaxDrawdownPct(series: number[]): number {
  let peak = series[0]
  let worst = 0
  for (const c of series) {
    if (c > peak) peak = c
    const dd = peak > 0 ? (peak - c) / peak : 0
    if (dd > worst) worst = dd
  }
  return worst
}

describe('maxDrawdown — measured against the peak that was standing', () => {
  it('does not shrink a 50% crash because the series later 20x-ed', () => {
    // The canonical reproduction. Old code: 100/1000 = 10%.
    expect(maxDrawdown([100, 50, 1000, 900])!.maxDdPct).toBeCloseTo(0.5, 10)
  })

  it.each([
    ['no recovery', [100, 50], 0.5],
    ['worst of two troughs', [100, 80, 100, 60, 100], 0.4],
    ['monotonic rise', [100, 110, 120], 0],
    ['flat', [100, 100, 100], 0],
  ])('%s', (_label, series, expected) => {
    expect(maxDrawdown(series as number[])!.maxDdPct).toBeCloseTo(expected as number, 10)
  })

  it('agrees with an independent oracle on every committed fixture', () => {
    // The property, over real data, rather than four pinned numbers. If the
    // implementation drifts on ANY of the 56 names this fails and names it.
    const dir = join(__dirname, '../../scripts/backtestData')
    const { readdirSync } = require('fs') as typeof import('fs')
    const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(50) // reachability: not a vacuous loop

    const mismatched: string[] = []
    for (const f of files) {
      const closes = JSON.parse(readFileSync(join(dir, f), 'utf8')).candles.map(
        (c: { close: number }) => c.close,
      )
      if (closes.length < 2) continue
      const got = maxDrawdown(closes)!.maxDdPct
      const want = trueMaxDrawdownPct(closes)
      if (Math.abs(got - want) > 1e-9) {
        mismatched.push(`${f}: reported ${(got * 100).toFixed(1)}% vs true ${(want * 100).toFixed(1)}%`)
      }
    }
    expect(mismatched).toEqual([])
  })

  it('never reports LESS than the true drawdown — the direction that matters', () => {
    // Stated as its own property because the failure was one-directional. A
    // future regression that overstates risk is a bug; one that understates it
    // is a bug that users act on.
    const series = [100, 40, 500, 450, 2000, 1900]
    expect(maxDrawdown(series)!.maxDdPct).toBeGreaterThanOrEqual(trueMaxDrawdownPct(series) - 1e-12)
  })

  it('keeps the absolute and percentage answers independent', () => {
    // They can come from different points, and conflating them is what caused
    // the bug. Here the largest PROPORTIONAL fall is early and small in dollars;
    // the largest DOLLAR fall is late and small in proportion.
    const r = maxDrawdown([10, 1, 1000, 500])!
    expect(r.maxDdPct).toBeCloseTo(0.9, 10) // 10 -> 1
    expect(r.maxDd).toBeCloseTo(500, 10) // 1000 -> 500
  })
})
