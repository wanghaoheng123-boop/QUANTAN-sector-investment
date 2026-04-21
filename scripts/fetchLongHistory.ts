/**
 * Phase 8 bootstrap: fetch long OHLCV history from Stooq into SQLite warehouse.
 * Usage: npm run fetch:history
 */

import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join } from 'node:path'
import { SECTORS } from '../lib/sectors'
import { StooqProvider } from '../lib/data/providers/stooq'
import { initWarehouseSchema, warehouseTickerKey } from '../lib/data/warehouse'

const provider = new StooqProvider()
const years = 30
const startDate = new Date()
startDate.setUTCDate(startDate.getUTCDate() - Math.floor(years * 365.25))

function resolveDbPath(): string {
  const env = process.env.QUANTAN_SQLITE_PATH?.trim()
  if (env) return env
  const arg = process.argv[2]?.trim()
  if (arg) return isAbsolute(arg) ? arg : join(process.cwd(), arg)
  return join(process.cwd(), 'quantan-warehouse.db')
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath()
  const db = new DatabaseSync(dbPath, { timeout: 120_000 })
  initWarehouseSchema(db)

  const tickers = [...new Set([...SECTORS.flatMap((s) => s.topHoldings.map((t) => t.toUpperCase())), 'BTC'])]
  let inserted = 0
  for (const ticker of tickers) {
    const rows = await provider.fetchDaily(ticker, { period1: startDate, interval: '1d' })
    if (!rows?.length) {
      console.warn(`[fetch:history] skip ${ticker}: no rows`)
      continue
    }
    const key = warehouseTickerKey(ticker)
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO candles (ticker, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    db.exec('BEGIN IMMEDIATE')
    for (const r of rows) {
      const date = new Date(r.time * 1000).toISOString().slice(0, 10)
      stmt.run(key, date, r.open, r.high, r.low, r.close, Math.round(r.volume ?? 0))
      inserted += 1
    }
    db.exec('COMMIT')
    console.log(`[fetch:history] ${ticker} rows=${rows.length}`)
  }
  db.close()
  console.log(`[fetch:history] done tickers=${tickers.length} inserted=${inserted} db=${dbPath}`)
}

main().catch((err) => {
  console.error('[fetch:history] failed', err)
  process.exit(1)
})

