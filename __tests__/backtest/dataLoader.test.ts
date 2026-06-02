import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for lib/backtest/dataLoader.ts
 *
 * Closes F8.1 (sub-task: dataLoader). Verifies:
 *   - Pure converters (closesFromRows, barsFromRows) preserve order and shape
 *   - loadLocalData reads JSON, returns null on missing/invalid files
 *   - loadStockHistory prefers warehouse over JSON, sanitizes non-finite rows
 *   - availableTickers unions warehouse + JSON dir, dot/dash translation
 *
 * fs and the warehouse module are mocked so the test doesn't depend on
 * a real SQLite file or a populated scripts/backtestData directory.
 */

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}))

vi.mock('@/lib/data/warehouse', () => ({
  getCandles: vi.fn(),
  isWarehouseAvailable: vi.fn(),
  warehouseTickers: vi.fn(),
}))

import * as fs from 'fs'
import * as warehouse from '@/lib/data/warehouse'
import {
  loadLocalData,
  loadStockHistory,
  loadBtcHistory,
  availableTickers,
  closesFromRows,
  barsFromRows,
} from '@/lib/backtest/dataLoader'

const mockedFs = fs as unknown as {
  readFileSync: ReturnType<typeof vi.fn>
  existsSync: ReturnType<typeof vi.fn>
  readdirSync: ReturnType<typeof vi.fn>
}
const mockedWh = warehouse as unknown as {
  getCandles: ReturnType<typeof vi.fn>
  isWarehouseAvailable: ReturnType<typeof vi.fn>
  warehouseTickers: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('closesFromRows', () => {
  it('extracts close prices preserving order', () => {
    const rows = [
      { time: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
      { time: 2, open: 10.5, high: 12, low: 10, close: 11, volume: 110 },
      { time: 3, open: 11, high: 11.5, low: 10.5, close: 10.8, volume: 90 },
    ]
    expect(closesFromRows(rows)).toEqual([10.5, 11, 10.8])
  })

  it('returns empty array for empty input', () => {
    expect(closesFromRows([])).toEqual([])
  })
})

describe('barsFromRows', () => {
  it('strips time and volume, preserves OHLC', () => {
    const rows = [{ time: 1, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }]
    expect(barsFromRows(rows)).toEqual([{ open: 10, high: 11, low: 9, close: 10.5 }])
  })

  it('preserves order and length', () => {
    const rows = [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { time: 2, open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { time: 3, open: 3, high: 3, low: 3, close: 3, volume: 0 },
    ]
    expect(barsFromRows(rows)).toHaveLength(3)
    expect(barsFromRows(rows)[2].close).toBe(3)
  })
})

describe('loadLocalData', () => {
  it('returns null when file does not exist', () => {
    mockedFs.existsSync.mockReturnValue(false)
    expect(loadLocalData('AAPL')).toBeNull()
    expect(mockedFs.readFileSync).not.toHaveBeenCalled()
  })

  it('reads and parses JSON when file exists', () => {
    mockedFs.existsSync.mockReturnValue(true)
    const fixture = {
      ticker: 'AAPL',
      sector: 'Technology',
      fetchedAt: '2026-04-01',
      candles: [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
    }
    mockedFs.readFileSync.mockReturnValue(JSON.stringify(fixture))
    const result = loadLocalData('AAPL')
    expect(result).toEqual(fixture)
  })

  it('translates dotted tickers to dashed filenames (BRK.B → BRK-B.json)', () => {
    mockedFs.existsSync.mockReturnValue(false)
    loadLocalData('BRK.B')
    const path = (mockedFs.existsSync.mock.calls[0]?.[0] ?? '') as string
    expect(path).toMatch(/BRK-B\.json$/)
    expect(path).not.toMatch(/BRK\.B\.json$/)
  })

  it('returns null on JSON parse error (silent recovery)', () => {
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue('{not-json')
    expect(loadLocalData('AAPL')).toBeNull()
  })

  it('returns null when readFileSync throws (e.g. EACCES)', () => {
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(loadLocalData('AAPL')).toBeNull()
  })
})

describe('loadStockHistory', () => {
  it('returns warehouse data when warehouse is available', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.getCandles.mockReturnValue([
      { date: '2025-01-02', open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { date: '2025-01-03', open: 101, high: 103, low: 100, close: 102, volume: 1100 },
    ])
    const rows = loadStockHistory('AAPL')
    expect(rows).toHaveLength(2)
    expect(rows[0].close).toBe(101)
    expect(rows[0].time).toBe(Math.floor(new Date('2025-01-02').getTime() / 1000))
    // Should NOT have hit the JSON path
    expect(mockedFs.existsSync).not.toHaveBeenCalled()
  })

  it('drops warehouse rows with non-finite OHLC or an unparseable date (D5-1)', () => {
    // Mirrors the JSON-path guard: the warehouse path previously passed these
    // rows through unfiltered, feeding NaN/Infinity into the indicators.
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.getCandles.mockReturnValue([
      { date: '2025-01-02', open: 100, high: 102, low: 99, close: 101, volume: 1000 }, // valid
      { date: '2025-01-03', open: NaN, high: 103, low: 100, close: 102, volume: 1100 }, // invalid open
      { date: '2025-01-06', open: 101, high: Infinity, low: 100, close: 103, volume: 1200 }, // invalid high
      { date: 'not-a-date', open: 100, high: 101, low: 99, close: 100, volume: 900 }, // NaN time
      { date: '2025-01-07', open: 102, high: 104, low: 101, close: 103 }, // missing volume → 0
    ])
    const rows = loadStockHistory('AAPL')
    expect(rows).toHaveLength(2)
    expect(rows[0].close).toBe(101)
    expect(rows[1].close).toBe(103)
    expect(rows[1].volume).toBe(0)
    // A warehouse hit still short-circuits the JSON fallback.
    expect(mockedFs.existsSync).not.toHaveBeenCalled()
  })

  it('returns empty (no JSON fallthrough) when every warehouse row is non-finite (D5-1)', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.getCandles.mockReturnValue([
      { date: '2025-01-02', open: NaN, high: 102, low: 99, close: 101, volume: 1000 },
    ])
    const rows = loadStockHistory('AAPL')
    expect(rows).toEqual([])
    // Documented behavior: a non-empty warehouse hit short-circuits JSON even
    // when all rows are dropped (does NOT fall through).
    expect(mockedFs.existsSync).not.toHaveBeenCalled()
  })

  it('falls back to JSON when warehouse returns empty', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.getCandles.mockReturnValue([])
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        ticker: 'AAPL',
        sector: 'X',
        fetchedAt: '',
        candles: [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      })
    )
    const rows = loadStockHistory('AAPL')
    expect(rows).toHaveLength(1)
    expect(rows[0].close).toBe(1.5)
  })

  it('falls back to JSON when warehouse is unavailable', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(false)
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        ticker: 'AAPL',
        sector: 'X',
        fetchedAt: '',
        candles: [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }],
      })
    )
    const rows = loadStockHistory('AAPL')
    expect(rows).toHaveLength(1)
    expect(mockedWh.getCandles).not.toHaveBeenCalled()
  })

  it('drops rows with non-finite OHLC', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(false)
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        ticker: 'AAPL',
        sector: 'X',
        fetchedAt: '',
        candles: [
          { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }, // valid
          { time: 2, open: NaN, high: 2, low: 0.5, close: 1.5, volume: 100 }, // invalid open
          { time: 3, open: 1, high: null as unknown as number, low: 0.5, close: 1.5, volume: 100 }, // invalid high
          { time: 4, open: 1, high: 2, low: 0.5, close: 1.5 }, // missing volume → defaults 0
        ],
      })
    )
    const rows = loadStockHistory('AAPL')
    expect(rows).toHaveLength(2)
    expect(rows[0].time).toBe(1)
    expect(rows[1].time).toBe(4)
    expect(rows[1].volume).toBe(0)
  })

  it('returns empty array when both warehouse and JSON are missing', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(false)
    mockedFs.existsSync.mockReturnValue(false)
    expect(loadStockHistory('UNKNOWN')).toEqual([])
  })
})

describe('loadBtcHistory', () => {
  it('reads BTC.json and sanitizes non-finite rows', () => {
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readFileSync.mockReturnValue(
      JSON.stringify({
        ticker: 'BTC',
        sector: 'Crypto',
        fetchedAt: '',
        candles: [
          { time: 1, open: 50000, high: 51000, low: 49500, close: 50500, volume: 1 },
          { time: 2, open: Infinity, high: 51000, low: 49500, close: 50500, volume: 1 }, // dropped
        ],
      })
    )
    const rows = loadBtcHistory()
    expect(rows).toHaveLength(1)
    expect(rows[0].close).toBe(50500)
  })

  it('returns empty array when BTC file is missing', () => {
    mockedFs.existsSync.mockReturnValue(false)
    expect(loadBtcHistory()).toEqual([])
  })
})

describe('availableTickers', () => {
  it('returns sorted union of warehouse + json tickers', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.warehouseTickers.mockReturnValue(['AAPL', 'MSFT'])
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readdirSync.mockReturnValue(['MSFT.json', 'GOOG.json', 'BRK-B.json', 'README.md'] as never)

    const tickers = availableTickers()
    // BRK-B → BRK.B (translation), README.md filtered, MSFT deduped
    expect(tickers).toEqual(['AAPL', 'BRK.B', 'GOOG', 'MSFT'])
  })

  it('handles missing data dir', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(true)
    mockedWh.warehouseTickers.mockReturnValue(['AAPL'])
    mockedFs.existsSync.mockReturnValue(false)
    expect(availableTickers()).toEqual(['AAPL'])
  })

  it('returns json-only tickers when warehouse unavailable', () => {
    mockedWh.isWarehouseAvailable.mockReturnValue(false)
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.readdirSync.mockReturnValue(['SPY.json', 'QQQ.json'] as never)
    expect(availableTickers()).toEqual(['QQQ', 'SPY'])
    // warehouseTickers should NOT be called when warehouse unavailable
    expect(mockedWh.warehouseTickers).not.toHaveBeenCalled()
  })
})
