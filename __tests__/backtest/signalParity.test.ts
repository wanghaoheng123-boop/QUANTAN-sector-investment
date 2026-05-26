import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadStockHistory } from '@/lib/backtest/dataLoader'
import { resolveBacktestSignal } from '@/lib/backtest/signals'
import { signalAtBarIndex, rowsToSignalInputs } from '@/lib/backtest/benchmarkLabel'
import { buildLiveInstrumentSignal } from '@/lib/backtest/liveSignal'

describe('signal SSOT parity', () => {
  const prevFlag = process.env.QUANTAN_USE_ENHANCED_SIGNAL

  beforeEach(() => {
    process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'
  })

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.QUANTAN_USE_ENHANCED_SIGNAL
    else process.env.QUANTAN_USE_ENHANCED_SIGNAL = prevFlag
  })

  it('benchmark label helper matches resolveBacktestSignal on AAPL sample bars', () => {
    const rows = loadStockHistory('AAPL')
    if (rows.length < 300) return

    const indices = [220, 400, rows.length - 30]
    for (const i of indices) {
      const label = signalAtBarIndex(rows, i, 'AAPL', { productionPath: true })
      const slice = rows.slice(0, i + 1)
      const { closes, bars, ohlcvBars } = rowsToSignalInputs(slice)
      const date = new Date(rows[i].time * 1000).toISOString().split('T')[0]
      const direct = resolveBacktestSignal('AAPL', date, rows[i].close, closes, bars, ohlcvBars)
      expect(label.action).toBe(direct.action)
    }
  })

  it('live adapter matches resolveBacktestSignal on latest bar', () => {
    const rows = loadStockHistory('AAPL')
    if (rows.length < 220) return

    const live = buildLiveInstrumentSignal(rows, 'AAPL', 'Technology')
    expect(live).not.toBeNull()

    const { closes, bars, ohlcvBars } = rowsToSignalInputs(rows)
    const date = live!.lastDate ?? ''
    const direct = resolveBacktestSignal('AAPL', date, live!.price, closes, bars, ohlcvBars)

    expect(live!.action).toBe(direct.action)
    expect(live!.confidence).toBe(direct.confidence)
    expect(live!.KellyFraction).toBe(direct.KellyFraction)
  })
})
