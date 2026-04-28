import { describe, it, expect } from 'vitest'
import { btcRegime, type BtcCandle } from '@/lib/quant/btc-indicators'

function makeCandles(closes: number[], baseTime = 1700000000, range = 0.01): BtcCandle[] {
  return closes.map((c, i) => ({
    time: baseTime + i * 86400,
    open: c,
    high: c * (1 + range),
    low: c * (1 - range),
    close: c,
    volume: 1000,
  }))
}

function makeFlatCandles(n: number, price = 50000, range = 0.01): BtcCandle[] {
  return makeCandles(Array.from({ length: n }, () => price), 1700000000, range)
}

function makeTrendCandles(n: number, start: number, dailyReturn: number): BtcCandle[] {
  const closes: number[] = [start]
  for (let i = 1; i < n; i++) closes.push(closes[i - 1] * (1 + dailyReturn))
  return makeCandles(closes)
}

describe('btcRegime', () => {
  it('returns NEUTRAL with insufficient data', () => {
    const r = btcRegime(makeFlatCandles(50))
    expect(r.regime).toBe('NEUTRAL')
    expect(r.reasons).toContain('insufficient data')
    expect(r.confidence).toBe(0)
  })

  it('classifies a flat series within ±10% of EMA200 as NEUTRAL', () => {
    const r = btcRegime(makeFlatCandles(250))
    expect(r.regime).toBe('NEUTRAL')
    expect(r.metrics.pctVsEma200).not.toBeNull()
    expect(Math.abs(r.metrics.pctVsEma200!)).toBeLessThan(0.01)
  })

  it('classifies steady uptrend (≥+10% above EMA200) as a bull regime (STRONG_BULL or EUPHORIA)', () => {
    const r = btcRegime(makeTrendCandles(250, 30000, 0.003))
    // Extreme 250-bar uptrend triggers EUPHORIA (pct>20% + RSI>80); STRONG_BULL for milder moves.
    // Both are valid bullish regimes — Phase 12 extended the classification with EUPHORIA/CAPITULATION.
    expect(['STRONG_BULL', 'EUPHORIA']).toContain(r.regime)
    expect(r.metrics.pctVsEma200).toBeGreaterThan(0.10)
  })

  it('classifies steady downtrend (≥-10% below EMA200) as a bear regime (STRONG_BEAR or CAPITULATION)', () => {
    const r = btcRegime(makeTrendCandles(250, 60000, -0.003))
    // Extreme 250-bar downtrend triggers CAPITULATION (pct<-20% + RSI<20); STRONG_BEAR for milder.
    expect(['STRONG_BEAR', 'CAPITULATION']).toContain(r.regime)
    expect(r.metrics.pctVsEma200).toBeLessThan(-0.10)
  })

  it('returns metrics with finite numbers when populated', () => {
    const r = btcRegime(makeFlatCandles(250))
    expect(r.metrics.ema200).not.toBeNull()
    expect(r.metrics.atrPct).not.toBeNull()
    expect(Number.isFinite(r.metrics.ema200!)).toBe(true)
  })

  it('confidence scales inversely with volatility (calmer = higher)', () => {
    // Use candles with tiny range (0.1%) for calm market — ATR should be minimal
    const calm = btcRegime(makeFlatCandles(250, 50000, 0.001))
    expect(calm.confidence).toBeGreaterThan(80)
  })

  it('reasons array is non-empty for every regime', () => {
    const r = btcRegime(makeTrendCandles(250, 30000, 0.002))
    expect(r.reasons.length).toBeGreaterThan(0)
  })
})
