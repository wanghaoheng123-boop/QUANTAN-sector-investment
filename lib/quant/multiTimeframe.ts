/**
 * Multi-Timeframe Analysis — aggregate daily bars to weekly/monthly,
 * compute indicators on each, and produce an alignment score.
 *
 * Alignment score ranges from -3 (all bearish) to +3 (all bullish).
 * Each timeframe contributes +1 (bullish), -1 (bearish), or 0 (neutral).
 */

import type { OhlcvBar } from '@/lib/quant/indicators'
import { emaFull, rsiArray, macdArray } from '@/lib/quant/indicators'

// ─── Types ──────────────────────────────────────────────────────────────────

/** OhlcvBar with a required time field (unix seconds). */
export interface TimedBar extends OhlcvBar {
  time: number
}

export interface AggregatedBar {
  time: number  // unix seconds of the period start
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type TrendDirection = 'bullish' | 'bearish' | 'neutral'

export interface TimeframeSignal {
  timeframe: 'daily' | 'weekly' | 'monthly'
  trend: TrendDirection        // price vs EMA(21)
  rsiZone: 'oversold' | 'overbought' | 'neutral'
  macdDirection: 'positive' | 'negative' | 'neutral'
  score: number               // +1, -1, or 0
}

export interface MultiTimeframeResult {
  daily: TimeframeSignal
  weekly: TimeframeSignal | null   // null if insufficient data
  monthly: TimeframeSignal | null  // null if insufficient data
  alignmentScore: number           // -3 to +3
}

// ─── Aggregation ────────────────────────────────────────────────────────────

/**
 * Aggregate daily bars to weekly bars.
 * Groups by ISO week (Monday-Friday). Partial weeks at start/end are included.
 */
export function aggregateToWeekly(daily: TimedBar[]): AggregatedBar[] {
  if (daily.length === 0) return []

  const weeks: AggregatedBar[] = []
  let current: AggregatedBar | null = null

  for (const bar of daily) {
    const date = new Date(bar.time * 1000)
    // getDay: 0=Sun..6=Sat. ISO week starts Monday (1).
    // Use Monday as week boundary.
    const day = date.getUTCDay()
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(date)
    monday.setUTCDate(date.getUTCDate() + mondayOffset)
    monday.setUTCHours(0, 0, 0, 0)
    const weekStart = Math.floor(monday.getTime() / 1000)

    if (current === null || current.time !== weekStart) {
      if (current !== null) weeks.push(current)
      current = {
        time: weekStart,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }
    } else {
      current.high = Math.max(current.high, bar.high)
      current.low = Math.min(current.low, bar.low)
      current.close = bar.close
      current.volume += bar.volume
    }
  }
  if (current !== null) weeks.push(current)
  return weeks
}

/**
 * Aggregate daily bars to monthly bars.
 * Groups by calendar month (UTC).
 */
export function aggregateToMonthly(daily: TimedBar[]): AggregatedBar[] {
  if (daily.length === 0) return []

  const months: AggregatedBar[] = []
  let current: AggregatedBar | null = null
  let currentKey = ''

  for (const bar of daily) {
    const date = new Date(bar.time * 1000)
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`

    if (current === null || currentKey !== key) {
      if (current !== null) months.push(current)
      currentKey = key
      const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
      current = {
        time: Math.floor(monthStart.getTime() / 1000),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }
    } else {
      current.high = Math.max(current.high, bar.high)
      current.low = Math.min(current.low, bar.low)
      current.close = bar.close
      current.volume += bar.volume
    }
  }
  if (current !== null) months.push(current)
  return months
}

// ─── Per-Timeframe Signal ───────────────────────────────────────────────────

function classifyTimeframe(
  closes: number[],
  timeframe: 'daily' | 'weekly' | 'monthly',
  strategyHint?: string,
): TimeframeSignal | null {
  // Need at least 26 bars for MACD(12,26,9) + some lookback
  if (closes.length < 35) return null

  // Trend: price vs EMA(21)
  const ema21 = emaFull(closes, 21)
  const lastEma = ema21[ema21.length - 1]
  const lastClose = closes[closes.length - 1]
  let trend: TrendDirection = 'neutral'
  if (Number.isFinite(lastEma)) {
    const devPct = ((lastClose - lastEma) / lastEma) * 100
    if (devPct > 1) trend = 'bullish'
    else if (devPct < -1) trend = 'bearish'
  }

  // RSI zone
  const rsi = rsiArray(closes, 14)
  const lastRsi = rsi[rsi.length - 1]
  let rsiZone: 'oversold' | 'overbought' | 'neutral' = 'neutral'
  if (Number.isFinite(lastRsi)) {
    if (lastRsi < 30) rsiZone = 'oversold'
    else if (lastRsi > 70) rsiZone = 'overbought'
  }

  // MACD direction
  const macd = macdArray(closes)
  const lastHist = macd.histogram[macd.histogram.length - 1]
  let macdDirection: 'positive' | 'negative' | 'neutral' = 'neutral'
  if (Number.isFinite(lastHist)) {
    if (lastHist > 0) macdDirection = 'positive'
    else if (lastHist < 0) macdDirection = 'negative'
  }

  // Score: +1 for bullish signals, -1 for bearish
  let score = 0
  if (trend === 'bullish') score++
  else if (trend === 'bearish') score--
  // RSI scoring: mean_reversion (default) → contrarian; trend_following → momentum
  if (strategyHint === 'trend_following') {
    // Trend following: overbought = trend strength (bullish), oversold = trend breakdown (bearish)
    if (rsiZone === 'oversold') score -= 0.5
    else if (rsiZone === 'overbought') score += 0.5
  } else {
    // Mean reversion (default): oversold = bullish reversal, overbought = bearish reversal
    if (rsiZone === 'oversold') score += 0.5
    else if (rsiZone === 'overbought') score -= 0.5
  }
  if (macdDirection === 'positive') score += 0.5
  else if (macdDirection === 'negative') score -= 0.5

  // Clamp to -1/0/+1 for the overall timeframe score
  const clampedScore = score > 0.3 ? 1 : score < -0.3 ? -1 : 0

  return { timeframe, trend, rsiZone, macdDirection, score: clampedScore }
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Compute multi-timeframe alignment from daily OHLCV bars.
 *
 * Accepts either TimedBar[] (with time field for weekly/monthly aggregation)
 * or plain OhlcvBar[] (daily-only analysis).
 */
export function multiTimeframeSignal(
  dailyBars: (OhlcvBar & { time?: number })[],
  strategyHint?: string,
): MultiTimeframeResult {
  const dailyCloses = dailyBars.map(b => b.close)
  const daily = classifyTimeframe(dailyCloses, 'daily', strategyHint) ?? {
    timeframe: 'daily' as const,
    trend: 'neutral' as const,
    rsiZone: 'neutral' as const,
    macdDirection: 'neutral' as const,
    score: 0,
  }

  // Weekly: need time field and enough data
  let weekly: TimeframeSignal | null = null
  const hasTime = dailyBars.length > 0 && (dailyBars[0] as TimedBar).time != null
  if (hasTime && dailyBars.length >= 200) {
    const weeklyBars = aggregateToWeekly(dailyBars as TimedBar[])
    if (weeklyBars.length >= 35) {
      weekly = classifyTimeframe(weeklyBars.map(b => b.close), 'weekly', strategyHint)
    }
  }

  // Monthly: need even more data (~24 monthly bars)
  let monthly: TimeframeSignal | null = null
  if (hasTime && dailyBars.length >= 300) {
    const monthlyBars = aggregateToMonthly(dailyBars as TimedBar[])
    if (monthlyBars.length >= 24) {
      monthly = classifyTimeframe(monthlyBars.map(b => b.close), 'monthly', strategyHint)
    }
  }

  const alignmentScore = daily.score + (weekly?.score ?? 0) + (monthly?.score ?? 0)

  return { daily, weekly, monthly, alignmentScore }
}
