/** EMA overlays on KLineChart — comprehensive periods covering all standard trading platforms.
 *
 * Sources cross-referenced:
 *  - ThinkOrSwim: 4, 5, 9, 10, 12, 15, 20, 21, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120,
 *                  130, 140, 150, 160, 170, 180, 200, 250
 *  - TradingView default: 9, 21, 50, 100, 200  (custom any period available)
 *  - Binance: 5, 10, 20, 50, 100, 200
 *  - StockCharts: 20, 50, 200
 *  - Webull: 5, 10, 20, 30, 60, 120, 200
 *
 * We include all commonly-used institutional periods: 4–60 (intraday/short-term) and 100–250 (medium/long-term).
 */

/** All supported EMA periods. */
export const CHART_EMA_PERIODS = [
  4, 5, 6, 7, 8,     // very short-term
  9, 10, 12,          // short-term (9=standard MACD component)
  15, 20,            // short/medium
  21, 26,            // medium-term (21=standard, 26=MACD component)
  30, 40,            // medium
  50, 60,            // medium/long (50=standard half-year)
  100,               // long-term
  150,               // major institutional (≈7.5-month SMA / EMA)
  200,               // critical institutional benchmark (~1 trading year)
  250,               // major institutional (≈1 trading year SMA, used by Mebane Faber, RCIP)
] as const

export type ChartEmaPeriod = (typeof CHART_EMA_PERIODS)[number]

/** Key type for indicator flags, e.g. `ema9`, `ema200`. */
export type ChartEmaKey = `ema${ChartEmaPeriod}`

/** Stable, distinct colors for each EMA period. */
export const CHART_EMA_COLORS: Record<ChartEmaPeriod, string> = {
  // Very short-term — cool/cyan tones
  4:   '#67e8f9',   // cyan-300
  5:   '#22d3ee',   // cyan-400
  6:   '#06b6d4',   // cyan-500
  7:   '#0e7490',   // cyan-700
  8:   '#0891b2',   // cyan-600
  // Short-term — greens/limes
  9:   '#84cc16',   // lime-500
  10:  '#a3e635',   // lime-400
  12:  '#65a30d',   // lime-600
  // Short/medium — yellows/ambers
  15:  '#fbbf24',   // amber-400
  20:  '#f59e0b',   // amber-500
  // Medium-term — orange
  21:  '#f97316',   // orange-500
  26:  '#ea580c',   // orange-600
  // Medium — yellow-green
  30:  '#ca8a04',   // yellow-600
  40:  '#d97706',   // amber-600
  // Medium/long — purples/violets
  50:  '#8b5cf6',   // violet-500
  60:  '#7c3aed',   // violet-600
  // Long-term — pinks/rose
  100: '#ec4899',   // pink-500
  // Major institutional — warm/cool extremes
  150: '#14b8a6',   // teal-500
  200: '#94a3b8',   // slate-400  (classic 200MA — neutral grey so it doesn't clash)
  250: '#fb923c',   // orange-400 (1-year round number)
}

/** Default enabled EMAs when user selects EMA preset. */
export const DEFAULT_ACTIVE_EMAS: ChartEmaKey[] = ['ema20', 'ema50']

/** EMAs that are always shown regardless of preset (key reference lines). */
export const ALWAYS_ON_EMAS: ChartEmaKey[] = []

export function chartEmaKey(period: ChartEmaPeriod): ChartEmaKey {
  return `ema${period}` as ChartEmaKey
}

/** Build a Record<ChartEmaKey, boolean> with all false. */
export function allEmaOff(): Record<ChartEmaKey, boolean> {
  const out: Partial<Record<ChartEmaKey, boolean>> = {}
  for (const p of CHART_EMA_PERIODS) out[chartEmaKey(p)] = false
  return out as Record<ChartEmaKey, boolean>
}

/** Build a Record<ChartEmaKey, boolean> with all true. */
export function allEmaOn(): Record<ChartEmaKey, boolean> {
  const out: Partial<Record<ChartEmaKey, boolean>> = {}
  for (const p of CHART_EMA_PERIODS) out[chartEmaKey(p)] = true
  return out as Record<ChartEmaKey, boolean>
}
