/**
 * Q153-C11 — the 200-day average's 20-day change in three states, with the
 * classifier's own threshold, so the chip and the classification cannot
 * disagree about "rising".
 */
import { describe, expect, it } from 'vitest'
import { MA200_RISING_THRESHOLD, ma200Regime, slopeState, slopeText } from '@/lib/quant/technicals'

describe('slopeState / slopeText', () => {
  it('rising is exactly the classifier\'s test; falling is its mirror; between is flat', () => {
    expect(MA200_RISING_THRESHOLD).toBe(0.005)
    expect(slopeState(0.0051)).toBe('rising')
    expect(slopeState(0.005)).toBe('flat')
    expect(slopeState(0.0019)).toBe('flat') // the +0.19% average that read "▲ up" (2026-10-17)
    expect(slopeState(0)).toBe('flat')
    expect(slopeState(-0.005)).toBe('flat')
    expect(slopeState(-0.0051)).toBe('falling')
    expect(slopeState(null)).toBeNull()
    expect(slopeState(Number.NaN)).toBeNull()
  })

  it('agrees with ma200Regime: "rising" exactly when the classifier says slopePositive', () => {
    for (const step of [0.0, 0.002, 0.004, 0.006, 0.01, 0.05, 0.2, -0.05]) {
      const closes = Array.from({ length: 260 }, (_, i) => 100 + i * step)
      const r = ma200Regime(closes[closes.length - 1] * 0.95, closes)
      expect(slopeState(r.slopePct) === 'rising', `step ${step}`).toBe(r.slopePositive === true)
    }
  })

  it('says the state, the measured value and the band', () => {
    expect(slopeText(0.0078)).toBe('▲ rising +0.78% / 20d')
    expect(slopeText(0.0019)).toBe('● flat +0.19% / 20d (within ±0.5%)')
    expect(slopeText(-0.0081)).toBe('▼ falling -0.81% / 20d')
    expect(slopeText(0.0019, '20 bars')).toBe('● flat +0.19% / 20 bars (within ±0.5%)')
    expect(slopeText(null)).toBe('—')
  })
})
