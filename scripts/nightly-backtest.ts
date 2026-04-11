#!/usr/bin/env tsx
/**
 * Nightly backtest runner — automated strategy performance tracking.
 *
 * Usage:
 *   npx tsx scripts/nightly-backtest.ts [--tickers AAPL,MSFT,SPY] [--output results/]
 *
 * What it does:
 *   1. Loads available price data from the SQLite warehouse (or JSON fallback).
 *   2. For each ticker, runs the grid-search optimizer to find the best
 *      SMA-crossover parameters on the trailing IS window.
 *   3. Evaluates those parameters on the most recent OOS window.
 *   4. Writes a JSON report to `results/nightly-YYYY-MM-DD.json`.
 *   5. Appends a one-line summary to `results/performance-log.jsonl`.
 *   6. Prints a Markdown table summary to stdout (for CI log readability).
 *
 * Designed to run in GitHub Actions (see .github/workflows/nightly-backtest.yml).
 * All I/O is to local disk; no external API calls during CI.
 */

import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'fs'
import { join } from 'path'
import { loadStockHistory, closesFromRows, availableTickers } from '../lib/backtest/dataLoader'
import {
  gridSearch,
  smaCrossoverEvaluator,
  type GridSearchReport,
  type ParamAxis,
} from '../lib/optimize/gridSearch'

// ────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────

const DEFAULT_TICKERS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'AMZN', 'JPM', 'XOM']
const IS_BARS  = 252  // 1 year in-sample
const OOS_BARS = 63   // 3 months out-of-sample
const TOP_K    = 5

const FAST_PERIODS: ParamAxis = { name: 'fastPeriod', values: [5, 10, 15, 20] }
const SLOW_PERIODS: ParamAxis = { name: 'slowPeriod', values: [20, 30, 50, 100, 200] }

// ────────────────────────────────────────────────────────────────
// CLI arg parsing
// ────────────────────────────────────────────────────────────────

function parseArgs(): { tickers: string[]; outputDir: string } {
  const args = process.argv.slice(2)
  let tickers = DEFAULT_TICKERS
  let outputDir = 'results'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tickers' && args[i + 1]) {
      tickers = args[++i].split(',').map((t) => t.trim().toUpperCase())
    }
    if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i]
    }
  }

  return { tickers, outputDir }
}

// ────────────────────────────────────────────────────────────────
// Result types
// ────────────────────────────────────────────────────────────────

interface TickerResult {
  ticker: string
  dataPoints: number
  hasEnoughData: boolean
  report: GridSearchReport | null
  error: string | null
}

interface NightlyReport {
  runDate: string
  runTimestamp: string
  tickers: string[]
  results: TickerResult[]
  summary: {
    total: number
    withEnoughData: number
    avgIsSharpe: number
    avgOosSharpe: number
    avgDegradation: number
    bestTicker: string | null
    bestParams: Record<string, number | string | boolean> | null
    bestOosSharpe: number | null
  }
}

// ────────────────────────────────────────────────────────────────
// Markdown formatting
// ────────────────────────────────────────────────────────────────

function markdownTable(results: TickerResult[]): string {
  const header = '| Ticker | Bars | IS Sharpe | OOS Sharpe | Degradation | Fast | Slow |'
  const sep    = '|--------|------|-----------|------------|-------------|------|------|'
  const rows = results.map((r) => {
    if (!r.hasEnoughData || !r.report) {
      return `| ${r.ticker} | ${r.dataPoints} | — | — | — | — | — |`
    }
    const best = r.report.results[0]
    if (!best) return `| ${r.ticker} | ${r.dataPoints} | — | — | — | — | — |`
    const isSharpe  = best.inSample.sharpe.toFixed(2)
    const oosSharpe = best.outOfSample?.sharpe.toFixed(2) ?? '—'
    const deg       = best.sharpeDegradation != null ? best.sharpeDegradation.toFixed(2) : '—'
    const fast = best.params['fastPeriod'] ?? '—'
    const slow = best.params['slowPeriod'] ?? '—'
    return `| ${r.ticker} | ${r.dataPoints} | ${isSharpe} | ${oosSharpe} | ${deg} | ${fast} | ${slow} |`
  })
  return [header, sep, ...rows].join('\n')
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

async function main() {
  const { tickers: requestedTickers, outputDir } = parseArgs()

  // Expand to all available tickers if requested
  const available = new Set(availableTickers().map((t) => t.toUpperCase()))
  const tickers = requestedTickers.filter((t) => {
    if (!available.has(t)) {
      console.warn(`⚠  ${t}: no local data — skipping`)
      return false
    }
    return true
  })

  if (tickers.length === 0) {
    const avail = availableTickers()
    if (avail.length === 0) {
      console.error('❌  No price data available. Run scripts/fetchBacktestData.mjs first.')
      process.exit(1)
    }
    tickers.push(...avail.map((t) => t.toUpperCase()).slice(0, 20))
  }

  console.log(`\n🌙 QUANTAN Nightly Backtest — ${new Date().toISOString()}`)
  console.log(`   Running on: ${tickers.join(', ')}\n`)

  mkdirSync(outputDir, { recursive: true })

  const results: TickerResult[] = []

  for (const ticker of tickers) {
    process.stdout.write(`   ${ticker.padEnd(6)} … `)
    try {
      const rows   = loadStockHistory(ticker)
      const closes = closesFromRows(rows)

      if (closes.length < IS_BARS + OOS_BARS) {
        console.log(`⚠  insufficient data (${closes.length} bars, need ${IS_BARS + OOS_BARS})`)
        results.push({ ticker, dataPoints: closes.length, hasEnoughData: false, report: null, error: null })
        continue
      }

      const report = gridSearch(closes, smaCrossoverEvaluator, {
        axes: [FAST_PERIODS, SLOW_PERIODS],
        objective: 'sharpe',
        inSampleBars: IS_BARS,
        outOfSampleBars: OOS_BARS,
        topK: TOP_K,
      })

      const best = report.results[0]
      const isSharpe  = best?.inSample.sharpe.toFixed(2) ?? 'n/a'
      const oosSharpe = best?.outOfSample?.sharpe.toFixed(2) ?? 'n/a'
      console.log(`✓  IS=${isSharpe}, OOS=${oosSharpe} | ${report.elapsedMs}ms`)
      results.push({ ticker, dataPoints: closes.length, hasEnoughData: true, report, error: null })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`✗  ${msg}`)
      results.push({ ticker, dataPoints: 0, hasEnoughData: false, report: null, error: msg })
    }
  }

  // ── Build summary ──────────────────────────────────────────────
  const valid = results.filter((r) => r.report && r.report.results.length > 0)
  const isSharpesArr  = valid.map((r) => r.report!.results[0].inSample.sharpe)
  const oosSharpesArr = valid.map((r) => r.report!.results[0].outOfSample?.sharpe ?? 0)
  const degsArr       = valid.map((r) => r.report!.results[0].sharpeDegradation ?? 0)

  const avgIsSharpe  = isSharpesArr.length  ? isSharpesArr.reduce((a, b) => a + b, 0)  / isSharpesArr.length  : 0
  const avgOosSharpe = oosSharpesArr.length ? oosSharpesArr.reduce((a, b) => a + b, 0) / oosSharpesArr.length : 0
  const avgDeg       = degsArr.length       ? degsArr.reduce((a, b) => a + b, 0)       / degsArr.length       : 0

  let bestTicker:  string | null = null
  let bestParams:  Record<string, number | string | boolean> | null = null
  let bestOosSharpe: number | null = null

  for (const r of valid) {
    const oos = r.report!.results[0].outOfSample?.sharpe ?? -Infinity
    if (bestOosSharpe === null || oos > bestOosSharpe) {
      bestOosSharpe = oos
      bestTicker    = r.ticker
      bestParams    = r.report!.results[0].params
    }
  }

  const summary = {
    total:          results.length,
    withEnoughData: valid.length,
    avgIsSharpe,
    avgOosSharpe,
    avgDegradation: avgDeg,
    bestTicker,
    bestParams,
    bestOosSharpe,
  }

  // ── Write JSON report ─────────────────────────────────────────
  const runDate = new Date().toISOString().slice(0, 10)
  const reportPath = join(outputDir, `nightly-${runDate}.json`)
  const nightlyReport: NightlyReport = {
    runDate,
    runTimestamp: new Date().toISOString(),
    tickers,
    results,
    summary,
  }
  writeFileSync(reportPath, JSON.stringify(nightlyReport, null, 2))

  // ── Append to performance log ─────────────────────────────────
  const logPath = join(outputDir, 'performance-log.jsonl')
  appendFileSync(logPath, JSON.stringify({
    date: runDate,
    avgOosSharpe: avgOosSharpe.toFixed(3),
    avgDegradation: avgDeg.toFixed(3),
    bestTicker,
    bestOosSharpe: bestOosSharpe?.toFixed(3) ?? null,
  }) + '\n')

  // ── Print Markdown table ──────────────────────────────────────
  console.log('\n## Results\n')
  console.log(markdownTable(results))
  console.log(`\n**Avg IS Sharpe:** ${avgIsSharpe.toFixed(2)}`)
  console.log(`**Avg OOS Sharpe:** ${avgOosSharpe.toFixed(2)}`)
  console.log(`**Avg Sharpe Degradation:** ${avgDeg.toFixed(2)}`)
  if (bestTicker) {
    console.log(`**Best OOS ticker:** ${bestTicker} (Sharpe ${bestOosSharpe?.toFixed(2)})`)
    console.log(`**Best params:** fast=${bestParams?.['fastPeriod']}, slow=${bestParams?.['slowPeriod']}`)
  }
  console.log(`\n📄 Report written to ${reportPath}`)
  console.log(`📊 Performance log appended to ${logPath}\n`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
