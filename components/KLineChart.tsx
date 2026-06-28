'use client'

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import type { ChartEmaPeriod } from '@/lib/chartEma'
import {
  CHART_EMA_PERIODS,
} from '@/lib/chartEma'
import { sortChartCandles } from '@/lib/sortChartCandles'
import {
  rsiArray,
  atrArray,
  type OhlcBar,
} from '@/lib/quant/indicators'
import { useKLineChart } from '@/hooks/useKLineChart'

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'] as const
type Timeframe = typeof TIMEFRAMES[number]

interface Candle {
  // Phase 14 wave 29: widened to `string | number` to remove the
  // `candles={candles as any}` cast in app/crypto/btc/page.tsx. The
  // lightweight-charts `Time` type accepts both: a string like '2024-05-15'
  // (BusinessDay form) OR a UTCTimestamp number (Unix seconds). BTC candles
  // arrive as Unix seconds; equity candles arrive as YYYY-MM-DD strings.
  // Both paths funnel through here, so the type must accept both.
  time: string | number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface DarkPoolMarker {
  time: string
  price: number
  size: number
  sentiment: 'BULLISH' | 'BEARISH'
}

interface NewsMarker {
  time: string
  headline: string
  impact: 'positive' | 'negative' | 'neutral'
}

// KLineIndicatorFlags lives in ./klineTypes (neutral leaf) to avoid a
// KLineChart ↔ useKLineChart cycle; re-exported here so the public import
// path `@/components/KLineChart` is unchanged for callers.
export type { KLineIndicatorFlags } from './klineTypes'
import type { KLineIndicatorFlags } from './klineTypes'

interface KLineChartProps {
  candles: Candle[]
  darkPoolMarkers?: DarkPoolMarker[]
  newsMarkers?: NewsMarker[]
  color: string
  ticker: string
  range?: string
  showRSI?: boolean
  indicators?: KLineIndicatorFlags
  /** Callback when user selects a timeframe (only when built-in selector is shown) */
  onTimeframeChange?: (tf: Timeframe) => void
  /** When set, parent page controls range via its own toolbar — hide duplicate timeframe row */
  hideTimeframeSelector?: boolean
}

const DEFAULT_INDICATORS: Required<KLineIndicatorFlags> = {
  ema4: false, ema5: false, ema6: false, ema7: false, ema8: false,
  ema9: true, ema10: false, ema12: false,
  ema15: false, ema20: true, ema21: false, ema26: false,
  ema30: false, ema40: false,
  ema50: true, ema60: false,
  ema100: false,
  ema150: false,
  ema200: true,
  ema250: false,
  vwap: false,
  bollingerBands: false,
  fibonacci: false,
  volSma: true,
}

import { CHART_EMA_COLORS } from '@/lib/chartEma'
import type { ChartEmaKey } from '@/lib/chartEma'

const EMA_LEGEND_TAILWIND: Record<ChartEmaPeriod, string> = {
  4:   'bg-cyan-300',
  5:   'bg-cyan-400',
  6:   'bg-cyan-500',
  7:   'bg-cyan-700',
  8:   'bg-cyan-600',
  9:   'bg-lime-500',
  10:  'bg-lime-400',
  12:  'bg-lime-600',
  15:  'bg-amber-400',
  20:  'bg-amber-500',
  21:  'bg-orange-500',
  26:  'bg-orange-600',
  30:  'bg-yellow-600',
  40:  'bg-amber-600',
  50:  'bg-violet-500',
  60:  'bg-violet-600',
  100: 'bg-pink-500',
  150: 'bg-teal-500',
  200: 'bg-slate-400',
  250: 'bg-orange-400',
}

function isEmaLineVisible(ind: KLineIndicatorFlags, period: ChartEmaPeriod): boolean {
  if (period === 9) return ind.ema9 !== false
  if (period === 20) return ind.ema20 !== false
  if (period === 50) return ind.ema50 !== false
  if (period === 200) return ind.ema200 !== false
  const k = `ema${period}` as keyof KLineIndicatorFlags
  return ind[k] === true
}

type VisKey = ChartEmaKey | 'vwap' | 'bollingerBands' | 'fibonacci' | 'volSma'

function buildVisFromProps(ind: KLineIndicatorFlags): Record<VisKey, boolean> {
  const out = {} as Record<VisKey, boolean>
  for (const p of CHART_EMA_PERIODS) {
    const k = `ema${p}` as ChartEmaKey
    out[k] = isEmaLineVisible(ind, p)
  }
  out.vwap = ind.vwap === true
  out.bollingerBands = ind.bollingerBands === true
  out.fibonacci = ind.fibonacci === true
  out.volSma = ind.volSma !== false // default ON; reflects the real series visibility
  return out
}

// ─── Indicator helpers for display-only values (RSI/ATR in legend) ───────────

function calcRSIForDisplay(prices: number[], period = 14): number[] {
  return rsiArray(prices, period)
}

function calcATRForDisplay(candles: Candle[], period = 14): number[] {
  const bars: OhlcBar[] = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
  return atrArray(bars, period)
}

// ─────────────────────────────────────────────────────────────────
// Chart component
// ─────────────────────────────────────────────────────────────────

export default function KLineChart({
  candles,
  darkPoolMarkers = [],
  newsMarkers = [],
  color,
  ticker,
  showRSI = true,
  indicators: indicatorsIn,
  onTimeframeChange,
  hideTimeframeSelector,
}: KLineChartProps) {
  // R5-M-1 (Phase 14): warn when a caller passes a partial `indicators`
  // object. The spread below silently fills missing keys with defaults,
  // which masks bugs where a parent forgot to wire up a new flag. The
  // warning fires once per render where the prop is partial — dev only.
  if (process.env.NODE_ENV !== 'production' && indicatorsIn) {
    for (const k of Object.keys(DEFAULT_INDICATORS)) {
      if (!(k in indicatorsIn)) {
        // eslint-disable-next-line no-console
        console.warn(`KLineChart: indicators prop missing key "${k}" — using default`)
      }
    }
  }

  const indicatorsProp = useMemo(
    () => ({ ...DEFAULT_INDICATORS, ...indicatorsIn }),
    [indicatorsIn]
  )

  // DOM container refs (owned here; passed to hook)
  const containerRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)
  const atrRef = useRef<HTMLDivElement>(null)

  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('3M')
  const showBuiltinTimeframes = hideTimeframeSelector !== true && onTimeframeChange != null

  const sortedCandlesPreview = useMemo(() => sortChartCandles(candles), [candles])

  const [vis, setVis] = useState<Record<VisKey, boolean>>(() => buildVisFromProps(indicatorsProp))

  useEffect(() => {
    const next = buildVisFromProps(indicatorsProp)
    setVis((prev) => {
      // Only update if values actually changed — prevents cascading re-renders
      // when indicatorsProp reference changes but content is identical
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev
      return next
    })
  }, [indicatorsProp])

  // R5-C-1 (Phase 14 S1): stable primitive dep for `vis` state.
  const visSerialised = useMemo(() => JSON.stringify(vis), [vis])

  // ── Chart lifecycle hook ───────────────────────────────────────
  const {
    chartReadyGen,
    initError,
    crosshairData,
    emaLineRefs,
    vwapRef,
    bbUpperRef,
    bbMidRef,
    bbLowerRef,
    volSmaRef,
  } = useKLineChart({
    containerRef,
    rsiRef,
    macdRef,
    atrRef,
    candles,
    darkPoolMarkers,
    newsMarkers,
    color,
    showRSI,
    indicatorsProp,
    visSerialised,
    vis,
  })

  // Keep series visibility in sync when parent indicator preset changes (refs exist after mount).
  useEffect(() => {
    for (const p of CHART_EMA_PERIODS) {
      emaLineRefs.current[p]?.applyOptions({ visible: isEmaLineVisible(indicatorsProp, p) })
    }
    vwapRef.current?.applyOptions({ visible: indicatorsProp.vwap === true })
    const bb = indicatorsProp.bollingerBands === true
    bbUpperRef.current?.applyOptions({ visible: bb })
    bbMidRef.current?.applyOptions({ visible: bb })
    bbLowerRef.current?.applyOptions({ visible: bb })
    volSmaRef.current?.applyOptions({ visible: indicatorsProp.volSma !== false })
  }, [indicatorsProp, emaLineRefs, vwapRef, bbUpperRef, bbMidRef, bbLowerRef, volSmaRef])

  const INDICATOR_DEFS = useMemo(() => {
    const emaDefs = CHART_EMA_PERIODS.map((p) => ({
      key: `ema${p}` as ChartEmaKey,
      label: `EMA ${p}`,
      color: EMA_LEGEND_TAILWIND[p],
    }))
    return [
      ...emaDefs,
      { key: 'vwap' as const, label: 'VWAP', color: 'bg-cyan-500' },
      { key: 'bollingerBands' as const, label: 'BB(20,2)', color: 'bg-amber-400/60' },
      { key: 'fibonacci' as const, label: 'Fib', color: 'bg-rose-400/60' },
      { key: 'volSma' as const, label: 'Vol SMA(20)', color: 'bg-indigo-400/60' },
    ]
  }, [])

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setSelectedTimeframe(tf)
    onTimeframeChange?.(tf)
  }, [onTimeframeChange])

  const latestCandle = sortedCandlesPreview[sortedCandlesPreview.length - 1]
  const isUp = latestCandle ? latestCandle.close >= latestCandle.open : true
  const priceStr = latestCandle
    ? `$${latestCandle.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : ''
  const chgPct = latestCandle && latestCandle.open > 0
    ? (((latestCandle.close - latestCandle.open) / latestCandle.open) * 100).toFixed(2)
    : '0.00'
  const volStr = latestCandle
    ? latestCandle.volume >= 1_000_000
      ? `${(latestCandle.volume / 1_000_000).toFixed(2)}M`
      : latestCandle.volume >= 1_000
        ? `${(latestCandle.volume / 1_000).toFixed(1)}K`
        : String(latestCandle.volume.toFixed(0))
    : ''
  const rangeStr = latestCandle
    ? `H $${latestCandle.high.toLocaleString('en-US', { maximumFractionDigits: 0 })} L $${latestCandle.low.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : ''

  const activeIndicators = INDICATOR_DEFS.filter((d) => vis[d.key])

  // Memoize last RSI and ATR to avoid recomputing on every render (e.g., crosshair move)
  const latestRsi = useMemo<number | null>(() => {
    if (sortedCandlesPreview.length < 15) return null
    const closes = sortedCandlesPreview.map(c => c.close)
    const vals = calcRSIForDisplay(closes, 14)
    const last = vals[vals.length - 1]
    return Number.isFinite(last) ? last : null
  }, [sortedCandlesPreview])

  const latestAtr14 = useMemo<number | null>(() => {
    if (sortedCandlesPreview.length < 15) return null
    const vals = calcATRForDisplay(sortedCandlesPreview, 14)
    const last = vals[vals.length - 1]
    return Number.isFinite(last) ? last : null
  }, [sortedCandlesPreview])

  // Suppress unused-variable warning for chartReadyGen (used only to trigger hook's data effect)
  void chartReadyGen

  return (
    <div className="relative select-none">
      {/* Built-in timeframe row only when parent does not own range (stock/sector/BTC pages use page toolbar). */}
      {showBuiltinTimeframes && (
      <div className="flex items-center gap-1 px-3 py-2 bg-slate-950/80 border-b border-slate-800/50">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => handleTimeframeChange(tf)}
            className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all ${
              selectedTimeframe === tf
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 border border-transparent'
            }`}
          >
            {tf}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {/* VP hint */}
          <span className="text-[10px] text-slate-400 font-mono">VP</span>
          <span className="text-[10px] text-slate-700">|</span>
          {/* Crosshair OHLCV display */}
          {crosshairData ? (
            <div className="flex items-center gap-3 text-[10px] font-mono">
              <span className="text-slate-400">
                O <span className="text-slate-300">{crosshairData.open.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                H <span className="text-green-400">{crosshairData.high.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                L <span className="text-red-400">{crosshairData.low.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                C <span className={crosshairData.close >= crosshairData.open ? 'text-green-400' : 'text-red-400'}>{crosshairData.close.toFixed(2)}</span>
              </span>
              <span className="text-slate-400">
                Vol <span className="text-slate-300">{crosshairData.volume >= 1000000 ? (crosshairData.volume / 1000000).toFixed(2) + 'M' : crosshairData.volume >= 1000 ? (crosshairData.volume / 1000).toFixed(1) + 'K' : crosshairData.volume.toFixed(0)}</span>
              </span>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-slate-400">
              {priceStr} {isUp ? '+' : ''}{chgPct}%
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Enhanced legend with price / change / volume ── */}
      <div className={`absolute ${showBuiltinTimeframes ? 'top-[52px]' : 'top-2'} left-3 right-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-slate-950/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-800/50 max-h-[min(40vh,220px)] overflow-y-auto`}>
        {/* Live price summary */}
        <span className={`text-sm font-mono font-bold mr-1 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? '▲' : '▼'} {priceStr}
        </span>
        <span className={`text-xs font-mono ${isUp ? 'text-green-400/80' : 'text-red-400/80'}`}>
          {isUp ? '+' : ''}{chgPct}%
        </span>
        {volStr && (
          <span className="text-xs font-mono text-slate-500 border-l border-slate-700 pl-2">
            Vol {volStr}
          </span>
        )}
        {rangeStr && (
          <span className="text-[10px] font-mono text-slate-400">
            {rangeStr}
          </span>
        )}
        <span className="border-l border-slate-700 pl-2 flex items-center gap-1.5">
          {activeIndicators.map((d) => (
            <span key={d.key} className="flex items-center gap-1 shrink-0">
              <span className={`w-4 h-0.5 ${d.color} inline-block rounded`} />
              <span className="text-slate-400">{d.label}</span>
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-blue-400 text-[10px]">●</span>
          <span className="text-slate-400">Dark Pool</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="text-green-400 text-[10px]">▲</span>
          <span className="text-slate-400">News</span>
        </span>
      </div>

      {/* F6.2 (Phase 13 S2): chart text alternative for screen readers — WCAG 1.1.1 + 4.1.2.
          The canvas itself isn't accessible to AT; this role+aria-label gives a summary. */}
      <div
        ref={containerRef}
        role="img"
        aria-label={
          // KL-4 (WS-F F1): on async-init failure, tell AT users the chart
          // failed rather than leaving a perpetual "loading" label.
          initError
            ? `Price chart for ${ticker} failed to load. Try refreshing the page.`
            : sortedCandlesPreview.length > 0 && latestCandle
            ? `Price chart for ${ticker}: ${sortedCandlesPreview.length} candles. ` +
              `Latest close ${latestCandle.close?.toFixed(2) ?? 'N/A'}, ` +
              `range ${Math.min(...sortedCandlesPreview.map(c => c.low ?? Infinity)).toFixed(2)}–` +
              `${Math.max(...sortedCandlesPreview.map(c => c.high ?? 0)).toFixed(2)}.`
            : `Price chart for ${ticker} (loading)`
        }
        className="w-full rounded-t-lg overflow-hidden min-h-[200px]"
      />

      {/* KL-4 (WS-F F1): visible fallback when the chart canvas fails to
          initialise (e.g. a dynamic-import chunk-load error). Rendered as a
          SIBLING — never a child of the lightweight-charts-managed container —
          to avoid React reconciling against the imperatively-appended canvas. */}
      {initError && (
        <div
          role="alert"
          className="flex w-full items-center justify-center px-4 py-6 text-center text-xs text-slate-400"
        >
          Chart failed to load. Try refreshing the page.
        </div>
      )}

      {showRSI && (
        <>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">
              RSI(14) {latestRsi != null ? latestRsi.toFixed(1) : '—'}
            </div>
            <div ref={rsiRef} className="w-full overflow-hidden" />
          </div>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">
              MACD(12,26,9)
            </div>
            <div ref={macdRef} className="w-full overflow-hidden" />
          </div>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">
              ATR(14) {latestAtr14 != null ? `$${latestAtr14.toFixed(2)}` : '—'}
            </div>
            <div ref={atrRef} className="w-full rounded-b-lg overflow-hidden" />
          </div>
        </>
      )}
    </div>
  )
}
