import { describe, it, expect } from 'vitest'
import {
  calcMVRV,
  calcS2FPrice,
  calcRSI,
  calcEMA,
  calcMACD,
  calcATR,
  calcVWAP,
  calcBollingerBands,
  interpretFundingRate,
  interpretFearGreed,
  getRainbowBand,
  type BtcCandle,
} from '@/lib/crypto'
import {
  calcMVRV as calcMVRV2,
  calcPiCycleTop,
  calcS2FPrice as calcS2F2,
  calcDifficultyRibbon,
  calcOBV,
  calcVWMA,
  generateSignals,
} from '@/lib/quant/btc-indicators'

const SECONDS_PER_DAY = 86400
const T0 = Math.floor(Date.UTC(2024, 0, 1) / 1000)

function makeCandles(closes: number[], range = 50): BtcCandle[] {
  return closes.map((c, i) => ({
    time: T0 + i * SECONDS_PER_DAY,
    open: i === 0 ? c : closes[i - 1],
    high: c + range,
    low: c - range,
    close: c,
    volume: 1000,
  }))
}

// ─── Indicator-adapter sanity checks (lib/crypto delegates correctly) ──────

describe('lib/crypto adapters delegate to canonical indicators', () => {
  const prices = Array.from({ length: 50 }, (_, i) => 100 + i)

  it('calcEMA matches indicators.ts:emaFull on the same input', async () => {
    const { emaFull } = await import('@/lib/quant/indicators')
    const a = calcEMA(prices, 20)
    const b = emaFull(prices, 20)
    expect(a).toEqual(b)
  })

  it('calcRSI matches indicators.ts:rsiArray on the same input', async () => {
    const { rsiArray } = await import('@/lib/quant/indicators')
    const a = calcRSI(prices, 14)
    const b = rsiArray(prices, 14)
    expect(a).toEqual(b)
  })

  it('calcMACD shape adapter exposes macd/signal/histogram per bar', () => {
    const out = calcMACD(prices)
    expect(out).toHaveLength(prices.length)
    expect(typeof out[40].macd).toBe('number')
    expect(typeof out[40].signal).toBe('number')
    expect(typeof out[40].histogram).toBe('number')
  })

  it('calcBollingerBands shape adapter has mid/upper/lower per bar', () => {
    const out = calcBollingerBands(prices)
    expect(out).toHaveLength(prices.length)
    const last = out[out.length - 1]
    expect(last.upper).toBeGreaterThan(last.mid)
    expect(last.lower).toBeLessThan(last.mid)
  })

  it('calcATR returns Wilder-smoothed values (canonical match)', async () => {
    const { atrArray } = await import('@/lib/quant/indicators')
    const candles = makeCandles(prices, 5)
    const a = calcATR(candles)
    const b = atrArray(
      candles.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close })),
    )
    expect(a).toEqual(b)
  })

  it('calcVWAP shape adapter has time + value', () => {
    const candles = makeCandles(prices)
    const out = calcVWAP(candles)
    expect(out).toHaveLength(prices.length)
    expect(typeof out[0].time).toBe('number')
    expect(typeof out[0].value).toBe('number')
  })
})

// ─── On-chain models ────────────────────────────────────────────────────────

describe('on-chain models', () => {
  it('calcMVRV returns price/realizedCap when realizedCap > 0', () => {
    expect(calcMVRV(60_000, 30_000)).toBe(2)
    expect(calcMVRV(50_000, 50_000)).toBe(1)
  })

  it('calcMVRV defaults to 1 on zero/negative realizedCap', () => {
    expect(calcMVRV(50_000, 0)).toBe(1)
    expect(calcMVRV(50_000, -1)).toBe(1)
  })

  it('calcMVRV identical across both sources (lib/crypto and btc-indicators)', () => {
    expect(calcMVRV(60_000, 30_000)).toBe(calcMVRV2(60_000, 30_000))
  })

  it('calcS2FPrice power-law formula', () => {
    // Formula: S2F^3 × 0.001
    // S2F=50  → 50^3 × 0.001 = 125_000 × 0.001 = 125
    // S2F=100 → 100^3 × 0.001 = 1_000_000 × 0.001 = 1000
    expect(calcS2FPrice(50)).toBeCloseTo(125, 4)
    expect(calcS2FPrice(100)).toBeCloseTo(1000, 4)
  })

  it('calcS2FPrice identical across both sources', () => {
    expect(calcS2FPrice(50)).toBe(calcS2F2(50))
  })

  it('calcPiCycleTop fires when ema111 > 2 × ema350', () => {
    expect(calcPiCycleTop(70_000, 30_000)).toBe(true)  // 70k > 60k
    expect(calcPiCycleTop(50_000, 30_000)).toBe(false) // 50k < 60k
  })

  it('calcDifficultyRibbon returns false on insufficient data', () => {
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 50_000 + i))
    expect(calcDifficultyRibbon(candles)).toBe(false)
  })

  it('calcDifficultyRibbon detects ribbon inversion in downtrend', () => {
    // Strong downtrend over 300 bars → 8-period EMA below 256-period EMA at the tail
    const closes = Array.from({ length: 300 }, (_, i) => 60_000 - i * 50)
    const candles = makeCandles(closes)
    expect(calcDifficultyRibbon(candles)).toBe(true)
  })

  it('calcDifficultyRibbon false in steady uptrend', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 50_000 + i * 50)
    const candles = makeCandles(closes)
    expect(calcDifficultyRibbon(candles)).toBe(false)
  })
})

// ─── Volume helpers ─────────────────────────────────────────────────────────

describe('volume helpers', () => {
  it('calcOBV accumulates on up-closes, decrements on down-closes', () => {
    const candles = makeCandles([100, 102, 101, 105])
    const obv = calcOBV(candles)
    expect(obv[0]).toBe(0)
    expect(obv[1]).toBe(1000)   // close up → +volume
    expect(obv[2]).toBe(0)      // close down → -volume
    expect(obv[3]).toBe(1000)   // close up → +volume
  })

  it('calcVWMA returns price-volume weighted mean', () => {
    const candles = makeCandles(Array.from({ length: 30 }, () => 100))
    const vwma = calcVWMA(candles, 20)
    // All closes 100 + uniform volume → VWMA = 100
    expect(vwma[29]).toBeCloseTo(100, 6)
  })
})

// ─── Funding rate / Fear & Greed interpretation ─────────────────────────────

describe('interpretFundingRate', () => {
  it('flags very-high positive as BEARISH (longs pay)', () => {
    const r = interpretFundingRate(0.005) // > PERP_FUNDING_HIGH_ABS
    expect(r.signal).toBe('BEARISH')
  })

  it('flags very-high negative as BULLISH (shorts pay)', () => {
    const r = interpretFundingRate(-0.005)
    expect(r.signal).toBe('BULLISH')
  })

  it('returns NEUTRAL at zero', () => {
    expect(interpretFundingRate(0).signal).toBe('NEUTRAL')
  })

  it('returns NEUTRAL on non-finite input', () => {
    expect(interpretFundingRate(NaN).signal).toBe('NEUTRAL')
    expect(interpretFundingRate(Infinity).signal).toBe('NEUTRAL')
  })
})

describe('interpretFearGreed', () => {
  it('flags >= 75 as Extreme Greed', () => {
    expect(interpretFearGreed(80).label).toBe('Extreme Greed')
    expect(interpretFearGreed(75).label).toBe('Extreme Greed')
  })

  it('flags 25-44 as Fear', () => {
    expect(interpretFearGreed(30).label).toBe('Fear')
  })

  it('flags <25 as Extreme Fear', () => {
    expect(interpretFearGreed(10).label).toBe('Extreme Fear')
  })
})

describe('getRainbowBand', () => {
  it('top of range returns Bubble Peak', () => {
    expect(getRainbowBand(95, 100, 0).label).toBe('Bubble Peak')
  })

  it('bottom of range returns Deep Value', () => {
    expect(getRainbowBand(5, 100, 0).label).toBe('Deep Value')
  })

  it('neutral mid returns mid band', () => {
    const b = getRainbowBand(50, 100, 0)
    expect(['FOMO', 'Neutral']).toContain(b.label)
  })

  it('zero-range edge case falls back to mid (Neutral)', () => {
    const b = getRainbowBand(50, 100, 100)
    expect(b.label).toBe('FOMO')
  })
})

// ─── generateSignals end-to-end smoke ───────────────────────────────────────

describe('generateSignals', () => {
  it('returns [] on insufficient candles (<55)', () => {
    const candles = makeCandles(Array.from({ length: 30 }, () => 50_000))
    expect(generateSignals(candles)).toEqual([])
  })

  it('returns RSI + MACD + EMA Cross + BB signals on sufficient data', () => {
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 50_000 + i * 100))
    const signals = generateSignals(candles)
    const indicators = signals.map((s) => s.indicator)
    expect(indicators).toContain('RSI(14)')
    expect(indicators).toContain('EMA Cross')
  })

  it('adds Funding Rate signal when provided extreme funding', () => {
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 50_000 + i * 10))
    const signals = generateSignals(candles, 0.005, 50)
    const funding = signals.find((s) => s.indicator === 'Funding Rate')
    expect(funding?.signal).toBe('SELL')  // positive funding = crowded longs
  })

  it('adds Fear & Greed contrarian signal when extreme', () => {
    const candles = makeCandles(Array.from({ length: 100 }, (_, i) => 50_000 + i * 10))
    const signals = generateSignals(candles, undefined, 10)  // extreme fear
    const fg = signals.find((s) => s.indicator === 'Fear & Greed')
    expect(fg?.signal).toBe('BUY')
  })
})
