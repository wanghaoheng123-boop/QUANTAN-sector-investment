/**
 * Shared label benchmark: 20-day forward return after BUY from resolveBacktestSignal.
 * Used by scripts/benchmark-signals.ts and signal parity tests.
 */

import type { OhlcvRow } from './dataLoader'
import { resolveBacktestSignal } from './signals'
import { netReturnAfterCosts, roundTripCostPct, type ExecutionCostConfig, DEFAULT_EXECUTION_COSTS } from './executionModel'
import { getProfileForTicker } from '@/lib/optimize/sectorProfiles'
import { useEnhancedCombinedSignal } from '@/lib/featureFlags'

export const LABEL_HOLD_DAYS = 20
export const WARMUP_BARS = 200

export interface LabelBenchmarkOptions {
  /** Force production regime path when true (CI canonical). */
  productionPath?: boolean
  costs?: ExecutionCostConfig
}

export interface LabelSignalOutcome {
  action: 'BUY' | 'HOLD' | 'SELL'
  grossReturn: number | null
  netReturn: number | null
  /** Regime zone at the signal bar (Q-066); null for non-BUY outcomes. */
  regimeZone: string | null
}

function sectorGatesForTicker(ticker: string) {
  if (!useEnhancedCombinedSignal()) return undefined
  return getProfileForTicker(ticker)
}

export function rowsToSignalInputs(rows: OhlcvRow[]) {
  const closes = rows.map((r) => r.close)
  const bars = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
  const ohlcvBars = rows.map((r) => ({
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume ?? 0,
    time: r.time,
  }))
  return { closes, bars, ohlcvBars }
}

/** SSOT signal at bar index `i` (signal at close[i], entry close[i+1]). */
export function signalAtBarIndex(
  rows: OhlcvRow[],
  i: number,
  ticker: string,
  options: LabelBenchmarkOptions = {},
): LabelSignalOutcome {
  if (i < WARMUP_BARS || i >= rows.length - LABEL_HOLD_DAYS - 1) {
    return { action: 'HOLD', grossReturn: null, netReturn: null, regimeZone: null }
  }

  const slice = rows.slice(0, i + 1)
  const { closes, bars, ohlcvBars } = rowsToSignalInputs(slice)
  const date = new Date(rows[i].time * 1000).toISOString().split('T')[0]
  const price = rows[i].close

  const prevEnhanced = process.env.QUANTAN_USE_ENHANCED_SIGNAL
  if (options.productionPath) {
    process.env.QUANTAN_USE_ENHANCED_SIGNAL = '0'
  }

  let action: 'BUY' | 'HOLD' | 'SELL' = 'HOLD'
  let regimeZone: string | null = null
  try {
    const sig = resolveBacktestSignal(
      ticker,
      date,
      price,
      closes,
      bars,
      ohlcvBars,
      {},
      sectorGatesForTicker(ticker),
    )
    action = sig.action
    regimeZone = sig.regime?.zone ?? null
  } finally {
    if (options.productionPath) {
      if (prevEnhanced === undefined) delete process.env.QUANTAN_USE_ENHANCED_SIGNAL
      else process.env.QUANTAN_USE_ENHANCED_SIGNAL = prevEnhanced
    }
  }

  if (action !== 'BUY') {
    return { action, grossReturn: null, netReturn: null, regimeZone: null }
  }

  const entryPrice = rows[i + 1].close
  const exitPrice = rows[Math.min(i + 1 + LABEL_HOLD_DAYS, rows.length - 1)].close
  // Fail closed on a corrupt entry OR exit close. The entry was already guarded;
  // the exit needs the same treatment — a non-finite/<=0 exit makes grossReturn
  // NaN, which slips through the caller's `== null` filter (NaN != null) and is
  // then counted as a loss (`NaN > 0` is false) while poisoning avgReturn20d.
  // Benchmark-neutral on the current dataset (0 non-finite/<=0 closes across all
  // 56 backtestData files / 70,796 rows); guards only a latent corrupt-bar case.
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 ||
      !Number.isFinite(exitPrice) || exitPrice <= 0) {
    return { action, grossReturn: null, netReturn: null, regimeZone: null }
  }
  const grossReturn = (exitPrice - entryPrice) / entryPrice
  const costs = options.costs ?? DEFAULT_EXECUTION_COSTS
  return {
    action,
    grossReturn,
    netReturn: netReturnAfterCosts(grossReturn, costs),
    regimeZone,
  }
}

export interface InstrumentLabelStats {
  ticker: string
  sector: string
  bars: number
  buySignals: number
  wins: number
  losses: number
  winRate: number | null
  netWinRate: number | null
  avgReturn20d: number | null
  avgNetReturn20d: number | null
  bnhReturn: number
  /**
   * Per-BUY trade detail (Q-065/Q-066 additive; barIndex/date added by the
   * 2026-07-11 rethink): net/gross 20d label return + the regime zone, plus
   * the SIGNAL bar's index and ISO date — needed for non-overlapping
   * (effective-n) statistics and per-year edge tables. Ascending barIndex;
   * length === buySignals.
   */
  trades: { zone: string; grossReturn: number; netReturn: number; barIndex: number; date: string }[]
}

export function runInstrumentLabelBenchmark(
  ticker: string,
  sector: string,
  rows: OhlcvRow[],
  options: LabelBenchmarkOptions = {},
): InstrumentLabelStats | null {
  if (rows.length < 252) return null

  let wins = 0
  let losses = 0
  let netWins = 0
  let netLosses = 0
  let buyCount = 0
  const returns20d: number[] = []
  const netReturns20d: number[] = []
  const trades: { zone: string; grossReturn: number; netReturn: number; barIndex: number; date: string }[] = []

  for (let i = WARMUP_BARS; i < rows.length - LABEL_HOLD_DAYS - 1; i++) {
    const out = signalAtBarIndex(rows, i, ticker, options)
    if (out.action !== 'BUY' || out.grossReturn == null || out.netReturn == null) continue
    buyCount++
    returns20d.push(out.grossReturn)
    netReturns20d.push(out.netReturn)
    trades.push({
      zone: out.regimeZone ?? 'UNKNOWN',
      grossReturn: out.grossReturn,
      netReturn: out.netReturn,
      barIndex: i,
      date: new Date(rows[i].time * 1000).toISOString().slice(0, 10),
    })
    if (out.grossReturn > 0) wins++
    else losses++
    if (out.netReturn > 0) netWins++
    else netLosses++
  }

  const closes = rows.map((r) => r.close)
  const bnhReturn = (closes[closes.length - 1] - closes[0]) / closes[0]

  return {
    ticker,
    sector,
    bars: closes.length,
    buySignals: buyCount,
    wins,
    losses,
    winRate: buyCount > 0 ? wins / buyCount : null,
    netWinRate: buyCount > 0 ? netWins / buyCount : null,
    avgReturn20d: returns20d.length > 0 ? returns20d.reduce((a, b) => a + b, 0) / returns20d.length : null,
    avgNetReturn20d: netReturns20d.length > 0 ? netReturns20d.reduce((a, b) => a + b, 0) / netReturns20d.length : null,
    bnhReturn,
    trades,
  }
}

export { roundTripCostPct }
