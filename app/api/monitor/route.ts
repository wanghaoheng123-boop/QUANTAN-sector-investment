/**
 * GET /api/monitor
 *
 * System health + performance monitoring endpoint.
 *
 * Returns:
 *   - Data infrastructure status (SQLite warehouse, JSON fallback)
 *   - ML sidecar health (FastAPI on port 8001)
 *   - Available tickers count
 *   - Latest nightly backtest results (if available)
 *   - Environment variables presence (no values exposed)
 */

import { NextResponse } from 'next/server'
import { isWarehouseAvailable, warehouseTickers } from '@/lib/data/warehouse'
import { availableTickers } from '@/lib/backtest/dataLoader'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

export const runtime = 'nodejs'

async function checkMlSidecar(): Promise<{ available: boolean; latency?: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch('http://localhost:8001/health', { signal: controller.signal })
    clearTimeout(timeout)
    return { available: res.ok, latency: Date.now() - start }
  } catch {
    return { available: false }
  }
}

function latestNightlyReport(): Record<string, unknown> | null {
  const resultsDir = join(process.cwd(), 'results')
  if (!existsSync(resultsDir)) return null
  const files = readdirSync(resultsDir)
    .filter((f) => f.startsWith('nightly-') && f.endsWith('.json'))
    .sort()
    .reverse()
  if (files.length === 0) return null
  try {
    const raw = readFileSync(join(resultsDir, files[0]), 'utf-8')
    const report = JSON.parse(raw)
    // Return only the summary to keep the response lean
    return {
      runDate: report.runDate,
      totalTickers: report.tickers?.length ?? 0,
      summary: report.summary,
    }
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  const [mlHealth] = await Promise.all([checkMlSidecar()])

  const warehouseAvailable = isWarehouseAvailable()
  const warehouseTickerList = warehouseAvailable ? warehouseTickers() : []
  const allTickers = availableTickers()

  const envFlags = {
    POLYGON_API_KEY:     !!process.env.POLYGON_API_KEY,
    ALPHAVANTAGE_API_KEY: !!process.env.ALPHAVANTAGE_API_KEY,
    FRED_API_KEY:        !!process.env.FRED_API_KEY,
    NEXTAUTH_SECRET:     !!process.env.NEXTAUTH_SECRET,
    NODE_ENV:            process.env.NODE_ENV ?? 'unknown',
  }

  const nightly = latestNightlyReport()

  const health = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    dataInfrastructure: {
      sqlite: {
        available: warehouseAvailable,
        tickerCount: warehouseTickerList.length,
      },
      jsonFallback: {
        tickerCount: allTickers.length,
      },
      totalTickersAvailable: allTickers.length,
    },
    mlSidecar: mlHealth,
    nightlyBacktest: nightly ?? { available: false, message: 'No nightly reports found in results/' },
    environment: envFlags,
  }

  return NextResponse.json(health, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
