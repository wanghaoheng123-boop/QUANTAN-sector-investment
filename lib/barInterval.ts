/**
 * Q-141 — words for a candle interval, so a label says what the bars are.
 *
 * The BTC Quant Lab labelled a 200-BAR average "200-Day MA" and a 20-bar range
 * "20-week", whatever timeframe the Chart tab had last loaded (1m … 1M). The
 * arithmetic is per bar; only the words assumed daily candles.
 */
const LABELS: Readonly<Record<string, string>> = {
  '1m': '1-minute', '5m': '5-minute', '15m': '15-minute',
  '1h': '1-hour', '4h': '4-hour',
  '1d': 'daily', '1w': 'weekly', '1M': 'monthly',
}

/**
 * The LABELS key for an interval. Case matters only where it carries meaning
 * (`1m` minute vs `1M` month); `1D`, `1H` and `1W` are the same as their
 * lower-case forms (red-team R2-241-2: `1D` was labelled "1D bars" and told
 * daily candles were not daily).
 */
function normalise(interval: string): string {
  if (interval in LABELS) return interval
  return /^\d+[DHW]$/.test(interval) ? interval.toLowerCase() : interval
}

/** "1-hour", "daily", … — the interval itself when it is not one we know. */
export function barLabel(interval: string): string {
  return LABELS[normalise(interval)] ?? interval
}

export const isDailyInterval = (interval: string): boolean => normalise(interval) === '1d'
