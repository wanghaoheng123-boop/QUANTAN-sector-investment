/**
 * Q122: an unpriceable required exit invalidates the run; it must neither book
 * fictitious proceeds nor wait for a more favourable later execution price.
 *
 * Accounting oracle: Bacon (2008), Practical Risk-Adjusted Performance
 * Measurement, p. 9 (cash + holdings at current market prices), with the
 * repository's executionModel.ts 11 bps per side deducted from actual notional.
 * These are explicitly __SYNTHETIC__ unit fixtures, never research evidence.
 */
import { serialize } from 'node:v8'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backtestInstrument, type OhlcvRow } from '@/lib/backtest/core'
import { resolveBacktestSignal, type EnhancedCombinedSignal } from '@/lib/backtest/signals'
import { markSynthetic, unwrapSynthetic } from '@/lib/synthetic'

vi.mock('@/lib/backtest/signals', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/backtest/signals')>(),
  resolveBacktestSignal: vi.fn(),
}))

const signalMock = vi.mocked(resolveBacktestSignal)
const INVALID_PRICES = [
  ['zero', 0],
  ['negative', -1],
  ['NaN', NaN],
  ['positive infinity', Infinity],
  ['negative infinity', -Infinity],
] as const
const INITIAL_CAPITAL = 10_000
const ENTRY_DECISION = 200
const ENTRY_FILL = 201
// Current 60-bar policy: decision at 261 closes the entry at open 262.
const TIME_DECISION = 261
const TIME_FILL = 262
const CONFIG = { initialCapital: INITIAL_CAPITAL, maxDrawdownCap: 0.20 }

function fixtureRows(count = 280): OhlcvRow[] {
  const __SYNTHETIC__ = markSynthetic(Array.from({ length: count }, (_, i) => ({
    time: Date.UTC(2020, 0, 1) / 1000 + i * 86_400,
    open: 100, high: 100, low: 100, close: 100, volume: 1_000_000,
  })))
  return unwrapSynthetic(__SYNTHETIC__, 'Q122 unit test only')
}

function controlledSignal(
  ticker: string, date: string, price: number, action: 'BUY' | 'HOLD',
): EnhancedCombinedSignal {
  return {
    ticker, date, price, action, KellyFraction: 0.5, confidence: 100,
    reason: '__SYNTHETIC__ forced Q122 accounting scenario',
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

function forceSingleBuy() {
  signalMock.mockImplementation((ticker, date, price, closes) =>
    controlledSignal(ticker, date, price, closes.length === ENTRY_DECISION + 1 ? 'BUY' : 'HOLD'))
}

function forceFlat() {
  signalMock.mockImplementation((ticker, date, price) => controlledSignal(ticker, date, price, 'HOLD'))
}

function run(rows: OhlcvRow[]) {
  return backtestInstrument('__SYNTHETIC__Q122', 'Technology', rows, CONFIG)
}

beforeEach(() => {
  signalMock.mockReset()
  forceSingleBuy()
})

describe('Q122 — reject unpriceable required exits', () => {
  it.each(INVALID_PRICES)('drawdown exit rejects %s next-open despite later recovery', (_label, badPrice) => {
    const rows = fixtureRows()
    rows[210].close = 50 // The held 50 shares cause a > 20% equity drawdown.
    rows[210].low = 50
    rows[211].open = badPrice
    rows[212].open = 120 // A later executable price cannot rescue this run.
    rows[212].high = 120

    expect(() => run(rows)).toThrow(/finite positive/i)
    // Reachability: actual entry generation ran before the bad exit.
    expect(signalMock.mock.calls[0][3]).toHaveLength(ENTRY_DECISION + 1)
  })

  it.each(INVALID_PRICES)('time exit rejects %s instead of extending the holding horizon', (_label, badPrice) => {
    const rows = fixtureRows()
    rows[TIME_FILL].open = badPrice
    rows[TIME_FILL + 1].open = 120
    rows[TIME_FILL + 1].high = 120

    expect(() => run(rows)).toThrow(/finite positive/i)
    expect(signalMock.mock.calls[0][3]).toHaveLength(ENTRY_DECISION + 1)
  })

  it.each(INVALID_PRICES)('coincident time and drawdown exits reject %s before a recovery', (_label, badPrice) => {
    const rows = fixtureRows()
    rows[TIME_DECISION].close = 50
    rows[TIME_DECISION].low = 50
    rows[TIME_FILL].open = badPrice
    rows[TIME_FILL + 1].open = 120
    rows[TIME_FILL + 1].high = 120

    expect(() => run(rows)).toThrow(/finite positive/i)
  })

  it.each(INVALID_PRICES)('terminal liquidation rejects %s close while holding', (_label, badPrice) => {
    const rows = fixtureRows(252) // Ends before the 60-bar time exit.
    rows[251].close = badPrice
    expect(() => run(rows)).toThrow(/finite positive/i)
  })

  it.each(INVALID_PRICES)('terminal valuation rejects %s close while flat', (_label, badPrice) => {
    forceFlat()
    const rows = fixtureRows()
    rows[rows.length - 1].close = badPrice
    expect(() => run(rows)).toThrow(/finite positive/i)
  })

  describe.each([1, 251])('%i-bar insufficient history still validates a terminal mark', count => {
    it.each(INVALID_PRICES)('rejects %s instead of returning an apparently valid stub', (_label, badPrice) => {
      const rows = fixtureRows(count)
      rows[count - 1].close = badPrice
      expect(() => run(rows)).toThrow(/finite positive/i)
      expect(signalMock).not.toHaveBeenCalled()
    })
  })

  it('rejects an all-NaN OHLC price history', () => {
    const rows = fixtureRows(252).map(row => ({ ...row, open: NaN, high: NaN, low: NaN, close: NaN }))
    expect(() => run(rows)).toThrow(/finite positive/i)
  })
})

describe('Q122 — preserve valid accounting and existing no-entry behaviour', () => {
  it.each(INVALID_PRICES)('still skips a %s entry open without inventing a trade', (_label, badPrice) => {
    const rows = fixtureRows()
    rows[ENTRY_FILL].open = badPrice
    const result = run(rows)
    expect(result.totalTrades).toBe(0)
    expect(result.closedTrades).toEqual([])
    expect(new Set(result.equityCurve)).toEqual(new Set([INITIAL_CAPITAL]))
    expect(result.totalReturn).toBe(0)
    expect(result.finalPrice).toBe(100)
  })

  it.each(['drawdown', 'time', 'terminal'] as const)('%s exit preserves the exact fill and cash ledger', path => {
    const rows = fixtureRows(path === 'terminal' ? 252 : 280)
    if (path === 'drawdown') {
      rows[210].close = 50
      rows[210].low = 50
      rows[211].open = 110
      rows[211].high = 110
    } else if (path === 'time') {
      rows[TIME_FILL].open = 110
      rows[TIME_FILL].high = 110
    } else {
      rows[251].close = 110
      rows[251].high = 110
    }
    const result = run(rows)
    // Buy 50 at 100: 5,000 + 5.50 fee. Sell 50 at 110: 5,500 - 6.05 fee.
    // Final cash = 10,000 - 5,005.50 + 5,493.95 = 10,488.45.
    expect(result.totalTrades).toBe(1)
    expect(result.closedTrades).toHaveLength(1)
    expect(result.closedTrades[0]).toMatchObject({
      action: 'BUY', entryPrice: 100, exitPrice: 110,
      shares: 50, value: 5_000, pnlPct: 0.1,
    })
    expect(result.equityCurve[1]).toBe(9_994.5)
    expect(result.equityCurve.at(-1)).toBe(10_488.45)
    expect(result.totalReturn).toBeCloseTo(0.048845, 12)
    expect(result.openTrade).toBeNull()
  })

  it('keeps empty and one-bar valid histories as zero-trade stubs', () => {
    const empty = run(fixtureRows(0))
    const one = run(fixtureRows(1))
    expect(empty).toMatchObject({
      initialPrice: 0, finalPrice: 0, days: 0, totalTrades: 0,
      totalReturn: 0, equityCurve: [INITIAL_CAPITAL], dailyReturns: [],
    })
    expect(one).toMatchObject({
      initialPrice: 100, finalPrice: 100, days: 1, totalTrades: 0,
      totalReturn: 0, equityCurve: [INITIAL_CAPITAL], dailyReturns: [],
    })
    expect(signalMock).not.toHaveBeenCalled()
  })

  it('all-equal prices lose exactly two fees and serialize byte-identically', () => {
    const first = run(fixtureRows())
    signalMock.mockClear()
    const second = run(fixtureRows())
    // v8 serialization preserves Infinity/NaN, unlike JSON.stringify.
    expect(serialize(second).equals(serialize(first))).toBe(true)
    expect({
      trades: first.closedTrades.map(({ entryPrice, exitPrice, shares, pnlPct }) =>
        ({ entryPrice, exitPrice, shares, pnlPct })),
      initialEquity: first.equityCurve[0],
      entryEquity: first.equityCurve[1],
      finalEquity: first.equityCurve.at(-1),
      totalReturn: first.totalReturn,
    }).toMatchInlineSnapshot(`
      {
        "entryEquity": 9994.5,
        "finalEquity": 9989,
        "initialEquity": 10000,
        "totalReturn": -0.0011,
        "trades": [
          {
            "entryPrice": 100,
            "exitPrice": 100,
            "pnlPct": 0,
            "shares": 50,
          },
        ],
      }
    `)
  })
})
