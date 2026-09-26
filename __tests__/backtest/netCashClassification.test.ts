import { describe, it, expect } from 'vitest'
import { netCashPnl, TX_COST_PCT_PER_SIDE, type Trade } from '@/lib/backtest/core'
import { aggregatePortfolio } from '@/lib/backtest/engine'

/**
 * Q-123 — win/loss was decided by `r > 2c`, a price-return approximation.
 * The exit fee is charged on EXIT notional, so exact cash profit per entry
 * notional is `r - c*(2 + r)` and break-even is `2c/(1-c)`, not `2c`. Every
 * return inside that sliver was booked as a win while losing money.
 *
 * Q-124 — profit factor summed PERCENTAGES, so a $100 position and a
 * $100,000 position counted equally, and the two call sites disagreed about
 * where a gross-positive-but-net-losing trade belonged.
 */

const c = TX_COST_PCT_PER_SIDE
const BREAK_EVEN = (2 * c) / (1 - c)

const mk = (over: Partial<Trade> = {}): Trade => ({
  date: '2026-01-05', ticker: 'T', sector: 'S', action: 'BUY',
  entryPrice: 100, exitPrice: 100, shares: 10, value: 1000,
  regime: 'FIRST_DIP', dipSignal: 'STRONG_DIP', confidence: 90,
  pnlPct: 0, reason: '__SYNTHETIC__ Q123 boundary fixture', ...over,
})

describe('Q-123 — the exact break-even, not the 2c approximation', () => {
  it('the two definitions genuinely differ', () => {
    expect(BREAK_EVEN).toBeGreaterThan(2 * c)
    // ~2.4 bps apart at 11 bps per side — the misclassified band.
    expect((BREAK_EVEN - 2 * c) * 10_000).toBeCloseTo(0.0242, 3)
  })

  it('THE REPORTED CASE: 500 @ 100 sold at 100.2201 loses money', () => {
    const t = mk({ shares: 500, entryPrice: 100, exitPrice: 100.2201 })
    const cash = netCashPnl(t)
    expect(cash).toBeLessThan(0)
    expect(cash).toBeCloseTo(-0.071055, 6)   // the audit's figure, independently
    // and the old rule would have called it a win
    const oldRule = (100.2201 - 100) / 100 > 2 * c
    expect(oldRule).toBe(true)
  })

  it('classifies either side of exact break-even, and break-even itself', () => {
    const at = (r: number) => netCashPnl(mk({ exitPrice: 100 * (1 + r) }))
    expect(at(BREAK_EVEN * 0.999)).toBeLessThan(0)
    expect(at(BREAK_EVEN)).toBeCloseTo(0, 9)
    expect(at(BREAK_EVEN * 1.001)).toBeGreaterThan(0)
    expect(at(0)).toBeLessThan(0)          // zero move still pays both fees
  })

  it('a SELL (short) round trip is costed symmetrically', () => {
    const short = mk({ action: 'SELL', entryPrice: 100, exitPrice: 90 })
    expect(netCashPnl(short)).toBeGreaterThan(0)
    const badShort = mk({ action: 'SELL', entryPrice: 100, exitPrice: 110 })
    expect(netCashPnl(badShort)).toBeLessThan(0)
  })
})

describe('Q-124 — profit factor is net dollars, and size matters', () => {
  const resultWith = (trades: Trade[]) => ({
    ticker: 'AAA', sector: 'Technology', initialPrice: 100, finalPrice: 110,
    totalReturn: 0.1, annualizedReturn: 0.1, sharpeRatio: null, sortinoRatio: null,
    maxDrawdown: 0, winRate: 0, profitFactor: 0, avgTradeReturn: 0,
    totalTrades: trades.length, closedTrades: trades, openTrade: null,
    equityCurve: Array.from({ length: 300 }, (_, i) => 100_000 + i),
    bnhCurve: Array.from({ length: 300 }, (_, i) => 100_000 + i),
    dailyReturns: Array.from({ length: 299 }, () => 0.0001),
    days: 300, bnhReturn: 0.1, excessReturn: 0, confidenceAvg: 90,
  })

  it('a gross gain that cannot clear costs is a LOSS in both sums, not neither', () => {
    // The exact pair from the ticket: +10% and +0.1%.
    const trades = [
      mk({ exitPrice: 110 }),      // clear win
      mk({ exitPrice: 100.1 }),    // gross +0.1% -> net loss
    ]
    const agg = aggregatePortfolio([resultWith(trades)], 100_000)
    // Previously: core said 100, aggregating the same result said Infinity.
    expect(Number.isFinite(agg.profitFactor)).toBe(true)
    const cs = trades.map(netCashPnl)
    expect(agg.profitFactor).toBeCloseTo(
      cs.filter(v => v > 0).reduce((a, b) => a + b, 0) /
      Math.abs(cs.filter(v => v < 0).reduce((a, b) => a + b, 0)), 10)
  })

  it('position SIZE now changes the profit factor, as net dollars must', () => {
    // Identical percentage moves, different notionals. Summing percentages
    // made these two portfolios identical; summing cash does not.
    const small = [mk({ shares: 1, exitPrice: 110 }), mk({ shares: 1000, exitPrice: 98 })]
    const large = [mk({ shares: 1000, exitPrice: 110 }), mk({ shares: 1, exitPrice: 98 })]
    const pfSmall = aggregatePortfolio([resultWith(small)], 100_000).profitFactor
    const pfLarge = aggregatePortfolio([resultWith(large)], 100_000).profitFactor
    expect(pfLarge).toBeGreaterThan(pfSmall)
  })

  it('WHAT THIS CANNOT DO — asserted, so a green run is not read as a proof', () => {
    // Still per-trade cash, not time-weighted: it does not account for how
    // long capital was committed, so two trades of equal cash profit count
    // equally whether held one day or sixty.
    const quick = mk({ shares: 10, exitPrice: 110 })
    const slow = mk({ shares: 10, exitPrice: 110 })
    expect(netCashPnl(quick)).toBeCloseTo(netCashPnl(slow), 12)
  })
})
