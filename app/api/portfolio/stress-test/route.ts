/**
 * POST /api/portfolio/stress-test
 *
 * Run historical stress scenarios against a set of positions.
 *
 * Body:
 *   {
 *     positions: Array<{ ticker: string; marketValue: number; assetClass?: AssetClass }>,
 *     totalValue: number,
 *     scenarios?: string[]   // optional filter — names of scenarios to run
 *   }
 *
 * Returns: StressTestReport
 */

import { NextResponse } from 'next/server'
import {
  runStressTests,
  classifyTicker,
  SCENARIOS,
  type StressPosition,
  type AssetClass,
} from '@/lib/portfolio/stressTest'

export const runtime = 'nodejs'

interface BodyPosition {
  ticker: string
  marketValue: number
  assetClass?: AssetClass
}

export async function POST(req: Request): Promise<Response> {
  let body: { positions?: BodyPosition[]; totalValue?: number; scenarios?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { positions, totalValue, scenarios: scenarioFilter } = body

  if (!Array.isArray(positions) || positions.length === 0) {
    return NextResponse.json({ error: 'positions must be a non-empty array' }, { status: 422 })
  }
  if (typeof totalValue !== 'number' || totalValue <= 0) {
    return NextResponse.json({ error: 'totalValue must be a positive number' }, { status: 422 })
  }

  const stressPositions: StressPosition[] = positions.map((p) => ({
    ticker: p.ticker,
    marketValue: p.marketValue,
    assetClass: p.assetClass ?? classifyTicker(p.ticker),
  }))

  const filteredScenarios = scenarioFilter && scenarioFilter.length > 0
    ? SCENARIOS.filter((s) => scenarioFilter.includes(s.name))
    : SCENARIOS

  if (filteredScenarios.length === 0) {
    return NextResponse.json(
      { error: 'No matching scenarios. Valid names: ' + SCENARIOS.map((s) => s.name).join(', ') },
      { status: 422 }
    )
  }

  const report = runStressTests(stressPositions, totalValue, filteredScenarios)

  return NextResponse.json(report, {
    headers: { 'Cache-Control': 'no-store' },  // stress results depend on live positions
  })
}

/** GET /api/portfolio/stress-test — list available scenarios */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    scenarios: SCENARIOS.map(({ name, periodStart, periodEnd, duration, description }) => ({
      name, periodStart, periodEnd, duration, description,
    })),
  }, {
    headers: { 'Cache-Control': 's-maxage=86400' },
  })
}
