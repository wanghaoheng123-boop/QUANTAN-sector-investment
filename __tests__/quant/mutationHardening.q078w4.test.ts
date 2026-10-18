/**
 * Q-078 wave 4 (2026-07-22) — mutation hardening for the quant-indicators shard.
 *
 * The 2026-07-19 scheduled run exposed two STABLE weak files (identical scores
 * on the 07-17 and 07-19 runs, so genuine coverage gaps, not the fixture
 * flakiness fixed separately): btc-indicators.ts (39.34, 189 survived) and
 * technicals.ts (47.79, 110 survived — almost all in ma200Regime's zone
 * metadata + dipSignal templates, which the existing suite asserts only with
 * `.length`/regex structural checks).
 *
 * These are pure functions. Exact-value CHARACTERIZATION goldens on
 * deterministic fixtures pin every strength, description string, confidence,
 * zone-metadata literal, and dipSignal template so arithmetic/string/boundary
 * mutants shift a pinned value. Integer-exact deviation boundaries (flat-100
 * SMA base) pin every `>`/`>=` edge; fp values use toBeCloseTo.
 */
import { offending } from '../architecture/adviceWords'
import { describe, it, expect } from 'vitest'
import {
  generateSignals,
  btcRegime,
  calcMVRV,
  calcPiCycleTop,
  calcS2FPrice,
  calcDifficultyRibbon,
  calcVWMA,
  type BtcCandle,
} from '@/lib/quant/btc-indicators'
import { ma200Regime, trendLabel } from '@/lib/quant/technicals'

// ─── fixtures ────────────────────────────────────────────────────────────────
function candles(closes: number[], vol = 1000): BtcCandle[] {
  return closes.map((c, i) => ({
    time: 1700000000 + i * 86400,
    open: i === 0 ? c : closes[i - 1],
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: vol,
  }))
}
function flatCandles(n: number, price = 50000): BtcCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 86400, open: price, high: price, low: price, close: price, volume: 1000,
  }))
}
function trendCandles(n: number, start: number, r: number): BtcCandle[] {
  const cl = [start]
  for (let i = 1; i < n; i++) cl.push(cl[i - 1] * (1 + r))
  return candles(cl)
}

// ─── calcMVRV / calcPiCycleTop / calcS2FPrice — exact arithmetic + guards ────

describe('calcMVRV', () => {
  it('returns price/realizedCap and fails closed on degenerate inputs', () => {
    expect(calcMVRV(60000, 30000)).toBe(2)
    expect(calcMVRV(45000, 30000)).toBeCloseTo(1.5, 12)
    expect(calcMVRV(60000, 0)).toBeNull()
    expect(calcMVRV(60000, -1)).toBeNull()
    expect(calcMVRV(0, 30000)).toBeNull()
    expect(calcMVRV(-1, 30000)).toBeNull()
    expect(calcMVRV(NaN, 30000)).toBeNull()
    expect(calcMVRV(60000, NaN)).toBeNull()
  })
})

describe('calcPiCycleTop', () => {
  it('fires strictly when ema111 > ema350 × multi; null on bad inputs', () => {
    expect(calcPiCycleTop(100, 40)).toBe(true)   // 100 > 80
    expect(calcPiCycleTop(80, 40)).toBe(false)   // 80 not > 80 (strict)
    expect(calcPiCycleTop(100, 60)).toBe(false)  // 100 not > 120
    expect(calcPiCycleTop(100, 40, 3)).toBe(false) // 100 not > 120
    expect(calcPiCycleTop(NaN, 40)).toBeNull()
    expect(calcPiCycleTop(100, NaN)).toBeNull()
    expect(calcPiCycleTop(100, 0)).toBeNull()    // ema350 <= 0
  })
})

describe('calcS2FPrice', () => {
  it('power-law totalS2F^3 × 0.001; null on non-finite/negative', () => {
    expect(calcS2FPrice(50)).toBe(125)      // 50^3 × 0.001
    expect(calcS2FPrice(56)).toBeCloseTo(175.616, 10)
    expect(calcS2FPrice(0)).toBe(0)         // 0 is not < 0
    expect(calcS2FPrice(-1)).toBeNull()
    expect(calcS2FPrice(NaN)).toBeNull()
  })
})

describe('calcDifficultyRibbon', () => {
  it('false below 256 candles; inversion true in downtrend, false in uptrend', () => {
    expect(calcDifficultyRibbon(candles(Array.from({ length: 255 }, () => 100)))).toBe(false)
    expect(calcDifficultyRibbon(candles(Array.from({ length: 300 }, (_, i) => 400 - i)))).toBe(true)  // ema8 < ema256
    expect(calcDifficultyRibbon(candles(Array.from({ length: 300 }, (_, i) => 100 + i)))).toBe(false) // ema8 > ema256
  })
})

describe('calcVWMA — exact volume-weighted means', () => {
  const vc: BtcCandle[] = [
    { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 100 },
    { time: 2, open: 20, high: 20, low: 20, close: 20, volume: 200 },
    { time: 3, open: 30, high: 30, low: 30, close: 30, volume: 300 },
  ]
  it('period 2 and 3 windows, NaN warmup, zero-volume close fallback', () => {
    const p2 = calcVWMA(vc, 2)
    expect(p2[0]).toBeNaN()
    expect(p2[1]).toBeCloseTo(5000 / 300, 12)  // (10·100 + 20·200)/300
    expect(p2[2]).toBeCloseTo(13000 / 500, 12) // (20·200 + 30·300)/500
    const p3 = calcVWMA(vc, 3)
    expect(p3[0]).toBeNaN()
    expect(p3[1]).toBeNaN()
    expect(p3[2]).toBeCloseTo(14000 / 600, 12)
    // sumV == 0 → fall back to the bar's own close
    const zero: BtcCandle[] = [
      { time: 1, open: 5, high: 5, low: 5, close: 5, volume: 0 },
      { time: 2, open: 7, high: 7, low: 7, close: 7, volume: 0 },
    ]
    expect(calcVWMA(zero, 2)[1]).toBe(7)
  })
})

// ─── generateSignals — exact per-indicator strength + description ────────────

describe('generateSignals', () => {
  it('returns [] below 55 candles', () => {
    expect(generateSignals(candles(Array.from({ length: 54 }, () => 100)))).toEqual([])
  })

  it('sharp decline → oversold-RSI BUY + negative MACD/EMA-cross SELL', () => {
    const decline = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 20 }, (_, i) => 100 - (i + 1) * 2)]
    expect(generateSignals(candles(decline))).toEqual([
      { indicator: 'RSI(14)', signal: 'BUY', strength: 100, description: 'Oversold at 0.0' },
      { indicator: 'MACD', signal: 'SELL', strength: 60, description: 'MACD histogram negative' },
      { indicator: 'EMA Cross', signal: 'SELL', strength: 70, description: 'EMA20 ($76) < EMA50 ($87) by 12.1%' },
      { indicator: 'Bollinger Bands', signal: 'HOLD', strength: 40, description: 'Price within BB bands' },
    ])
  })

  it('sharp rally → overbought-RSI SELL + positive MACD/EMA-cross BUY', () => {
    const rally = [...Array.from({ length: 60 }, () => 100), ...Array.from({ length: 20 }, (_, i) => 100 + (i + 1) * 2)]
    expect(generateSignals(candles(rally))).toEqual([
      { indicator: 'RSI(14)', signal: 'SELL', strength: 100, description: 'Overbought at 100.0' },
      { indicator: 'MACD', signal: 'BUY', strength: 60, description: 'MACD histogram positive' },
      { indicator: 'EMA Cross', signal: 'BUY', strength: 70, description: 'EMA20 ($124) > EMA50 ($113) by 9.3%' },
      { indicator: 'Bollinger Bands', signal: 'HOLD', strength: 40, description: 'Price within BB bands' },
    ])
  })

  it('flat series → no-cross HOLD; MACD suppressed (histogram not > 0 nor < 0)', () => {
    const flat = Array.from({ length: 80 }, () => 100)
    expect(generateSignals(candles(flat))).toEqual([
      { indicator: 'RSI(14)', signal: 'SELL', strength: 100, description: 'Overbought at 100.0' },
      { indicator: 'EMA Cross', signal: 'HOLD', strength: 30, description: 'EMA20 ($100) and EMA50 ($100) within 1% — no clear cross' },
      { indicator: 'Bollinger Bands', signal: 'HOLD', strength: 40, description: 'Price within BB bands' },
    ])
  })

  it('funding-rate signal fires only outside ±PERP_FUNDING_HIGH_ABS with exact copy', () => {
    const flat = Array.from({ length: 80 }, () => 100)
    const pos = generateSignals(candles(flat), 0.01).find((s) => s.indicator === 'Funding Rate')!
    expect(pos).toEqual({ indicator: 'Funding Rate', signal: 'SELL', strength: 75, description: 'Elevated positive funding (1.0000% / interval) — longs pay shorts (crowding)' })
    const neg = generateSignals(candles(flat), -0.01).find((s) => s.indicator === 'Funding Rate')!
    expect(neg).toEqual({ indicator: 'Funding Rate', signal: 'BUY', strength: 75, description: 'Elevated negative funding (-1.0000% / interval) — shorts pay longs (crowding)' })
    // modest funding → no funding signal
    expect(generateSignals(candles(flat), 0).some((s) => s.indicator === 'Funding Rate')).toBe(false)
  })

  it('fear & greed contrarian signal at the <25 / >75 extremes', () => {
    const flat = Array.from({ length: 80 }, () => 100)
    expect(generateSignals(candles(flat), undefined, 10).find((s) => s.indicator === 'Fear & Greed')).toEqual({
      indicator: 'Fear & Greed', signal: 'BUY', strength: 80, description: 'Extreme Fear (10) — contrarian buy signal',
    })
    expect(generateSignals(candles(flat), undefined, 90).find((s) => s.indicator === 'Fear & Greed')).toEqual({
      indicator: 'Fear & Greed', signal: 'SELL', strength: 80, description: 'Extreme Greed (90) — contrarian sell signal',
    })
    expect(generateSignals(candles(flat), undefined, 50).some((s) => s.indicator === 'Fear & Greed')).toBe(false)
  })
})

// ─── btcRegime — regime matrix, confidence formula, exact metrics/reasons ────

describe('btcRegime', () => {
  it('insufficient data → NEUTRAL conf 0, all metrics null', () => {
    expect(btcRegime(flatCandles(50))).toEqual({
      regime: 'NEUTRAL', confidence: 0, reasons: ['insufficient data'],
      metrics: { pctVsEma200: null, ema50: null, ema200: null, rsi14: null, atrPct: null },
    })
  })

  it('non-positive last close → fail-closed empty regime', () => {
    const bad = [...flatCandles(249), { time: 1, open: 0, high: 0, low: 0, close: 0, volume: 1000 }]
    expect(btcRegime(bad).regime).toBe('NEUTRAL')
    expect(btcRegime(bad).confidence).toBe(0)
    expect(btcRegime(bad).reasons).toEqual(['insufficient data'])
  })

  it('flat series → NEUTRAL, pct 0, conf 100 (ATR 0), exact reason', () => {
    const r = btcRegime(flatCandles(250))
    expect(r.regime).toBe('NEUTRAL')
    expect(r.confidence).toBe(100)
    expect(r.reasons).toEqual(['Price within ±10% of 200EMA, no strong cross signal'])
    expect(r.metrics.pctVsEma200).toBe(0)
    expect(r.metrics.rsi14).toBe(100)
    expect(r.metrics.atrPct).toBe(0)
    expect(r.metrics.ema50).toBeCloseTo(50000, 6)
    expect(r.metrics.ema200).toBeCloseTo(50000, 6)
  })

  it('extreme uptrend → EUPHORIA (pct>20% + RSI>80) with exact reason', () => {
    const r = btcRegime(trendCandles(250, 30000, 0.003))
    expect(r.regime).toBe('EUPHORIA')
    expect(r.confidence).toBe(70)
    expect(r.metrics.pctVsEma200).toBeCloseTo(0.3129412447739407, 10)
    expect(r.reasons).toEqual(['Price 31.3% above 200EMA + RSI 100 > 80'])
  })

  it('extreme downtrend → CAPITULATION (pct<-20% + RSI<20) with exact reason', () => {
    const r = btcRegime(trendCandles(250, 60000, -0.003))
    expect(r.regime).toBe('CAPITULATION')
    expect(r.confidence).toBe(68)
    expect(r.metrics.pctVsEma200).toBeCloseTo(-0.278547765390465, 10)
    expect(r.reasons).toEqual(['Price -27.9% below 200EMA + RSI 0 < 20'])
  })

  it('mild uptrend in (0, +10%] with 50>200 EMA → BULL', () => {
    const r = btcRegime(trendCandles(250, 40000, 0.0006))
    expect(r.regime).toBe('BULL')
    expect(r.reasons).toEqual(['Price above 200EMA, 50EMA > 200EMA'])
    expect(r.metrics.pctVsEma200).toBeCloseTo(0.060369380631380955, 10)
  })

  it('confidence = round(100·max(0,1−atrPct/0.08)^1.3) — pinned across the curve', () => {
    // Craft flat-close candles with an upper-only wick of `atrFrac` so ATR/last ≈ atrFrac.
    const conf = (atrFrac: number) => {
      const price = 50000
      const cs: BtcCandle[] = Array.from({ length: 250 }, (_, i) => ({
        time: 1700000000 + i * 86400, open: price, high: price + price * atrFrac, low: price, close: price, volume: 1000,
      }))
      return btcRegime(cs).confidence
    }
    expect(conf(0)).toBe(100)
    expect(conf(0.005)).toBe(92)
    expect(conf(0.01)).toBe(84)
    expect(conf(0.02)).toBe(69)
    expect(conf(0.05)).toBe(28)
    expect(conf(0.08)).toBe(0)
    expect(conf(0.10)).toBe(0) // clamped at 0 (max(0, negative))
  })
})

// ─── ma200Regime — full zone-metadata matrix (the 110-survivor pool) ─────────

// MIGRATION NOTE — Q-153 (2026-10-17): the zone copy now DESCRIBES the
// measurement. Labels, interpretations and dipSignalExplained were trade
// instructions with unsourced forward returns; forwardReturnContext is gone.
// Zone, color, riskLevel and every dipSignal are unchanged, and the strings stay
// pinned exactly so the mutation shard still kills string mutants. (Q153-C4: an
// earlier note said the classification "mirrors lib/backtest/regimeSignal.ts".
// Only the null-slope arm is pinned to it, by the AL-5 parity test; the
// known-slope arms still diverge, and regimeSignal has no riskLevel or color.)
interface ZoneMeta {
  zone: string; label: string; color: string; riskLevel: string; interpretation: string
}
const ZONE_META: Record<string, ZoneMeta> = {
  EXTREME_BULL: { zone: 'EXTREME_BULL', label: 'More than 20% above the 200-day average', color: '#ef4444', riskLevel: 'extreme', interpretation: 'Price is more than 20% above its 200-day simple moving average.' },
  EXTENDED_BULL: { zone: 'EXTENDED_BULL', label: '10–20% above the 200-day average', color: '#f97316', riskLevel: 'high', interpretation: 'Price is 10–20% above its 200-day simple moving average.' },
  HEALTHY_BULL: { zone: 'HEALTHY_BULL', label: '0–10% above the 200-day average', color: '#22c55e', riskLevel: 'low', interpretation: 'Price is 0–10% above its 200-day simple moving average.' },
  FIRST_DIP: { zone: 'FIRST_DIP', label: '0–10% below the 200-day average', color: '#84cc16', riskLevel: 'low', interpretation: 'Price is 0–10% below its 200-day simple moving average.' },
  DEEP_DIP: { zone: 'DEEP_DIP', label: '10–20% below the 200-day average', color: '#eab308', riskLevel: 'medium', interpretation: 'Price is 10–20% below its 200-day simple moving average.' },
  BEAR_ALERT: { zone: 'BEAR_ALERT', label: '20–30% below the 200-day average', color: '#f97316', riskLevel: 'high', interpretation: 'Price is 20–30% below its 200-day simple moving average.' },
  CRASH_ZONE: { zone: 'CRASH_ZONE', label: 'More than 30% below the 200-day average', color: '#ef4444', riskLevel: 'extreme', interpretation: 'Price is more than 30% below its 200-day simple moving average.' },
}

describe('ma200Regime — deviation-zone boundaries + full metadata (null slope)', () => {
  const flat220 = Array.from({ length: 220 }, () => 100) // SMA=100, slope null (< 221 bars)

  // [price, zoneKey, expected integer deviation]
  const rows: Array<[number, string, number]> = [
    [125, 'EXTREME_BULL', 25], [121, 'EXTREME_BULL', 21],
    [120, 'EXTENDED_BULL', 20], [111, 'EXTENDED_BULL', 11],
    [110, 'HEALTHY_BULL', 10], [100, 'HEALTHY_BULL', 0],
    [95, 'FIRST_DIP', -5], [90, 'FIRST_DIP', -10],
    [85, 'DEEP_DIP', -15], [80, 'DEEP_DIP', -20],
    [75, 'BEAR_ALERT', -25], [70, 'BEAR_ALERT', -30],
    [65, 'CRASH_ZONE', -35], [60, 'CRASH_ZONE', -40],
  ]

  it.each(rows)('price %d → %s (dev %d) with exact zone metadata', (price, zoneKey, dev) => {
    const r = ma200Regime(price, flat220)
    const m = ZONE_META[zoneKey]
    expect(r.zone).toBe(m.zone)
    expect(r.deviationPct).toBeCloseTo(dev, 10)
    expect(r.label).toBe(m.label)
    expect(r.color).toBe(m.color)
    expect(r.riskLevel).toBe(m.riskLevel)
    expect(r.interpretation).toBe(m.interpretation)
    expect('forwardReturnContext' in r).toBe(false)
    expect(r.slopePositive).toBeNull() // 220 bars < 221 ⇒ slope unknown
  })

  it('overbought zones → OVERBOUGHT dipSignal with the exact template', () => {
    expect(ma200Regime(125, flat220).dipSignal).toBe('OVERBOUGHT')
    expect(ma200Regime(125, flat220).dipSignalExplained).toBe(
      "Price is 25.0% above the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
    expect(ma200Regime(105, flat220).dipSignal).toBe('IN_TREND')
    expect(ma200Regime(105, flat220).dipSignalExplained).toBe(
      "Price is 5.0% above the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
  })

  // AL-4 (2026-08-15): this test previously pinned `FALLING_KNIFE` at 220 bars
  // as the golden — it was characterizing the bug. With fewer than 221 closes
  // sma200Slope() returns null, so the slope is UNKNOWN, and the deep zones now
  // fail closed to WATCH_DIP instead of asserting a DECLINING SMA as fact.
  // Exact-string `toBe` is kept deliberately: these templates are what the
  // quant-indicators mutation shard scores, and loosening them to
  // toContain/regex would hand back the survived mutants Q-078 wave 4 killed.
  it('null-slope dip zones → WATCH_DIP in every zone (unknown slope is never a falling knife)', () => {
    expect(ma200Regime(95, flat220).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(95, flat220).dipSignalExplained).toBe(
      "Price is 5.0% below the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
    expect(ma200Regime(85, flat220).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(85, flat220).dipSignalExplained).toBe(
      "Price is 15.0% below the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
    expect(ma200Regime(75, flat220).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(75, flat220).dipSignalExplained).toBe(
      "Price is 25.0% below the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
    expect(ma200Regime(60, flat220).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(60, flat220).dipSignalExplained).toBe(
      "Price is 40.0% below the 200-day average; its 20-day slope cannot be computed yet (fewer than 221 closes).",
    )
  })
})

describe('ma200Regime — dipSignal by slope direction', () => {
  const rising250 = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5)
  const SMA_RISE = 174.75 // mean of closes[50..249]
  const falling250 = Array.from({ length: 250 }, (_, i) => 200 - i * 0.4)
  const SMA_FALL = falling250.slice(-200).reduce((a, b) => a + b, 0) / 200

  it('rising 200MA: FIRST_DIP → STRONG_DIP; RSI<40 appends oversold confirmation', () => {
    const r = ma200Regime(SMA_RISE * 0.95, rising250)
    expect(r.slopePositive).toBe(true)
    expect(r.dipSignal).toBe('STRONG_DIP')
    expect(r.dipSignalExplained).toBe(
      "Price is 5.0% below the 200-day average; the average moved +6.07% over 20 days (rising by the +0.5% threshold).",
    )
    expect(ma200Regime(SMA_RISE * 0.95, rising250, 25).dipSignalExplained).toBe(
      "Price is 5.0% below the 200-day average; the average moved +6.07% over 20 days (rising by the +0.5% threshold). RSI(14) is 25.",
    )
  })

  it('rising 200MA: DEEP_DIP → WATCH_DIP (scale-in), BEAR_ALERT → WATCH_DIP, CRASH → STRONG_DIP', () => {
    expect(ma200Regime(SMA_RISE * 0.85, rising250).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(SMA_RISE * 0.85, rising250, 25).dipSignalExplained).toBe(
      "Price is 15.0% below the 200-day average; the average moved +6.07% over 20 days (rising by the +0.5% threshold). RSI(14) is 25.",
    )
    expect(ma200Regime(SMA_RISE * 0.75, rising250).dipSignal).toBe('WATCH_DIP')
    expect(ma200Regime(SMA_RISE * 0.65, rising250).dipSignal).toBe('STRONG_DIP')
    expect(ma200Regime(SMA_RISE * 0.65, rising250).dipSignalExplained).toBe(
      "Price is 35.0% below the 200-day average; the average moved +6.07% over 20 days (rising by the +0.5% threshold).",
    )
  })

  it('falling 200MA: FIRST_DIP → WATCH_DIP; deeper zones → FALLING_KNIFE', () => {
    const fd = ma200Regime(SMA_FALL * 0.95, falling250)
    expect(fd.slopePositive).toBe(false)
    expect(fd.dipSignal).toBe('WATCH_DIP')
    expect(fd.dipSignalExplained).toBe(
      "Price is 5.0% below the 200-day average; the average moved -5.40% over 20 days (not rising by the +0.5% threshold).",
    )
    expect(ma200Regime(SMA_FALL * 0.85, falling250).dipSignal).toBe('FALLING_KNIFE')
    expect(ma200Regime(SMA_FALL * 0.75, falling250).dipSignalExplained).toBe(
      "Price is 25.0% below the 200-day average; the average moved -5.40% over 20 days (not rising by the +0.5% threshold).",
    )
    expect(ma200Regime(SMA_FALL * 0.65, falling250).dipSignalExplained).toBe(
      "Price is 35.0% below the 200-day average; the average moved -5.40% over 20 days (not rising by the +0.5% threshold).",
    )
  })

  it('insufficient / non-positive price → INSUFFICIENT_DATA guard', () => {
    const ins = ma200Regime(100, [99, 100, 101])
    expect(ins).toEqual({
      zone: 'INSUFFICIENT_DATA', deviationPct: null, slopePositive: null, slopePct: null,
      label: 'Insufficient Data', color: '#64748b', riskLevel: 'medium',
      interpretation: 'Fewer than 200 daily closes available — cannot compute 200-day SMA.',
      dipSignal: 'INSUFFICIENT_DATA', dipSignalExplained: 'Not enough history to assess.',
    })
    const flat220 = Array.from({ length: 220 }, () => 100)
    expect(ma200Regime(0, flat220).zone).toBe('INSUFFICIENT_DATA')
    expect(ma200Regime(-5, flat220).zone).toBe('INSUFFICIENT_DATA')
    expect(ma200Regime(NaN, flat220).zone).toBe('INSUFFICIENT_DATA')
  })
})

describe('ma200Regime — Q-153: the copy describes, and a slow rise is not "declining"', () => {
  it('a 200-day average up less than +0.5% over 20 days reads "not rising", with its real + sign', () => {
    // 221+ closes rising slowly: the slope is positive but below the threshold.
    const slow = Array.from({ length: 260 }, (_, i) => 100 + i * 0.002)
    const r = ma200Regime(95, slow)
    expect(r.slopePositive).toBe(false)
    expect(r.slopePct).toBeGreaterThan(0)
    expect(r.dipSignalExplained).toMatch(/the average moved \+0\.\d\d% over 20 days \(not rising by the \+0\.5% threshold\)/)
    expect(r.dipSignalExplained).not.toMatch(/negative|declin/i)
  })

  it('no zone, slope state or RSI produces trade instructions or forward-return claims', () => {
    // Q153-C9: the same list regime-copy.test.ts uses — two guards over the
    // same copy carried two different lists.
    const series = {
      flat: Array.from({ length: 220 }, () => 100),
      rising: Array.from({ length: 250 }, (_, i) => 100 + i * 0.5),
      falling: Array.from({ length: 250 }, (_, i) => 200 - i * 0.4),
    }
    for (const closes of Object.values(series)) {
      const sma = closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      for (const k of [1.3, 1.15, 1.05, 0.95, 0.85, 0.75, 0.6]) {
        for (const rsi of [undefined, 25, 75]) {
          const r = ma200Regime(sma * k, closes, rsi)
          for (const text of [r.label, r.interpretation, r.dipSignalExplained]) expect(offending(text), text).toBe(false)
        }
      }
    }
  })
})

describe('trendLabel — exact branch strings', () => {
  it('pins all five outcomes', () => {
    expect(trendLabel(null, null, 100)).toBe('Insufficient history')
    expect(trendLabel(110, 100, 120)).toBe('Price > SMA50 > SMA200')
    expect(trendLabel(100, 120, 90)).toBe('Price < SMA50 < SMA200') // price 90 < SMA50 100 < SMA200 120
    expect(trendLabel(105, 100, 102)).toBe('SMA50 above SMA200')
    expect(trendLabel(95, 100, 102)).toBe('SMA50 below SMA200')
  })
})
