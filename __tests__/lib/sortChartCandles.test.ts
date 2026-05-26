import { describe, it, expect } from 'vitest'
import { chartTimeKey, sortChartCandles } from '@/lib/sortChartCandles'

describe('sortChartCandles', () => {
  it('sorts descending daily rows ascending', () => {
    const rows = [
      { time: '2026-05-21', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { time: '2026-05-04', open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
    ]
    const out = sortChartCandles(rows)
    expect(out.map((r) => r.time)).toEqual(['2026-05-04', '2026-05-21'])
  })

  it('dedupes by time keeping last row', () => {
    const rows = [
      { time: '2026-05-04', open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
      { time: '2026-05-04', open: 2, high: 3, low: 1, close: 2, volume: 20 },
    ]
    const out = sortChartCandles(rows)
    expect(out).toHaveLength(1)
    expect(out[0].close).toBe(2)
  })

  it('chartTimeKey aligns daily strings with unix timestamps', () => {
    const unix = chartTimeKey('2026-05-04')
    expect(chartTimeKey(unix)).toBe(unix)
  })

  it('sorts out-of-order intraday unix seconds', () => {
    const rows = [
      { time: 1_700_000_100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 1_700_000_050, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ]
    const out = sortChartCandles(rows)
    expect(out.map((r) => r.time)).toEqual([1_700_000_000, 1_700_000_050, 1_700_000_100])
  })

  it('drops rows with invalid OHLC or negative volume', () => {
    const rows = [
      { time: '2026-05-04', open: NaN, high: 2, low: 0.5, close: 1, volume: 10 },
      { time: '2026-05-05', open: 1, high: 0.5, low: 2, close: 1, volume: 10 },
      { time: '2026-05-06', open: 1, high: 2, low: 0.5, close: 1, volume: -1 },
      { time: '2026-05-07', open: 1, high: 2, low: 0.5, close: 1, volume: 10 },
    ]
    const out = sortChartCandles(rows)
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe('2026-05-07')
  })
})
