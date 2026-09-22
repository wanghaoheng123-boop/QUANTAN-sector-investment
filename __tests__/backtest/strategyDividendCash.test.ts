/**
 * Q-125 — dividends on shares the STRATEGY holds.
 *
 * Every dividend read in core.ts fed the B&H comparator; the strategy's own
 * cash ledger never received one, while the benchmark it is measured against
 * did. Q-126 widened that asymmetry by making the benchmark side compound.
 *
 * ENTITLEMENT ORDERING (criterion 2). Fills execute at `rows[i+1].open`, and
 * the credit is applied to the holding that exists BEFORE that fill — the one
 * that owned the shares through bar i's close, i.e. before the ex-date opened:
 *
 *   held across the ex-date     -> entitled
 *   SOLD at the ex-date open    -> entitled (owned it before the open)
 *   BOUGHT at the ex-date open  -> NOT entitled
 *   flat                        -> nothing
 *
 * Fixtures are __SYNTHETIC__ unit inputs, never research evidence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backtestInstrument, type OhlcvRow } from '@/lib/backtest/core'
import { resolveBacktestSignal, type EnhancedCombinedSignal } from '@/lib/backtest/signals'
import { markSynthetic, unwrapSynthetic } from '@/lib/synthetic'

vi.mock('@/lib/backtest/signals', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/backtest/signals')>(),
  resolveBacktestSignal: vi.fn(),
}))

const signalMock = vi.mocked(resolveBacktestSignal)
const W = 200
const INITIAL_CAPITAL = 10_000
const CONFIG = { initialCapital: INITIAL_CAPITAL, maxDrawdownCap: 0.20 }
const PRICE = 100

function fixture(count = 280, divs: Record<number, number> = {}): OhlcvRow[] {
  return unwrapSynthetic(markSynthetic(Array.from({ length: count }, (_, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1_000_000,
    ...(divs[i] ? { dividend: divs[i] } : {}),
  }))), 'Q125 unit test only')
}

function sig(ticker: string, date: string, price: number, action: 'BUY' | 'HOLD'): EnhancedCombinedSignal {
  return {
    ticker, date, price, action, KellyFraction: 0.5, confidence: 100,
    reason: '__SYNTHETIC__ forced Q125 scenario',
    regime: { action, label: '__SYNTHETIC__', zone: '__SYNTHETIC__', dipSignal: 'IN_TREND',
      deviationPct: 0, slopePct: 0, slopePositive: true, confidence: 100 },
    confirms: [], weightedConfirms: [],
    volRegime: { volatilityRegime: 'normal', trendRegime: 'range_bound', strategyHint: 'neutral',
      volRatio: null, adxValue: null, confidence: 0 },
    multiTfScore: 0, volumeZone: null, totalWeightedScore: 0,
  }
}

/** BUY decided at `decisionBar` -> fills at open of decisionBar+1. */
function buyAt(decisionBar: number) {
  signalMock.mockImplementation((t, d, p, closes) =>
    sig(t, d, p, closes.length === decisionBar + 1 ? 'BUY' : 'HOLD'))
}
function neverBuy() {
  signalMock.mockImplementation((t, d, p) => sig(t, d, p, 'HOLD'))
}

const run = (rows: OhlcvRow[]) => backtestInstrument('__SYNTHETIC__Q125', 'Technology', rows, CONFIG)

beforeEach(() => { signalMock.mockReset(); neverBuy() })

describe('Q-125 — the strategy collects dividends on shares it holds', () => {
  it('THE REPORTED CASE: a position spanning an ex-date is no longer identical to a dividend-free control', () => {
    buyAt(W)                                    // fills at open of bar 201
    const control = run(fixture(280))
    buyAt(W)
    const withDiv = run(fixture(280, { 220: 2 }))   // ex-date well inside the hold
    expect(withDiv.totalReturn).toBeGreaterThan(control.totalReturn)
    // Independent ledger: shares held x $2, on a flat price series.
    const shares = withDiv.closedTrades[0].shares
    expect(shares).toBeGreaterThan(0)
    const expected = (shares * 2) / INITIAL_CAPITAL
    expect(withDiv.totalReturn - control.totalReturn).toBeCloseTo(expected, 10)
  })

  it('BOUGHT at the ex-date open is NOT entitled', () => {
    buyAt(W)                                    // fill lands on bar 201
    const onExDate = run(fixture(280, { [W + 1]: 2 }))
    buyAt(W)
    const control = run(fixture(280))
    expect(onExDate.totalReturn).toBeCloseTo(control.totalReturn, 12)
  })

  it('SOLD at the ex-date open IS entitled — it owned the shares before the open', () => {
    // 60-bar time exit: decision at 261 fills the exit at open 262.
    buyAt(W)
    const exitDayDiv = run(fixture(280, { 262: 2 }))
    buyAt(W)
    const control = run(fixture(280))
    const shares = control.closedTrades[0].shares
    expect(exitDayDiv.totalReturn - control.totalReturn).toBeCloseTo((shares * 2) / INITIAL_CAPITAL, 10)
  })

  it('CONTROL: no position means no credit', () => {
    neverBuy()
    const withDiv = run(fixture(280, { 220: 5 }))
    neverBuy()
    const control = run(fixture(280))
    expect(withDiv.totalTrades).toBe(0)
    expect(withDiv.totalReturn).toBeCloseTo(control.totalReturn, 12)
  })

  it('CONTROL: a zero-dividend series is bit-for-bit unchanged', () => {
    buyAt(W)
    const a = run(fixture(280))
    buyAt(W)
    const b = run(fixture(280, { 220: 0 }))
    expect(b.totalReturn).toBeCloseTo(a.totalReturn, 12)
    expect(b.equityCurve).toEqual(a.equityCurve)
  })

  it('dividends during the WARMUP are never credited — the strategy held nothing', () => {
    buyAt(W)
    const warmupDiv = run(fixture(280, { 50: 10, 120: 10 }))
    buyAt(W)
    const control = run(fixture(280))
    expect(warmupDiv.totalReturn).toBeCloseTo(control.totalReturn, 12)
  })

  it('two ex-dates inside one hold are each credited exactly once', () => {
    buyAt(W)
    const two = run(fixture(280, { 215: 2, 235: 3 }))
    buyAt(W)
    const control = run(fixture(280))
    const shares = control.closedTrades[0].shares
    expect(two.totalReturn - control.totalReturn).toBeCloseTo((shares * 5) / INITIAL_CAPITAL, 10)
  })

  it('WHAT THIS DOES NOT DO — asserted, so a green run is not read as a proof', () => {
    // Dividends are paid as CASH and are NOT reinvested, and `pnlPct` remains
    // the raw price move — so a trade's logged return excludes the dividend
    // that its own holding earned. That is deliberate (Q-123/Q-124 fixed
    // pnlPct's meaning) but it does mean per-trade returns and totalReturn
    // account for dividends differently.
    buyAt(W)
    const res = run(fixture(280, { 220: 2 }))
    expect(res.closedTrades[0].pnlPct).toBeCloseTo(0, 6)   // flat price series
    expect(res.totalReturn).toBeGreaterThan(0)             // but cash arrived
  })
})
