/**
 * `excessReturn` subtracted 1254 bars of market return from 1054 bars of
 * strategy return.
 *
 * `totalReturn` is earned over `[BACKTEST_WARMUP_BARS, len-1]` — the walk-forward
 * loop cannot emit a signal until the 200-bar SMA/EMA lookbacks are satisfied.
 * `bnhReturn` was `computeBuyAndHoldReturn(rows)`: the FULL history from bar 0.
 * Their difference is rendered as "Excess" in `InstrumentTable`, `AnalysisTab`
 * and `WalkForwardPanel`.
 *
 * Measured over all 56 committed fixtures BEFORE the fix:
 *
 *   mean |Δ excess|            40.36 pp
 *   worst  NFLX                −230.87 pp   (−42.84 → −273.70)
 *   sign flips  UNH, PEP       shown orange/underperforming while outperforming
 *
 * `lib/backtest/engine.ts` F-2 had already made exactly this correction for the
 * PORTFOLIO aggregate, and its comment names this field as the mismatched-window
 * legacy it routes around. The per-instrument value — the one the UI renders per
 * row — kept the defect.
 *
 * The tests below are PROPERTIES, not pinned constants. A pinned constant is
 * what froze this project's `maxDrawdown` bug and its `bnhReturn` bug alike:
 * a golden asserting `res.bnhReturn === computeBuyAndHoldReturn(rows)` ratified
 * the wrong window and would have failed whoever fixed it.
 */
import { describe, it, expect } from 'vitest'
import {
  backtestInstrument,
  computeBuyAndHoldReturn,
  BACKTEST_WARMUP_BARS,
  type OhlcvRow,
} from '../../lib/backtest/core'

const W = BACKTEST_WARMUP_BARS

/** Deterministic bar from a close; open=prev close so fills are well defined. */
function bar(i: number, close: number, prev: number, dividend?: number): OhlcvRow {
  return {
    time: Math.floor(Date.UTC(2020, 0, 1) / 1000) + i * 86_400,
    open: prev,
    high: Math.max(close, prev) * 1.001,
    low: Math.min(close, prev) * 0.999,
    close,
    volume: 1_000_000,
    ...(dividend ? { dividend } : {}),
  }
}

function seriesFromCloses(closes: number[]): OhlcvRow[] {
  return closes.map((c, i) => bar(i, c, i === 0 ? c : closes[i - 1]))
}

/** Independent oracle: buy 1 share at the warmup close, reinvest, mark at the end. */
function holdFromWarmup(rows: OhlcvRow[]): number {
  const base = rows[W].close
  let shares = 1
  for (let i = W + 1; i < rows.length; i++) {
    const d = rows[i].dividend ?? 0
    if (d > 0 && rows[i].close > 0) shares += d / rows[i].close
  }
  return (shares * rows[rows.length - 1].close - base) / base
}

describe('bnhReturn spans the window the strategy actually trades (Q110-Q1)', () => {
  it('is INVARIANT to the warmup, which the strategy never traded', () => {
    // The property stated exactly: two histories identical from bar W onward,
    // differing wildly before it, must report the same benchmark return. The
    // old implementation reported the warmup move as if the strategy had held
    // through it. No oracle arithmetic — an equality between two runs.
    const tail = Array.from({ length: 300 }, (_, i) => 300 + Math.sin(i / 9) * 12 + i * 0.2)

    const calm = seriesFromCloses([...Array.from({ length: W }, () => 300), ...tail])
    const wild = seriesFromCloses([
      ...Array.from({ length: W }, (_, i) => 100 + (i * 200) / (W - 1)), // 100 → 300
      ...tail,
    ])

    const a = backtestInstrument('TEST', 'Technology', calm)
    const b = backtestInstrument('TEST', 'Technology', wild)

    expect(b.bnhReturn).toBeCloseTo(a.bnhReturn, 12)
    // Reachability: the warmups really are different, so this is not vacuous.
    expect(computeBuyAndHoldReturn(wild)).not.toBeCloseTo(computeBuyAndHoldReturn(calm), 3)
    // And the OLD definition would have differed by ~200pp on exactly this pair.
    expect(
      Math.abs(computeBuyAndHoldReturn(wild) - computeBuyAndHoldReturn(calm)),
    ).toBeGreaterThan(1.5)
  })

  it('reports ~0 when the market tripled BEFORE the strategy could trade', () => {
    // Discriminating magnitude, one-directional: warmup +200%, traded window
    // ends where it began. Correct answer ≈ 0; the old code answered ≈ 2.0.
    const closes = [
      ...Array.from({ length: W }, (_, i) => 100 + (i * 200) / (W - 1)), // 100 → 300
      ...Array.from({ length: 300 }, (_, i) => 300 + Math.sin(i / 7) * 6), // ends at 300
    ]
    closes[closes.length - 1] = 300
    const rows = seriesFromCloses(closes)
    const res = backtestInstrument('TEST', 'Technology', rows)

    expect(res.bnhReturn).toBeCloseTo(0, 6)
    expect(computeBuyAndHoldReturn(rows)).toBeCloseTo(2, 6) // what it used to say
  })

  it('agrees with an independent oracle, dividends included', () => {
    const closes = Array.from({ length: 420 }, (_, i) => 100 * 1.002 ** i)
    const rows = seriesFromCloses(closes).map((r, i) =>
      i > 0 && i % 60 === 25 ? { ...r, dividend: 1.5 } : r,
    )
    const res = backtestInstrument('TEST', 'Technology', rows)

    expect(res.bnhReturn).toBeCloseTo(holdFromWarmup(rows), 12)
    // Warmup dividends must NOT reach the benchmark's share count: the B&H
    // investor buys at bar W and did not hold through the warmup ex-dates.
    expect(res.bnhReturn).not.toBeCloseTo(computeBuyAndHoldReturn(rows), 3)
  })

  it('excessReturn stays defined as totalReturn − bnhReturn', () => {
    const rows = seriesFromCloses(Array.from({ length: 700 }, (_, i) => 120 + Math.sin(i / 17) * 30))
    const res = backtestInstrument('TEST', 'Technology', rows)
    expect(res.totalTrades).toBeGreaterThan(0) // reachability, per the note above
    expect(res.excessReturn).toBeCloseTo(res.totalReturn - res.bnhReturn, 12)
  })
})

describe('annualizedReturn annualizes the exposure window (Q110-Q1 sibling)', () => {
  it('compounds totalReturn over rows.length − warmup, not rows.length', () => {
    // REACHABILITY, and it is not decoration: the first draft of this test used
    // a monotonic uptrend, on which this dip-buying strategy never opens a
    // position. totalReturn was 0, `(1+0)^x − 1 = 0` for EVERY exponent, and the
    // test passed against the unfixed code. It could not fail. The series below
    // is chosen because it trades, and the assertion below makes a return of
    // zero a FAILURE rather than a silent skip.
    const rows = seriesFromCloses(Array.from({ length: 700 }, (_, i) => 120 + Math.sin(i / 17) * 30))
    const res = backtestInstrument('TEST', 'Technology', rows)
    expect(res.totalTrades).toBeGreaterThan(0)
    expect(Math.abs(res.totalReturn)).toBeGreaterThan(0.01)

    const traded = rows.length - W
    const expected = (1 + res.totalReturn) ** (252 / traded) - 1
    expect(res.annualizedReturn).toBeCloseTo(expected, 12)

    // `days` still reports the LOADED history, and the two must not be conflated.
    expect(res.days).toBe(rows.length)
    // What the old window said on this exact series: 11.16% vs the true 15.97%.
    const oldWay = (1 + res.totalReturn) ** (252 / rows.length) - 1
    expect(res.annualizedReturn).not.toBeCloseTo(oldWay, 3)
    expect(res.annualizedReturn).toBeGreaterThan(oldWay) // one-directional: it UNDERSTATED
  })
})

describe('what this fix does NOT do — named residuals, asserted', () => {
  it('leaves bnhCurve folding warmup dividends into its opening share count', () => {
    // bnhCurve[0] = (1 + warmup dividends) × close[W]; the scalar starts from
    // 1 share at close[W]. Measured across the 56 fixtures the two differ by a
    // mean 0.308pp (max 1.705pp, T). The curve's job is index-alignment with
    // equityCurve for charting and the engine.ts F-2 combine, so its endpoint
    // SHOULD track the strategy; the scalar's job is a fixed comparison window.
    // They are deliberately different measurements — this asserts the gap is
    // real and bounded rather than pretending it is closed.
    const closes = Array.from({ length: 420 }, (_, i) => 100 * 1.002 ** i)
    const rows = seriesFromCloses(closes).map((r, i) =>
      i > 0 && i % 60 === 25 ? { ...r, dividend: 1.5 } : r,
    )
    const res = backtestInstrument('TEST', 'Technology', rows)
    const c = res.bnhCurve!
    const curveReturn = (c[c.length - 1] - c[0]) / c[0]

    expect(curveReturn).not.toBeCloseTo(res.bnhReturn, 6)
    expect(Math.abs(curveReturn - res.bnhReturn)).toBeLessThan(0.05)
  })
})
