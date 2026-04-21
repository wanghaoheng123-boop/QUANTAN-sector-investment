/**
 * Backtest data loaders — reads from SQLite warehouse when `QUANTAN_SQLITE_PATH`
 * is set and the file exists; otherwise pre-fetched JSON under `scripts/backtestData/`.
 * No network — works in any environment (local, Vercel, sandbox).
 */

import { createRequire } from 'node:module'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import {
  listWarehouseTickers,
  readCandles,
  readMacroSeries,
  readRecessionDates,
  warehouseTickerKey,
  WAREHOUSE_ENV_PATH,
} from '@/lib/data/warehouse'
import type { WarehouseDb } from '@/lib/data/warehouse'

const nodeRequire = createRequire(join(process.cwd(), 'package.json'))

function openWarehouseDb(path: string): WarehouseDb | null {
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: new (p: string, o?: object) => WarehouseDb }
    return new DatabaseSync(path, { timeout: 60_000 })
  } catch {
    return null
  }
}
import type { OhlcBar } from '@/lib/quant/technicals'

export interface OhlcvRow extends OhlcBar {
  time: number // Unix seconds
  volume: number
}

export interface DataFile {
  ticker: string
  sector: string
  fetchedAt: string
  candles: OhlcvRow[]
}

// Path to the pre-fetched data directory (relative to project root)
function dataDir(): string {
  return join(process.cwd(), 'scripts', 'backtestData')
}

function warehousePath(): string | null {
  const p = process.env[WAREHOUSE_ENV_PATH]?.trim()
  return p && existsSync(p) ? p : null
}

function rowsFromWarehouse(ticker: string): OhlcvRow[] | null {
  const path = warehousePath()
  if (!path) return null
  const key = warehouseTickerKey(ticker)
  let db: WarehouseDb | null = null
  try {
    db = openWarehouseDb(path)
    if (!db) return null
    const rows = readCandles(db, key)
    if (rows.length === 0) return null
    const out: OhlcvRow[] = []
    for (const r of rows) {
      const time = Math.floor(new Date(`${r.date}T00:00:00.000Z`).getTime() / 1000)
      if (
        Number.isFinite(time) &&
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close)
      ) {
        out.push({
          time,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volume ?? 0,
        })
      }
    }
    return out.length ? out : null
  } catch {
    return null
  } finally {
    db?.close()
  }
}

/**
 * Read a pre-fetched JSON data file for a given ticker.
 * Returns null if file doesn't exist (ticker not pre-fetched yet).
 */
export function loadLocalData(ticker: string): DataFile | null {
  const safe = ticker.replace(/\./g, '-') // BRK.B → BRK-B
  const filePath = join(dataDir(), `${safe}.json`)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as DataFile
  } catch {
    return null
  }
}

/**
 * Load daily OHLCV history for a stock ticker from pre-fetched local JSON.
 * Returns empty array if data file not found.
 */
export function loadStockHistory(ticker: string): OhlcvRow[] {
  const fromWh = rowsFromWarehouse(ticker)
  if (fromWh) return fromWh
  const data = loadLocalData(ticker)
  if (!data) return []
  const out: OhlcvRow[] = []
  for (const c of data.candles) {
    if (
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    ) {
      out.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 })
    }
  }
  return out
}

export function loadLongHistory(ticker: string, years: number): OhlcvRow[] {
  const rows = loadStockHistory(ticker)
  if (years <= 0 || rows.length === 0) return rows
  const maxTime = rows[rows.length - 1]?.time ?? 0
  if (!Number.isFinite(maxTime) || maxTime <= 0) return rows
  const cutoff = maxTime - Math.floor(years * 365.25 * 24 * 60 * 60)
  return rows.filter((r) => r.time >= cutoff)
}

export function loadMacroSeries(seriesId: string): { date: string; value: number }[] {
  const path = warehousePath()
  if (!path) return []
  let db: WarehouseDb | null = null
  try {
    db = openWarehouseDb(path)
    if (!db) return []
    return readMacroSeries(db, seriesId.trim().toUpperCase())
  } catch {
    return []
  } finally {
    db?.close()
  }
}

export function loadRecessionDates(): { startDate: string; endDate: string }[] {
  const path = warehousePath()
  if (!path) return []
  let db: WarehouseDb | null = null
  try {
    db = openWarehouseDb(path)
    if (!db) return []
    return readRecessionDates(db)
  } catch {
    return []
  } finally {
    db?.close()
  }
}

/**
 * Load daily BTC/USD OHLCV from pre-fetched local JSON.
 * Returns empty array if data file not found.
 */
export function loadBtcHistory(): OhlcvRow[] {
  const fromWh = rowsFromWarehouse('BTC')
  if (fromWh) return fromWh
  const data = loadLocalData('BTC')
  if (!data) return []
  const out: OhlcvRow[] = []
  for (const c of data.candles) {
    if (
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    ) {
      out.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 })
    }
  }
  return out
}

/**
 * Get the list of all tickers that have pre-fetched data.
 */
export function availableTickers(): string[] {
  const slugToDisplay = (slug: string) => slug.replace(/-/g, '.')
  const path = warehousePath()
  if (path) {
    let db: WarehouseDb | null = null
    try {
      db = openWarehouseDb(path)
      if (!db) return fromJsonOnly()
      const wh = listWarehouseTickers(db).map(slugToDisplay)
      const dir = dataDir()
      const json =
        existsSync(dir) ?
          readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace(/\.json$/, '').replace(/-/g, '.'))
        : []
      return [...new Set([...wh, ...json])].sort()
    } catch {
      return fromJsonOnly()
    } finally {
      db?.close()
    }
  }
  return fromJsonOnly()
}

function fromJsonOnly(): string[] {
  const dir = dataDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, '').replace(/-/g, '.')) // BRK-B → BRK.B
}

/** Convert OhlcvRow[] to close price array. */
export function closesFromRows(rows: OhlcvRow[]): number[] {
  return rows.map((r) => r.close)
}

/** Convert OhlcvRow[] to OhlcBar[] (strip time/volume). */
export function barsFromRows(rows: OhlcvRow[]): OhlcBar[] {
  return rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
}
