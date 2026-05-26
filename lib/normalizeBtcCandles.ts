import type { BtcCandle } from '@/lib/crypto'
import { sortChartCandles } from '@/lib/sortChartCandles'

/**
 * Sort by time, dedupe by timestamp (last wins), drop invalid rows.
 * Delegates to sortChartCandles (SSOT for lightweight-charts OHLCV).
 */
export function normalizeBtcCandles(rows: BtcCandle[]): BtcCandle[] {
  return sortChartCandles(
    rows.map((raw) => ({
      time:
        typeof raw.time === 'string'
          ? Math.floor(new Date(raw.time).getTime() / 1000)
          : Number(raw.time),
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      volume: raw.volume,
    })),
  ) as BtcCandle[]
}
