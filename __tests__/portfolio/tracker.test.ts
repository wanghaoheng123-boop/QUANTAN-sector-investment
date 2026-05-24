/**
 * lib/portfolio/tracker.ts tests (Q-051-NEW).
 *
 * Coverage: createPortfolio, addPosition (new + average-up), closePosition
 * (full + partial), updatePrices (incl. invalid-price rejection),
 * recomputePortfolio invariants, holdingDays date validation, error paths.
 *
 * Skips localStorage tests since this lib gracefully degrades when
 * `typeof localStorage === 'undefined'` (Node env).
 */

import { describe, it, expect } from 'vitest'
import {
  createPortfolio,
  addPosition,
  closePosition,
  updatePrices,
  type Portfolio,
} from '@/lib/portfolio/tracker'

describe('createPortfolio', () => {
  it('initializes with all-cash NAV and zero P&L', () => {
    const p = createPortfolio('Test', 100_000)
    expect(p.name).toBe('Test')
    expect(p.cash).toBe(100_000)
    expect(p.initialCapital).toBe(100_000)
    expect(p.totalValue).toBe(100_000)
    expect(p.positions).toEqual([])
    expect(p.unrealizedPnl).toBe(0)
    expect(p.realizedPnl).toBe(0)
    expect(p.totalReturnPct).toBe(0)
    expect(p.id).toMatch(/^p-\d+$/)
  })
})

describe('addPosition', () => {
  it('opens a new position and deducts cash', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Technology', 10, 150, '2026-01-01')
    expect(p.positions).toHaveLength(1)
    expect(p.positions[0].ticker).toBe('AAPL')
    expect(p.positions[0].shares).toBe(10)
    expect(p.positions[0].avgCost).toBe(150)
    expect(p.cash).toBe(100_000 - 1500)
    expect(p.totalValue).toBe(100_000) // still flat: cash + shares*current
  })

  it('average-up: blends avgCost on existing ticker', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Technology', 10, 100, '2026-01-01')
    p = addPosition(p, 'AAPL', 'Technology', 10, 200, '2026-01-15')
    expect(p.positions).toHaveLength(1)
    expect(p.positions[0].shares).toBe(20)
    expect(p.positions[0].avgCost).toBe(150) // (10*100 + 10*200) / 20
    expect(p.cash).toBe(100_000 - 1000 - 2000)
  })

  it('preserves the original entryDate on average-up', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Tech', 5, 100, '2026-01-01')
    p = addPosition(p, 'AAPL', 'Tech', 5, 110, '2026-06-01')
    expect(p.positions[0].entryDate).toBe('2026-01-01')
  })

  it('throws on insufficient cash', () => {
    const p = createPortfolio('T', 1000)
    expect(() => addPosition(p, 'AAPL', 'Tech', 100, 50, '2026-01-01'))
      .toThrow(/Insufficient cash/)
  })

  it('records optional stop-loss and target prices', () => {
    let p = createPortfolio('T', 10_000)
    p = addPosition(p, 'AAPL', 'Tech', 1, 100, '2026-01-01', 90, 130)
    expect(p.positions[0].stopLossPrice).toBe(90)
    expect(p.positions[0].targetPrice).toBe(130)
  })
})

describe('closePosition', () => {
  function setup(): Portfolio {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Tech', 10, 100, '2026-01-01')
    return p
  }

  it('closes a full position and records the realized trade', () => {
    const initial = setup()
    const { portfolio: after, trade } = closePosition(initial, 'AAPL', 10, 150, '2026-01-31')
    expect(after.positions).toHaveLength(0)
    expect(after.cash).toBe(100_000 - 1000 + 1500) // 100.5k
    expect(after.realizedPnl).toBe(500)
    expect(trade.realizedPnl).toBe(500)
    expect(trade.realizedPnlPct).toBeCloseTo(0.5, 6)
    expect(trade.exitReason).toBe('signal')
  })

  it('partial close keeps position with reduced shares', () => {
    const initial = setup()
    const { portfolio: after, trade } = closePosition(initial, 'AAPL', 4, 150, '2026-01-31')
    expect(after.positions).toHaveLength(1)
    expect(after.positions[0].shares).toBe(6)
    expect(after.realizedPnl).toBe(200) // (150-100) * 4
    expect(trade.shares).toBe(4)
  })

  it('throws when ticker not in portfolio', () => {
    const p = setup()
    expect(() => closePosition(p, 'GOOG', 1, 200, '2026-01-31'))
      .toThrow(/No position in GOOG/)
  })

  it('throws when closing more shares than held', () => {
    const p = setup()
    expect(() => closePosition(p, 'AAPL', 11, 150, '2026-01-31'))
      .toThrow(/Cannot close 11 shares/)
  })

  it('holdingDays is 0 when entry/exit dates are invalid', () => {
    const p = setup()
    const { trade } = closePosition(p, 'AAPL', 10, 150, 'NOT-A-DATE')
    // entry is valid ('2026-01-01'), exit is invalid → guard returns 0
    expect(trade.holdingDays).toBe(0)
  })

  it('holdingDays = elapsed days for valid dates', () => {
    const p = setup() // entry 2026-01-01
    const { trade } = closePosition(p, 'AAPL', 10, 150, '2026-01-11')
    expect(trade.holdingDays).toBe(10)
  })

  it('exit reason is propagated', () => {
    const p = setup()
    const { trade } = closePosition(p, 'AAPL', 10, 90, '2026-01-05', 'stop_loss')
    expect(trade.exitReason).toBe('stop_loss')
    expect(trade.realizedPnl).toBe(-100) // (90-100)*10
  })

  it('closing a position with avgCost=0 produces realizedPnlPct=0, not Infinity (Phase 16 div-by-zero guard)', () => {
    // Simulate a corrupted-state position with avgCost=0. addPosition would
    // never produce this in normal flow (it requires price > 0), but
    // localStorage corruption / a buggy upgrade migration could.
    const p = createPortfolio('T', 100_000)
    p.positions.push({
      ticker: 'CORRUPT',
      sector: 'Tech',
      shares: 10,
      avgCost: 0, // ← the toxic value
      currentPrice: 100,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      weight: 0,
      entryDate: '2026-01-01',
      stopLossPrice: null,
      targetPrice: null,
    })
    const { trade } = closePosition(p, 'CORRUPT', 10, 150, '2026-01-31')
    // Pre-fix: (150-0)/0 = Infinity → JSON.stringify → null.
    // Post-fix: realizedPnlPct = 0 (the only finite value that signals
    // "undefined % return on a zero-cost position").
    expect(trade.realizedPnlPct).toBe(0)
    expect(Number.isFinite(trade.realizedPnlPct)).toBe(true)
    // realizedPnl = (150 - 0) × 10 = 1500 — this is still meaningful even
    // when the percentage isn't.
    expect(trade.realizedPnl).toBe(1500)
  })
})

describe('updatePrices + recomputePortfolio invariants', () => {
  it('recomputes weights, unrealizedPnl, totalReturnPct on price change', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Tech', 10, 100, '2026-01-01')
    p = updatePrices(p, { AAPL: 150 })
    expect(p.positions[0].currentPrice).toBe(150)
    expect(p.positions[0].unrealizedPnl).toBe(500)
    expect(p.positions[0].unrealizedPnlPct).toBeCloseTo(0.5, 6)
    // totalValue = cash(99_000) + 10 shares × 150 = 100_500 → +0.5%
    expect(p.totalValue).toBe(100_500)
    expect(p.totalReturnPct).toBeCloseTo(0.005, 6)
  })

  it('ignores NaN / Infinity / negative / zero prices', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Tech', 10, 100, '2026-01-01')
    const before = p.positions[0].currentPrice
    p = updatePrices(p, { AAPL: NaN })
    expect(p.positions[0].currentPrice).toBe(before)
    p = updatePrices(p, { AAPL: -1 })
    expect(p.positions[0].currentPrice).toBe(before)
    p = updatePrices(p, { AAPL: 0 })
    expect(p.positions[0].currentPrice).toBe(before)
    p = updatePrices(p, { AAPL: Infinity })
    expect(p.positions[0].currentPrice).toBe(before)
  })

  it('weight = position market value / total portfolio value', () => {
    let p = createPortfolio('T', 100_000)
    p = addPosition(p, 'AAPL', 'Tech', 10, 100, '2026-01-01') // $1000 pos, $99k cash
    p = addPosition(p, 'GOOG', 'Tech', 10, 200, '2026-01-01') // $2000 pos, $97k cash
    p = updatePrices(p, { AAPL: 100, GOOG: 200 }) // unchanged
    // totalValue 100k, AAPL weight 1%, GOOG weight 2%
    expect(p.positions.find(x => x.ticker === 'AAPL')?.weight).toBeCloseTo(0.01, 6)
    expect(p.positions.find(x => x.ticker === 'GOOG')?.weight).toBeCloseTo(0.02, 6)
  })
})
