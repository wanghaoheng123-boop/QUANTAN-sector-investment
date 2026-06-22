import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadStockHistory } from '@/lib/backtest/dataLoader'
import { signalAtBarIndex, LABEL_HOLD_DAYS, WARMUP_BARS } from '@/lib/backtest/benchmarkLabel'

/**
 * Q08: the label benchmark guarded `entryPrice` but NOT `exitPrice`. A corrupt
 * exit close (non-finite or <=0) makes grossReturn NaN, which slips through the
 * caller's `out.grossReturn == null` filter (NaN != null) and is then counted as
 * a loss (`NaN > 0` is false) while poisoning avgReturn20d. The fix fails closed
 * on a bad exit, symmetric with the existing entry guard.
 *
 * Uses real committed AAPL data (scripts/backtestData/AAPL.json) so the BUY path
 * is exercised through the production resolveBacktestSignal, not a synthetic stub.
 */
describe('benchmarkLabel — corrupt-exit fail-closed guard (Q08)', () => {
  const prevFlag = process.env.QUANTAN_USE_ENHANCED_SIGNAL
  beforeEach(() => { process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0' })
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.QUANTAN_USE_ENHANCED_SIGNAL
    else process.env.QUANTAN_USE_ENHANCED_SIGNAL = prevFlag
  })

  /** First bar (with room for a full 20-day exit) where the production path BUYs. */
  function firstBuyBar(rows: ReturnType<typeof loadStockHistory>): number {
    for (let i = WARMUP_BARS; i < rows.length - LABEL_HOLD_DAYS - 1; i++) {
      if (signalAtBarIndex(rows, i, 'AAPL', { productionPath: true }).action === 'BUY') return i
    }
    return -1
  }

  it('corrupt EXIT close → null returns (not a NaN-counted loss); action unchanged', () => {
    const rows = loadStockHistory('AAPL')
    if (rows.length < 300) return // committed data should be present in CI; no-op if absent

    const buyBar = firstBuyBar(rows)
    expect(buyBar).toBeGreaterThan(-1) // fixture sanity: AAPL produces a BUY

    // Clean baseline: a real BUY yields finite gross/net returns.
    const clean = signalAtBarIndex(rows, buyBar, 'AAPL', { productionPath: true })
    expect(clean.action).toBe('BUY')
    expect(clean.grossReturn).not.toBeNull()
    expect(Number.isFinite(clean.grossReturn as number)).toBe(true)
    expect(Number.isFinite(clean.netReturn as number)).toBe(true)

    const exitIdx = Math.min(buyBar + 1 + LABEL_HOLD_DAYS, rows.length - 1)
    expect(exitIdx).toBeGreaterThan(buyBar) // exit bar is outside the signal slice [0..buyBar]

    for (const badClose of [NaN, Infinity, 0, -5]) {
      const corrupted = rows.map((r, idx) => (idx === exitIdx ? { ...r, close: badClose } : r))
      const out = signalAtBarIndex(corrupted, buyBar, 'AAPL', { productionPath: true })
      // The signal is computed from rows[0..buyBar], so corrupting the exit can't change it:
      expect(out.action).toBe('BUY')
      // ...but the return must fail closed rather than emit NaN/garbage:
      expect(out.grossReturn).toBeNull()
      expect(out.netReturn).toBeNull()
    }
  })

  it('corrupt ENTRY close → null returns (regression lock on the pre-existing entry guard)', () => {
    const rows = loadStockHistory('AAPL')
    if (rows.length < 300) return

    const buyBar = firstBuyBar(rows)
    expect(buyBar).toBeGreaterThan(-1)

    const entryIdx = buyBar + 1 // entry is the bar AFTER the signal; also outside the slice
    const corrupted = rows.map((r, idx) => (idx === entryIdx ? { ...r, close: NaN } : r))
    const out = signalAtBarIndex(corrupted, buyBar, 'AAPL', { productionPath: true })
    expect(out.action).toBe('BUY')
    expect(out.grossReturn).toBeNull()
    expect(out.netReturn).toBeNull()
  })
})
