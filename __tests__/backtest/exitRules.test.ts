import { describe, it, expect } from 'vitest'
import {
  atrAdaptiveStop,
  checkExitConditions,
  updatePosition,
  computeExitStats,
  DEFAULT_EXIT_CONFIG,
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
