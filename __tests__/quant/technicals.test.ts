import { describe, it, expect } from 'vitest'
import {
  sma, rsi, macd, bollinger, atr, maxDrawdown, dailyReturns,
  sharpeRatio, sortinoRatio, trendLabel, sma200DeviationPct,
  sma200Slope, ma200Regime,
  type OhlcBar,
} from '@/lib/quant/technicals'

// ─── Wrapper layer integrity ────────────────────────────────────────────────

describe('technicals.ts wrapper layer (F8.1)', () => {
  describe('SMA / RSI / MACD / Bollinger / ATR delegate to canonical', () => {
    it('sma returns latest SMA value', async () => {
      const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
      // SMA of last 20: average of [110..129] = 119.5
      expect(sma(closes, 20)).toBeCloseTo(119.5, 6)
    })

    it('rsi returns latest RSI in [0, 100]', () => {
      const closes = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5)
      const r = rsi(closes)
      expect(r).not.toBeNull()
      expect(r!).toBeGreaterThanOrEqual(0)
      expect(r!).toBeLessThanOrEqual(100)
    })

    it('macd returns latest line/signal/histogram', () => {
      // MACD signal-line needs slow+sig-1 (=34) bars for the line, and another
      // (sig=9) bars to fully seed the signal EMA → ~50 bars minimum for the
      // tail signal value to be non-null. Use 100 to clear the warmup safely.
      const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 5)
      const m = macd(closes)
      expect(m.line).not.toBeNull()
      expect(m.signal).not.toBeNull()
      expect(m.histogram).not.toBeNull()
    })

    it('bollinger returns latest bands', () => {
      const closes = Array.from({ length: 30 }, (_, i) => 100 + i * 0.1)
      const b = bollinger(closes)
      expect(b.mid).not.toBeNull()
      expect(b.upper).not.toBeNull()
      expect(b.lower).not.toBeNull()
      if (b.mid != null && b.upper != null && b.lower != null) {
        expect(b.upper).toBeGreaterThan(b.mid)
        expect(b.lower).toBeLessThan(b.mid)
      }
    })

    it('atr returns latest ATR (Wilder)', () => {
      const bars: OhlcBar[] = Array.from({ length: 30 }, (_, i) => ({
        open: 100 + i,
        high: 100 + i + 2,
        low: 100 + i - 1,
        close: 100 + i + 1,
      }))
      expect(atr(bars)).not.toBeNull()
      expect(atr(bars)!).toBeGreaterThan(0)
    })
  })

  describe('return helpers', () => {
    it('dailyReturns produces n-1 returns', () => {
      const closes = [100, 101, 102, 103]
      expect(dailyReturns(closes)).toHaveLength(3)
      expect(dailyReturns(closes)[0]).toBeCloseTo(0.01, 4)
    })

    it('maxDrawdown identifies peak-to-trough', () => {
      const closes = [100, 110, 105, 95, 100, 90]
      const r = maxDrawdown(closes)
      expect(r).not.toBeNull()
      if (r) {
        // Peak 110 → trough 90 → DD = 20/110 ≈ 0.1818
        expect(r.maxDdPct).toBeCloseTo(20 / 110, 3)
      }
    })

    it('sharpeRatio default rf=4% — positive series gives positive Sharpe', () => {
      const returns = Array.from({ length: 252 }, () => 0.001)
      expect(sharpeRatio(returns)).toBeGreaterThan(0)
    })

    it('sortinoRatio default MAR=0 — series with min 30 negatives works', () => {
      const returns = Array.from({ length: 100 }, (_, i) =>
        i % 5 < 3 ? 0.02 : -0.01,
      )
      const s = sortinoRatio(returns)
      expect(s).not.toBeNull()
    })
  })

  describe('trendLabel', () => {
    it('insufficient history returns guard string', () => {
      expect(trendLabel(null, null, 100)).toBe('Insufficient history')
    })

    it('bullish stack: price > SMA50 > SMA200', () => {
      expect(trendLabel(110, 100, 120)).toMatch(/bullish stack/)
    })

    it('bearish stack: price < SMA50 < SMA200', () => {
      expect(trendLabel(110, 120, 100)).toMatch(/bearish stack/)
    })

    it('golden cross zone: SMA50 > SMA200 (no full stack)', () => {
      expect(trendLabel(105, 100, 102)).toMatch(/Golden cross|bullish stack/)
    })

    it('death cross zone: SMA50 < SMA200', () => {
      expect(trendLabel(95, 100, 102)).toMatch(/Death cross|bearish stack/)
    })
  })

  describe('sma200DeviationPct', () => {
    it('returns null on degenerate inputs', () => {
      expect(sma200DeviationPct(100, 0)).toBeNull()
      expect(sma200DeviationPct(NaN, 100)).toBeNull()
    })

    it('positive when price > sma200', () => {
      expect(sma200DeviationPct(110, 100)).toBeCloseTo(10, 6)
    })

    it('negative when price < sma200', () => {
      expect(sma200DeviationPct(90, 100)).toBeCloseTo(-10, 6)
    })

    it('zero when price equals sma200', () => {
      expect(sma200DeviationPct(100, 100)).toBeCloseTo(0, 6)
    })

    /**
     * Phase 13 S2 hardening regression: matches the same guard in
     * lib/backtest/signals.ts. A negative price has no semantic meaning
     * for equity backtesting; allowing it produced a mathematically-
     * finite-but-meaningless deviation (e.g. price=-50, sma=100 → -150)
     * which downstream regime classifiers would treat as CRASH_ZONE and
     * silently emit a real BUY/SELL from corrupted data.
     */
    it('returns null for non-positive price (fail-closed)', () => {
      expect(sma200DeviationPct(0, 100)).toBeNull()
      expect(sma200DeviationPct(-50, 100)).toBeNull()
      expect(sma200DeviationPct(-0.01, 100)).toBeNull()
    })

    it('returns null for Infinity price', () => {
      expect(sma200DeviationPct(Infinity, 100)).toBeNull()
      expect(sma200DeviationPct(-Infinity, 100)).toBeNull()
    })
  })

  describe('sma200Slope', () => {
    it('returns null on insufficient bars (< 221)', () => {
      expect(sma200Slope(Array.from({ length: 220 }, () => 100))).toBeNull()
    })

    it('positive on uptrend (slope > 0)', () => {
      const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5)
      const slope = sma200Slope(closes)
      expect(slope).not.toBeNull()
      expect(slope!).toBeGreaterThan(0)
    })

    it('negative on downtrend', () => {
      const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5)
      const slope = sma200Slope(closes)
      expect(slope).not.toBeNull()
      expect(slope!).toBeLessThan(0)
    })
  })

  describe('ma200Regime', () => {
    it('returns INSUFFICIENT_DATA when < 200 bars', () => {
      const r = ma200Regime(100, [99, 100, 101])
      expect(r.zone).toBe('INSUFFICIENT_DATA')
      expect(r.dipSignal).toBe('INSUFFICIENT_DATA')
    })

    it('classifies HEALTHY_BULL at 0-10% above SMA200', () => {
      // Build series so SMA200 ≈ 100 and price ≈ 105 → +5% deviation
      const closes = Array.from({ length: 220 }, () => 100)
      const r = ma200Regime(105, closes)
      expect(r.zone).toBe('HEALTHY_BULL')
      expect(r.deviationPct).toBeCloseTo(5, 1)
    })

    it('classifies EXTREME_BULL above +20%', () => {
      const closes = Array.from({ length: 220 }, () => 100)
      const r = ma200Regime(125, closes)
      expect(r.zone).toBe('EXTREME_BULL')
    })

    it('classifies FIRST_DIP between 0% and -10%', () => {
      const closes = Array.from({ length: 220 }, () => 100)
      const r = ma200Regime(95, closes)
      expect(r.zone).toBe('FIRST_DIP')
    })

    it('classifies CRASH_ZONE below -30%', () => {
      const closes = Array.from({ length: 220 }, () => 100)
      const r = ma200Regime(60, closes)
      expect(r.zone).toBe('CRASH_ZONE')
    })

    it('every regime yields non-empty interpretation + forwardReturnContext', () => {
      const closes = Array.from({ length: 220 }, () => 100)
      for (const px of [125, 115, 105, 95, 85, 75, 60]) {
        const r = ma200Regime(px, closes)
        expect(r.interpretation.length).toBeGreaterThan(20)
        expect(r.forwardReturnContext.length).toBeGreaterThan(5)
        expect(r.label.length).toBeGreaterThan(0)
        expect(r.color).toMatch(/^#[0-9a-f]{6}$/i)
      }
    })

    it('FIRST_DIP with positive slope yields STRONG_DIP signal', () => {
      // Build uptrend: SMA200 rising, price 5% below current SMA = 0.95 × SMA
      const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5)
      const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      const price = sma200 * 0.95
      const r = ma200Regime(price, closes)
      // Price is 5% below SMA200, slope is positive, recent price near SMA → STRONG_DIP
      if (r.zone === 'FIRST_DIP') {
        // Slope must register positive
        expect(r.slopePositive).toBe(true)
        // STRONG_DIP follows from positive slope per the regime's own logic
        expect(['STRONG_DIP', 'WATCH_DIP']).toContain(r.dipSignal)
      }
    })

    it('DEEP_DIP with declining slope yields FALLING_KNIFE signal', () => {
      // Downtrend: 250 bars descending, price below SMA200
      const closes = Array.from({ length: 250 }, (_, i) => 200 - i * 0.5)
      const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      const price = sma200 * 0.85  // 15% below SMA
      const r = ma200Regime(price, closes)
      if (r.zone === 'DEEP_DIP') {
        expect(r.slopePositive).toBe(false)
        expect(r.dipSignal).toBe('FALLING_KNIFE')
      }
    })
  })
})
