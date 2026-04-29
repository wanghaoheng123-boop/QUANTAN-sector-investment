/**
 * Price-based indicators from OHLC series (oldest → newest).
 *
 * Thin re-export layer over the canonical indicators.ts.
 * These functions return single latest values (backward-compatible API).
 */

// Re-export the OhlcBar type from canonical source
export type { OhlcBar } from './indicators'

import {
  smaLatest,
  rsiLatest,
  macdLatest,
  bollingerLatest,
  atrLatest,
  maxDrawdown as maxDrawdownCanonical,
  dailyReturns as dailyReturnsCanonical,
  sharpeRatio as sharpeRatioCanonical,
  sortinoRatio as sortinoRatioCanonical,
} from './indicators'
import type { OhlcBar } from './indicators'

export function sma(values: number[], period: number): number | null {
  return smaLatest(values, period)
}

export function rsi(closes: number[], period = 14): number | null {
  return rsiLatest(closes, period)
}

export function macd(closes: number[]): {
  line: number | null
  signal: number | null
  histogram: number | null
} {
  return macdLatest(closes)
}

export function bollinger(closes: number[], period = 20, mult = 2): {
  mid: number | null
  upper: number | null
  lower: number | null
  pctB: number | null
} {
  return bollingerLatest(closes, period, mult)
}

export function atr(bars: OhlcBar[], period = 14): number | null {
  return atrLatest(bars, period)
}

export function maxDrawdown(closes: number[]): { maxDd: number; maxDdPct: number } | null {
  return maxDrawdownCanonical(closes)
}

export function dailyReturns(closes: number[]): number[] {
  return dailyReturnsCanonical(closes)
}

export function sharpeRatio(dailyReturns: number[], rfAnnual = 0.04): number | null {
  return sharpeRatioCanonical(dailyReturns, rfAnnual)
}

export function sortinoRatio(dailyReturns: number[], marDaily = 0): number | null {
  return sortinoRatioCanonical(dailyReturns, marDaily)
}

// ─── Functions that remain unique to technicals.ts ──────────────────────────

export function trendLabel(sma50: number | null, sma200: number | null, price: number): string {
  if (sma50 == null || sma200 == null) return 'Insufficient history'
  if (price > sma50 && sma50 > sma200) return 'Price > SMA50 > SMA200 (bullish stack)'
  if (price < sma50 && sma50 < sma200) return 'Price < SMA50 < SMA200 (bearish stack)'
  if (sma50 > sma200) return 'Golden cross zone (SMA50 above SMA200)'
  return 'Death cross zone (SMA50 below SMA200)'
}

export function sma200DeviationPct(price: number, sma200: number): number | null {
  if (!Number.isFinite(sma200) || sma200 <= 0 || !Number.isFinite(price)) return null
  return ((price - sma200) / sma200) * 100
}

export function sma200Slope(closes: number[]): number | null {
  if (closes.length < 221) return null
  const sma200Now = sma(closes, 200)
  const sma200Prev = sma(closes.slice(0, closes.length - 20), 200)
  if (sma200Now == null || sma200Prev == null || sma200Prev === 0) return null
  return (sma200Now - sma200Prev) / sma200Prev
}

export type MA200Zone =
  | 'EXTREME_BULL'
  | 'EXTENDED_BULL'
  | 'HEALTHY_BULL'
  | 'FIRST_DIP'
  | 'DEEP_DIP'
  | 'BEAR_ALERT'
  | 'CRASH_ZONE'
  | 'INSUFFICIENT_DATA'

export interface MA200Regime {
  zone: MA200Zone
  deviationPct: number | null
  slopePositive: boolean | null
  slopePct: number | null
  label: string
  color: string
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'
  interpretation: string
  forwardReturnContext: string
  dipSignal: 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE' | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'
  dipSignalExplained: string
}

export function ma200Regime(
  price: number,
  closes: number[],
  rsi14?: number | null,
): MA200Regime {
  const insufficient: MA200Regime = {
    zone: 'INSUFFICIENT_DATA',
    deviationPct: null,
    slopePositive: null,
    slopePct: null,
    label: 'Insufficient Data',
    color: '#64748b',
    riskLevel: 'medium',
    interpretation: 'Fewer than 200 daily closes available — cannot compute 200-day SMA.',
    forwardReturnContext: 'N/A',
    dipSignal: 'INSUFFICIENT_DATA',
    dipSignalExplained: 'Not enough history to assess.',
  }

  const sma200val = sma(closes, 200)
  if (sma200val == null || !Number.isFinite(price) || price <= 0) return insufficient

  const dev = sma200DeviationPct(price, sma200val)
  if (dev == null) return insufficient

  const slope = sma200Slope(closes)
  const slopePositive = slope != null ? slope > 0.005 : null

  let zone: MA200Zone
  if (dev > 20) zone = 'EXTREME_BULL'
  else if (dev > 10) zone = 'EXTENDED_BULL'
  else if (dev >= 0) zone = 'HEALTHY_BULL'
  else if (dev >= -10) zone = 'FIRST_DIP'
  else if (dev >= -20) zone = 'DEEP_DIP'
  else if (dev >= -30) zone = 'BEAR_ALERT'
  else zone = 'CRASH_ZONE'

  const zoneData: Record<MA200Zone, {
    label: string; color: string; riskLevel: MA200Regime['riskLevel']
    interpretation: string; forwardReturnContext: string
  }> = {
    EXTREME_BULL: {
      label: 'Extreme Overextension',
      color: '#ef4444',
      riskLevel: 'extreme',
      interpretation: 'Price is >20% above its 200-day SMA — a historically rare euphoric condition. Mean-reversion risk is elevated.',
      forwardReturnContext: 'Historically weak: median 12M forward return near +2–4% with high variance and elevated drawdown risk. Avoid new long entries at these levels.',
    },
    EXTENDED_BULL: {
      label: 'Extended Bull Run',
      color: '#f97316',
      riskLevel: 'high',
      interpretation: 'Price is 10–20% above 200-day SMA. Momentum is stretched. Corrections are statistically more likely.',
      forwardReturnContext: 'Historically mixed to below-average near-term returns (~+5–8% median 12M). Volatility spikes are common. Trim positions on further extensions.',
    },
    HEALTHY_BULL: {
      label: 'Healthy Uptrend',
      color: '#22c55e',
      riskLevel: 'low',
      interpretation: 'Price is 0–10% above 200-day SMA. The classic "in uptrend" zone. Most institutional managers view this as the preferred hold zone.',
      forwardReturnContext: 'Historically best risk/reward: median 12M forward return ~+10–14%. Low drawdown frequency. Hold existing positions; add on minor pullbacks.',
    },
    FIRST_DIP: {
      label: 'First Dip Zone',
      color: '#84cc16',
      riskLevel: 'low',
      interpretation: 'Price has dipped 0–10% below 200-day SMA — the "first test" of the long-term average. IF the 200MA is still rising, this is historically the highest-probability buy zone.',
      forwardReturnContext: 'Historically strong when 200MA slope is positive: median 12M return ~+14–18%. Dips like this recover within 3–6 months in ~70% of historical cases (S&P 500, 1950–2020).',
    },
    DEEP_DIP: {
      label: 'Deep Dip / Caution',
      color: '#eab308',
      riskLevel: 'medium',
      interpretation: 'Price is 10–20% below 200-day SMA. Meaningful correction. Must check 200MA slope. Falling knife risk rises significantly if 200MA is declining.',
      forwardReturnContext: 'Historically variable: +12–16% median 12M when 200MA is rising (true dip); near 0% or negative when 200MA is declining (trend breakdown). RSI divergence is key confirming signal.',
    },
    BEAR_ALERT: {
      label: 'Bear Alert Zone',
      color: '#f97316',
      riskLevel: 'high',
      interpretation: 'Price is 20–30% below 200-day SMA — bear market territory. Either a deep washout opportunity or the beginning of a structural decline. Context is everything.',
      forwardReturnContext: 'High variance: median 12M return +18–25% in post-crash recovery scenarios (2009, 2020) but -10% to -30% in secular bears (2001–2002, 2008). Never average down without confirming 200MA slope inflection.',
    },
    CRASH_ZONE: {
      label: 'Crash / Capitulation',
      color: '#ef4444',
      riskLevel: 'extreme',
      interpretation: 'Price >30% below 200-day SMA — capitulation or systemic crisis territory. Historically presents the maximum long-term return opportunity but maximum near-term pain.',
      forwardReturnContext: 'Maximum historical opportunity: median 18M forward return +30–50%+ in recoveries. However, timing is extremely difficult — requires confirmation of 200MA slope stabilizing and market breadth recovering before averaging in.',
    },
    INSUFFICIENT_DATA: {
      label: 'Insufficient Data',
      color: '#64748b',
      riskLevel: 'medium',
      interpretation: 'Not enough historical data to compute 200-day SMA.',
      forwardReturnContext: 'N/A',
    },
  }

  const meta = zoneData[zone]

  let dipSignal: MA200Regime['dipSignal']
  let dipSignalExplained: string

  if (zone === 'EXTREME_BULL' || zone === 'EXTENDED_BULL') {
    dipSignal = 'OVERBOUGHT'
    dipSignalExplained = `Price is extended above the 200-day SMA by ${dev.toFixed(1)}%. Not a dip — this is an overextension zone. Avoid chasing; wait for pullback toward the 200MA.`
  } else if (zone === 'HEALTHY_BULL') {
    dipSignal = 'IN_TREND'
    dipSignalExplained = `Price is in a healthy uptrend, ${dev.toFixed(1)}% above the 200-day SMA. No dip signal — standard hold/accumulate-on-correction posture.`
  } else if (zone === 'FIRST_DIP') {
    if (slopePositive === true) {
      dipSignal = 'STRONG_DIP'
      dipSignalExplained = `First test of rising 200-day SMA (${dev.toFixed(1)}% below). 200MA slope is POSITIVE — this is a textbook high-probability buy zone. ${rsi14 != null ? `RSI(14) at ${rsi14.toFixed(0)} ${rsi14 < 40 ? '— oversold confirmation' : '— not yet oversold, consider scaling in'}.` : ''}`
    } else if (slopePositive === false) {
      dipSignal = 'WATCH_DIP'
      dipSignalExplained = `Price is ${dev.toFixed(1)}% below 200-day SMA but the 200MA slope is NEGATIVE (declining). This elevates falling-knife risk. Wait for 200MA to flatten before committing.`
    } else {
      dipSignal = 'WATCH_DIP'
      dipSignalExplained = `Price is ${dev.toFixed(1)}% below 200-day SMA. Insufficient history to confirm 200MA slope direction — treat as watch until confirmed.`
    }
  } else if (zone === 'DEEP_DIP') {
    if (slopePositive === true) {
      dipSignal = 'WATCH_DIP'
      dipSignalExplained = `Deep dip zone (${dev.toFixed(1)}% below 200MA) with a still-rising 200MA. Historical forward returns are positive, but volatility is elevated. Scale in cautiously — do NOT go all-in. ${rsi14 != null ? `RSI(14) at ${rsi14.toFixed(0)}${rsi14 < 30 ? ' — extreme oversold signal supports staged entry.' : '.'}` : ''}`
    } else {
      dipSignal = 'FALLING_KNIFE'
      dipSignalExplained = `FALLING KNIFE RISK: Price is ${dev.toFixed(1)}% below a DECLINING 200-day SMA. This pattern (2000–2002, 2008, 2022) historically precedes further downside before stabilization. Avoid averaging down until 200MA slope turns positive.`
    }
  } else if (zone === 'BEAR_ALERT') {
    if (slopePositive === true) {
      dipSignal = 'WATCH_DIP'
      dipSignalExplained = `Extreme deep dip (${dev.toFixed(1)}% below 200MA). 200MA is still rising — potential major low. Requires staged accumulation with strict risk management. Historical max-opportunity zone in swift corrections (2020-type).`
    } else {
      dipSignal = 'FALLING_KNIFE'
      dipSignalExplained = `FALLING KNIFE — HIGH CONVICTION: ${dev.toFixed(1)}% below a DECLINING 200-day SMA. This matches historical bear market profiles (2001, 2008, 2022). Avoid long exposure until 200MA slope inflects positive.`
    }
  } else if (zone === 'CRASH_ZONE') {
    dipSignal = slopePositive === true ? 'STRONG_DIP' : 'FALLING_KNIFE'
    dipSignalExplained = slopePositive === true
      ? `Capitulation zone (${dev.toFixed(1)}% below 200MA) with 200MA slope starting to flatten/rise — this mirrors post-crash bottoming patterns. Maximum long-term opportunity with disciplined staged buying.`
      : `EXTREME FALLING KNIFE: ${dev.toFixed(1)}% below a still-declining 200-day SMA. Systemic bear market or structural breakdown. Only the most aggressive contrarian positioning is warranted, with full expectation of further short-term pain.`
  } else {
    dipSignal = 'INSUFFICIENT_DATA'
    dipSignalExplained = 'Cannot classify.'
  }

  return {
    zone,
    deviationPct: dev,
    slopePositive,
    slopePct: slope,
    label: meta.label,
    color: meta.color,
    riskLevel: meta.riskLevel,
    interpretation: meta.interpretation,
    forwardReturnContext: meta.forwardReturnContext,
    dipSignal,
    dipSignalExplained,
  }
}
