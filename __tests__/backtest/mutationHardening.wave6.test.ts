/**
 * Q-075 wave 6 (2026-07-26) — the `sectorGates` path of enhancedCombinedSignal.
 *
 * The 2026-07-22 and 2026-07-26 stryker runs BOTH scored the backtest shard at
 * exactly 69.99 — deterministic, and 0.01pp under the 70.00 break threshold
 * (~1 mutant of 2619). The single largest untested block in the shard is
 * signals.ts's Loop-1/2 `sectorGates` branch: 30 NO-COVERAGE mutants spanning
 * the three score bonuses (lines 204-213), the sector gate filters (243-255),
 * and the post-gate SELL re-check (258-259). Production runs the regime-only
 * path (`sectorGates === undefined`), so nothing ever exercised it.
 *
 * The unlock for reaching the gate filters at all: `buyWScoreThreshold` is
 * itself a sectorGates override, so setting it below the fixture's weighted
 * score keeps `action === 'BUY'` alive into the filter block, which is where
 * the untested code lives.
 *
 * All pins are CHARACTERIZATION goldens from the shipped implementation on
 * deterministic fixtures. The bonus assertions are stated as exact DELTAS
 * between a gated and un-gated run of the same fixture, so a mutated bonus
 * constant (0.15 / 0.20 / 0.10) shifts a pinned value.
 */
import { describe, it, expect } from 'vitest'
import { enhancedCombinedSignal } from '@/lib/backtest/signals'
import {
  isGoldenCross,
  hasPositiveMomentum,
  isMACompression,
  detectBullishDivergence,
  detectVolumeClimax,
} from '@/lib/backtest/signalHelpers'
import { rsiArray } from '@/lib/quant/indicators'
import type { OhlcBar, OhlcvBar } from '@/lib/quant/indicators'
import type { SectorGateConfig } from '@/lib/backtest/signalTypes'

// ─── deterministic fixtures ─────────────────────────────────────────────────

function toBars(closes: number[]): OhlcBar[] {
  return closes.map((c, i) => ({ open: i === 0 ? c : closes[i - 1], high: c + 2, low: c - 2, close: c }))
}

function toOhlcv(closes: number[]): (OhlcvBar & { time: number })[] {
  const date = new Date('2020-01-02')
  return closes.map((c, i) => {
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1)
    const time = Math.floor(date.getTime() / 1000)
    date.setUTCDate(date.getUTCDate() + 1)
    return {
      open: i === 0 ? c : closes[i - 1], high: c + 2, low: c - 2, close: c,
      volume: 1_000_000 + Math.sin(i) * 100_000, time,
    }
  })
}

/** Rising trend (positive 200SMA slope, price recently near SMA) with a tail dip. */
function risingDip(n: number, slope: number, dipPct: number, dipBars: number): number[] {
  const out = Array.from({ length: n }, (_, i) => 100 + slope * i)
  const base = out[n - dipBars - 1]
  for (let i = n - dipBars; i < n; i++) {
    const t = (i - (n - dipBars) + 1) / dipBars
    out[i] = base * (1 - dipPct * t)
  }
  return out
}

/** FIRST_DIP / STRONG_DIP regime BUY; goldenCross true, momentum false, MA compression true. */
const DIP = risingDip(260, 0.1, 0.15, 20)

function run(closes: number[], gates?: SectorGateConfig, ohlcvOverride?: (OhlcvBar & { time: number })[]) {
  return enhancedCombinedSignal(
    'TST', '2026-01-01', closes[closes.length - 1],
    closes, toBars(closes), ohlcvOverride ?? toOhlcv(closes), {}, gates,
  )
}

/** Keeps `action === 'BUY'` alive into the gate-filter block. */
const OPEN: SectorGateConfig = { buyWScoreThreshold: -1 }

// Weighted scores for DIP, pinned exactly (see the deltas asserted below).
const W_NO_GATES = -0.10637701246745752   // no sectorGates → no bonuses
const W_WITH_COMPRESSION = -0.0063770124674575185 // + MA-compression bonus (+0.10)

describe('enhancedCombinedSignal — sectorGates fixture preconditions', () => {
  it('DIP is a regime BUY with goldenCross true, momentum false, compression true', () => {
    expect(isGoldenCross(DIP)).toBe(true)
    expect(hasPositiveMomentum(DIP)).toBe(false)
    expect(isMACompression(DIP)).toBe(true)
    const s = run(DIP)
    expect(s.regime.zone).toBe('FIRST_DIP')
    expect(s.regime.dipSignal).toBe('STRONG_DIP')
    expect(s.regime.action).toBe('BUY')
  })
})

describe('sectorGates — Loop 1/2 score bonuses (exact deltas)', () => {
  it('MA-compression bonus adds exactly +0.10 when gates are present', () => {
    const bare = run(DIP)
    const gated = run(DIP, {})
    expect(bare.totalWeightedScore).toBeCloseTo(W_NO_GATES, 12)
    expect(gated.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION, 12)
    expect(gated.totalWeightedScore - bare.totalWeightedScore).toBeCloseTo(0.10, 12)
  })

  it('bullish-divergence bonus adds +0.15 (delta 0.25 alongside compression)', () => {
    const div = [...DIP]
    div[245] = div[244] * 0.93; div[246] = div[244] * 0.97
    div[255] = div[254] * 0.90; div[256] = div[254] * 0.96
    expect(detectBullishDivergence(div, rsiArray(div))).toBe(true)
    expect(isMACompression(div)).toBe(true)
    const bare = run(div)
    const gated = run(div, {})
    expect(bare.totalWeightedScore).toBeCloseTo(-0.13058689270401014, 12)
    expect(gated.totalWeightedScore).toBeCloseTo(0.11941310729598986, 12)
    // 0.15 (divergence) + 0.10 (compression)
    expect(gated.totalWeightedScore - bare.totalWeightedScore).toBeCloseTo(0.25, 12)
  })

  it('volume-climax bonus adds +0.20 (delta 0.30 alongside compression)', () => {
    const cl = [...DIP]
    cl[258] = cl[257]
    cl[259] = cl[258] * 0.95
    const ob = toOhlcv(cl)
    ob[258] = { ...ob[258], open: cl[257], high: cl[258] + 5, low: cl[258] - 20, close: cl[258], volume: 1_000_000 }
    ob[259] = { ...ob[259], open: cl[258], high: cl[258] + 1, low: cl[259] - 1, close: cl[259], volume: 10_000_000 }
    expect(detectVolumeClimax(ob)).toBe(true)
    expect(detectBullishDivergence(cl, rsiArray(cl))).toBe(false)
    expect(isMACompression(cl)).toBe(true)
    const bare = run(cl, undefined, ob)
    const gated = run(cl, {}, ob)
    expect(bare.totalWeightedScore).toBeCloseTo(-0.16666666666666666, 12)
    expect(gated.totalWeightedScore).toBeCloseTo(0.13333333333333336, 12)
    // 0.20 (climax) + 0.10 (compression)
    expect(gated.totalWeightedScore - bare.totalWeightedScore).toBeCloseTo(0.30, 12)
  })
})

describe('sectorGates — threshold overrides keep BUY alive', () => {
  it('buyWScoreThreshold below the score preserves the regime BUY', () => {
    const s = run(DIP, OPEN)
    expect(s.action).toBe('BUY')
    expect(s.confidence).toBe(90)
    expect(s.KellyFraction).toBeCloseTo(0.25, 12)
    expect(s.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION, 12)
    expect(s.reason).toBe(
      'FIRST_DIP [STRONG_DIP]: wScore -0.01. RSI(14) 1.00, BB% 0.80, Vol POC 0.80, Vol Regime 0.50. Kelly 25%.',
    )
  })

  it('default 0.25 buy threshold (gates present but no override) downgrades to HOLD', () => {
    const s = run(DIP, {})
    expect(s.action).toBe('HOLD')
    expect(s.KellyFraction).toBeCloseTo(0.10, 12)
    expect(s.reason).toBe('FIRST_DIP [STRONG_DIP]: wScore -0.01, confidence 90%. Hold.')
  })
})

describe('sectorGates — gate filters downgrade BUY', () => {
  it('goldenCrossGate does NOT downgrade when the golden cross holds', () => {
    const s = run(DIP, { ...OPEN, goldenCrossGate: true })
    expect(s.action).toBe('BUY')
    expect(s.KellyFraction).toBeCloseTo(0.25, 12)
    expect(s.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION, 12)
  })

  it('requirePositiveMomentum downgrades BUY → HOLD when 3-month momentum is negative', () => {
    const s = run(DIP, { ...OPEN, requirePositiveMomentum: true })
    expect(s.action).toBe('HOLD')
    expect(s.KellyFraction).toBeCloseTo(0.10, 12)   // Kelly reverts to the base fraction
    expect(s.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION, 12) // score untouched by this gate
    expect(s.reason).toBe('FIRST_DIP [STRONG_DIP]: wScore -0.01, confidence 90%. Hold.')
  })

  it('tlrGate subtracts exactly 0.10 and keeps BUY when the score still clears the threshold', () => {
    const s = run(DIP, { ...OPEN, tlrGate: true })
    expect(s.action).toBe('BUY')
    expect(s.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION - 0.10, 12)
    expect(s.totalWeightedScore).toBeCloseTo(W_NO_GATES, 12) // compression +0.10 exactly cancels the tlr penalty
    expect(s.reason).toBe(
      'FIRST_DIP [STRONG_DIP]: wScore -0.11. RSI(14) 1.00, BB% 0.80, Vol POC 0.80, Vol Regime 0.50. Kelly 25%.',
    )
  })

  it('tlrGate penalty crossing the threshold downgrades BUY → HOLD', () => {
    // pre-penalty −0.0064 > −0.05 (BUY survives); post-penalty −0.1064 ≤ −0.05 → HOLD
    const s = run(DIP, { buyWScoreThreshold: -0.05, tlrGate: true })
    expect(s.action).toBe('HOLD')
    expect(s.totalWeightedScore).toBeCloseTo(W_NO_GATES, 12)
    expect(s.KellyFraction).toBeCloseTo(0.10, 12)
  })

  it('after a gate downgrade, a high sellWScoreThreshold re-classifies HOLD → SELL', () => {
    const s = run(DIP, { ...OPEN, requirePositiveMomentum: true, sellWScoreThreshold: 9 })
    expect(s.action).toBe('SELL')
    expect(s.KellyFraction).toBe(1.0)
    expect(s.totalWeightedScore).toBeCloseTo(W_WITH_COMPRESSION, 12)
    expect(s.reason).toBe(
      'FIRST_DIP [STRONG_DIP]: wScore -0.01, exiting. RSI(14) 1.00, BB% 0.80, Vol POC 0.80, Vol Regime 0.50.',
    )
  })
})
