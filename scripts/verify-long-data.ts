/**
 * Phase 8 sanity check for long-history candles in SQLite warehouse.
 * Ensures OHLC constraints + major gap detection.
 */

import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join } from 'node:path'
import { listWarehouseTickers, readCandles } from '../lib/data/warehouse'

function resolveDbPath(): string {
  const env = process.env.QUANTAN_SQLITE_PATH?.trim()
  if (env) return env
  const arg = process.argv[2]?.trim()
  if (arg) return isAbsolute(arg) ? arg : join(process.cwd(), arg)
  return join(process.cwd(), 'quantan-warehouse.db')
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function main(): void {
  const db = new DatabaseSync(resolveDbPath(), { timeout: 120_000 })
  const tickers = listWarehouseTickers(db)
  if (!tickers.length) throw new Error('no candles in warehouse')
  let failed = 0
  for (const ticker of tickers) {
    const rows = readCandles(db, ticker)
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]
      const ohlcOk =
        Number.isFinite(r.open) &&
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close) &&
        r.high >= Math.max(r.open, r.close) &&
        r.low <= Math.min(r.open, r.close)
      if (!ohlcOk) {
        failed += 1
        console.error(`[verify:data:long] ${ticker} bad ohlc ${r.date}`)
      }
      if (i > 0) {
        const gap = daysBetween(rows[i - 1].date, r.date)
        if (gap > 8) {
          failed += 1
          console.error(`[verify:data:long] ${ticker} large gap ${rows[i - 1].date} -> ${r.date} (${gap}d)`)
        }
      }
    }
  }
  db.close()
  if (failed > 0) process.exit(1)
  console.log(`[verify:data:long] ok tickers=${tickers.length}`)
}

main()

