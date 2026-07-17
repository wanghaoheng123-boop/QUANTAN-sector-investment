/**
 * Q-075 wave 3 (2026-07-17) — pins for the two clusters wave 2 did not
 * touch (per the 29553164644 survivor histogram):
 *
 * 1. portfolioBacktest.ts 204–212 + 440–442: the correlation-tape PRE-SEED
 *    (Phase 14 wave 6) and the correlation-adjusted Kelly at entry. All
 *    earlier fixtures entered positions long after warmup, when the live
 *    tape was already full — the seed never mattered. This fixture forces
 *    a SECOND entry 8 bars after the first, inside the seed-dependent
 *    window: without the seed (the mutant), maxCorrelationVsPeers sees
 *    < 20 samples → correlationAdjustedKelly fail-closes → the second
 *    position never opens → totalTrades changes.
 *
 * 2. signals.ts 190–196 + 237–270: weightedConfirms field construction
 *    (weights/bullish flags were unpinned) and the action-determination
 *    branches (BUY gate downgrades, tlr penalty, confidence floor, and
 *    the HEALTHY_BULL overbought → SELL override).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runPortfolioBacktest } from '@/lib/backtest/portfolioBacktest'
import { enhancedCombinedSignal } from '@/lib/backtest/signals'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'

const START_TIME = Date.UTC(2024, 0, 1) / 1000

afterEach(() => vi.unstubAllEnvs())

// ─── portfolio: correlation seed + Kelly shrink at early entries ─────────────

/** Exp drift + sin noise, single-bar crash, recovery tail (probe-verified). */
function noisyDip(
  bars: number, crashes: number[], rate: number, cf: number, tail: number, phase = 0,
): OhlcvRow[] {
  const closes: number[] = []
  let level = 100
  let g = rate
  const cs = new Set(crashes)
  for (let i = 0; i < bars; i++) {
    if (i > 0) level *= 1 + g + Math.sin(i * 0.9 + phase) * 0.0015
    if (cs.has(i)) { level *= cf; g = tail }
    closes.push(level)
  }
  return closes.map((close, i) => ({
    time: START_TIME + i * 86400,
    open: i === 0 ? close : closes[i - 1],
    high: Math.max(close, i === 0 ? close : closes[i - 1]) + 0.2,
    low: Math.min(close, i === 0 ? close : closes[i - 1]) - 0.2,
    close,
    volume: 1_000_000,
  }))
}

describe('runPortfolioBacktest — correlation seed enables early second entry', () => {
  beforeEach(() => vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '0'))

  it('both early entries fill with exact sizing (seed-dependent golden)', () => {
    // Crashes at bars 225/233 — entries at union bars ~226/234, only ~6/14
    // live tape samples past warmup. The 25-bar PRE-SEED is what lets
    // maxCorrelationVsPeers reach its 20-sample minimum for BB's entry.
    const data = {
      AA: noisyDip(320, [225], 0.004, 0.64, 0.005, 0),
      BB: noisyDip(320, [233], 0.004, 0.66, 0.005, 0.4),
    }
    const res = runPortfolioBacktest(data, { AA: 'Technology', BB: 'Healthcare' })
    expect(res.totalTrades).toBe(2) // seed mutants block BB → 1
    expect(res.trades.map((t) => t.ticker)).toEqual(['AA', 'BB'])
    expect(res.trades[0].entryDate).toBe('2024-08-13')
    expect(res.trades[1].entryDate).toBe('2024-08-21')
    // Exact share counts pin the Kelly → allocation → floor chain,
    // including the correlation-adjusted shrink on the SECOND entry.
    expect(res.trades[0].shares).toBe(95)
    expect(res.trades[1].shares).toBe(76)
    expect(res.trades[0].pnlPct).toBeCloseTo(0.349595, 5)
    expect(res.trades[1].pnlPct).toBeCloseTo(0.350222, 5)
    expect(res.finalCapital).toBeCloseTo(109704.626401, 2)
    expect(res.maxConcurrentPositions).toBe(2)
    expect(res.exitReasonBreakdown.time_exit).toBe(2)
  })
})

// ─── signals: confirm-array fields + action-determination branches ──────────

function mkRows(bars: number, fn: (i: number) => number, range = 0.2): OhlcvRow[] {
  const out: OhlcvRow[] = []
  for (let i = 0; i < bars; i++) {
    const close = fn(i)
    const open = i === 0 ? close : fn(i - 1)
    out.push({
      time: START_TIME + i * 86400, open,
      high: Math.max(open, close) + range, low: Math.min(open, close) - range,
      close, volume: 1_000_000 + (i % 7) * 50_000,
    })
  }
  return out
}

function inputs(rows: OhlcvRow[]) {
  return {
    closes: rows.map((r) => r.close),
    bars: rows.map(({ open, high, low, close }) => ({ open, high, low, close })),
    ohlcv: rows.map((r) => ({
      open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume ?? 0, time: r.time,
    })),
  }
}

/** Wave-1 dipBar fixture: 300 bars of +0.4%/bar, crash to 0.64× on the last bar. */
function dipFixture() {
  const closes: number[] = []
  let level = 100
  for (let i = 0; i < 301; i++) {
    if (i > 0) level *= 1.004
    if (i === 300) level *= 0.64
    closes.push(level)
  }
  const rows = mkRows(301, (i) => closes[i])
  return { ...inputs(rows), price: closes[300] }
}

describe('enhancedCombinedSignal — weightedConfirms field pins (dip bar)', () => {
  const { closes, bars, ohlcv, price } = dipFixture()
  const s = enhancedCombinedSignal('T', '2026-01-01', price, closes, bars, ohlcv)

  it('names, regime-profile weights, and bullish flags are exact', () => {
    expect(s.weightedConfirms.map((c) => c.name)).toEqual([
      'RSI(14)', 'MACD hist', 'ATR%', 'BB%', 'Vol POC', 'Multi-TF', 'Vol Regime',
    ])
    expect(s.weightedConfirms.map((c) => c.weight)).toEqual([
      0.2, 0.15, 0.1, 0.15, 0.1, 0.2, 0.1,
    ])
    expect(s.weightedConfirms.map((c) => c.bullish)).toEqual([
      true, false, false, true, true, false, false,
    ])
    // per-row invariant: weightedScore = weight × score, and bullish ⇔ score > 0.3
    for (const c of s.weightedConfirms) {
      expect(c.weightedScore).toBeCloseTo(c.weight * c.score, 12)
      if (c.name !== 'Vol Regime') expect(c.bullish).toBe(c.score > 0.3)
    }
    // backward-compat confirms mirror name/value/bullish
    expect(s.confirms.map((c) => c.bullish)).toEqual(s.weightedConfirms.map((c) => c.bullish))
  })
})

describe('enhancedCombinedSignal — action-determination branches', () => {
  const { closes, bars, ohlcv, price } = dipFixture()
  const at = (config = {}, gates?: object) =>
    enhancedCombinedSignal('T', '2026-01-01', price, closes, bars, ohlcv, config, gates as never)

  it('lowered buy threshold opens the BUY path with capped half-Kelly', () => {
    const s = at({}, { buyWScoreThreshold: -0.5 })
    expect(s.action).toBe('BUY')
    expect(s.confidence).toBe(90)
    expect(s.KellyFraction).toBe(0.25) // halfKelly computed then capped
  })

  it('tlrGate subtracts EXACTLY 0.10 from the weighted score and re-checks', () => {
    const base = at({}, { buyWScoreThreshold: -0.5 })
    const tlr = at({}, { buyWScoreThreshold: -0.5, tlrGate: true })
    expect(base.totalWeightedScore - tlr.totalWeightedScore).toBeCloseTo(0.1, 10)
    expect(tlr.action).toBe('BUY') // still above the lowered threshold
  })

  it('requirePositiveMomentum downgrades the post-crash BUY; goldenCross holds', () => {
    expect(at({}, { buyWScoreThreshold: -0.5, requirePositiveMomentum: true }).action).toBe('HOLD')
    expect(at({}, { buyWScoreThreshold: -0.5, goldenCrossGate: true }).action).toBe('BUY')
  })

  it('confidence floor downgrades BUY (but never SELL) to HOLD', () => {
    expect(at({ confidenceThreshold: 101 }, { buyWScoreThreshold: -0.5 }).action).toBe('HOLD')
  })

  it('HEALTHY_BULL + RSI>70 overrides HOLD to SELL (overbought rule)', () => {
    const rows = mkRows(300, (i) => 100 * Math.pow(1.0008, i), 0.05)
    const ii = inputs(rows)
    const s = enhancedCombinedSignal('T', '2026-01-01', ii.closes[299], ii.closes, ii.bars, ii.ohlcv)
    expect(s.regime.zone).toBe('HEALTHY_BULL')
    expect(s.action).toBe('SELL')
    expect(s.confidence).toBe(57)
    expect(s.KellyFraction).toBe(1.0)
  })
})
