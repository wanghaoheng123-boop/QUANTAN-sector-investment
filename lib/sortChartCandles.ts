/**
 * Normalize OHLCV rows for lightweight-charts (strict ascending time).
 */

export type ChartCandleRow = {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** Comparable unix seconds for daily strings or UTCTimestamp numbers. */
export function chartTimeKey(time: string | number): number {
  if (typeof time === 'number') return time
  const ms = Date.parse(`${time}T12:00:00.000Z`)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

/**
 * Sort ascending, drop invalid rows, dedupe by time (last row wins).
 * Preserves intraday (number) vs daily (YYYY-MM-DD string) — never mixes types in one array.
 */
export function sortChartCandles<T extends ChartCandleRow>(rows: T[]): T[] {
  const valid: T[] = []
  for (const raw of rows) {
    const open = Number(raw.open)
    const high = Number(raw.high)
    const low = Number(raw.low)
    const close = Number(raw.close)
    const volume = Number(raw.volume)
    if (![open, high, low, close, volume].every((x) => Number.isFinite(x))) continue
    if (volume < 0 || high < low) continue
    const key = chartTimeKey(raw.time)
    if (!Number.isFinite(key) || key <= 0) continue
    valid.push({
      ...raw,
      open,
      high,
      low,
      close,
      volume,
    })
  }

  valid.sort((a, b) => chartTimeKey(a.time) - chartTimeKey(b.time))

  const out: T[] = []
  let lastKey: number | null = null
  for (const row of valid) {
    const key = chartTimeKey(row.time)
    if (lastKey !== null && key === lastKey) {
      out[out.length - 1] = row
    } else {
      out.push(row)
      lastKey = key
    }
  }
  return out
}
