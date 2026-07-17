/**
 * Q-078 wave 1 (2026-07-17) — mutation hardening for the quant-rest shard
 * (53.80 on run 29553164644). Exact-value pins for the biggest surviving
 * clusters after PR #119's buildFundamentalsPayload suite: researchScore
 * (162 survived), regimeDetection (85), dcf (32), yahooSymbol (19),
 * constants (17). Every function here is pure — pins are hand-computable.
 */
import { describe, it, expect } from 'vitest'
import {
  rsiScoreDelta,
  bandPosition,
  computeResearchScore,
} from '@/lib/quant/researchScore'
import { runDcf } from '@/lib/quant/dcf'
import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
import { detectRegime } from '@/lib/quant/regimeDetection'
import {
  BACKTEST_RFR_ANNUAL,
  OPTIONS_RFR_ANNUAL,
  DEFAULT_SORTINO_MAR_DAILY,
  TRADING_DAYS_EQUITIES,
  TRADING_DAYS_CRYPTO,
  OPTIONS_DAYS_PER_YEAR,
  DEFAULT_TX_COST_BPS_PER_SIDE,
} from '@/lib/quant/constants'
import type { OhlcBar } from '@/lib/quant/indicators'

// ─── researchScore.rsiScoreDelta — exact piecewise-linear pins ───────────────

describe('rsiScoreDelta — F1.11 piecewise ramp', () => {
  it('ramps +15→0 over RSI 0→30, flat to 70, 0→−10 over 70→100', () => {
    expect(rsiScoreDelta(NaN)).toEqual({ delta: 0, label: 'RSI n/a' })
    expect(rsiScoreDelta(0)).toEqual({ delta: 15, label: 'RSI oversold' })
    expect(rsiScoreDelta(15).delta).toBeCloseTo(7.5, 12)
    expect(rsiScoreDelta(30)).toEqual({ delta: 0, label: 'RSI 30' })
    expect(rsiScoreDelta(50)).toEqual({ delta: 0, label: 'RSI 50' })
    expect(rsiScoreDelta(70)).toEqual({ delta: 0, label: 'RSI 70' })
    expect(rsiScoreDelta(85).delta).toBeCloseTo(-5, 12)
    expect(rsiScoreDelta(100).delta).toBeCloseTo(-10, 12)
    // out-of-range inputs clamp to the pinned extremes
    expect(rsiScoreDelta(-20).delta).toBe(15)
    expect(rsiScoreDelta(140).delta).toBeCloseTo(-10, 12)
  })
})

// ─── researchScore.bandPosition — clamp + continuous interior ────────────────

describe('bandPosition — continuous [0.15, 0.85] mapping', () => {
  it('clamps outside the band and interpolates inside it', () => {
    expect(bandPosition(90, 100, 140, 120)).toBe(0.15) // below buy zone
    expect(bandPosition(100, 100, 140, 120)).toBe(0.15) // at buyHigh
    expect(bandPosition(140, 100, 140, 120)).toBe(0.85) // at sellLow
    expect(bandPosition(150, 100, 140, 120)).toBe(0.85) // above
    expect(bandPosition(120, 100, 140, 120)).toBeCloseTo(0.5, 12) // midpoint
    expect(bandPosition(110, 100, 140, 120)).toBeCloseTo(0.325, 12) // quarter
    // Phase-14 continuity fix: one cent above buyHigh ≈ the clamp value
    expect(bandPosition(100.01, 100, 140, 120)!).toBeCloseTo(0.15, 3)
  })

  it('fails closed on missing/invalid inputs and inverted bands', () => {
    expect(bandPosition(100, null, 140, 120)).toBeNull()
    expect(bandPosition(100, 100, null, 120)).toBeNull()
    expect(bandPosition(100, 100, 140, null)).toBeNull()
    expect(bandPosition(0, 100, 140, 120)).toBeNull()
    expect(bandPosition(100, 140, 100, 120)).toBeNull() // inverted
  })
})

// ─── researchScore.computeResearchScore — pillar goldens ────────────────────

describe('computeResearchScore — exact pillar arithmetic', () => {
  const NULLS = {
    trailingPE: null, forwardPE: null, debtToEquity: null, returnOnEquity: null,
    profitMargin: null, rsi14: null, trendScore: null, pctB: null,
    excessVsSpy60d: null, bandPosition: null,
  }

  it('all-null input: every pillar neutral 50, total 50', () => {
    const r = computeResearchScore(NULLS)
    expect(r.pillars).toHaveLength(5)
    expect(r.pillars.map((p) => p.score)).toEqual([50, 50, 50, 50, 50])
    expect(r.pillars.map((p) => p.name)).toEqual([
      'Value (multiples heuristic)',
      'Quality / balance sheet',
      'Momentum & technicals',
      'Relative strength (vs SPY)',
      'Valuation band fit',
    ])
    expect(r.total).toBeCloseTo(50, 10)
    expect(r.weights).toBe('20% value · 25% quality · 20% momentum · 20% vs SPY · 15% band position')
  })

  it('bullish composite: exact weighted total 76.0', () => {
    const r = computeResearchScore({
      ...NULLS,
      forwardPE: 10,        // value 85
      debtToEquity: 0.3, returnOnEquity: 0.2, profitMargin: 0.25, // quality 50+20+10+10 = 90
      rsi14: 20, trendScore: 1, pctB: 0.1, // momentum 50+5+20+8 = 83
      excessVsSpy60d: 0.1,  // rs 50+12 = 62
      bandPosition: 0.5,    // band 100−50 = 50
    })
    expect(r.pillars.map((p) => p.score)).toEqual([85, 90, 83, 62, 50])
    // 85×.2 + 90×.25 + 83×.2 + 62×.2 + 50×.15
    expect(r.total).toBeCloseTo(76.0, 10)
    expect(r.pillars[1].detail).toBe('strong ROE · healthy margins · low leverage')
    expect(r.pillars[2].detail).toContain('RSI oversold')
    expect(r.pillars[2].detail).toContain('trend supportive')
    expect(r.pillars[3].detail).toBe('Outperforming SPY in window (+10.0%).')
  })

  it('bearish composite: penalties stack exactly', () => {
    const r = computeResearchScore({
      ...NULLS,
      forwardPE: 40,        // value 35
      debtToEquity: 3, returnOnEquity: -0.1, profitMargin: -0.2, // 50−15−10−15 = 10
      rsi14: 100, trendScore: -1, pctB: 0.9, // 50−10−20−8 = 12
      excessVsSpy60d: -0.2, // 50−24 = 26
      bandPosition: 0.9,    // 100−90 = 10
    })
    expect(r.pillars.map((p) => p.score)).toEqual([35, 10, 12, 26, 10])
    expect(r.total).toBeCloseTo(35 * 0.2 + 10 * 0.25 + 12 * 0.2 + 26 * 0.2 + 10 * 0.15, 10)
    expect(r.pillars[1].detail).toBe('negative ROE · negative margins · high debt/equity')
  })

  it('PE tier boundaries and forward-over-trailing precedence', () => {
    const score = (forwardPE: number | null, trailingPE: number | null) =>
      computeResearchScore({ ...NULLS, forwardPE, trailingPE }).pillars[0].score
    expect(score(11.99, null)).toBe(85)
    expect(score(12, null)).toBe(70)
    expect(score(17.99, null)).toBe(70)
    expect(score(18, null)).toBe(55)
    expect(score(28, null)).toBe(35)
    expect(score(-5, null)).toBe(50) // non-positive → neutral
    expect(score(null, 10)).toBe(85) // falls back to trailing
    expect(score(30, 10)).toBe(35) // forward wins when present
  })

  it('relative-strength pillar clamps at [0, 100]', () => {
    const hot = computeResearchScore({ ...NULLS, excessVsSpy60d: 0.6 })
    expect(hot.pillars[3].score).toBe(100) // 50 + 72 clamped
    const cold = computeResearchScore({ ...NULLS, excessVsSpy60d: -0.6 })
    expect(cold.pillars[3].score).toBe(0)
  })
})

// ─── dcf.runDcf — exact two-stage arithmetic ─────────────────────────────────

describe('runDcf — hand-computed 2-year case', () => {
  const base = { fcf0: 100, shares: 10, wacc: 0.1, terminalGrowth: 0.02, explicitGrowth: 0.05 }

  it('explicit PV, Gordon terminal, and the FCFF→equity bridge', () => {
    const r = runDcf({ ...base, explicitYears: 2, netDebt: 100 })!
    const pv1 = 105 / 1.1
    const pv2 = 110.25 / 1.21
    const pvExplicit = pv1 + pv2
    const tvRaw = (110.25 * 1.02) / (0.1 - 0.02)
    const pvTerminal = tvRaw / 1.21
    expect(r.pvExplicit).toBeCloseTo(pvExplicit, 10)
    expect(r.terminalValueRaw).toBeCloseTo(tvRaw, 10)
    expect(r.pvTerminal).toBeCloseTo(pvTerminal, 10)
    expect(r.enterpriseValue).toBeCloseTo(pvExplicit + pvTerminal, 10)
    expect(r.equityValue).toBeCloseTo(pvExplicit + pvTerminal - 100, 10)
    expect(r.valuePerShare).toBeCloseTo((pvExplicit + pvTerminal - 100) / 10, 10)
    expect(r.netDebtUsed).toBe(100)
  })

  it('net-cash company: equity EXCEEDS enterprise value', () => {
    const r = runDcf({ ...base, explicitYears: 2, netDebt: -50 })!
    expect(r.equityValue).toBeCloseTo(r.enterpriseValue + 50, 10)
  })

  it('defaults: 5 explicit years and netDebt 0 (non-finite coerced)', () => {
    const d5 = runDcf(base)!
    const d2 = runDcf({ ...base, explicitYears: 2 })!
    expect(d5.pvExplicit).toBeGreaterThan(d2.pvExplicit)
    expect(d5.netDebtUsed).toBe(0)
    expect(runDcf({ ...base, netDebt: NaN })!.netDebtUsed).toBe(0)
    expect(d5.equityValue).toBe(d5.enterpriseValue)
  })

  it('guard rails: every rejection branch returns null', () => {
    expect(runDcf({ ...base, shares: 0 })).toBeNull()
    expect(runDcf({ ...base, fcf0: NaN })).toBeNull()
    expect(runDcf({ ...base, wacc: 0.02 })).toBeNull() // wacc ≤ terminalGrowth
    expect(runDcf({ ...base, wacc: 0.5 })).toBeNull() // wacc ≥ 0.5
    expect(runDcf({ ...base, wacc: -0.1, terminalGrowth: -0.15 as never })).toBeNull()
    expect(runDcf({ ...base, terminalGrowth: 0.07 })).toBeNull()
    expect(runDcf({ ...base, terminalGrowth: -0.03 })).toBeNull()
    expect(runDcf({ ...base, explicitGrowth: 0.5 })).toBeNull()
    expect(runDcf({ ...base, explicitGrowth: -0.4 })).toBeNull()
    // insolvency: net debt swamps EV
    expect(runDcf({ ...base, explicitYears: 2, netDebt: 1e9 })).toBeNull()
  })
})

// ─── yahooSymbolFromParam — index prefixing + fail-closed ────────────────────

describe('yahooSymbolFromParam', () => {
  it('prefixes every known US index and uppercases plain tickers', () => {
    for (const idx of ['VIX', 'GSPC', 'DJI', 'IXIC', 'NDX', 'TNX', 'IRX', 'TYX', 'RUT', 'SPX']) {
      expect(yahooSymbolFromParam(idx.toLowerCase())).toBe(`^${idx}`)
    }
    expect(yahooSymbolFromParam('^VIX')).toBe('^VIX')
    expect(yahooSymbolFromParam('aapl')).toBe('AAPL')
    expect(yahooSymbolFromParam('  msft  ')).toBe('MSFT')
    expect(yahooSymbolFromParam('BRK-B')).toBe('BRK-B')
  })

  it('fails closed on junk (F7.3)', () => {
    expect(yahooSymbolFromParam('')).toBeNull()
    expect(yahooSymbolFromParam('   ')).toBeNull()
    expect(yahooSymbolFromParam('bad ticker!')).toBeNull()
    expect(yahooSymbolFromParam('../etc/passwd')).toBeNull()
    expect(yahooSymbolFromParam(42 as unknown as string)).toBeNull()
  })
})

// ─── detectRegime — regime classification pins ───────────────────────────────

describe('detectRegime', () => {
  function bars(closes: number[], range = 0.5): OhlcBar[] {
    return closes.map((c, i) => {
      const open = i === 0 ? c : closes[i - 1]
      return { open, high: Math.max(open, c) + range, low: Math.min(open, c) - range, close: c }
    })
  }

  it('insufficient data: exact fail-closed sentinel (no confidence boosts)', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.1)
    const r = detectRegime(closes, bars(closes.slice(0, 10)))
    expect(r).toEqual({
      volatilityRegime: 'normal',
      trendRegime: 'range_bound',
      strategyHint: 'neutral',
      volRatio: null,
      adxValue: null,
      confidence: 50,
    })
  })

  it('vol compression + strong trend → trend_following at low vol', () => {
    // First 45 bars: violent ±3% alternation; last 20: near-flat → vol20 ≪ vol60
    const closes: number[] = []
    let level = 100
    for (let i = 0; i < 65; i++) {
      level *= i < 45 ? (i % 2 === 0 ? 1.03 : 0.97) : 1.0005
      closes.push(level)
    }
    // ADX from a separate persistent uptrend (function takes bars independently)
    const trendCloses = Array.from({ length: 60 }, (_, i) => 100 + i * 2)
    const r = detectRegime(closes, bars(trendCloses, 0.3))
    expect(r.volatilityRegime).toBe('low')
    expect(r.volRatio).not.toBeNull()
    expect(r.volRatio!).toBeLessThan(0.8)
    expect(r.trendRegime).toBe('strong_trend')
    expect(r.adxValue!).toBeGreaterThan(25)
    expect(r.strategyHint).toBe('trend_following')
    expect(r.confidence).toBeGreaterThanOrEqual(70) // 50 + 20 (+10 if ADX > 30)
  })

  it('vol spike → crisis, and crisis blocks both strategy hints', () => {
    // First 45 bars near-flat; last 20 violent → vol20/vol60 > 1.5
    const closes: number[] = []
    let level = 100
    for (let i = 0; i < 65; i++) {
      level *= i < 45 ? 1.0005 : i % 2 === 0 ? 1.05 : 0.95
      closes.push(level)
    }
    const choppy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1))
    const r = detectRegime(closes, bars(choppy, 0.2))
    expect(r.volatilityRegime).toBe('crisis')
    expect(r.volRatio!).toBeGreaterThan(1.5)
    expect(r.strategyHint).toBe('neutral')
  })

  it('steady vol + range-bound ADX → mean_reversion', () => {
    // Homogeneous mild noise: vol20 ≈ vol60 → normal
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i * 1.3) * 0.6)
    const r = detectRegime(closes, bars(closes, 0.1))
    expect(r.volatilityRegime).toBe('normal')
    expect(r.volRatio!).toBeGreaterThan(0.8)
    expect(r.volRatio!).toBeLessThan(1.2)
    expect(r.trendRegime).toBe('range_bound')
    expect(r.adxValue!).toBeLessThan(15)
    expect(r.strategyHint).toBe('mean_reversion')
    // 50 + 10 (range) + 10 (normal vol) + 10 (ADX < 12) — allow either ADX tier
    expect(r.confidence).toBeGreaterThanOrEqual(70)
    expect(r.confidence).toBeLessThanOrEqual(80)
  })

  // Q-078 wave 2: exact-value pins (probe-verified) — the first measurement
  // left 58 survivors here because the assertions above are range-based.
  it('EXACT pins: ratios, ADX, and the confidence arithmetic', () => {
    // low-vol fixture: constant-growth tail → identical log returns → vol20 = 0
    const a: number[] = []
    let l = 100
    for (let i = 0; i < 65; i++) { l *= i < 45 ? (i % 2 === 0 ? 1.03 : 0.97) : 1.0005; a.push(l) }
    const trend = Array.from({ length: 60 }, (_, i) => 100 + i * 2)
    const r1 = detectRegime(a, bars(trend, 0.3))
    expect(r1.volRatio!).toBeCloseTo(0, 12) // constant-growth tail → vol20 ~ 0 (FP residue ~1e-17)
    expect(r1.adxValue).toBeCloseTo(100, 8) // one-directional bars saturate ADX
    expect(r1.confidence).toBe(80) // 50 + 20 strong + 10 adx>30

    const b: number[] = []
    l = 100
    for (let i = 0; i < 65; i++) { l *= i < 45 ? 1.0005 : i % 2 === 0 ? 1.05 : 0.95; b.push(l) }
    const choppy = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1))
    const r2 = detectRegime(b, bars(choppy, 0.2))
    expect(r2.volRatio!).toBeCloseTo(1.76145659, 6)
    expect(r2.confidence).toBe(65) // 50 + 20 strong − 15 crisis + 10 adx>30

    const c = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i * 1.3) * 0.6)
    const r3 = detectRegime(c, bars(c, 0.1))
    expect(r3.volRatio!).toBeCloseTo(0.99921663, 6)
    expect(r3.adxValue!).toBeCloseTo(7.79745942, 6)
    expect(r3.confidence).toBe(80) // 50 + 10 range + 10 normal + 10 adx<12
  })
})

// ─── constants — SSOT value pins ─────────────────────────────────────────────

describe('quant constants — SSOT pins', () => {
  it('documented values hold', () => {
    expect(BACKTEST_RFR_ANNUAL).toBe(0.045)
    expect(OPTIONS_RFR_ANNUAL).toBe(0.0525)
    expect(DEFAULT_SORTINO_MAR_DAILY).toBe(0)
    expect(TRADING_DAYS_EQUITIES).toBe(252)
    expect(TRADING_DAYS_CRYPTO).toBe(365)
    expect(OPTIONS_DAYS_PER_YEAR).toBe(365)
    expect(DEFAULT_TX_COST_BPS_PER_SIDE).toBe(11)
  })
})
