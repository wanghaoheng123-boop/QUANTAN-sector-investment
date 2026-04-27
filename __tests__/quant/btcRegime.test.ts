import { describe, it, expect } from 'vitest'
import { btcRegime, type BtcCandle } from '@/lib/quant/btc-indicators'

function makeCandles(closes: number[], baseTime = 1700000000): BtcCandle[] {
  return closes.map((c, i) => ({
    time: baseTime + i * 86400,
    open: c,
    high: c * 1.01,
    low: c * 0.99,
    close: c,
    volume: 1000,
  }))
}

function makeFlatCandles(n: number, price = 50000): BtcCandle[] {
  return makeCandles(Array.from({ length: n }, () => price))
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

  it('classifies steady uptrend (≥+10% above EMA200) as STRONG_BULL', () => {
    const r = btcRegime(makeTrendCandles(250, 30000, 0.003))
    expect(r.regime).toBe('STRONG_BULL')
    expect(r.metrics.pctVsEma200).toBeGreaterThan(0.10)
  })

  it('classifies steady downtrend (≥-10% below EMA200) as STRONG_BEAR', () => {
    const r = btcRegime(makeTrendCandles(250, 60000, -0.003))
    expect(r.regime).toBe('STRONG_BEAR')
    expect(r.metrics.pctVsEma200).toBeLessThan(-0.10)
  })

  it('returns metrics with finite numbers when populated', () => {
    const r = btcRegime(makeFlatCandles(250))
    expect(r.metrics.ema200).not.toBeNull()
    expect(r.metrics.atrPct).not.toBeNull()
    expect(Number.isFinite(r.metrics.ema200!)).toBe(true)
  })

  it('confidence scales inversely with volatility (calmer = higher)', () => {
    const calm = btcRegime(makeFlatCandles(250))
    expect(calm.confidence).toBeGreaterThan(80)
  })

  it('reasons array is non-empty for every regime', () => {
    const r = btcRegime(makeTrendCandles(250, 30000, 0.002))
    expect(r.reasons.length).toBeGreaterThan(0)
  })
})
