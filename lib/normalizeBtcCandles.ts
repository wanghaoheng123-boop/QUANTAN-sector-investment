import type { BtcCandle } from '@/lib/crypto'

/**
 * Sort by time, dedupe by timestamp (last wins), drop invalid rows.
 * Prevents lightweight-charts crashes from duplicate or NaN times.
 */
export function normalizeBtcCandles(rows: BtcCandle[]): BtcCandle[] {
  const byTime = new Map<number, BtcCandle>()
  for (const raw of rows) {
    const time =
      typeof raw.time === 'string'
        ? Math.floor(new Date(raw.time).getTime() / 1000)
        : Number(raw.time)
    if (!Number.isFinite(time) || time <= 0) continue
    const open = Number(raw.open)
    const high = Number(raw.high)
    const low = Number(raw.low)
    const close = Number(raw.close)
    const volume = Number(raw.volume)
    if (![open, high, low, close, volume].every((x) => Number.isFinite(x))) continue
    if (volume < 0 || high < low) continue
    if (high < Math.max(open, close) || low > Math.min(open, close)) continue
    byTime.set(time, { time, open, high, low, close, volume })
  }
  return [...byTime.keys()]
    .sort((a, b) => a - b)
    .map((t) => byTime.get(t)!)
}
