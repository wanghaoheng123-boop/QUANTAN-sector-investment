/**
 * Small OOS validation slice — 70% IS / 30% OOS label WR on unified SSOT (production path).
 * Output: workspace/optimization-runs/oos-validation.json
 */

process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { OhlcvRow } from '../lib/backtest/dataLoader'
import { runInstrumentLabelBenchmark } from '../lib/backtest/benchmarkLabel'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const dataDir = join(__dirname, 'backtestData')
const outDir = join(process.cwd(), 'workspace', 'optimization-runs')

function loadTickers(limit = 12): Array<{ ticker: string; sector: string; rows: OhlcvRow[] }> {
  if (!existsSync(dataDir)) {
    console.error('No backtestData')
    process.exit(1)
  }
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).slice(0, limit)
  return files.map((f) => {
    const raw = readFileSync(join(dataDir, f), 'utf-8')
    const data = JSON.parse(raw) as { sector?: string; candles?: OhlcvRow[] }
    const ticker = f.replace('.json', '').replace(/-/g, '.')
    const rows = (data.candles ?? []).filter((c) => Number.isFinite(c.close) && Number.isFinite(c.time))
    return { ticker, sector: data.sector ?? 'Unknown', rows }
  }).filter((d) => d.rows.length >= 400)
}

function sliceRows(rows: OhlcvRow[], start: number, end: number): OhlcvRow[] {
  return rows.slice(start, end)
}

function aggregateWr(stats: ReturnType<typeof runInstrumentLabelBenchmark>[]): number | null {
  let buys = 0
  let wins = 0
  for (const s of stats) {
    if (!s) continue
    buys += s.buySignals
    wins += s.wins
  }
  return buys > 0 ? wins / buys : null
}

const tickers = loadTickers(12)
const isStats: NonNullable<ReturnType<typeof runInstrumentLabelBenchmark>>[] = []
const oosStats: NonNullable<ReturnType<typeof runInstrumentLabelBenchmark>>[] = []

for (const { ticker, sector, rows } of tickers) {
  const split = Math.floor(rows.length * 0.7)
  const isRows = sliceRows(rows, 0, split)
  const oosRows = sliceRows(rows, split - 220, rows.length)
  const is = runInstrumentLabelBenchmark(ticker, sector, isRows, { productionPath: true })
  const oos = runInstrumentLabelBenchmark(ticker, sector, oosRows, { productionPath: true })
  if (is) isStats.push(is)
  if (oos) oosStats.push(oos)
}

const isWr = aggregateWr(isStats)
const oosWr = aggregateWr(oosStats)
const gapPp = isWr != null && oosWr != null ? (isWr - oosWr) * 100 : null

const payload = {
  timestamp: new Date().toISOString(),
  signalPath: 'resolveBacktestSignal (regime-only)',
  sampleSize: tickers.length,
  isWinRate: isWr != null ? Number((isWr * 100).toFixed(2)) : null,
  oosWinRate: oosWr != null ? Number((oosWr * 100).toFixed(2)) : null,
  isOosGapPp: gapPp != null ? Number(gapPp.toFixed(2)) : null,
  collapseOver10pp: gapPp != null ? gapPp > 10 : null,
  instruments: tickers.map((t) => t.ticker),
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'oos-validation.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))
console.log(JSON.stringify(payload, null, 2))
console.log(`Wrote ${outPath}`)
