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

/** "1-hour", "daily", … — the interval itself when it is not one we know. */
export function barLabel(interval: string): string {
  return LABELS[interval] ?? interval
}

export const isDailyInterval = (interval: string): boolean => interval === '1d'
