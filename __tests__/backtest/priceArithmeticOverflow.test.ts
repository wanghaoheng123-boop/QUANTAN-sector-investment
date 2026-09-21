/**
 * Q-130 — Q-122 validated the price DOMAIN (finite and positive). It did not
 * validate the ARITHMETIC DERIVED from a price that passes that test.
 *
 * Two finite, positive, entirely legal doubles break the accounting:
 *   • Number.MIN_VALUE (5e-324) as an entry price: allocation / price
 *     overflows to Infinity, Math.floor(Infinity) is Infinity, and the
 *     `shares <= 0` check does not catch it.
 *   • Number.MAX_VALUE as an exit price: position * price is Infinity, the
 *     fee is Infinity, and proceeds - fee is Infinity - Infinity = NaN, which
 *     is then added to capital.
 *
 * The failure contract mirrors the one Q-122 established, and the asymmetry is
 * deliberate: an ENTRY is discretionary, so unusable arithmetic skips the bar
 * (matching the guard already above the sizing site); a REQUIRED EXIT is not,
 * so it throws rather than booking a fictitious number.
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
const INITIAL_CAPITAL = 10_000
const ENTRY_DECISION = 200
const CONFIG = { initialCapital: INITIAL_CAPITAL, maxDrawdownCap: 0.20 }

function fixtureRows(count = 280): OhlcvRow[] {
  return unwrapSynthetic(markSynthetic(Array.from({ length: count }, (_, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: 100, high: 100, low: 100, close: 100, volume: 1_000_000,
  }))), 'Q130 unit test only')
}

function controlledSignal(
  ticker: string, date: string, price: number, action: 'BUY' | 'HOLD',
): EnhancedCombinedSignal {
  return {
    ticker, date, price, action, KellyFraction: 0.5, confidence: 100,
    reason: '__SYNTHETIC__ forced Q130 accounting scenario',
    regime: {
      action, label: '__SYNTHETIC__', zone: '__SYNTHETIC__',
      dipSignal: 'IN_TREND', deviationPct: 0, slopePct: 0,
      slopePositive: true, confidence: 100,
    },
    confirms: [], weightedConfirms: [],
    volRegime: {
      volatilityRegime: 'normal', trendRegime: 'range_bound',
      strategyHint: 'neutral', volRatio: null, adxValue: null, confidence: 0,
    },
    multiTfScore: 0, volumeZone: null, totalWeightedScore: 0,
  }
}

beforeEach(() => {
  signalMock.mockReset()
  signalMock.mockImplementation((ticker, date, price, closes) =>
    controlledSignal(ticker, date, price, closes.length === ENTRY_DECISION + 1 ? 'BUY' : 'HOLD'))
})

const run = (rows: OhlcvRow[]) => backtestInstrument('__SYNTHETIC__Q130', 'Technology', rows, CONFIG)

/**
 * Enter late enough that the 60-bar time exit cannot fire before the series
 * ends, so the position is still OPEN at the terminal bar and the final
 * liquidation — the fault site this ticket names — actually executes.
 */
function forceLateBuy(decisionBar: number) {
  signalMock.mockImplementation((ticker, date, price, closes) =>
    controlledSignal(ticker, date, price, closes.length === decisionBar + 1 ? 'BUY' : 'HOLD'))
}

const allFinite = (xs: number[]) => xs.every(Number.isFinite)

describe('Q-130 — arithmetic derived from a legal price must stay finite', () => {
  it('ENTRY: Number.MIN_VALUE open does not size an infinite position', () => {
    const rows = fixtureRows()
    rows[ENTRY_DECISION + 1].open = Number.MIN_VALUE   // finite, positive, legal
    const res = run(rows)
    // The bar is skipped, exactly as an unpriceable entry already is.
    expect(res.closedTrades.every(t => Number.isFinite(t.entryPrice))).toBe(true)
    expect(allFinite(res.equityCurve)).toBe(true)
    expect(Number.isFinite(res.totalReturn)).toBe(true)
    expect(Number.isFinite(res.maxDrawdown)).toBe(true)
  })

  it('EXIT: Number.MAX_VALUE terminal close cannot book NaN proceeds', () => {
    forceLateBuy(250)                                   // still open at the last bar
    const rows = fixtureRows()
    rows[rows.length - 1].close = Number.MAX_VALUE      // finite, positive, legal
    // A required exit whose arithmetic is unusable invalidates the run; it must
    // not silently produce NaN capital the way Infinity - Infinity does.
    expect(() => run(rows)).toThrow(/finite/i)
  })

  it('EXIT: a drawdown exit at Number.MAX_VALUE is rejected, not booked', () => {
    const rows = fixtureRows()
    rows[210].close = 50
    rows[210].low = 50
    rows[211].open = Number.MAX_VALUE
    expect(() => run(rows)).toThrow(/finite/i)
  })

  it('CONTROL: representable extreme prices still trade normally', () => {
    // The hardening must not reject prices that are merely unusual. A penny
    // stock and a very expensive share are both ordinary inputs.
    for (const price of [0.01, 1e6]) {
      const rows = fixtureRows()
      for (const r of rows) { r.open = price; r.high = price; r.low = price; r.close = price }
      const res = run(rows)
      expect(allFinite(res.equityCurve), `price ${price}`).toBe(true)
      expect(Number.isFinite(res.totalReturn), `price ${price}`).toBe(true)
    }
  })

  it('CONTROL: the Q-122 invalid-price contract is untouched', () => {
    forceLateBuy(250)
    const rows = fixtureRows()
    rows[rows.length - 1].close = 0
    expect(() => run(rows)).toThrow(/finite positive/i)
  })
})
