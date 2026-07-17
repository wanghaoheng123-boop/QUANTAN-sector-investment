/**
 * Q-075 wave 4 (2026-07-17) — the last two never-exercised regions after
 * the 63.50 measurement (run 29584073911):
 *
 * 1. The portfolio-level MAX-DRAWDOWN CIRCUIT BREAKER (portfolioBacktest
 *    ~501–533): every prior fixture kept portfolio DD under the 25% default
 *    cap, so the breaker block (T+1 fill resolution, per-side cost credit,
 *    trade bookkeeping, position clear) had zero behavioral coverage.
 * 2. The enhancedCombinedSignal REASON template builders (~302–306):
 *    string-literal and template mutants survived because no fixture pinned
 *    the exact BUY / HOLD / SELL reason strings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runPortfolioBacktest } from '@/lib/backtest/portfolioBacktest'
import { enhancedCombinedSignal } from '@/lib/backtest/signals'
import type { OhlcvRow } from '@/lib/backtest/dataLoader'

const START_TIME = Date.UTC(2024, 0, 1) / 1000

afterEach(() => vi.unstubAllEnvs())

function mk(bars: number, fn: (i: number) => number, range = 0.2): OhlcvRow[] {
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

// ─── portfolio DD circuit breaker ────────────────────────────────────────────

describe('runPortfolioBacktest — max-drawdown circuit breaker golden', () => {
  beforeEach(() => vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '0'))

  /** Dip entry at ~bar 301, then a second −28% crash at bar 310 while holding. */
  function doubleCrash(): OhlcvRow[] {
    const closes: number[] = []
    let l = 100
    let g = 0.004
    for (let i = 0; i < 380; i++) {
      if (i > 0) l *= 1 + g
      if (i === 300) { l *= 0.64; g = 0.001 }
      if (i === 310) l *= 0.72
      closes.push(l)
    }
    return mk(380, (i) => closes[i])
  }

  it('2% cap: breaker force-closes at T+1 open with exact bookkeeping', () => {
    const res = runPortfolioBacktest({ ZZ: doubleCrash() }, { ZZ: 'Technology' }, {
      maxDrawdownCap: 0.02,
    })
    expect(res.exitReasonBreakdown).toEqual({
      signal: 0, stop_loss: 0, time_exit: 0, profit_target: 0,
      panic_exit: 0, max_drawdown: 1, end_of_data: 0,
    })
    const t = res.trades[0]
    expect(t.entryDate).toBe('2024-10-27')
    expect(t.exitDate).toBe('2024-11-06') // breach observed on the crash bar → fill T+1
    expect(t.shares).toBe(70)
    expect(t.pnlPct).toBeCloseTo(-0.274366, 5)
    expect(t.pnlDollar).toBeCloseTo(-4047.478, 2)
    expect(t.exitReason).toBe('max_drawdown')
    expect(res.finalCapital).toBeCloseTo(95924.329344, 2)
    expect(res.maxDrawdown).toBeCloseTo(0.04188498, 6)
    expect(res.totalTrades).toBe(1)
    expect(res.winRate).toBe(0)
  })

  it('25% default cap: same fixture never trips the breaker (time exit instead)', () => {
    const res = runPortfolioBacktest({ ZZ: doubleCrash() }, { ZZ: 'Technology' })
    expect(res.exitReasonBreakdown.max_drawdown).toBe(0)
    expect(res.exitReasonBreakdown.time_exit).toBe(1)
    expect(res.trades[0].exitDate).toBe('2024-12-27') // 60-bar H-decision default
    expect(res.finalCapital).toBeCloseTo(96488.040013, 2)
  })
})

// ─── enhanced signal reason strings ──────────────────────────────────────────

describe('enhancedCombinedSignal — exact reason templates', () => {
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
  const dipCloses: number[] = []
  {
    let l = 100
    for (let i = 0; i < 301; i++) { if (i > 0) l *= 1.004; if (i === 300) l *= 0.64; dipCloses.push(l) }
  }
  const dip = inputs(mk(301, (i) => dipCloses[i]))

  it('HOLD reason carries zone, dipSignal, wScore, confidence', () => {
    const s = enhancedCombinedSignal('T', '2026-01-01', dipCloses[300], dip.closes, dip.bars, dip.ohlcv)
    expect(s.reason).toBe('FIRST_DIP [STRONG_DIP]: wScore -0.03, confidence 90%. Hold.')
  })

  it('BUY reason lists bullish confirms and the Kelly percentage', () => {
    const s = enhancedCombinedSignal('T', '2026-01-01', dipCloses[300], dip.closes, dip.bars, dip.ohlcv, {}, {
      buyWScoreThreshold: -0.5,
    })
    expect(s.reason).toBe(
      'FIRST_DIP [STRONG_DIP]: wScore -0.03. RSI(14) 1.00, BB% 1.00, Vol POC 0.80. Kelly 25%.',
    )
  })

  it('SELL reason uses the exiting template', () => {
    const knife = inputs(mk(300, (i) => (i < 250 ? 100 + i * 0.1 : 125 - (i - 250) * 1.2)))
    const s = enhancedCombinedSignal('T', '2026-01-01', knife.closes[299], knife.closes, knife.bars, knife.ohlcv)
    expect(s.reason).toBe(
      'CRASH_ZONE [FALLING_KNIFE]: wScore -0.05, exiting. RSI(14) 1.00, BB% 0.80, Vol POC 0.80, Vol Regime 0.50.',
    )
  })
})
