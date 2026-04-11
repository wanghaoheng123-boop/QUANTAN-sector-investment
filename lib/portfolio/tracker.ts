/**
 * Portfolio tracker — positions, cash, and P&L.
 *
 * Storage: server-side this is pure in-memory (for API use); on the client,
 * the state is persisted to `localStorage` under the key "quantan_portfolio".
 *
 * This module is isomorphic: all logic runs the same way in Node and browser.
 * The persistence helpers (`savePortfolio` / `loadPortfolio`) are no-ops on
 * the server — callers in Next.js API routes should own their own storage.
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type Side = 'LONG' | 'SHORT'

export interface Position {
  ticker: string
  side: Side
  /** Number of shares/units held (always positive). */
  quantity: number
  /** Average entry price per unit. */
  avgCost: number
  /** Latest market price per unit (updated externally). */
  lastPrice: number
  /** ISO timestamp of when this position was opened. */
  openedAt: string
  /** Optional note (strategy, thesis, etc.). */
  note?: string
}

export interface Trade {
  id: string          // UUID-style
  ticker: string
  side: Side
  action: 'BUY' | 'SELL'
  quantity: number
  price: number
  commission: number  // USD, default 0
  executedAt: string  // ISO timestamp
  note?: string
}

export interface Portfolio {
  /** Available cash in USD. */
  cash: number
  positions: Record<string, Position>  // keyed by ticker
  trades: Trade[]
  /** Creation / last-modified timestamp. */
  updatedAt: string
}

export interface PositionMetrics {
  ticker: string
  side: Side
  quantity: number
  avgCost: number
  lastPrice: number
  marketValue: number   // quantity × lastPrice
  costBasis: number     // quantity × avgCost
  unrealizedPnl: number
  unrealizedPnlPct: number
  dayPnl?: number       // optional, requires prevClose
}

export interface PortfolioSummary {
  totalValue: number      // cash + sum of marketValues
  totalCostBasis: number
  totalUnrealizedPnl: number
  totalUnrealizedPnlPct: number
  totalRealizedPnl: number
  cash: number
  positions: PositionMetrics[]
  updatedAt: string
}

// ────────────────────────────────────────────────────────────────
// Factory / helpers
// ────────────────────────────────────────────────────────────────

export function createPortfolio(initialCash = 100_000): Portfolio {
  return {
    cash: initialCash,
    positions: {},
    trades: [],
    updatedAt: new Date().toISOString(),
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function uuid(): string {
  // Minimal UUID v4 without crypto dependency
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ────────────────────────────────────────────────────────────────
// Core mutations (immutable — return new Portfolio)
// ────────────────────────────────────────────────────────────────

/**
 * Add a new long/short position or average into an existing one.
 * Reduces cash by `price × quantity + commission`.
 */
export function openPosition(
  portfolio: Portfolio,
  ticker: string,
  side: Side,
  quantity: number,
  price: number,
  commission = 0,
  note?: string,
): Portfolio {
  if (quantity <= 0 || price <= 0) throw new Error('quantity and price must be positive')

  const cost = quantity * price + commission
  if (portfolio.cash < cost) throw new Error(`Insufficient cash: need $${cost.toFixed(2)}, have $${portfolio.cash.toFixed(2)}`)

  const existing = portfolio.positions[ticker]
  let newPosition: Position

  if (existing && existing.side === side) {
    // Average in
    const totalQty = existing.quantity + quantity
    const totalCost = existing.quantity * existing.avgCost + quantity * price
    newPosition = { ...existing, quantity: totalQty, avgCost: totalCost / totalQty, lastPrice: price }
  } else {
    newPosition = {
      ticker,
      side,
      quantity,
      avgCost: price,
      lastPrice: price,
      openedAt: nowIso(),
      note,
    }
  }

  const trade: Trade = {
    id: uuid(),
    ticker,
    side,
    action: 'BUY',
    quantity,
    price,
    commission,
    executedAt: nowIso(),
    note,
  }

  return {
    ...portfolio,
    cash: portfolio.cash - cost,
    positions: { ...portfolio.positions, [ticker]: newPosition },
    trades: [...portfolio.trades, trade],
    updatedAt: nowIso(),
  }
}

/**
 * Close (fully or partially) an existing position.
 * Increases cash by `price × quantity − commission`.
 * Returns `{ portfolio, realizedPnl }`.
 */
export function closePosition(
  portfolio: Portfolio,
  ticker: string,
  quantity: number,
  price: number,
  commission = 0,
  note?: string,
): { portfolio: Portfolio; realizedPnl: number } {
  const pos = portfolio.positions[ticker]
  if (!pos) throw new Error(`No open position for ${ticker}`)
  if (quantity > pos.quantity) throw new Error(`Cannot close ${quantity} — only ${pos.quantity} held`)

  const proceeds = quantity * price - commission
  const costBasis = quantity * pos.avgCost
  const realizedPnl = pos.side === 'LONG' ? proceeds - costBasis : costBasis - proceeds

  const remainingQty = pos.quantity - quantity
  const newPositions = { ...portfolio.positions }
  if (remainingQty === 0) {
    delete newPositions[ticker]
  } else {
    newPositions[ticker] = { ...pos, quantity: remainingQty, lastPrice: price }
  }

  const trade: Trade = {
    id: uuid(),
    ticker,
    side: pos.side,
    action: 'SELL',
    quantity,
    price,
    commission,
    executedAt: nowIso(),
    note,
  }

  return {
    portfolio: {
      ...portfolio,
      cash: portfolio.cash + proceeds,
      positions: newPositions,
      trades: [...portfolio.trades, trade],
      updatedAt: nowIso(),
    },
    realizedPnl,
  }
}

/**
 * Update the last market price for one or more tickers.
 */
export function updatePrices(
  portfolio: Portfolio,
  prices: Record<string, number>,
): Portfolio {
  const updated: Record<string, Position> = {}
  for (const [ticker, pos] of Object.entries(portfolio.positions)) {
    updated[ticker] = prices[ticker] != null
      ? { ...pos, lastPrice: prices[ticker] }
      : pos
  }
  return { ...portfolio, positions: updated, updatedAt: nowIso() }
}

// ────────────────────────────────────────────────────────────────
// Analytics
// ────────────────────────────────────────────────────────────────

export function positionMetrics(pos: Position, prevClose?: number): PositionMetrics {
  const marketValue = pos.quantity * pos.lastPrice
  const costBasis   = pos.quantity * pos.avgCost
  const signedPnl   = pos.side === 'LONG'
    ? marketValue - costBasis
    : costBasis - marketValue
  const pct = costBasis === 0 ? 0 : signedPnl / costBasis

  const dayPnl = prevClose != null
    ? pos.quantity * (pos.side === 'LONG' ? pos.lastPrice - prevClose : prevClose - pos.lastPrice)
    : undefined

  return {
    ticker: pos.ticker,
    side: pos.side,
    quantity: pos.quantity,
    avgCost: pos.avgCost,
    lastPrice: pos.lastPrice,
    marketValue,
    costBasis,
    unrealizedPnl: signedPnl,
    unrealizedPnlPct: pct,
    dayPnl,
  }
}

/** Compute total realized P&L from trade history. */
export function realizedPnl(trades: Trade[]): number {
  // Pair BUY and SELL trades per ticker with FIFO matching
  const queues: Record<string, Array<{ qty: number; price: number; side: Side }>> = {}
  let total = 0

  for (const t of trades) {
    if (!queues[t.ticker]) queues[t.ticker] = []

    if (t.action === 'BUY') {
      queues[t.ticker].push({ qty: t.quantity, price: t.price, side: t.side })
    } else {
      // SELL — match against FIFO queue
      let remaining = t.quantity
      while (remaining > 0 && queues[t.ticker].length > 0) {
        const lot = queues[t.ticker][0]
        const matched = Math.min(lot.qty, remaining)
        const pnl = lot.side === 'LONG'
          ? matched * (t.price - lot.price)
          : matched * (lot.price - t.price)
        total += pnl
        lot.qty -= matched
        remaining -= matched
        if (lot.qty === 0) queues[t.ticker].shift()
      }
    }
  }

  return total
}

export function portfolioSummary(portfolio: Portfolio): PortfolioSummary {
  const positions = Object.values(portfolio.positions).map((p) => positionMetrics(p))
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const totalCostBasis   = positions.reduce((s, p) => s + p.costBasis, 0)
  const totalUnrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0)
  const totalValue = portfolio.cash + totalMarketValue

  return {
    totalValue,
    totalCostBasis,
    totalUnrealizedPnl,
    totalUnrealizedPnlPct: totalCostBasis === 0 ? 0 : totalUnrealizedPnl / totalCostBasis,
    totalRealizedPnl: realizedPnl(portfolio.trades),
    cash: portfolio.cash,
    positions,
    updatedAt: portfolio.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────
// localStorage persistence (browser-only, no-op on server)
// ────────────────────────────────────────────────────────────────

const LS_KEY = 'quantan_portfolio'

export function savePortfolio(portfolio: Portfolio): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(portfolio))
  } catch { /* storage quota exceeded or private mode */ }
}

export function loadPortfolio(): Portfolio | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Portfolio) : null
  } catch { return null }
}

export function clearPortfolio(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}
