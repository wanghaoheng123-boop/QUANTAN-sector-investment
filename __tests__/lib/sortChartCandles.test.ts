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
})
