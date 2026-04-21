import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { backtestInstrument, aggregatePortfolio } from '@/lib/backtest/engine'
import { loadLongHistory } from '@/lib/backtest/dataLoader'
import { SECTORS } from '@/lib/sectors'
import { DEFAULT_CONFIG } from '@/lib/backtest/signals'

type WindowYears = 10 | 15 | 20 | 30

const WINDOWS: WindowYears[] = [10, 15, 20, 30]
const CORE_UNIVERSE = Array.from(new Set([
  ...SECTORS.slice(0, 6).flatMap((s) => s.topHoldings.slice(0, 2)),
  'SPY',
  'QQQ',
  'GLD',
  'BTC',
]))

interface WindowResult {
  years: WindowYears
  instruments: number
  totalReturn: number
  annualizedReturn: number
  winRate: number
  maxDrawdown: number
  sharpeRatio: number | null
  sortinoRatio: number | null
}

function runWindow(years: WindowYears): WindowResult {
  const results = CORE_UNIVERSE
    .map((ticker) => {
      const rows = loadLongHistory(ticker, years)
      if (rows.length < 280) return null
      return backtestInstrument(ticker, 'matrix', rows, DEFAULT_CONFIG)
    })
    .filter((v): v is NonNullable<typeof v> => v != null)

  const portfolio = aggregatePortfolio(results, DEFAULT_CONFIG.initialCapital)
  return {
    years,
    instruments: results.length,
    totalReturn: portfolio.totalReturn,
    annualizedReturn: portfolio.annualizedReturn,
    winRate: portfolio.winRate,
    maxDrawdown: portfolio.maxDrawdown,
    sharpeRatio: portfolio.sharpeRatio,
    sortinoRatio: portfolio.sortinoRatio,
  }
}

function main() {
  const matrix = WINDOWS.map(runWindow)
  const outDir = join(process.cwd(), 'artifacts')
  mkdirSync(outDir, { recursive: true })
  const payload = {
    generatedAt: new Date().toISOString(),
    universe: CORE_UNIVERSE,
    windows: matrix,
  }
  const outPath = join(outDir, 'backtest-matrix.json')
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`[backtest:matrix] wrote ${outPath}`)
}

main()
