/**
 * POST /api/portfolio/risk-parity
 *
 * Compute inverse-volatility weights for a set of tickers.
 *
 * Body: { tickers: string[], totalValue?: number, volWindow?: number }
 * Returns: RiskParityResult
 */

import { NextResponse } from 'next/server'
import { riskParityWeights, equalWeights } from '@/lib/portfolio/riskParity'
import { loadStockHistory, closesFromRows } from '@/lib/backtest/dataLoader'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  let body: { tickers?: string[]; totalValue?: number; volWindow?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { tickers, totalValue, volWindow } = body
  if (!Array.isArray(tickers) || tickers.length === 0) {
    return NextResponse.json({ error: 'tickers must be a non-empty array' }, { status: 422 })
  }
  if (tickers.length > 50) {
    return NextResponse.json({ error: 'Maximum 50 tickers per request' }, { status: 422 })
  }

  const assets = tickers.map((ticker) => {
    const rows = loadStockHistory(ticker.toUpperCase())
    return { ticker: ticker.toUpperCase(), closes: closesFromRows(rows) }
  })

  // Tickers with insufficient data fall back to equal-weight
  const sufficient = assets.filter((a) => a.closes.length >= 20)
  const insufficient = assets.filter((a) => a.closes.length < 20).map((a) => a.ticker)

  const result = sufficient.length > 0
    ? riskParityWeights(sufficient, totalValue, volWindow)
    : { weights: equalWeights(tickers, totalValue), portfolioVol: 0, hhi: 1 / tickers.length }

  return NextResponse.json({
    ...result,
    insufficientData: insufficient,
    note: insufficient.length > 0
      ? `${insufficient.join(', ')} had <20 bars of history — excluded from vol calculation`
      : null,
  }, {
    headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
  })
}
