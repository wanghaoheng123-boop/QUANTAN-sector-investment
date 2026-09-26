/**
 * Q-105 — `confidenceThreshold` is live on ONE signal path and inert on the
 * other, and the tests must say which.
 *
 * Q-085 varied it (40–65) together with `stopLossPct` on `backtestInstrument`
 * and got byte-identical trades on every instrument — PBO came back exactly 1
 * with a median logit of 0, the signature of a tie. The Q-108 caller audit then
 * corrected the inference: the field IS read, by `enhancedCombinedSignal`
 * (`signals.ts`), and the experiment ran on the regime-only path, which ignores
 * it. So the right test is not "every option changes every output" — options
 * are legitimately inactive when their branch is not reached — but a fixture
 * that FORCES each supported boundary.
 *
 * Every test pins the signal path explicitly. Under vitest NODE_ENV is 'test',
 * which makes the enhanced path the default (`lib/featureFlags.ts`); an unpinned
 * test would exercise the path production never runs.
 *
 * Fixtures are real committed price histories, not synthetic series, so the
 * boundaries are ones the engine actually meets.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadStockHistory, type OhlcvRow } from '@/lib/backtest/dataLoader'
import { backtestInstrument } from '@/lib/backtest/engine'
import { enhancedCombinedSignal, resolveBacktestSignal } from '@/lib/backtest/signals'
import { REGIME_PATH_POSITION_FRACTION } from '@/lib/backtest/strategyConstants'

/** SO trades on both paths over the committed window (8 regime, 3 enhanced). */
const TICKER = 'SO'
const SECTOR = 'Utilities'

const rows: OhlcvRow[] = loadStockHistory(TICKER)

function signalAt(i: number, confidenceThreshold: number, path: 'enhanced' | 'resolve' = 'enhanced') {
  const window = rows.slice(0, i + 1)
  const closes = window.map((r) => r.close)
  const bars = window.map(({ open, high, low, close }) => ({ open, high, low, close }))
  const date = new Date(rows[i].time * 1000).toISOString().split('T')[0]
  const fn = path === 'enhanced' ? enhancedCombinedSignal : resolveBacktestSignal
  return fn(TICKER, date, rows[i].close, closes, bars, window, { confidenceThreshold })
}

/** Scan backwards from the end for the first bar whose threshold-0 action matches. */
function findBar(action: 'BUY' | 'SELL', from = rows.length - 1, span = 600): number {
  for (let i = from; i > from - span && i >= 220; i--) {
    if (signalAt(i, 0).action === action) return i
  }
  return -1
}

describe('the enhanced path reads confidenceThreshold at its boundary', () => {
  it('fixture is real and long enough to reach the classifier', () => {
    expect(rows.length).toBeGreaterThan(1000)
  })

  it('a BUY at confidence c survives threshold c and becomes HOLD at c + 1', () => {
    const i = findBar('BUY')
    expect(i, 'no enhanced BUY bar found in the scan window').toBeGreaterThan(0)
    const c = signalAt(i, 0).confidence
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThanOrEqual(100)
    // `confidence < threshold` downgrades — so equality keeps the BUY.
    expect(signalAt(i, c).action).toBe('BUY')
    expect(signalAt(i, c + 1).action).toBe('HOLD')
  }, 60_000)

  it('SELL is exempt: no threshold can suppress an exit signal', () => {
    const i = findBar('SELL')
    expect(i, 'no enhanced SELL bar found in the scan window').toBeGreaterThan(0)
    expect(signalAt(i, 101).action).toBe('SELL')
  }, 60_000)
})

describe('end to end through backtestInstrument', () => {
  beforeEach(() => { vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '1') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('enhanced: a threshold no confidence can reach removes every trade', () => {
    const live = backtestInstrument(TICKER, SECTOR, rows)
    expect(live.totalTrades, 'fixture must trade at the default threshold').toBeGreaterThan(0)
    const blocked = backtestInstrument(TICKER, SECTOR, rows, { confidenceThreshold: 101 })
    expect(blocked.totalTrades).toBe(0)
  }, 120_000)
})

describe('the regime-only path — the production default — does NOT read it', () => {
  beforeEach(() => { vi.stubEnv('QUANTAN_USE_ENHANCED_SIGNAL', '0') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('CANNOT DO: identical results at threshold 0 and 101 (fails the day someone wires it in)', () => {
    const a = backtestInstrument(TICKER, SECTOR, rows, { confidenceThreshold: 0 })
    const b = backtestInstrument(TICKER, SECTOR, rows, { confidenceThreshold: 101 })
    expect(a.totalTrades, 'fixture must trade, or identical output proves nothing').toBeGreaterThan(0)
    expect(b).toEqual(a)
  }, 120_000)

  it('sizes every BUY at the fixed regime-path fraction the /backtest copy quotes', () => {
    // The two paths disagree bar by bar, so scan the regime path directly.
    let j = -1
    for (let k = rows.length - 1; k > rows.length - 900 && k >= 220; k--) {
      if (signalAt(k, 0, 'resolve').action === 'BUY') { j = k; break }
    }
    expect(j, 'no regime BUY bar found').toBeGreaterThan(0)
    expect(signalAt(j, 0, 'resolve').KellyFraction).toBe(REGIME_PATH_POSITION_FRACTION.halfKelly)
    expect(signalAt(j, 0, 'resolve').reason).toContain('regime-only path')
  }, 120_000)
})
