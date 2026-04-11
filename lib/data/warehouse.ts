/**
 * SQLite data warehouse for QUANTAN.
 *
 * Stores pre-fetched OHLCV candles locally to reduce Yahoo Finance API calls
 * during backtesting. Falls back gracefully when SQLite is unavailable
 * (e.g. Vercel serverless — use JSON files there instead).
 *
 * Schema:
 *   candles(ticker TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)
 *   quotes(ticker TEXT, price REAL, change REAL, change_pct REAL, updated_at TEXT)
 *   meta(key TEXT PRIMARY KEY, value TEXT)
 */

import { join } from 'path'
import type { DailyBar, QuoteSnapshot } from './providers/types'

// Dynamic import to avoid crashing in environments where better-sqlite3 is unavailable
let Database: typeof import('better-sqlite3') | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Database = require('better-sqlite3')
} catch {
  // Not available in this environment (Vercel edge, etc.)
}

type Db = InstanceType<typeof import('better-sqlite3')>

const DB_PATH = join(process.cwd(), 'scripts', 'quantan.db')

let _db: Db | null = null

function getDb(): Db | null {
  if (!Database) return null
  if (_db) return _db
  try {
    _db = new (Database as unknown as new (path: string) => Db)(DB_PATH)
    createSchema(_db)
    return _db
  } catch {
    return null
  }
}

function createSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      ticker  TEXT NOT NULL,
      date    TEXT NOT NULL,
      open    REAL NOT NULL,
      high    REAL NOT NULL,
      low     REAL NOT NULL,
      close   REAL NOT NULL,
      volume  REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (ticker, date)
    );

    CREATE TABLE IF NOT EXISTS quotes (
      ticker      TEXT PRIMARY KEY,
      price       REAL NOT NULL,
      change_val  REAL NOT NULL DEFAULT 0,
      change_pct  REAL NOT NULL DEFAULT 0,
      volume      REAL,
      market_cap  REAL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_candles_ticker_date ON candles(ticker, date);
  `)
}

// ─── Read Operations ─────────────────────────────────────────────────────────

/**
 * Returns true when SQLite is available and the DB file can be opened.
 */
export function isWarehouseAvailable(): boolean {
  return getDb() !== null
}

/**
 * Fetches all daily bars for `ticker` from the SQLite warehouse.
 * Returns null if warehouse is unavailable or ticker not found.
 */
export function getCandles(ticker: string): DailyBar[] | null {
  const db = getDb()
  if (!db) return null
  try {
    const rows = db.prepare(
      'SELECT date, open, high, low, close, volume FROM candles WHERE ticker = ? ORDER BY date ASC'
    ).all(ticker) as DailyBar[]
    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

/**
 * Fetches the most recent stored quote for `ticker`.
 * Returns null if not found.
 */
export function getCachedQuote(ticker: string): QuoteSnapshot | null {
  const db = getDb()
  if (!db) return null
  try {
    const row = db.prepare(
      'SELECT ticker, price, change_val, change_pct, volume, market_cap, updated_at FROM quotes WHERE ticker = ?'
    ).get(ticker) as (Omit<QuoteSnapshot, 'change' | 'changePct' | 'updatedAt'> & { change_val: number; change_pct: number; market_cap?: number; updated_at: string }) | undefined
    if (!row) return null
    return {
      ticker: row.ticker,
      price: row.price,
      change: row.change_val,
      changePct: row.change_pct,
      volume: row.volume,
      marketCap: row.market_cap,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

/**
 * Returns the list of tickers that have candle data in the warehouse.
 */
export function warehouseTickers(): string[] {
  const db = getDb()
  if (!db) return []
  try {
    const rows = db.prepare('SELECT DISTINCT ticker FROM candles ORDER BY ticker').all() as Array<{ ticker: string }>
    return rows.map((r) => r.ticker)
  } catch {
    return []
  }
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Bulk-inserts or replaces daily bars for `ticker`.
 * Wrapped in a transaction for performance.
 */
export function upsertCandles(ticker: string, bars: DailyBar[]): void {
  const db = getDb()
  if (!db || bars.length === 0) return
  const insert = db.prepare(`
    INSERT OR REPLACE INTO candles (ticker, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const insertMany = db.transaction((rows: DailyBar[]) => {
    for (const row of rows) {
      insert.run(ticker, row.date, row.open, row.high, row.low, row.close, row.volume)
    }
  })
  insertMany(bars)
}

/**
 * Stores/updates the latest quote for `ticker`.
 */
export function upsertQuote(quote: QuoteSnapshot): void {
  const db = getDb()
  if (!db) return
  db.prepare(`
    INSERT OR REPLACE INTO quotes (ticker, price, change_val, change_pct, volume, market_cap, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    quote.ticker, quote.price, quote.change, quote.changePct,
    quote.volume ?? null, quote.marketCap ?? null, quote.updatedAt
  )
}

/**
 * Reads a metadata value.
 */
export function getMeta(key: string): string | null {
  const db = getDb()
  if (!db) return null
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/**
 * Writes a metadata value.
 */
export function setMeta(key: string, value: string): void {
  const db = getDb()
  if (!db) return
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
}
