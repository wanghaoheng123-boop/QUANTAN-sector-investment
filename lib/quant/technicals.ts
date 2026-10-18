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
  sma200DeviationPct,
  sma200Slope,
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
  // Q153-C16: "bullish/bearish stack" and "golden/death cross zone" named a
  // state with a direction and as if it were an event; the order is the fact.
  if (price > sma50 && sma50 > sma200) return 'Price > SMA50 > SMA200'
  if (price < sma50 && sma50 < sma200) return 'Price < SMA50 < SMA200'
  if (sma50 > sma200) return 'SMA50 above SMA200'
  return 'SMA50 below SMA200'
}

// F-6: sma200DeviationPct / sma200Slope are now defined once in ./indicators
// (the SSOT both this UI path and lib/backtest/signalHelpers.ts re-export) so the
// two paths can never drift. Imported above for the internal ma200Regime calls;
// re-exported here to preserve this module's public API (BtcQuantLab imports them).
export { sma200DeviationPct, sma200Slope }

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
  dipSignal: 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE' | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'
  dipSignalExplained: string
}

/** The 20-day change of the 200-day average above which ma200Regime calls it rising. */
export const MA200_RISING_THRESHOLD = 0.005

export type SlopeState = 'rising' | 'flat' | 'falling'

/**
 * Q153-C11: the 20-day change of the 200-day average in THREE states, with the
 * classifier's own threshold. "Rising" is exactly the classifier's test
 * (above +0.5%); "falling" is its mirror; anything between is flat. The chips
 * used to be three-state by SIGN, so an average up 0.19% read "▲ up" beside a
 * classification that does not call it rising.
 */
export function slopeState(slopePct: number | null | undefined): SlopeState | null {
  if (slopePct == null || !Number.isFinite(slopePct)) return null
  if (slopePct > MA200_RISING_THRESHOLD) return 'rising'
  if (slopePct < -MA200_RISING_THRESHOLD) return 'falling'
  return 'flat'
}

/**
 * The slope as one line, threshold included: "● flat +0.19% / 20d (within ±0.5%)".
 * `window` names the 20 observations — "20d" on daily bars, "20 bars" otherwise.
 */
export function slopeText(slopePct: number | null | undefined, window = '20d'): string {
  const state = slopeState(slopePct)
  if (state == null || slopePct == null) return '—'
  const glyph = state === 'rising' ? '▲' : state === 'falling' ? '▼' : '●'
  const value = `${slopePct > 0 ? '+' : ''}${(slopePct * 100).toFixed(2)}%`
  const band = state === 'flat' ? ` (within ±${(MA200_RISING_THRESHOLD * 100).toFixed(1)}%)` : ''
  return `${glyph} ${state} ${value} / ${window}${band}`
}

/**
 * What ma200Regime measured, in words — no trade instruction (Q-153). The
 * slope is described by its MEASURED sign and the classifier's threshold:
 * `slopePositive === false` means "not rising by +0.5% over 20 days", which
 * includes a flat or slowly rising average. The old text called every such
 * case "NEGATIVE (declining)".
 */
export function describeRegime(dev: number, slope: number | null, slopePositive: boolean | null, rsi14?: number | null): string {
  const where = `${Math.abs(dev).toFixed(1)}% ${dev >= 0 ? 'above' : 'below'} the 200-day average`
  const slopeText = slope == null
    ? 'its 20-day slope cannot be computed yet (fewer than 221 closes)'
    : `the average moved ${slope >= 0 ? '+' : ''}${(slope * 100).toFixed(2)}% over 20 days (${slopePositive ? 'rising' : 'not rising'} by the +${(MA200_RISING_THRESHOLD * 100).toFixed(1)}% threshold)`
  const rsiText = rsi14 != null && Number.isFinite(rsi14) ? ` RSI(14) is ${rsi14.toFixed(0)}.` : ''
  return `Price is ${where}; ${slopeText}.${rsiText}`
}

/*
 * Q153-C1: there is no display label for `dipSignal` any more. The labels this
 * file carried ("Below a rising average", "Below the average", …) were not true
 * of the classes they named — WATCH_DIP includes prices below a FALLING average,
 * and the band-to-class map is not a predicate — so the badge and its summary
 * counts were removed from every surface. The enum values stay: the backtest
 * and the public API use them (whether the API keeps them is owner-gated, Q-083).
 */

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
    dipSignal: 'INSUFFICIENT_DATA',
    dipSignalExplained: 'Not enough history to assess.',
  }

  const sma200val = sma(closes, 200)
  if (sma200val == null || !Number.isFinite(price) || price <= 0) return insufficient

  const dev = sma200DeviationPct(price, sma200val)
  if (dev == null) return insufficient

  const slope = sma200Slope(closes)
  const slopePositive = slope != null ? slope > MA200_RISING_THRESHOLD : null

  let zone: MA200Zone
  if (dev > 20) zone = 'EXTREME_BULL'
  else if (dev > 10) zone = 'EXTENDED_BULL'
  else if (dev >= 0) zone = 'HEALTHY_BULL'
  else if (dev >= -10) zone = 'FIRST_DIP'
  else if (dev >= -20) zone = 'DEEP_DIP'
  else if (dev >= -30) zone = 'BEAR_ALERT'
  else zone = 'CRASH_ZONE'

  // Q-153 (2026-10-17): the zone text DESCRIBES the measurement. It used to
  // carry trade instructions ("Avoid new long entries", "Trim positions",
  // "highest-probability buy zone") and unsourced forward-return figures
  // ("median 18M forward return +30-50%+") — personal-recommendation copy on
  // the surface Q-083 gates, and performance claims I5 forbids without a
  // source. The dipSignal classification below is unchanged. Its null-slope arm
  // is pinned to lib/backtest/regimeSignal.ts by the AL-5 parity test; the
  // known-slope arms still diverge (AL-5 open). `riskLevel` and `color` are
  // UI-era fields no surface renders any more and nothing in the benchmark reads
  // (Q153-C4, C5, C6); they stay on the public payloads pending Q-083.
  const zoneData: Record<MA200Zone, { label: string; color: string; riskLevel: MA200Regime['riskLevel']; interpretation: string }> = {
    EXTREME_BULL: { label: 'More than 20% above the 200-day average', color: '#ef4444', riskLevel: 'extreme', interpretation: 'Price is more than 20% above its 200-day simple moving average.' },
    EXTENDED_BULL: { label: '10–20% above the 200-day average', color: '#f97316', riskLevel: 'high', interpretation: 'Price is 10–20% above its 200-day simple moving average.' },
    HEALTHY_BULL: { label: '0–10% above the 200-day average', color: '#22c55e', riskLevel: 'low', interpretation: 'Price is 0–10% above its 200-day simple moving average.' },
    FIRST_DIP: { label: '0–10% below the 200-day average', color: '#84cc16', riskLevel: 'low', interpretation: 'Price is 0–10% below its 200-day simple moving average.' },
    DEEP_DIP: { label: '10–20% below the 200-day average', color: '#eab308', riskLevel: 'medium', interpretation: 'Price is 10–20% below its 200-day simple moving average.' },
    BEAR_ALERT: { label: '20–30% below the 200-day average', color: '#f97316', riskLevel: 'high', interpretation: 'Price is 20–30% below its 200-day simple moving average.' },
    CRASH_ZONE: { label: 'More than 30% below the 200-day average', color: '#ef4444', riskLevel: 'extreme', interpretation: 'Price is more than 30% below its 200-day simple moving average.' },
    INSUFFICIENT_DATA: { label: 'Insufficient Data', color: '#64748b', riskLevel: 'medium', interpretation: 'Not enough history to compute a 200-day simple moving average.' },
  }

  const meta = zoneData[zone]

  let dipSignal: MA200Regime['dipSignal']

  if (zone === 'EXTREME_BULL' || zone === 'EXTENDED_BULL') {
    dipSignal = 'OVERBOUGHT'
  } else if (zone === 'HEALTHY_BULL') {
    dipSignal = 'IN_TREND'
  } else if (zone === 'FIRST_DIP') {
    if (slopePositive === true) {
      dipSignal = 'STRONG_DIP'
    } else if (slopePositive === false) {
      dipSignal = 'WATCH_DIP'
    } else {
      dipSignal = 'WATCH_DIP'
    }
  } else if (zone === 'DEEP_DIP') {
    // AL-4/AL-5 (2026-08-15) — fail-closed on an UNKNOWN slope.
    //
    // These three deep zones were `if (slopePositive === true) … else
    // FALLING_KNIFE`, which folded "slope is null" (fewer than the 221 closes
    // sma200Slope() needs) into the same arm as "slope is negative". A caller
    // with 200–220 bars was told, as fact and in the most alarming copy in the
    // codebase, that the 200-day SMA is DECLINING — from a number the code
    // never computed. `/api/ma-deviation` hit this on every row of the board.
    //
    // Unknown ≠ declining. Each deep zone now has an explicit `null` arm that
    // says so, mirroring the FIRST_DIP branch above and the Q05-1 fail-closed
    // in lib/backtest/regimeSignal.ts:153-161. WATCH_DIP is deliberate: it is
    // the value regimeSignal emits for the same input, so the two surfaces
    // agree on dipSignal instead of contradicting each other (AL-5).
    // The true/false arms are untouched.
    if (slopePositive === true) {
      dipSignal = 'WATCH_DIP'
    } else if (slopePositive === false) {
      dipSignal = 'FALLING_KNIFE'
    } else {
      dipSignal = 'WATCH_DIP'
    }
  } else if (zone === 'BEAR_ALERT') {
    if (slopePositive === true) {
      dipSignal = 'WATCH_DIP'
    } else if (slopePositive === false) {
      dipSignal = 'FALLING_KNIFE'
    } else {
      dipSignal = 'WATCH_DIP'
    }
  } else if (zone === 'CRASH_ZONE') {
    // Restructured from a pair of ternaries to the same if/else-if/else shape
    // as its sibling zones so the null arm is explicit rather than implied.
    if (slopePositive === true) {
      dipSignal = 'STRONG_DIP'
    } else if (slopePositive === false) {
      dipSignal = 'FALLING_KNIFE'
    } else {
      dipSignal = 'WATCH_DIP'
    }
  } else {
    dipSignal = 'INSUFFICIENT_DATA'
  }

  const dipSignalExplained = describeRegime(dev, slope, slopePositive, rsi14)


  return {
    zone,
    deviationPct: dev,
    slopePositive,
    slopePct: slope,
    label: meta.label,
    color: meta.color,
    riskLevel: meta.riskLevel,
    interpretation: meta.interpretation,
    dipSignal,
    dipSignalExplained,
  }
}
