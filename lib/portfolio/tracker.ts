/**
 * Portfolio tracker — position model with CRUD operations.
 * MVP persistence via localStorage (no server DB required).
 * TypeScript-safe, works in both browser and Node environments.
 */

export interface Position {
  ticker: string
  sector: string
  shares: number
  avgCost: number        // average cost basis per share
  currentPrice: number
  unrealizedPnl: number  // (currentPrice - avgCost) * shares
  unrealizedPnlPct: number
  weight: number         // position value / total portfolio value
  entryDate: string      // ISO date
  stopLossPrice: number | null
  targetPrice: number | null
}

export interface Portfolio {
  id: string
  name: string
  positions: Position[]
  cash: number
  initialCapital: number
  totalValue: number     // cash + sum(position market values)
  unrealizedPnl: number
  /** Total return since inception: (totalValue - initialCapital) / initialCapital.
   *  Includes both realized and unrealized P&L, hence "total return" not "unrealized PnL%". */
  totalReturnPct: number
  realizedPnl: number
  createdAt: string
  updatedAt: string
}

export interface ClosedTrade {
  ticker: string
  sector: string
  entryDate: string
  exitDate: string
  shares: number
  entryPrice: number
  exitPrice: number
  realizedPnl: number
  realizedPnlPct: number
  holdingDays: number
  exitReason: 'signal' | 'stop_loss' | 'profit_target' | 'manual'
}

// ─── Storage key ──────────────────────────────────────────────────────────────

function storageKey(portfolioId: string): string {
  return `quantan-portfolio-${portfolioId}`
}

function closedTradesKey(portfolioId: string): string {
  return `quantan-closed-trades-${portfolioId}`
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createPortfolio(name: string, initialCapital: number): Portfolio {
  const now = new Date().toISOString()
  return {
    id: `p-${Date.now()}`,
    name,
    positions: [],
    cash: initialCapital,
    initialCapital,
    totalValue: initialCapital,
    unrealizedPnl: 0,
    totalReturnPct: 0,
    realizedPnl: 0,
    createdAt: now,
    updatedAt: now,
  }
}

export function savePortfolio(portfolio: Portfolio): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey(portfolio.id), JSON.stringify(portfolio))
}

export function loadPortfolio(portfolioId: string): Portfolio | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(storageKey(portfolioId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as Portfolio
  } catch {
    return null
  }
}

export function listPortfolioIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  const ids: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('quantan-portfolio-')) {
      ids.push(key.replace('quantan-portfolio-', ''))
    }
  }
  return ids
}

// ─── Position management ──────────────────────────────────────────────────────

export function addPosition(
  portfolio: Portfolio,
  ticker: string,
  sector: string,
  shares: number,
  price: number,
  entryDate: string,
  stopLossPrice: number | null = null,
  targetPrice: number | null = null,
): Portfolio {
  const cost = shares * price
  if (cost > portfolio.cash) {
    throw new Error(`Insufficient cash: need ${cost.toFixed(2)}, have ${portfolio.cash.toFixed(2)}`)
  }
  const existing = portfolio.positions.find(p => p.ticker === ticker)
  if (existing) {
    // Average-up / average-down: keep original entryDate for the original shares.
    // The new shares get the new entryDate in tracking, but the position-level
    // entryDate stays as the original — this is the conventional treatment.
    const totalShares = existing.shares + shares
    const newAvgCost = (existing.shares * existing.avgCost + shares * price) / totalShares
    existing.shares = totalShares
    existing.avgCost = newAvgCost
    existing.currentPrice = price
    // Keep original entryDate; do NOT overwrite with the new date
    // existing.entryDate remains unchanged
  } else {
    portfolio.positions.push({
      ticker, sector, shares, avgCost: price,
      currentPrice: price,
      unrealizedPnl: 0, unrealizedPnlPct: 0, weight: 0,
      entryDate,
      stopLossPrice, targetPrice,
    })
  }
  portfolio.cash -= cost
  portfolio.updatedAt = new Date().toISOString()
  return recomputePortfolio(portfolio)
}

export function closePosition(
  portfolio: Portfolio,
  ticker: string,
  shares: number,
  exitPrice: number,
  exitDate: string,
  exitReason: ClosedTrade['exitReason'] = 'signal',
): { portfolio: Portfolio; trade: ClosedTrade } {
  const pos = portfolio.positions.find(p => p.ticker === ticker)
  if (!pos) throw new Error(`No position in ${ticker}`)
  if (shares > pos.shares) throw new Error(`Cannot close ${shares} shares; only hold ${pos.shares}`)

  const proceeds = shares * exitPrice
  const realizedPnl = (exitPrice - pos.avgCost) * shares
  const realizedPnlPct = (exitPrice - pos.avgCost) / pos.avgCost

  portfolio.cash += proceeds
  portfolio.realizedPnl += realizedPnl

  const trade: ClosedTrade = {
    ticker, sector: pos.sector,
    entryDate: pos.entryDate, exitDate,
    shares, entryPrice: pos.avgCost, exitPrice,
    realizedPnl, realizedPnlPct,
    holdingDays: Math.round((new Date(exitDate).getTime() - new Date(pos.entryDate).getTime()) / 86400000),
    exitReason,
  }

  if (shares >= pos.shares) {
    portfolio.positions = portfolio.positions.filter(p => p.ticker !== ticker)
  } else {
    pos.shares -= shares
  }

  portfolio.updatedAt = new Date().toISOString()
  return { portfolio: recomputePortfolio(portfolio), trade }
}

export function updatePrices(portfolio: Portfolio, prices: Record<string, number>): Portfolio {
  for (const pos of portfolio.positions) {
    const rawPrice = prices[pos.ticker]
    if (rawPrice != null) {
      // Validate: reject NaN, Infinity, negative, or zero prices
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
        continue  // Keep previous price for invalid inputs
      }
      pos.currentPrice = rawPrice
    }
  }
  return recomputePortfolio(portfolio)
}

function recomputePortfolio(portfolio: Portfolio): Portfolio {
  const posValue = portfolio.positions.reduce((s, p) => s + p.shares * p.currentPrice, 0)
  portfolio.totalValue = portfolio.cash + posValue

  for (const pos of portfolio.positions) {
    const mktVal = pos.shares * pos.currentPrice
    pos.unrealizedPnl = (pos.currentPrice - pos.avgCost) * pos.shares
    pos.unrealizedPnlPct = pos.avgCost > 0 ? (pos.currentPrice - pos.avgCost) / pos.avgCost : 0
    pos.weight = portfolio.totalValue > 0 ? mktVal / portfolio.totalValue : 0
  }

  const totalUnrealized = portfolio.positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  portfolio.unrealizedPnl = totalUnrealized
  // This is actually total return (realized + unrealized), not just unrealized PnL %.
  // totalValue includes both cash (which holds realized PnL) and position market values.
  portfolio.totalReturnPct = portfolio.initialCapital > 0
    ? (portfolio.totalValue - portfolio.initialCapital) / portfolio.initialCapital
    : 0

  return portfolio
}

// ─── Closed trade persistence ─────────────────────────────────────────────────

export function appendClosedTrade(portfolioId: string, trade: ClosedTrade): void {
  if (typeof localStorage === 'undefined') return
  const key = closedTradesKey(portfolioId)
  let existing: ClosedTrade[] = []
  try {
    existing = JSON.parse(localStorage.getItem(key) ?? '[]') as ClosedTrade[]
    if (!Array.isArray(existing)) existing = []
  } catch {
    // Corrupted data — initialize with empty array
    existing = []
  }
  existing.push(trade)
  localStorage.setItem(key, JSON.stringify(existing))
}

export function loadClosedTrades(portfolioId: string): ClosedTrade[] {
  if (typeof localStorage === 'undefined') return []
  const raw = localStorage.getItem(closedTradesKey(portfolioId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as ClosedTrade[] : []
  } catch {
    // Corrupted data — return empty array
    return []
  }
}
