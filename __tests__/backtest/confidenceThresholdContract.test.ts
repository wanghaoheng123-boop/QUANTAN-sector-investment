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
import { loadBtcHistory, loadStockHistory, type OhlcvRow } from '@/lib/backtest/dataLoader'
import { backtestInstrument } from '@/lib/backtest/engine'
import { DEFAULT_CONFIG, enhancedCombinedSignal, resolveBacktestSignal } from '@/lib/backtest/signals'
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

  it('the REALISED first position is 15% of starting cash, rounded down to whole shares', () => {
    // Red-team R1: the previous test here read one bar's KellyFraction FIELD and
    // was titled "sizes every BUY" — it never looked at a position the engine
    // opened. This checks the position: cash is exactly the starting capital at
    // the first entry, so the bound is exact.
    const r = backtestInstrument(TICKER, SECTOR, rows)
    expect(r.closedTrades.length).toBeGreaterThan(0)
    const first = r.closedTrades[0]
    const allocation = DEFAULT_CONFIG.initialCapital * REGIME_PATH_POSITION_FRACTION.half
    expect(Number.isInteger(first.shares)).toBe(true)
    expect(first.value).toBeLessThanOrEqual(allocation)
    expect(first.value).toBeGreaterThan(allocation - first.entryPrice)
    expect(first.reason).toContain('regime-only path')
  }, 120_000)

  it('R1: a BUY that cannot afford one whole share is skipped — BTC never trades at this capital', () => {
    // The disclosure in the Rules grid ("an instrument priced above $15,000
    // cannot open its first position") is pinned to what the engine does.
    const btc = loadBtcHistory()
    const allocation = DEFAULT_CONFIG.initialCapital * REGIME_PATH_POSITION_FRACTION.half
    const closes = btc.map((r) => r.close)
    const bars = btc.map(({ open, high, low, close }) => ({ open, high, low, close }))
    const buyBars: number[] = []
    for (let i = 221; i < btc.length - 1; i += 1) {
      const date = new Date(btc[i].time * 1000).toISOString().split('T')[0]
      const sig = resolveBacktestSignal('BTC', date, btc[i].close, closes.slice(0, i + 1), bars.slice(0, i + 1), btc.slice(0, i + 1))
      if (sig.action === 'BUY') buyBars.push(i)
    }
    // Zero trades must come from the skip, not from an absence of signals.
    expect(buyBars.length, 'BTC has no regime BUY bars — the skip is untested').toBeGreaterThan(0)
    for (const i of buyBars) expect(btc[i + 1].open).toBeGreaterThan(allocation)
    expect(backtestInstrument('BTC', 'Crypto', btc).totalTrades).toBe(0)
  }, 240_000)
})
