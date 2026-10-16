/**
 * Q-133 / Q-136 / Q-137 — branch-forcing fixtures for backtestInstrument's
 * exits and sizing.
 *
 * On the committed fixtures the drawdown breaker has never fired (0 of 230
 * exits) and the unaffordable-entry branch fires only for BTC, so neither can
 * be pinned by the real data. The signal is SCRIPTED here: BUY on chosen
 * signal bars, HOLD otherwise. Everything after the signal — sizing, fills,
 * exits, accounting — is the production engine.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SignalsModule from '@/lib/backtest/signals'

/** Signal-bar index → BUY. Every other bar is HOLD. */
const BUY_BARS = new Set<number>()

vi.mock('@/lib/backtest/signals', async (importOriginal) => {
  const actual = await importOriginal<typeof SignalsModule>()
  const scripted: typeof actual.resolveBacktestSignal = (ticker, date, price, closes) => {
    const action = BUY_BARS.has(closes.length - 1) ? 'BUY' : 'HOLD'
    const regime = {
      zone: 'SCRIPTED', dipSignal: 'INSUFFICIENT_DATA', deviationPct: null, slopePct: null,
      slopePositive: null, action, confidence: 50, label: '__SYNTHETIC__ scripted',
    } as const
    return {
      ...actual.resolveBacktestSignal(ticker, date, price, [price], [], [], {}),
      ticker, date, price, regime, confirms: [], action, confidence: 50,
      KellyFraction: 0.15, reason: '__SYNTHETIC__ scripted signal',
    }
  }
  return { ...actual, resolveBacktestSignal: scripted }
})

const { backtestInstrument, aggregatePortfolio, BACKTEST_WARMUP_BARS } = await import('@/lib/backtest/engine')
type Row = Parameters<typeof backtestInstrument>[2][number]

const DAY = 86_400
const T0 = Date.UTC(2020, 0, 1) / 1000

/** Flat at `base` except where `path` overrides a bar's price. */
function rows(n: number, base: number, path: Record<number, number> = {}): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const p = path[i] ?? base
    return { time: T0 + i * DAY, open: p, high: p, low: p, close: p, volume: 1_000 }
  })
}

const dateOf = (i: number) => new Date((T0 + i * DAY) * 1000).toISOString().split('T')[0]

beforeEach(() => BUY_BARS.clear())

describe('Q-133: every closed trade says why and when it closed', () => {
  it('time exit, then end of data', () => {
    const W = BACKTEST_WARMUP_BARS
    BUY_BARS.add(W + 5).add(W + 100)
    const r = backtestInstrument('TST', 'Test', rows(W + 120, 100))
    expect(r.closedTrades.map((t) => t.exitReason)).toEqual(['time_exit', 'end_of_data'])
    // fill at W+6; 60 bars later the exit is observed at W+66 and filled at W+67
    expect(r.closedTrades[0].exitDate).toBe(dateOf(W + 67))
    expect(r.closedTrades[1].exitDate).toBe(dateOf(W + 119))
  })

  it('records the net cash P&L the win rate is classified on', () => {
    const W = BACKTEST_WARMUP_BARS
    BUY_BARS.add(W + 5)
    const path: Record<number, number> = {}
    for (let i = W + 7; i < W + 120; i++) path[i] = 100.1   // +0.1%: positive move, loss after costs
    const r = backtestInstrument('TST', 'Test', rows(W + 120, 100, path))
    const t = r.closedTrades[0]
    expect(t.pnlPct).toBeGreaterThan(0)
    expect(t.netPnl).toBeLessThan(0)
    expect(r.winRate).toBe(0)
  })
})

describe('Q-137: the drawdown breaker fires, and re-arms', () => {
  // Cap lowered so one 15% position can trip it: a 20% fall on 15% of equity
  // is a 3% equity drawdown.
  const CAP = { maxDrawdownCap: 0.02 }

  function scenario() {
    const W = BACKTEST_WARMUP_BARS
    const path: Record<number, number> = {}
    for (let i = W + 3; i < W + 400; i++) path[i] = 80   // the fall, and it stays down
    BUY_BARS.add(W + 1)    // filled at 100 on W+2, then the price drops to 80
    BUY_BARS.add(W + 30)   // a fresh position opened AFTER the trip, at 80
    return backtestInstrument('TST', 'Test', rows(W + 140, 100, path), CAP)
  }

  it('closes the losing position with reason max_drawdown at the next open', () => {
    const r = scenario()
    expect(r.closedTrades[0].exitReason).toBe('max_drawdown')
    expect(r.closedTrades[0].exitPrice).toBe(80)
    // Red-team F7: the breach is OBSERVED at the close of W+3 (the first bar at
    // 80) and FILLED at the next open, so the exit is dated W+4 — not the
    // observation bar. Nothing pinned this; dating it on the signal bar survived.
    const W = BACKTEST_WARMUP_BARS
    expect(r.closedTrades[0].exitDate).toBe(dateOf(W + 4))
  })

  it('does not close the NEXT position one bar after entry against the stale peak', () => {
    // Before the re-arm, equity after the trip was still 2%+ below the
    // all-time peak, so the second position was force-closed at its first
    // check: a one-bar 'max_drawdown' trade paying a round trip of costs.
    const r = scenario()
    const second = r.closedTrades[1]
    expect(second.exitReason).toBe('time_exit')
    expect(second.pnlPct).toBe(0)
  })
})

describe('Q-136: an instrument that can never afford one unit is not a strategy result', () => {
  const W = BACKTEST_WARMUP_BARS
  const buyEvery = (from: number, to: number, step: number) => { for (let i = from; i < to; i += step) BUY_BARS.add(i) }

  it('counts the unfillable BUY signals and takes no position', () => {
    buyEvery(W, W + 200, 10)
    const r = backtestInstrument('BTC', 'Crypto', rows(W + 260, 1_000_000))
    expect(r.totalTrades).toBe(0)
    expect(r.unaffordableEntries).toBe(20)
  })

  it('is excluded from the portfolio, disclosed, and cannot change the calendar', () => {
    buyEvery(W, W + 200, 10)
    const equity = backtestInstrument('AAA', 'Tech', rows(W + 260, 100, { [W + 30]: 104, [W + 31]: 104 }))
    const btc = backtestInstrument('BTC', 'Crypto', rows(W + 260, 1_000_000))
    const alone = aggregatePortfolio([equity], 100_000)
    const withBtc = aggregatePortfolio([equity, btc], 100_000)
    expect(withBtc.untradeableTickers).toEqual(['BTC'])
    expect(withBtc.totalInstruments).toBe(1)
    // Identical in every figure: before Q-136 a flat $100,000 curve diluted the
    // return, and BTC's 7-day calendar re-annualized the equity book at 365.
    // `instruments` is the per-row list and still carries BTC, so the table can
    // show it with its reason.
    const { untradeableTickers: _u1, instruments: i1, ...a } = alone
    const { untradeableTickers: _u2, instruments: i2, ...b } = withBtc
    expect(b).toEqual(a)
    expect(i2.map((r) => r.ticker)).toEqual([...i1.map((r) => r.ticker), 'BTC'])
  })

  it('an instrument that traded is never excluded, even if it later could not afford a unit', () => {
    BUY_BARS.add(W + 1).add(W + 100)
    const path: Record<number, number> = {}
    for (let i = W + 70; i < W + 300; i++) path[i] = 1_000_000  // unaffordable after the first trade
    const r = backtestInstrument('AAA', 'Tech', rows(W + 300, 100, path))
    expect(r.totalTrades).toBe(1)
    expect(r.unaffordableEntries).toBe(1)
    expect(aggregatePortfolio([r], 100_000).untradeableTickers).toEqual([])
  })
})
