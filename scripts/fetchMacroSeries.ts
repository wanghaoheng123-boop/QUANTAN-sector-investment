/**
 * Phase 8 bootstrap: fetch macro + recession dates into SQLite warehouse.
 * Usage: npm run fetch:macro
 */

import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join } from 'node:path'
import { fetchFredObservations } from '../lib/data/providers/fred'
import { fetchRecessionRanges } from '../lib/data/providers/nber'
import { fetchVixHistory } from '../lib/data/providers/cboe'
import { initWarehouseSchema } from '../lib/data/warehouse'

const CORE_FRED_SERIES = ['T10Y2Y', 'T10Y3M', 'BAMLH0A0HYM2', 'BAMLC0A0CM', 'UNRATE', 'ICSA', 'MANEMP', 'M2SL', 'FEDFUNDS']

function resolveDbPath(): string {
  const env = process.env.QUANTAN_SQLITE_PATH?.trim()
  if (env) return env
  const arg = process.argv[2]?.trim()
  if (arg) return isAbsolute(arg) ? arg : join(process.cwd(), arg)
  return join(process.cwd(), 'quantan-warehouse.db')
}

async function storeFredSeries(db: DatabaseSync): Promise<void> {
  const insert = db.prepare(`INSERT OR REPLACE INTO macro_series (series_id, date, value) VALUES (?, ?, ?)`)
  for (const seriesId of CORE_FRED_SERIES) {
    const rows = await fetchFredObservations(seriesId)
    if (!rows?.length) {
      console.warn(`[fetch:macro] skip ${seriesId}: no rows (or missing FRED_API_KEY)`)
      continue
    }
    db.exec('BEGIN IMMEDIATE')
    for (const r of rows) {
      insert.run(seriesId, r.date, r.value)
    }
    db.exec('COMMIT')
    console.log(`[fetch:macro] ${seriesId} rows=${rows.length}`)
  }
}

async function storeRecessions(db: DatabaseSync): Promise<void> {
  const ranges = await fetchRecessionRanges()
  if (!ranges?.length) {
    console.warn('[fetch:macro] no recession ranges')
    return
  }
  db.exec('DELETE FROM recession_dates')
  const insert = db.prepare(`INSERT OR REPLACE INTO recession_dates (start_date, end_date) VALUES (?, ?)`)
  for (const r of ranges) insert.run(r.startDate, r.endDate)
  console.log(`[fetch:macro] recession_ranges=${ranges.length}`)
}

async function storeVixHistory(db: DatabaseSync): Promise<void> {
  const rows = await fetchVixHistory()
  if (!rows?.length) {
    console.warn('[fetch:macro] no vix rows')
    return
  }
  const insert = db.prepare(
    `INSERT OR REPLACE INTO vix_history (date, open, high, low, close) VALUES (?, ?, ?, ?, ?)`
  )
  db.exec('BEGIN IMMEDIATE')
  for (const r of rows) {
    insert.run(r.date, r.open, r.high, r.low, r.close)
  }
  db.exec('COMMIT')
  console.log(`[fetch:macro] vix_rows=${rows.length}`)
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath()
  const db = new DatabaseSync(dbPath, { timeout: 120_000 })
  initWarehouseSchema(db)
  await storeFredSeries(db)
  await storeRecessions(db)
  await storeVixHistory(db)
  db.close()
  console.log(`[fetch:macro] done db=${dbPath}`)
}

main().catch((err) => {
  console.error('[fetch:macro] failed', err)
  process.exit(1)
})

