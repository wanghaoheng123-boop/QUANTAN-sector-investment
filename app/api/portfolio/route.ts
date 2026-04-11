/**
 * GET  /api/portfolio         — compute summary from posted positions + prices
 * POST /api/portfolio         — compute summary + risk metrics for a portfolio
 *
 * The portfolio state is not persisted server-side; the client owns the state
 * (localStorage) and sends it here for server-side analytics computation.
 *
 * POST body: { portfolio: Portfolio }
 * Returns: PortfolioSummary + diversification metrics
 */

import { NextResponse } from 'next/server'
import {
  portfolioSummary,
  type Portfolio,
} from '@/lib/portfolio/tracker'
import { diversificationReport, diversificationGrade, type AssetCloses } from '@/lib/portfolio/diversification'
import { loadStockHistory, closesFromRows } from '@/lib/backtest/dataLoader'

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  let body: { portfolio?: Portfolio }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const portfolio = body.portfolio
  if (!portfolio || typeof portfolio !== 'object') {
    return NextResponse.json({ error: 'Missing portfolio in request body' }, { status: 422 })
  }

  const summary = portfolioSummary(portfolio)

  // Build diversification data from local warehouse / JSON files
  const tickers = Object.keys(portfolio.positions)
  const assets: AssetCloses[] = tickers
    .map((ticker) => {
      const rows = loadStockHistory(ticker)
      return { ticker, closes: closesFromRows(rows) }
    })
    .filter((a) => a.closes.length >= 20)

  const weights = tickers.map((t) => {
    const pos = portfolio.positions[t]
    if (!pos) return 0
    const mv = pos.quantity * pos.lastPrice
    return summary.totalValue > 0 ? mv / summary.totalValue : 0
  }).filter((_, i) => assets.find((a) => a.ticker === tickers[i]))

  const divReport = assets.length >= 2
    ? diversificationReport(assets, weights)
    : null

  return NextResponse.json({
    summary,
    diversification: divReport
      ? {
          hhi: divReport.hhi,
          effectiveN: divReport.effectiveN,
          avgPairwiseCorr: divReport.avgPairwiseCorr,
          portfolioVol: divReport.portfolioVol,
          diversificationRatio: divReport.diversificationRatio,
          grade: diversificationGrade(divReport),
          correlationMatrix: {
            tickers: divReport.correlationMatrix.tickers,
            matrix: divReport.correlationMatrix.matrix,
          },
        }
      : null,
  })
}
