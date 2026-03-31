/** EMA overlays on KLineChart — periods and stable chart colors. */
export const CHART_EMA_PERIODS = [9, 12, 20, 21, 26, 50, 100, 200] as const
export type ChartEmaPeriod = (typeof CHART_EMA_PERIODS)[number]
export type ChartEmaKey = `ema${ChartEmaPeriod}`

export const CHART_EMA_COLORS: Record<ChartEmaPeriod, string> = {
  9: '#22d3ee',
  12: '#84cc16',
  20: '#f59e0b',
  21: '#eab308',
  26: '#f97316',
  50: '#8b5cf6',
  100: '#ec4899',
  200: '#94a3b8',
}

export function chartEmaKey(period: ChartEmaPeriod): ChartEmaKey {
  return `ema${period}` as ChartEmaKey
}
