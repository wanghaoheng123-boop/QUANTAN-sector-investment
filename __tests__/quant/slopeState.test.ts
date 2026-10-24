/**
 * Q153-C11 — the 200-day average's 20-day change in three states, with the
 * classifier's own threshold, so the chip and the classification cannot
 * disagree about "rising".
 */
import { describe, expect, it } from 'vitest'
import { MA200_RISING_THRESHOLD, describeRegime, formatSlopePct, ma200Regime, slopeSignText, slopeState, slopeText } from '@/lib/quant/technicals'

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

// Q153-R2-14: at two decimals 0.00504 ("rising") and 0.00496 ("flat") both print
// "+0.50%", so two rows could show the same number with different states.
describe('formatSlopePct — a value is never printed AS the threshold from the wrong side of it', () => {
  it('two decimals away from the threshold, and the sign only where there is one', () => {
    expect(formatSlopePct(0.0078)).toBe('+0.78%')
    expect(formatSlopePct(-0.0081)).toBe('-0.81%')
    expect(formatSlopePct(0)).toBe('0.00%')
    expect(formatSlopePct(0.0019)).toBe('+0.19%')
  })

  it('adds the decimals that tell a value from the threshold it rounds onto', () => {
    expect(slopeText(0.00504)).toBe('▲ rising +0.504% / 20d')
    expect(slopeText(0.00496)).toBe('● flat +0.496% / 20d (within ±0.5%)')
    expect(slopeText(-0.00504)).toBe('▼ falling -0.504% / 20d')
    expect(slopeText(-0.00496)).toBe('● flat -0.496% / 20d (within ±0.5%)')
    // Three decimals still collide for these two, so it goes on.
    expect(formatSlopePct(0.0050004)).toBe('+0.50004%')
    expect(formatSlopePct(0.0049996)).toBe('+0.49996%')
  })

  it('a value exactly at the threshold is flat and keeps two decimals', () => {
    expect(slopeState(0.005)).toBe('flat')
    expect(slopeText(0.005)).toBe('● flat +0.50% / 20d (within ±0.5%)')
    expect(slopeText(-0.005)).toBe('● flat -0.50% / 20d (within ±0.5%)')
  })

  it('across the threshold, no printed number belongs to two states', () => {
    const statesByText = new Map<string, Set<string>>()
    for (let k = 4900; k <= 5100; k++) {
      const slope = k / 1e6
      const text = formatSlopePct(slope)
      statesByText.set(text, (statesByText.get(text) ?? new Set()).add(String(slopeState(slope))))
    }
    for (const [text, states] of statesByText) expect([...states], text).toHaveLength(1)
    // Away from the edge two decimals merge neighbours, which is fine; the edge is where they must not.
    expect(statesByText.has('+0.50%')).toBe(true)
    expect([...statesByText.get('+0.50%')!]).toEqual(['flat'])
  })

  it('stops adding decimals at the cap rather than looping', () => {
    expect(formatSlopePct(0.005000000001)).toBe('+0.500000%')
  })

  it('slopeText and describeRegime print the same number for the same slope', () => {
    for (const slope of [0.00504, 0.00496, -0.00504, 0.005, 0.0078, 0.0019, -0.0081, 0]) {
      const number = formatSlopePct(slope)
      expect(slopeText(slope), String(slope)).toContain(number)
      expect(describeRegime(-5, slope, slope > MA200_RISING_THRESHOLD), String(slope)).toContain(`the average moved ${number} over 20 days`)
    }
    expect(describeRegime(-5, 0.00504, true)).toContain('+0.504% over 20 days (rising by')
    expect(describeRegime(-5, 0.00496, false)).toContain('+0.496% over 20 days (not rising by')
  })
})

// Q153-R2-11: the ±0.5% band is defined for 20 DAYS of a 200-DAY average.
describe('slopeSignText — bars that are not daily get the sign and the value, and no state', () => {
  it('prints the glyph for the sign, the value and the window', () => {
    expect(slopeSignText(0.003, '20 bars')).toBe('▲ +0.30% / 20 bars')
    expect(slopeSignText(-0.0081, '20 bars')).toBe('▼ -0.81% / 20 bars')
    expect(slopeSignText(0, '20 bars')).toBe('0.00% / 20 bars')
    expect(slopeSignText(null, '20 bars')).toBe('—')
    expect(slopeSignText(Number.NaN, '20 bars')).toBe('—')
  })

  it('names no state and no band, even right on the daily threshold', () => {
    for (const slope of [0.003, 0.00504, 0.00496, -0.0081, 0.005, 0]) {
      expect(slopeSignText(slope, '20 bars'), String(slope)).not.toMatch(/rising|flat|falling|within|±/)
    }
    // No threshold is shown, so no extra decimals either.
    expect(slopeSignText(0.00504, '20 bars')).toBe('▲ +0.50% / 20 bars')
  })
})
