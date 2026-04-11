/**
 * POST /api/optimize
 *
 * Run an inline SMA-crossover grid search for a given ticker.
 *
 * Body: { ticker: string, inSampleBars?: number, outOfSampleBars?: number }
 * Returns: { bestParams, bestInSampleSharpe, bestOosSharpe, degradation, totalCombinations, validCombinations, elapsedMs }
 *
 * Uses local warehouse / JSON data — no external API calls.
 * Capped at 500 bars max to keep response times acceptable.
 */

import { NextResponse } from 'next/server'
import { loadStockHistory, closesFromRows } from '@/lib/backtest/dataLoader'
import { gridSearch, smaCrossoverEvaluator, type ParamAxis } from '@/lib/optimize/gridSearch'

export const runtime = 'nodejs'

const FAST_PERIODS: ParamAxis = { name: 'fastPeriod', values: [5, 10, 15, 20] }
const SLOW_PERIODS: ParamAxis = { name: 'slowPeriod', values: [20, 30, 50, 100, 200] }

const MAX_BARS = 750  // cap data to keep response fast

export async function POST(req: Request): Promise<Response> {
  let body: { ticker?: string; inSampleBars?: number; outOfSampleBars?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const ticker = body.ticker?.toUpperCase()
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 422 })
  }

  const rows   = loadStockHistory(ticker)
  const closes = closesFromRows(rows).slice(-MAX_BARS)

  const isBars  = Math.min(body.inSampleBars  ?? 252, 500)
  const oosBars = Math.min(body.outOfSampleBars ?? 63, 126)

  if (closes.length < isBars + oosBars) {
    return NextResponse.json(
      { error: `Insufficient data for ${ticker}: ${closes.length} bars, need ${isBars + oosBars}` },
      { status: 422 }
    )
  }

  try {
    const report = gridSearch(closes, smaCrossoverEvaluator, {
      axes: [FAST_PERIODS, SLOW_PERIODS],
      objective: 'sharpe',
      inSampleBars: isBars,
      outOfSampleBars: oosBars,
      topK: 5,
    })

    const best = report.results[0]
    return NextResponse.json({
      ticker,
      bestParams:          best?.params              ?? null,
      bestInSampleSharpe:  best?.inSample.sharpe     ?? null,
      bestOosSharpe:       best?.outOfSample?.sharpe ?? null,
      degradation:         best?.sharpeDegradation   ?? null,
      totalCombinations:   report.totalCombinations,
      validCombinations:   report.validCombinations,
      elapsedMs:           report.elapsedMs,
      topResults:          report.results.slice(0, 3).map((r) => ({
        params:        r.params,
        isSharpe:      r.inSample.sharpe,
        oosSharpe:     r.outOfSample?.sharpe ?? null,
        degradation:   r.sharpeDegradation,
      })),
    })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Optimization failed' },
      { status: 500 }
    )
  }
}
