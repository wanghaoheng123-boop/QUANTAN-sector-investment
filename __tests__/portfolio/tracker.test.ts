import { describe, it, expect } from 'vitest'
import {
  createPortfolio,
  openPosition,
  closePosition,
  updatePrices,
  portfolioSummary,
  realizedPnl,
  positionMetrics,
} from '@/lib/portfolio/tracker'

describe('createPortfolio', () => {
  it('creates portfolio with specified cash', () => {
    const p = createPortfolio(50_000)
    expect(p.cash).toBe(50_000)
    expect(Object.keys(p.positions)).toHaveLength(0)
    expect(p.trades).toHaveLength(0)
  })

  it('defaults to $100,000', () => {
    const p = createPortfolio()
    expect(p.cash).toBe(100_000)
  })
})

describe('openPosition', () => {
  it('deducts cost from cash', () => {
    const p = createPortfolio(10_000)
    const p2 = openPosition(p, 'AAPL', 'LONG', 10, 100, 5)
    expect(p2.cash).toBeCloseTo(10_000 - 10 * 100 - 5)
  })

  it('creates a new position', () => {
    const p = openPosition(createPortfolio(), 'MSFT', 'LONG', 5, 200)
    expect(p.positions['MSFT']).toBeDefined()
    expect(p.positions['MSFT'].quantity).toBe(5)
    expect(p.positions['MSFT'].avgCost).toBe(200)
  })

  it('averages into existing long position', () => {
    let p = createPortfolio()
    p = openPosition(p, 'NVDA', 'LONG', 10, 100)   // $100 avg
    p = openPosition(p, 'NVDA', 'LONG', 10, 200)   // $200 avg
    expect(p.positions['NVDA'].quantity).toBe(20)
    expect(p.positions['NVDA'].avgCost).toBeCloseTo(150)
  })

  it('records a trade', () => {
    const p = openPosition(createPortfolio(), 'SPY', 'LONG', 1, 400)
    expect(p.trades).toHaveLength(1)
    expect(p.trades[0].action).toBe('BUY')
    expect(p.trades[0].ticker).toBe('SPY')
  })

  it('throws when cash insufficient', () => {
    const p = createPortfolio(100)
    expect(() => openPosition(p, 'BRK', 'LONG', 1, 500_000)).toThrow(/Insufficient cash/)
  })

  it('throws for non-positive quantity', () => {
    expect(() => openPosition(createPortfolio(), 'X', 'LONG', 0, 10)).toThrow()
  })

  it('supports SHORT positions', () => {
    const p = openPosition(createPortfolio(), 'QQQ', 'SHORT', 5, 300)
    expect(p.positions['QQQ'].side).toBe('SHORT')
    // opening a short still costs cash (margin requirement approximated as cost)
    expect(p.cash).toBeLessThan(100_000)
  })
})

describe('closePosition', () => {
  it('adds proceeds to cash', () => {
    let p = createPortfolio(10_000)
    p = openPosition(p, 'AAPL', 'LONG', 10, 100)
    const { portfolio: p2 } = closePosition(p, 'AAPL', 10, 120)
    expect(p2.cash).toBeCloseTo(p.cash + 10 * 120)
  })

  it('computes correct realized P&L for long', () => {
    let p = createPortfolio()
    p = openPosition(p, 'TSLA', 'LONG', 100, 200)
    const { realizedPnl: rpnl } = closePosition(p, 'TSLA', 100, 250)
    expect(rpnl).toBeCloseTo(100 * (250 - 200))
  })

  it('computes correct realized P&L for short', () => {
    let p = createPortfolio()
    p = openPosition(p, 'META', 'SHORT', 50, 300)
    const { realizedPnl: rpnl } = closePosition(p, 'META', 50, 250)
    expect(rpnl).toBeCloseTo(50 * (300 - 250))  // profit from price decline
  })

  it('removes position after full close', () => {
    let p = createPortfolio()
    p = openPosition(p, 'GOOG', 'LONG', 5, 100)
    const { portfolio: p2 } = closePosition(p, 'GOOG', 5, 110)
    expect(p2.positions['GOOG']).toBeUndefined()
  })

  it('supports partial close', () => {
    let p = createPortfolio()
    p = openPosition(p, 'AMZN', 'LONG', 20, 150)
    const { portfolio: p2 } = closePosition(p, 'AMZN', 8, 160)
    expect(p2.positions['AMZN'].quantity).toBe(12)
  })

  it('throws when closing more than held', () => {
    let p = createPortfolio()
    p = openPosition(p, 'XYZ', 'LONG', 5, 10)
    expect(() => closePosition(p, 'XYZ', 10, 12)).toThrow()
  })

  it('throws when no position exists', () => {
    expect(() => closePosition(createPortfolio(), 'NOPE', 1, 100)).toThrow()
  })
})

describe('updatePrices', () => {
  it('updates lastPrice for specified tickers', () => {
    let p = createPortfolio()
    p = openPosition(p, 'AAPL', 'LONG', 10, 150)
    p = updatePrices(p, { AAPL: 175 })
    expect(p.positions['AAPL'].lastPrice).toBe(175)
  })

  it('leaves unspecified tickers unchanged', () => {
    let p = createPortfolio()
    p = openPosition(p, 'AAPL', 'LONG', 10, 150)
    p = openPosition(p, 'MSFT', 'LONG', 5, 200)
    p = updatePrices(p, { AAPL: 175 })
    expect(p.positions['MSFT'].lastPrice).toBe(200)
  })
})

describe('positionMetrics', () => {
  it('computes unrealized P&L for long', () => {
    let p = createPortfolio()
    p = openPosition(p, 'SPY', 'LONG', 10, 400)
    p = updatePrices(p, { SPY: 420 })
    const m = positionMetrics(p.positions['SPY'])
    expect(m.unrealizedPnl).toBeCloseTo(10 * 20)
    expect(m.unrealizedPnlPct).toBeCloseTo(20 / 400)
  })

  it('computes unrealized P&L for short (profit on decline)', () => {
    let p = createPortfolio()
    p = openPosition(p, 'QQQ', 'SHORT', 5, 300)
    p = updatePrices(p, { QQQ: 270 })
    const m = positionMetrics(p.positions['QQQ'])
    expect(m.unrealizedPnl).toBeCloseTo(5 * 30)
  })

  it('computes dayPnl when prevClose supplied', () => {
    let p = createPortfolio()
    p = openPosition(p, 'GLD', 'LONG', 10, 180)
    p = updatePrices(p, { GLD: 185 })
    const m = positionMetrics(p.positions['GLD'], 180)
    expect(m.dayPnl).toBeCloseTo(50)
  })
})

describe('realizedPnl', () => {
  it('returns 0 when no SELL trades', () => {
    let p = createPortfolio()
    p = openPosition(p, 'AAPL', 'LONG', 10, 100)
    expect(realizedPnl(p.trades)).toBe(0)
  })

  it('correctly sums FIFO P&L across multiple trades', () => {
    let p = createPortfolio()
    p = openPosition(p, 'NVDA', 'LONG', 10, 100)
    p = openPosition(p, 'NVDA', 'LONG', 10, 150)
    const { portfolio: p2 } = closePosition(p, 'NVDA', 15, 200)
    // FIFO: first 10 lots at cost 100, next 5 at cost 150
    // PnL = 10*(200-100) + 5*(200-150) = 1000 + 250 = 1250
    expect(realizedPnl(p2.trades)).toBeCloseTo(1250)
  })
})

describe('portfolioSummary', () => {
  it('totalValue = cash + market values', () => {
    let p = createPortfolio(50_000)
    p = openPosition(p, 'AAPL', 'LONG', 100, 150)  // cost $15k, cash now $35k
    p = updatePrices(p, { AAPL: 160 })
    const s = portfolioSummary(p)
    expect(s.totalValue).toBeCloseTo(35_000 + 100 * 160)
    expect(s.cash).toBeCloseTo(35_000)
  })
})
