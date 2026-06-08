/**
 * Live desk signal adapter — maps OHLCV rows to API payload using resolveBacktestSignal (SSOT).
 */

import type { OhlcvRow } from './dataLoader'
import { resolveBacktestSignal } from './signals'
import { rowsToSignalInputs } from './benchmarkLabel'
import type { OhlcBar } from '@/lib/quant/indicators'
// Indicators imported from the canonical SSOT directly (not re-exported via signals.ts).
import {
  rsiArray as rsi,
  macdArray as macdFn,
  atrArray as atr,
  bollingerArray as bollinger,
} from '@/lib/quant/indicators'

export interface LiveInstrumentSignal {
  ticker: string
  sector: string
  price: number
  changePct: number | null
  zone: string
  dipSignal: string
  deviationPct: number | null
  slopePct: number | null
  slopePositive: boolean | null
  rsi14: number | null
  atr14: number | null
  atrPct: number | null
  macdHist: number | null
  bbPctB: number | null
  action: 'BUY' | 'HOLD' | 'SELL'
  confidence: number
  KellyFraction: number
  regimeColor: string
  candles: number
  lastDate: string | null
  signalReason: string
}

export const REGIME_COLORS: Record<string, string> = {
  EXTREME_BULL: '#ef4444',
  EXTENDED_BULL: '#f97316',
  HEALTHY_BULL: '#22c55e',
  FIRST_DIP: '#84cc16',
  DEEP_DIP: '#eab308',
  BEAR_ALERT: '#f97316',
  CRASH_ZONE: '#ef4444',
  INSUFFICIENT_DATA: '#64748b',
}

export function buildLiveInstrumentSignal(
  rows: OhlcvRow[],
  ticker: string,
  sector: string,
): LiveInstrumentSignal | null {
  if (rows.length < 200) return null

  const closes = rows.map((r) => r.close)
  const bars: OhlcBar[] = rows.map(({ open, high, low, close }) => ({ open, high, low, close }))
  const price = closes[closes.length - 1]
  const prevPrice = closes[closes.length - 2]
  const changePct = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : null

  const rsiVals = rsi(closes)
  const macdVals = macdFn(closes)
  const atrVals = atr(bars)
  const bbVals = bollinger(closes)

  const rsi14 = rsiVals[rsiVals.length - 1]
  const macdHist = macdVals.histogram[macdVals.histogram.length - 1]
  const atrLast = atrVals[atrVals.length - 1]
  const bbPctB = bbVals.pctB[bbVals.pctB.length - 1]
  const atrPct =
    Number.isFinite(atrLast) && Number.isFinite(price) && price > 0
      ? (atrLast / price) * 100
      : NaN

  const lastDate =
    rows.length > 0
      ? new Date(rows[rows.length - 1].time * 1000).toISOString().split('T')[0]
      : null

  const { closes: lbCloses, bars: lbBars, ohlcvBars } = rowsToSignalInputs(rows)
  const sig = resolveBacktestSignal(
    ticker,
    lastDate ?? '',
    price,
    lbCloses,
    lbBars,
    ohlcvBars,
  )

  const reg = sig.regime

  return {
    ticker,
    sector,
    price,
    changePct,
    zone: reg.zone,
    dipSignal: reg.dipSignal,
    deviationPct: reg.deviationPct,
    slopePct: reg.slopePct,
    slopePositive: reg.slopePositive,
    rsi14: Number.isFinite(rsi14) ? rsi14 : null,
    atr14: Number.isFinite(atrLast) ? atrLast : null,
    atrPct: Number.isFinite(atrPct) ? atrPct : null,
    macdHist: Number.isFinite(macdHist) ? macdHist : null,
    bbPctB: Number.isFinite(bbPctB) ? bbPctB : null,
    action: sig.action,
    confidence: sig.confidence,
    KellyFraction: sig.KellyFraction,
    regimeColor: REGIME_COLORS[reg.zone] ?? '#64748b',
    candles: closes.length,
    lastDate,
    signalReason: sig.reason,
  }
}
