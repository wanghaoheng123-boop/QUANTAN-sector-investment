#!/usr/bin/env npx ts-node
/**
 * One-time migration: reads all JSON files in scripts/backtestData/
 * and inserts them into the SQLite warehouse at scripts/quantan.db.
 *
 * Usage:
 *   npx ts-node scripts/migrate-json-to-sqlite.ts
 *   # or
 *   npm run migrate:sqlite
 *
 * Safe to re-run (uses INSERT OR REPLACE).
 */

import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { upsertCandles, setMeta, isWarehouseAvailable } from '../lib/data/warehouse'
import type { DataFile } from '../lib/backtest/dataLoader'
import type { DailyBar } from '../lib/data/providers/types'

const DATA_DIR = join(process.cwd(), 'scripts', 'backtestData')

function main() {
  if (!isWarehouseAvailable()) {
    console.error('SQLite warehouse not available. Install better-sqlite3: npm install better-sqlite3 @types/better-sqlite3')
    process.exit(1)
  }

  if (!existsSync(DATA_DIR)) {
    console.error(`Data directory not found: ${DATA_DIR}`)
    console.error('Run: node scripts/fetchBacktestData.mjs  first.')
    process.exit(1)
  }

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
  if (files.length === 0) {
    console.log('No JSON files found in', DATA_DIR)
    process.exit(0)
  }

  let totalBars = 0
  let totalTickers = 0

  for (const file of files) {
    const ticker = file.replace(/\.json$/, '').replace(/-/g, '.')  // BRK-B.json → BRK.B
    const filePath = join(DATA_DIR, file)

    try {
      const raw = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(raw) as DataFile

      if (!data.candles?.length) {
        console.log(`  SKIP ${ticker} — no candles`)
        continue
      }

      // Convert OhlcvRow[] (time in Unix seconds) → DailyBar[] (date as ISO string)
      const bars: DailyBar[] = data.candles
        .filter((c) =>
          Number.isFinite(c.time) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close)
        )
        .map((c) => ({
          date: new Date(c.time * 1000).toISOString().slice(0, 10),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }))

      upsertCandles(ticker, bars)
      console.log(`  OK   ${ticker.padEnd(8)} — ${bars.length} bars  (fetched: ${data.fetchedAt ?? 'unknown'})`)
      totalBars += bars.length
      totalTickers++
    } catch (e) {
      console.error(`  FAIL ${ticker}: ${e}`)
    }
  }

  setMeta('migrated_at', new Date().toISOString())
  setMeta('source', 'migrate-json-to-sqlite')

  console.log(`\nMigration complete: ${totalTickers} tickers, ${totalBars.toLocaleString()} bars → scripts/quantan.db`)
}

main()
