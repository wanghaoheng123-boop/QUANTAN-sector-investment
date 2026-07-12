import { describe, it, expect } from 'vitest'
import {
  atrAdaptiveStop,
  checkExitConditions,
  updatePosition,
  computeExitStats,
  evaluateStopHit,
  DEFAULT_EXIT_CONFIG,
  LABEL_MATCHED_EXIT_CONFIG,
  type OpenPosition,
  type ExitConfig,
} from '@/lib/backtest/exitRules'
import type { OhlcBar } from '@/lib/quant/indicators'

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeBars(closes: number[], range = 2): OhlcBar[] {
  return closes.map((c, i) => ({
    open: i === 0 ? c : closes[i - 1],
    high: c + range / 2,
    low: c - range / 2,
    close: c,
  }))
}

function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    ticker: 'TEST',
    sector: 'Tech',
    entryIdx: 0,
    entryPrice: 100,
    entryDate: '2026-01-01',
    entryATRPct: 0.02, // 2%
    stopLossPrice: 97,
    initialShares: 100,
    currentShares: 100,
    highestPrice: 100,
    partialExitDone: false,
    confidence: 70,
    reason: 'test',
    ...overrides,
  }
}

const cfg: ExitConfig = { ...DEFAULT_EXIT_CONFIG, panicExitAtrMultiple: 3.0 }

// ─── atrAdaptiveStop ────────────────────────────────────────────────────────

describe('atrAdaptiveStop', () => {
  it('falls back to floor when ATR computation has insufficient data', () => {
    const bars = makeBars([100, 100, 100], 0)
    const result = atrAdaptiveStop(100, bars)
    expect(result.atrPct).toBe(0.05) // documented fallback
    expect(result.stopLossPrice).toBeLessThan(100)
    expect(result.stopLossPrice).toBeGreaterThan(80)
  })

  it('respects floor (min 5%)', () => {
    // Very low volatility series — would yield ATR ~0.5%, floor = 5%.
    const bars = makeBars(Array.from({ length: 30 }, (_, i) => 100 + i * 0.01), 0.02)
    const { stopLossPrice } = atrAdaptiveStop(100, bars, 1.5, 0.05, 0.15)
    expect(stopLossPrice).toBeCloseTo(100 * (1 - 0.05), 2)
  })

  it('respects ceiling (max 15%)', () => {
    // Extreme volatility — clamp at 15%.
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 30)
    const bars = makeBars(closes, 60)
    const { stopLossPrice } = atrAdaptiveStop(100, bars, 1.5, 0.05, 0.15)
    expect(stopLossPrice).toBeCloseTo(100 * (1 - 0.15), 2)
  })

  it('AT-F1.22-atr-prior-bar: forming entry bar does not affect ATR window', () => {
    const completed = makeBars(Array.from({ length: 25 }, () => 100), 2)
    const wildEntryBar: OhlcBar = { open: 100, high: 500, low: 1, close: 100 }
    const withWildEntry = [...completed, wildEntryBar]

    const baseline = atrAdaptiveStop(100, completed)
    const withEntry = atrAdaptiveStop(100, withWildEntry)

    expect(withEntry.stopLossPrice).toBeCloseTo(baseline.stopLossPrice, 6)
    expect(withEntry.atrPct).toBeCloseTo(baseline.atrPct, 6)
  })

  /**
   * R8-C-2 (Phase 14): property test — atrAdaptiveStop should hold its
   * advertised invariants for any input bar series and any entry > 0.
   *
   * For a long position with default params (multiplier 1.5, floor 5%,
   * ceiling 15%):
   *   • stopLossPrice ∈ (0, entry)
   *   • atrPct ≥ 0
   *   • (entry - stopLossPrice) / entry ∈ [floor, ceiling]
   *
   * We exercise five deterministic seeds rather than randomised input
   * to keep CI failures debuggable.
   */
  describe('R8-C-2: property invariants across random scenarios', () => {
    const SEEDS = [3, 17, 88, 256, 7777]

    function makeRng(seed: number): () => number {
      let s = seed >>> 0
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0
        return s / 0xFFFFFFFF
      }
    }

    function randomBars(rng: () => number, count: number, startPrice: number): OhlcBar[] {
      const bars: OhlcBar[] = []
      let p = startPrice
      for (let i = 0; i < count; i++) {
        const noise = (rng() - 0.5) * 0.04 * p   // ~±2% per bar
        const open = p
        const close = Math.max(p + noise, 1)
        const range = Math.abs(noise) + p * 0.005
        bars.push({
          open,
          close,
          high: Math.max(open, close) + range,
          low: Math.max(Math.min(open, close) - range, 0.5),
        })
        p = close
      }
      return bars
    }

    for (const seed of SEEDS) {
      it(`seed ${seed}: stop lies inside (0, entry) and stop% ∈ [floor, ceiling]`, () => {
        const rng = makeRng(seed)
        const startPrice = 50 + rng() * 200    // entry in [50, 250]
        const bars = randomBars(rng, 60, startPrice)
        const entry = startPrice

        const floor = 0.05
        const ceiling = 0.15
        const { stopLossPrice, atrPct } = atrAdaptiveStop(entry, bars, 1.5, floor, ceiling)

        // atrPct must be a finite, non-negative number (fallback is 0.05).
        expect(Number.isFinite(atrPct)).toBe(true)
        expect(atrPct).toBeGreaterThanOrEqual(0)

        // Stop must be strictly positive and tighter than entry (long stop).
        expect(stopLossPrice).toBeGreaterThan(0)
        expect(stopLossPrice).toBeLessThan(entry)

        // Stop-distance percentage must respect floor/ceiling.
        const stopDistPct = (entry - stopLossPrice) / entry
        // Allow tiny floating-point slop at the boundaries.
        expect(stopDistPct).toBeGreaterThanOrEqual(floor - 1e-9)
        expect(stopDistPct).toBeLessThanOrEqual(ceiling + 1e-9)
      })
    }

    it('zero / negative entry price returns floor-bounded stop (degenerate input)', () => {
      // Documented behaviour: atrPct falls back to floor when entry <= 0
      // (since the per-share ATR% can't be computed without a denominator).
      // The returned stopLossPrice equals entry * (1 - floor), which for
      // entry = 0 is also 0 — caller is responsible for guarding entry > 0.
      const bars = makeBars([100, 100, 100], 0)
      const { stopLossPrice, atrPct } = atrAdaptiveStop(0, bars)
      expect(Number.isFinite(atrPct)).toBe(true)
      expect(atrPct).toBeGreaterThanOrEqual(0)
      // For zero entry, stop also ends up at zero — but never NaN/-Infinity.
      expect(Number.isFinite(stopLossPrice)).toBe(true)
    })
  })
})

// ─── checkExitConditions ────────────────────────────────────────────────────

describe('checkExitConditions — stop loss', () => {
  it('exits at currentPrice when at-or-below stop loss', () => {
    const pos = makePosition({ stopLossPrice: 97 })
    // currentPrice piercing stop
    const result = checkExitConditions(pos, 5, 96, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
    expect(result!.exitPrice).toBe(96)
    expect(result!.isPartial).toBe(false)
  })

  it('does not exit when above stop loss', () => {
    const pos = makePosition({ stopLossPrice: 97 })
    const result = checkExitConditions(pos, 5, 98, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — panic exit (ATR spike)', () => {
  it('exits when current ATR% > entry ATR% × multiple', () => {
    const pos = makePosition({ entryATRPct: 0.02 })
    // 7% current ATR, 3× the 2% entry → triggers panic
    const result = checkExitConditions(pos, 5, 99, '2026-01-06', 0.07, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('panic_exit')
  })

  it('does not exit at exactly 3× ATR (strict greater-than)', () => {
    const pos = makePosition({ entryATRPct: 0.02 })
    const result = checkExitConditions(pos, 5, 99, '2026-01-06', 0.06, 'HOLD', cfg)
    // currentATR exactly 3× entry — the current code uses >, not >=, so no exit
    expect(result).toBeNull()
  })

  it('does not panic-exit if entryATRPct is zero (degenerate)', () => {
    const pos = makePosition({ entryATRPct: 0 })
    const result = checkExitConditions(pos, 5, 99, '2026-01-06', 0.99, 'HOLD', cfg)
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — signal-based exit', () => {
  it('exits on SELL signal when signalBasedExit is true', () => {
    const pos = makePosition()
    const result = checkExitConditions(pos, 5, 100, '2026-01-06', 0.02, 'SELL', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('signal')
  })

  it('ignores SELL signal when signalBasedExit is false', () => {
    const pos = makePosition()
    const noSignalCfg = { ...cfg, signalBasedExit: false }
    const result = checkExitConditions(pos, 5, 100, '2026-01-06', 0.02, 'SELL', noSignalCfg)
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — profit target (partial exit)', () => {
  it('triggers partial exit at profit target', () => {
    const pos = makePosition({ entryPrice: 100, partialExitDone: false })
    const result = checkExitConditions(pos, 5, 108, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('profit_target')
    expect(result!.isPartial).toBe(true)
    expect(result!.partialFraction).toBe(0.50)
  })

  it('does not re-trigger after partialExitDone', () => {
    const pos = makePosition({ entryPrice: 100, partialExitDone: true, highestPrice: 110 })
    // Above profit target but partial already done — should not trigger again
    const result = checkExitConditions(pos, 5, 109, '2026-01-06', 0.02, 'HOLD', cfg)
    // Trailing-stop logic kicks in instead (highest 110, trail 5% → 104.5)
    // 109 > 104.5 so no exit.
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — trailing stop after partial', () => {
  it('exits when price falls below highestPrice × (1 - trailPct)', () => {
    const pos = makePosition({
      entryPrice: 100,
      partialExitDone: true,
      highestPrice: 120,  // peak
      stopLossPrice: 97,  // original stop
    })
    // trail at 120 × 0.95 = 114. Price 113 → exit.
    const result = checkExitConditions(pos, 5, 113, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
  })

  it('does not exit while price is above trailing level', () => {
    const pos = makePosition({
      entryPrice: 100, partialExitDone: true, highestPrice: 120, stopLossPrice: 97,
    })
    const result = checkExitConditions(pos, 5, 115, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — time exit', () => {
  it('exits when held >= maxHoldDays', () => {
    const pos = makePosition({ entryIdx: 0 })
    const result = checkExitConditions(pos, 20, 100, '2026-01-21', 0.02, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('time_exit')
  })

  it('does not exit before maxHoldDays', () => {
    const pos = makePosition({ entryIdx: 0 })
    const result = checkExitConditions(pos, 19, 100, '2026-01-20', 0.02, 'HOLD', cfg)
    expect(result).toBeNull()
  })
})

describe('checkExitConditions — priority ordering', () => {
  it('stop loss takes priority over signal exit', () => {
    const pos = makePosition({ stopLossPrice: 99 })
    const result = checkExitConditions(pos, 5, 98, '2026-01-06', 0.02, 'SELL', cfg)
    expect(result!.reason).toBe('stop_loss')
  })

  it('panic exit takes priority over profit target', () => {
    // Pos at 100, profit target at 108, currentATR triggers panic.
    const pos = makePosition({ entryPrice: 100, entryATRPct: 0.02 })
    const result = checkExitConditions(pos, 5, 108, '2026-01-06', 0.07, 'HOLD', cfg)
    expect(result!.reason).toBe('panic_exit')
  })
})

// ─── D2/D4 (2026-07-11): LABEL_MATCHED_EXIT_CONFIG behavior pins ────────────
// Time exit is the ONLY rule that may fire; every zero-valued rule is OFF.
describe('checkExitConditions — LABEL_MATCHED_EXIT_CONFIG (D2/D4)', () => {
  const lm = LABEL_MATCHED_EXIT_CONFIG

  it('is time-only: 20-bar hold, everything else disabled', () => {
    expect(lm.maxHoldDays).toBe(20)
    expect(lm.profitTakePct).toBe(0)
    expect(lm.trailingStopPct).toBe(0)
    expect(lm.panicExitAtrMultiple).toBe(0)
    expect(lm.signalBasedExit).toBe(false)
    expect(lm.atrStopMultiplier).toBe(0)
  })

  it('disarmed stop (stopLossPrice 0) never exits on a deep intraday dip', () => {
    const pos = makePosition({ stopLossPrice: 0 })
    const result = checkExitConditions(pos, 5, 72, '2026-01-06', 0.02, 'HOLD', lm, {
      open: 95, high: 96, low: 70, close: 72,
    })
    expect(result).toBeNull()
  })

  it('profitTakePct 0 does NOT fire a bogus target at the entry price', () => {
    // Without the D2 disable guard, target = entry × (1+0) = entry and any
    // bar whose high touches entry produces an immediate partial exit.
    const pos = makePosition({ stopLossPrice: 0, entryPrice: 100 })
    const result = checkExitConditions(pos, 5, 101, '2026-01-06', 0.02, 'HOLD', lm, {
      open: 100, high: 102, low: 99, close: 101,
    })
    expect(result).toBeNull()
  })

  it('ignores the falling-knife SELL (D4)', () => {
    const pos = makePosition({ stopLossPrice: 0 })
    const result = checkExitConditions(pos, 5, 100, '2026-01-06', 0.02, 'SELL', lm)
    expect(result).toBeNull()
  })

  it('does not panic-exit on an ATR spike', () => {
    const pos = makePosition({ stopLossPrice: 0, entryATRPct: 0.02 })
    const result = checkExitConditions(pos, 5, 100, '2026-01-06', 0.99, 'HOLD', lm)
    expect(result).toBeNull()
  })

  it('time exit still fires at 20 bars', () => {
    const pos = makePosition({ stopLossPrice: 0, entryIdx: 0 })
    const result = checkExitConditions(pos, 20, 100, '2026-01-21', 0.02, 'SELL', lm)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('time_exit')
    expect(result!.isPartial).toBe(false)
  })
})

// ─── updatePosition ──────────────────────────────────────────────────────────

describe('updatePosition', () => {
  it('raises highestPrice when current is higher', () => {
    const pos = makePosition({ highestPrice: 100 })
    const updated = updatePosition(pos, 110)
    expect(updated.highestPrice).toBe(110)
  })

  it('keeps highestPrice when current is lower', () => {
    const pos = makePosition({ highestPrice: 110 })
    const updated = updatePosition(pos, 105)
    expect(updated.highestPrice).toBe(110)
  })

  it('returns same object reference when no update needed (perf)', () => {
    const pos = makePosition({ highestPrice: 110 })
    const updated = updatePosition(pos, 105)
    expect(updated).toBe(pos)
  })
})

// ─── computeExitStats ────────────────────────────────────────────────────────

describe('computeExitStats', () => {
  it('returns zeros for empty trades', () => {
    const stats = computeExitStats([])
    expect(stats.totalExits).toBe(0)
    expect(stats.byReason.stop_loss).toBe(0)
    expect(stats.stopLossPct).toBe(0)
  })

  it('aggregates by reason and computes avg PnL per reason', () => {
    const stats = computeExitStats([
      { exitReason: 'stop_loss', pnlPct: -0.03 },
      { exitReason: 'stop_loss', pnlPct: -0.05 },
      { exitReason: 'profit_target', pnlPct: 0.08 },
      { exitReason: 'profit_target', pnlPct: 0.10 },
      { exitReason: 'time_exit', pnlPct: 0.01 },
    ])
    expect(stats.totalExits).toBe(5)
    expect(stats.byReason.stop_loss).toBe(2)
    expect(stats.byReason.profit_target).toBe(2)
    expect(stats.byReason.time_exit).toBe(1)
    expect(stats.avgPnLByReason.stop_loss).toBeCloseTo(-0.04, 4)
    expect(stats.avgPnLByReason.profit_target).toBeCloseTo(0.09, 4)
    expect(stats.stopLossPct).toBeCloseTo(0.4, 4)
    expect(stats.profitTakePct).toBeCloseTo(0.4, 4)
    expect(stats.timeExitPct).toBeCloseTo(0.2, 4)
  })
})

// ─── F1.3 (Phase 13 S2): intraday-aware exits ───────────────────────────────

/**
 * The legacy behaviour (close-only stop evaluation) systematically
 * under-reported stops and profit-takes, biasing backtest WR optimistic
 * on stop hits and pessimistic on profit-take hits. These tests pin
 * down the corrected intraday-breach semantics.
 *
 * Reference: Pardo (2008), *The Evaluation and Optimization of Trading
 * Strategies* (2nd ed.), ch. 7 — backtests must check bar low for
 * long stops, bar high for long profit-targets, to avoid systematic
 * optimism in equity-curve estimates.
 */
describe('checkExitConditions — F1.3 intraday-aware exits', () => {
  it('STOP LOSS fires on bar.low <= stop even when close recovers above', () => {
    const pos = makePosition({ stopLossPrice: 97 })
    // close = 99 (above stop), but low = 95 (below stop) — intraday breach.
    const result = checkExitConditions(
      pos, 5, 99, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 99, high: 99.5, low: 95, close: 99 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
    // Fill at stop price (assumed limit-order), not at bar.low (no slippage).
    expect(result!.exitPrice).toBe(97)
  })

  it('STOP LOSS fills at bar.open on a gap-down through the stop', () => {
    const pos = makePosition({ stopLossPrice: 97 })
    // Gap-down: open = 95 (below stop). Fill at open (worse).
    const result = checkExitConditions(
      pos, 5, 94, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 95, high: 95.5, low: 93, close: 94 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
    expect(result!.exitPrice).toBe(95) // open
  })

  it('PROFIT TARGET fires on bar.high >= target even when close pulls back', () => {
    const pos = makePosition() // profitTake default 8% → target = 108
    // close = 105 (below target), but high = 109 (above target).
    const result = checkExitConditions(
      pos, 5, 105, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 104, high: 109, low: 103, close: 105 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('profit_target')
    // Fill at target (assumed limit-order), not at bar.high.
    expect(result!.exitPrice).toBe(108)
    expect(result!.isPartial).toBe(true)
  })

  it('PROFIT TARGET fills at bar.open on a gap-up through the target', () => {
    const pos = makePosition()
    // Gap-up: open = 110 (above target 108). Fill at open (better).
    const result = checkExitConditions(
      pos, 5, 111, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 110, high: 112, low: 109, close: 111 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('profit_target')
    expect(result!.exitPrice).toBe(110) // open
  })

  it('STOP LOSS takes priority over PROFIT TARGET on a wide range bar', () => {
    // Both breaches in one bar (very wide range): stop@97 hit AND target@108 hit.
    // Conservative: assume stop hits first (worse outcome).
    const pos = makePosition({ stopLossPrice: 97 })
    const result = checkExitConditions(
      pos, 5, 105, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 100, high: 109, low: 96, close: 105 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
  })

  it('TRAILING STOP fires on bar.low <= trail level (post partial exit)', () => {
    const pos = makePosition({
      partialExitDone: true,
      highestPrice: 110, // trail at 110 * 0.95 = 104.5 (default trailingStopPct = 5%)
    })
    // close = 105 (above trail), but low = 104 (below).
    const result = checkExitConditions(
      pos, 5, 105, '2026-01-06', 0.02, 'HOLD', cfg,
      { open: 105, high: 105.5, low: 104, close: 105 },
    )
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
    expect(result!.exitPrice).toBe(104.5) // trail level
  })

  it('back-compat: omitting currentBar falls back to close-only behaviour', () => {
    // No bar param — uses currentPrice as low/high/open. Same result as
    // the legacy contract (existing 23 tests rely on this).
    const pos = makePosition({ stopLossPrice: 97 })
    const result = checkExitConditions(pos, 5, 96, '2026-01-06', 0.02, 'HOLD', cfg)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('stop_loss')
    expect(result!.exitPrice).toBe(96)
  })
})

// ─── evaluateStopHit (SSOT primitive) ──────────────────────────────────────

/**
 * evaluateStopHit is the single source of truth for intraday stop/target
 * detection, used by BOTH lib/backtest/exitRules.ts:checkExitConditions
 * and lib/backtest/engine.ts. Direct tests cover the four (side, kind)
 * quadrants so regressions show up here even if the higher-level paths
 * don't exercise them.
 */
describe('evaluateStopHit — SSOT intraday primitive', () => {
  const bar = (open: number, high: number, low: number, close: number) =>
    ({ open, high, low, close })

  // ─── LONG STOP ─────────────────────────────────────────────────────────
  describe('long stop', () => {
    it('triggers when bar.low <= stop (close above)', () => {
      const r = evaluateStopHit(bar(100, 101, 95, 99), 97, 'long', 'stop')
      expect(r).toBe(97)
    })

    it('fills at bar.open when gap-down opens below stop', () => {
      const r = evaluateStopHit(bar(95, 96, 93, 94), 97, 'long', 'stop')
      expect(r).toBe(95)
    })

    it('does not trigger when bar.low > stop', () => {
      const r = evaluateStopHit(bar(100, 102, 99, 101), 97, 'long', 'stop')
      expect(r).toBeNull()
    })

    it('boundary: bar.low === stop fires (≤ semantics)', () => {
      const r = evaluateStopHit(bar(100, 101, 97, 99), 97, 'long', 'stop')
      expect(r).toBe(97)
    })
  })

  // ─── LONG TARGET ────────────────────────────────────────────────────────
  describe('long target (profit take)', () => {
    it('triggers when bar.high >= target (close below)', () => {
      const r = evaluateStopHit(bar(104, 109, 103, 105), 108, 'long', 'target')
      expect(r).toBe(108)
    })

    it('fills at bar.open when gap-up opens above target', () => {
      const r = evaluateStopHit(bar(110, 112, 109, 111), 108, 'long', 'target')
      expect(r).toBe(110)
    })

    it('does not trigger when bar.high < target', () => {
      const r = evaluateStopHit(bar(104, 106, 103, 105), 108, 'long', 'target')
      expect(r).toBeNull()
    })

    it('boundary: bar.high === target fires (≥ semantics)', () => {
      const r = evaluateStopHit(bar(104, 108, 103, 105), 108, 'long', 'target')
      expect(r).toBe(108)
    })
  })

  // ─── SHORT STOP ─────────────────────────────────────────────────────────
  describe('short stop', () => {
    it('triggers when bar.high >= stop', () => {
      const r = evaluateStopHit(bar(100, 109, 99, 101), 108, 'short', 'stop')
      expect(r).toBe(108)
    })

    it('fills at bar.open when gap-up opens above stop', () => {
      const r = evaluateStopHit(bar(110, 112, 109, 111), 108, 'short', 'stop')
      expect(r).toBe(110)
    })

    it('does not trigger when bar.high < stop', () => {
      const r = evaluateStopHit(bar(100, 105, 99, 101), 108, 'short', 'stop')
      expect(r).toBeNull()
    })
  })

  // ─── SHORT TARGET ───────────────────────────────────────────────────────
  describe('short target (profit take)', () => {
    it('triggers when bar.low <= target', () => {
      const r = evaluateStopHit(bar(100, 101, 89, 99), 90, 'short', 'target')
      expect(r).toBe(90)
    })

    it('fills at bar.open when gap-down opens below target', () => {
      const r = evaluateStopHit(bar(88, 89, 85, 86), 90, 'short', 'target')
      expect(r).toBe(88)
    })

    it('does not trigger when bar.low > target', () => {
      const r = evaluateStopHit(bar(100, 101, 92, 99), 90, 'short', 'target')
      expect(r).toBeNull()
    })
  })

  // ─── DEFENSIVE EDGE CASES ──────────────────────────────────────────────
  describe('defensive (non-finite / non-positive)', () => {
    it('returns null for NaN level', () => {
      expect(evaluateStopHit(bar(100, 101, 99, 100), NaN, 'long', 'stop')).toBeNull()
    })

    it('returns null for zero/negative level', () => {
      expect(evaluateStopHit(bar(100, 101, 99, 100), 0, 'long', 'stop')).toBeNull()
      expect(evaluateStopHit(bar(100, 101, 99, 100), -5, 'long', 'stop')).toBeNull()
    })

    it('returns null when bar has non-finite OHLC', () => {
      expect(evaluateStopHit({ open: NaN, high: 101, low: 99, close: 100 }, 97, 'long', 'stop')).toBeNull()
      expect(evaluateStopHit({ open: 100, high: Infinity, low: 99, close: 100 }, 97, 'long', 'stop')).toBeNull()
    })
  })
})
