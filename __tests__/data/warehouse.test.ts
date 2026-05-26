import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  isWarehouseAvailable,
  getCandles,
  getCachedQuote,
  warehouseTickers,
  upsertCandles,
  upsertQuote,
  getMeta,
  setMeta,
} from '@/lib/data/warehouse'

/**
 * Integration tests for lib/data/warehouse.ts
 *
 * Closes F8.1 (sub-task: warehouse). These tests exercise the REAL
 * better-sqlite3 binding and the real SQL paths — mocking the native
 * binding via vi.mock() does not work because warehouse.ts uses a
 * synchronous CommonJS require() that vitest's ESM mock layer does not
 * intercept (verified empirically).
 *
 * Strategy:
 *   - Use unique tickers prefixed with `__WHTEST_` so we cannot collide
 *     with any real production data in the SQLite warehouse.
 *   - Clean up via afterAll so the test does not leave residue.
 *   - Skip the entire suite when better-sqlite3 is not available (e.g.
 *     Vercel edge / sandbox CI without the native binding compiled).
 *
 * Tests pin down:
 *   - Schema is created on first open (CREATE IF NOT EXISTS is idempotent)
 *   - Upsert + read round-trip for candles, quotes, meta
 *   - getCandles returns null (NOT []) on empty result, per the contract
 *   - getCandles is ORDER BY date ASC
 *   - INSERT OR REPLACE semantics — second upsert overwrites the first
 *   - upsertQuote correctly maps undefined → null for volume / marketCap
 *   - getCachedQuote maps snake_case columns → camelCase fields
 *   - warehouseTickers DISTINCTs and SORTs
 */

const skip = !isWarehouseAvailable()
const describeIfDb = skip ? describe.skip : describe

const T1 = '__WHTEST_AAA'
const T2 = '__WHTEST_BBB'
const T3 = '__WHTEST_CCC'
const META_KEY = '__WHTEST_meta_key'

// Direct SQL cleanup — relies on the same `getDb()` instance the production
// code uses (singleton inside warehouse.ts). We achieve cleanup by overwriting
// candles with empty arrays (no-op) — instead, simply mark cleanup via deletes.
import * as path from 'path'

// DB_PATH must match lib/data/warehouse.ts. Main moved this from
// scripts/quantan.db → root-level quantan-warehouse-new.db (post-merge).
function cleanup(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3')
    const dbPath = path.join(process.cwd(), 'quantan-warehouse-new.db')
    const db = new Database(dbPath)
    db.prepare('DELETE FROM candles WHERE ticker LIKE ?').run('__WHTEST_%')
    db.prepare('DELETE FROM quotes WHERE ticker LIKE ?').run('__WHTEST_%')
    db.prepare('DELETE FROM meta WHERE key LIKE ?').run('__WHTEST_%')
    db.close()
  } catch {
    // ignore — best-effort
  }
}

beforeAll(() => {
  cleanup()
})

afterAll(() => {
  cleanup()
})

describeIfDb('warehouse — schema & availability', () => {
  it('isWarehouseAvailable() returns true when better-sqlite3 + DB are usable', () => {
    expect(isWarehouseAvailable()).toBe(true)
  })

  it('schema is idempotent — repeated calls do not throw', () => {
    expect(isWarehouseAvailable()).toBe(true)
    expect(isWarehouseAvailable()).toBe(true)
    expect(isWarehouseAvailable()).toBe(true)
  })
})

describeIfDb('warehouse — candles', () => {
  it('upsertCandles + getCandles round-trips', () => {
    const bars = [
      { date: '2025-01-02', open: 100, high: 102, low: 99, close: 101, volume: 1_000 },
      { date: '2025-01-03', open: 101, high: 103, low: 100, close: 102, volume: 1_100 },
      { date: '2025-01-06', open: 102, high: 104, low: 101.5, close: 103.5, volume: 1_200 },
    ]
    upsertCandles(T1, bars)

    const got = getCandles(T1)
    expect(got).not.toBeNull()
    expect(got).toHaveLength(3)
    expect(got![0]).toMatchObject({ date: '2025-01-02', open: 100, close: 101 })
    expect(got![2]).toMatchObject({ date: '2025-01-06', close: 103.5 })
  })

  it('getCandles ORDER BY date ASC even when inserted out of order', () => {
    upsertCandles(T2, [
      { date: '2025-03-15', open: 50, high: 51, low: 49, close: 50, volume: 0 },
      { date: '2025-01-15', open: 40, high: 41, low: 39, close: 40, volume: 0 },
      { date: '2025-02-15', open: 45, high: 46, low: 44, close: 45, volume: 0 },
    ])
    const got = getCandles(T2)!
    expect(got.map((b) => b.date)).toEqual(['2025-01-15', '2025-02-15', '2025-03-15'])
  })

  it('getCandles returns null (NOT []) when ticker is not in warehouse', () => {
    expect(getCandles('__WHTEST_DOES_NOT_EXIST')).toBeNull()
  })

  it('upsertCandles is INSERT OR REPLACE — second upsert overwrites first', () => {
    upsertCandles(T3, [
      { date: '2025-01-02', open: 100, high: 102, low: 99, close: 101, volume: 1_000 },
    ])
    upsertCandles(T3, [
      { date: '2025-01-02', open: 200, high: 202, low: 199, close: 201, volume: 2_000 },
    ])
    const got = getCandles(T3)!
    expect(got).toHaveLength(1)
    expect(got[0].close).toBe(201) // overwritten
    expect(got[0].volume).toBe(2_000)
  })

  it('upsertCandles is no-op for empty bars (does not crash)', () => {
    expect(() => upsertCandles('__WHTEST_EMPTY', [])).not.toThrow()
    expect(getCandles('__WHTEST_EMPTY')).toBeNull()
  })
})

describeIfDb('warehouse — tickers list', () => {
  it('warehouseTickers includes inserted test tickers, sorted', () => {
    upsertCandles(T1, [{ date: '2025-01-02', open: 1, high: 1, low: 1, close: 1, volume: 0 }])
    upsertCandles(T2, [{ date: '2025-01-02', open: 1, high: 1, low: 1, close: 1, volume: 0 }])
    const all = warehouseTickers()
    const subset = all.filter((t) => t.startsWith('__WHTEST_'))
    // Lexicographically sorted
    const sorted = [...subset].sort()
    expect(subset).toEqual(sorted)
    expect(subset).toContain(T1)
    expect(subset).toContain(T2)
  })

  it('warehouseTickers does NOT duplicate when same ticker has many candles', () => {
    upsertCandles(T1, [
      { date: '2025-01-02', open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { date: '2025-01-03', open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { date: '2025-01-04', open: 1, high: 1, low: 1, close: 1, volume: 0 },
    ])
    const all = warehouseTickers()
    const occurrences = all.filter((t) => t === T1).length
    expect(occurrences).toBe(1)
  })
})

describeIfDb('warehouse — quotes', () => {
  it('upsertQuote + getCachedQuote round-trips and maps fields correctly', () => {
    upsertQuote({
      ticker: T1,
      price: 200,
      change: 2.5,
      changePct: 1.27,
      volume: 50_000_000,
      marketCap: 3_000_000_000_000,
      updatedAt: '2026-04-15T15:30:00Z',
    })

    const q = getCachedQuote(T1)
    expect(q).toEqual({
      ticker: T1,
      price: 200,
      change: 2.5,
      changePct: 1.27,
      volume: 50_000_000,
      marketCap: 3_000_000_000_000,
      updatedAt: '2026-04-15T15:30:00Z',
    })
  })

  it('upsertQuote stores null for missing optional fields', () => {
    upsertQuote({
      ticker: T2,
      price: 100,
      change: 0,
      changePct: 0,
      // volume + marketCap intentionally omitted
      updatedAt: '2026-04-15T15:30:00Z',
    })
    const q = getCachedQuote(T2)!
    // Per better-sqlite3, NULL maps to JS null — the parser then leaves
    // the field undefined unless explicitly cast. We assert nullish.
    expect(q.volume == null).toBe(true)
    expect(q.marketCap == null).toBe(true)
  })

  it('getCachedQuote returns null when ticker is not cached', () => {
    expect(getCachedQuote('__WHTEST_NOT_CACHED')).toBeNull()
  })

  it('upsertQuote is INSERT OR REPLACE — second upsert overwrites', () => {
    upsertQuote({
      ticker: T3,
      price: 100,
      change: 0,
      changePct: 0,
      updatedAt: '2026-04-15T15:30:00Z',
    })
    upsertQuote({
      ticker: T3,
      price: 250,
      change: 5,
      changePct: 2.04,
      updatedAt: '2026-04-15T16:00:00Z',
    })
    const q = getCachedQuote(T3)!
    expect(q.price).toBe(250)
    expect(q.updatedAt).toBe('2026-04-15T16:00:00Z')
  })
})

describeIfDb('warehouse — meta', () => {
  it('setMeta + getMeta round-trips a string', () => {
    setMeta(META_KEY, '2026-04-15T12:00:00Z')
    expect(getMeta(META_KEY)).toBe('2026-04-15T12:00:00Z')
  })

  it('setMeta INSERT OR REPLACE — second setMeta overwrites', () => {
    setMeta(META_KEY, 'first-value')
    setMeta(META_KEY, 'second-value')
    expect(getMeta(META_KEY)).toBe('second-value')
  })

  it('getMeta returns null for unknown keys', () => {
    expect(getMeta('__WHTEST_UNKNOWN_KEY_XYZ')).toBeNull()
  })

  it('preserves whitespace and unicode in meta values', () => {
    const value = '  spaced  and 🦄 unicode  '
    setMeta(META_KEY, value)
    expect(getMeta(META_KEY)).toBe(value)
  })
})
