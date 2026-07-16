/**
 * Q-064 — purged walk-forward grid search.
 *
 * The legacy gridSearch selects params BY OOS Sharpe and reports the same
 * OOS (documented caveat #1). gridSearchPurged selects per fold on IS only,
 * with label purging by construction and a 5-bar embargo. These tests pin
 * the fold geometry exactly and verify the no-leak invariants structurally.
 */
import { describe, it, expect } from 'vitest'
import {
  purgedWalkForwardFolds,
  gridSearchPurged,
  generateGrid,
} from '@/lib/optimize/gridSearch'
import type { ParamGrid } from '@/lib/optimize/gridSearch'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'

describe('purgedWalkForwardFolds — exact geometry', () => {
  it('tiles the last 40% into folds with embargoed OOS entry starts', () => {
    const folds = purgedWalkForwardFolds(1000)
    // firstBoundary = max(472, 600) = 600, span 400, blockLen 100
    expect(folds).toHaveLength(4)
    expect(folds[0]).toEqual({
      isEnd: 600, oosWarmupStart: 385, oosEntryStart: 605, oosEnd: 700,
    })
    expect(folds[1]).toEqual({
      isEnd: 700, oosWarmupStart: 485, oosEntryStart: 705, oosEnd: 800,
    })
    expect(folds[3]).toEqual({
      isEnd: 900, oosWarmupStart: 685, oosEntryStart: 905, oosEnd: 1000,
    })
  })

  it('every fold is leak-free: last IS label closes before the embargoed OOS start', () => {
    for (const nRows of [800, 1000, 1500, 2333]) {
      for (const fold of purgedWalkForwardFolds(nRows)) {
        // simpleBacktestSlice on [0, isEnd) enters at most at isEnd-22 and
        // exits by isEnd-1; OOS entries begin at oosEntryStart.
        const lastIsExit = fold.isEnd - 1
        expect(lastIsExit).toBeLessThan(fold.oosEntryStart)
        expect(fold.oosEntryStart - fold.isEnd).toBe(5) // embargo
        expect(fold.oosEntryStart - fold.oosWarmupStart).toBe(220) // warmup
        expect(fold.oosEnd - fold.oosEntryStart - 22).toBeGreaterThanOrEqual(63)
      }
    }
  })

  it('drops folds that are too small; empty on short series', () => {
    expect(purgedWalkForwardFolds(400)).toEqual([]) // span too small
    expect(purgedWalkForwardFolds(0)).toEqual([])
    // 900 rows: firstBoundary 540<472? no → max(472,540)=540, span 360, block 90
    // 90-block: entrySpan = 90 - 5 - 22 = 63 → exactly at the floor, kept
    const folds900 = purgedWalkForwardFolds(900)
    expect(folds900.length).toBe(4)
    // raising the floor by one bar drops the equal-size folds
    expect(purgedWalkForwardFolds(900, { minOosEntryBars: 64 }).length).toBeLessThan(4)
  })
})

describe('gridSearchPurged — selection on IS only', () => {
  const SECONDS_PER_DAY = 86400
  const START_TIME = Date.UTC(2021, 0, 1) / 1000

  /**
   * Uptrend with periodic dips that satisfy the simplified BUY rule
   * (dev in [-20, 0), positive 200SMA slope, RSI < 40, EMA50 > EMA200):
   * 0.35%/bar exponential drift with single-bar 28% crashes every 150 bars
   * from bar 400 — deep enough to pull price below the lagging 200SMA.
   */
  function fixtureRows(bars: number): OhlcvRow[] {
    const closes: number[] = []
    let level = 100
    for (let i = 0; i < bars; i++) {
      if (i > 0) level *= 1.0035
      if (i >= 400 && (i - 400) % 150 === 0) level *= 0.72
      closes.push(level)
    }
    return closes.map((close, i) => ({
      time: START_TIME + i * SECONDS_PER_DAY,
      open: i === 0 ? close : closes[i - 1],
      high: Math.max(close, i === 0 ? close : closes[i - 1]) + 0.2,
      low: Math.min(close, i === 0 ? close : closes[i - 1]) - 0.2,
      close,
      volume: 1_000_000,
    }))
  }

  const grid: ParamGrid = {
    slopeThreshold: [0.001, 0.005],
    buyWScoreThreshold: [0.25],
    sellWScoreThreshold: [-0.3],
    confidenceThreshold: [50],
    atrStopMultiplier: [1.5, 2.5],
  }

  it('produces per-fold IS-selected params evaluated on unseen OOS', () => {
    const rows = fixtureRows(1400)
    const summary = gridSearchPurged(rows, grid, 'TST', 'Technology')
    expect(summary.totalCombinations).toBe(generateGrid(grid).length)
    expect(summary.folds.length).toBeGreaterThan(0)
    for (const f of summary.folds) {
      // selected params come from the grid
      expect(grid.slopeThreshold).toContain(f.selected.slopeThreshold)
      expect(grid.atrStopMultiplier).toContain(f.selected.atrStopMultiplier)
      // selection floor: at least 10 IS trades
      expect(f.isTrades).toBeGreaterThanOrEqual(10)
      // boundary date is the fold's isEnd bar
      const expected = new Date(rows[f.isEnd].time * 1000).toISOString().slice(0, 10)
      expect(f.boundaryDate).toBe(expected)
    }
    expect(summary.pooledOosTrades).toBeGreaterThan(0)
    expect(summary.meanOosWinRate).not.toBeNull()
    expect(summary.protocol).toContain('IS ONLY')
  })

  it('is deterministic', () => {
    const rows = fixtureRows(1200)
    const a = gridSearchPurged(rows, grid, 'TST', 'T')
    const b = gridSearchPurged(rows, grid, 'TST', 'T')
    expect(a).toEqual(b)
  })

  it('returns an empty summary on data too short for any fold', () => {
    const rows = fixtureRows(400)
    const summary = gridSearchPurged(rows, grid, 'TST', 'T')
    expect(summary.folds).toEqual([])
    expect(summary.meanOosWinRate).toBeNull()
    expect(summary.pooledOosTrades).toBe(0)
    expect(summary.modalParams).toEqual({})
  })
})
