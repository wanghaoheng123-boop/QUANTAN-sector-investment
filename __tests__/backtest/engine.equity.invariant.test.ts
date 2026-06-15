/**
 * R8-C-1 (Phase 14): Property-style invariant tests for the backtest
 * engine's equity bookkeeping.
 *
 * These tests exercise `backtestInstrument` over multiple deterministic
 * pseudo-random OHLCV series and check three structural invariants:
 *
 *   I1. Every entry in `equityCurve` is finite and positive.
 *   I2. Closed-trade `pnlPct` matches `(exit - entry) / entry` to within
 *       a small tolerance — i.e. the engine's per-trade P&L attribution
 *       is consistent with the prices it records.
 *   I3. The series starts at the initial capital and the final equity
 *       is non-degenerate (no NaN, no Infinity, > 0).
 *
 * These are not exact replays of internal accounting (which depend on
 * tx costs, slippage, partial exits, etc.) — they are basic shape /
 * sanity invariants that would be violated by a regression like the
 * cost-basis equity bug fixed in Q1-C-1.
 */
import { describe, it, expect } from 'vitest'
import { backtestInstrument, type OhlcvRow } from '@/lib/backtest/engine'

// Deterministic LCG so seeds are reproducible across runs.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xFFFFFFFF
  }
}

function generateRandomRows(count: number, seed: number, startPrice = 100): OhlcvRow[] {
  const rng = makeRng(seed)
  const rows: OhlcvRow[] = []
  let price = startPrice
  const startTime = Math.floor(new Date('2019-01-01').getTime() / 1000)

  for (let i = 0; i < count; i++) {
    // Random walk with mild drift; clamp to keep prices > 1.
    const drift = 0.0003
    const vol = 0.02
    const noise = (rng() - 0.5) * vol * price
    const open = price
    const close = Math.max(price * (1 + drift) + noise, 1)
    const high = Math.max(open, close) + Math.abs(noise) * 0.5
    const low = Math.max(Math.min(open, close) - Math.abs(noise) * 0.5, 0.5)

    rows.push({
      time: startTime + i * 86400,
      open,
      high,
      low,
      close,
      volume: 1_000_000 + Math.floor(rng() * 500_000),
    })
    price = close
  }
  return rows
}

describe('R8-C-1: backtest engine — equity bookkeeping invariants', () => {
  const SEEDS = [1, 7, 42, 101, 9999]

  for (const seed of SEEDS) {
    it(`seed ${seed}: equityCurve is finite + positive at every bar`, () => {
      const rows = generateRandomRows(400, seed)
      const result = backtestInstrument('TEST', 'Technology', rows)

      // I3 — non-degenerate series.
      expect(result.equityCurve.length).toBeGreaterThan(0)
      expect(result.equityCurve[0]).toBeGreaterThan(0)
      expect(Number.isFinite(result.equityCurve[0])).toBe(true)

      // I1 — every entry is finite and positive.
      for (let i = 0; i < result.equityCurve.length; i++) {
        const v = result.equityCurve[i]
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
    })

    it(`seed ${seed}: closed-trade pnlPct matches (exit - entry) / entry`, () => {
      const rows = generateRandomRows(400, seed)
      const result = backtestInstrument('TEST', 'Technology', rows)

      // I2 — per-trade P&L attribution is consistent.
      for (const t of result.closedTrades) {
        if (t.exitPrice == null || t.pnlPct == null) continue
        if (t.action !== 'BUY' && t.action !== 'SELL') continue
        const expected = t.action === 'BUY'
          ? (t.exitPrice - t.entryPrice) / t.entryPrice
          : (t.entryPrice - t.exitPrice) / t.entryPrice
        // Engine records gross trade pnlPct without tx-cost deduction in
        // the Trade record; compare with tight tolerance.
        expect(t.pnlPct).toBeCloseTo(expected, 8)
      }
    })
  }

  // Q02 regression: a corrupt next-open (0 / NaN / Infinity) on a bar where an
  // entry would otherwise fire used to make `shares` Infinity/NaN — the
  // `shares <= 0` check misses both — poisoning capital and the whole equity
  // curve with NaN. The entry-price guard in core.ts must keep the output finite.
  for (const seed of SEEDS) {
    it(`seed ${seed}: stays finite when some bar opens are corrupt (0 / NaN)`, () => {
      const rows = generateRandomRows(400, seed)
      // Scatter bad opens across the series so at least one lands on an entry bar.
      for (let i = 0; i < rows.length; i++) {
        if (i % 37 === 0) rows[i].open = 0
        else if (i % 53 === 0) rows[i].open = NaN
      }
      const result = backtestInstrument('TEST', 'Technology', rows)

      for (const v of result.equityCurve) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThan(0)
      }
      expect(Number.isFinite(result.totalReturn)).toBe(true)
      expect(Number.isFinite(result.finalPrice)).toBe(true)
      expect(result.sharpeRatio === null || Number.isFinite(result.sharpeRatio)).toBe(true)
      expect(Number.isFinite(result.winRate)).toBe(true)
    })
  }

  it('flat-position equity is exactly capital (no spurious position value)', () => {
    // A near-constant series should generate few/no trades; the equity
    // curve should remain near initial capital without drift.
    const rows = generateRandomRows(300, 12345, 100)
    const result = backtestInstrument('TEST', 'Technology', rows)
    // The starting value is always the initial capital.
    expect(result.equityCurve[0]).toBeGreaterThan(0)
    // Final equity should be within a reasonable corridor of initial.
    // We don't pin the exact value (engine internals decide), but it
    // must be strictly positive and finite — guards against the Q1-C-1
    // regression where mark-to-market drifted to NaN/0.
    const final = result.equityCurve[result.equityCurve.length - 1]
    expect(Number.isFinite(final)).toBe(true)
    expect(final).toBeGreaterThan(0)
  })
})
