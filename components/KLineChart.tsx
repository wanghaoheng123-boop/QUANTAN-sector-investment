'use client'

import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
  SeriesMarker,
  SeriesMarkerPosition,
  SeriesMarkerShape,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import {
  CHART_EMA_COLORS,
  CHART_EMA_PERIODS,
  type ChartEmaKey,
  type ChartEmaPeriod,
} from '@/lib/chartEma'

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '6M', '1Y', 'ALL'] as const
type Timeframe = typeof TIMEFRAMES[number]

interface Candle {
  time: string
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

export type KLineIndicatorFlags = {
  ema4?: boolean;  ema5?: boolean;  ema6?: boolean;  ema7?: boolean;  ema8?: boolean;
  ema9?: boolean;  ema10?: boolean; ema12?: boolean;
  ema15?: boolean; ema20?: boolean; ema21?: boolean; ema26?: boolean;
  ema30?: boolean; ema40?: boolean;
  ema50?: boolean; ema60?: boolean;
  ema100?: boolean;
  ema150?: boolean;
  ema200?: boolean;
  ema250?: boolean;
  vwap?: boolean
  bollingerBands?: boolean
  fibonacci?: boolean
}

interface KLineChartProps {
  candles: Candle[]
  darkPoolMarkers?: DarkPoolMarker[]
  newsMarkers?: NewsMarker[]
  color: string
  ticker: string
  range?: string
  showRSI?: boolean
  indicators?: KLineIndicatorFlags
  /** Fires whenever a user toggles an indicator via the chart overlay buttons.
   *  Use this to sync the external indicator selection state (e.g. for a side panel). */
  onIndicatorsChange?: (vis: Record<VisKey, boolean>) => void
  /** Callback when user selects a timeframe */
  onTimeframeChange?: (tf: Timeframe) => void
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
}

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
  out.volSma = true // always visible by default; user can toggle via legend
  return out
}

// ─────────────────────────────────────────────────────────────────
// Pure indicator math — all functions are O(n) total, called once
// per dataset change, NOT per candle update.
// ─────────────────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const ema: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period) return ema
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  ema[period - 1] = prev
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k)
    ema[i] = prev
  }
  return ema
}

function calcRSI(prices: number[], period = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(NaN)
  if (prices.length < period + 1) return rsi
  let avgGain = 0,
    avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9) {
  const result = new Array(prices.length).fill({ macd: NaN, signal: NaN, histogram: NaN })
  if (prices.length < slow) return result
  const fastEma = calcEMA(prices, fast)
  const slowEma = calcEMA(prices, slow)
  for (let i = slow - 1; i < prices.length; i++)
    result[i] = { macd: fastEma[i] - slowEma[i], signal: NaN, histogram: NaN }
  const validMacd = result.map((r) => r.macd).slice(slow - 1)
  const signalEma = calcEMA(validMacd, signal)
  for (let i = 0; i < signalEma.length; i++) {
    const idx = i + slow - 1
    const m = result[idx].macd,
      s = signalEma[i]
    result[idx] = { macd: m, signal: s, histogram: !isNaN(m) && !isNaN(s) ? m - s : NaN }
  }
  return result
}

function calcBollingerBands(prices: number[], period = 20, std = 2) {
  const result = new Array(prices.length).fill({ mid: NaN, upper: NaN, lower: NaN })
  if (prices.length < period) return result
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    result[i] = {
      mid: mean,
      upper: mean + std * Math.sqrt(variance),
      lower: mean - std * Math.sqrt(variance),
    }
  }
  return result
}

function calcVWAP(candles: Candle[]): { time: Time; value: number }[] {
  let cumulativeTPV = 0,
    cumulativeVol = 0
  return candles.map((c) => {
    const tpv = ((c.high + c.low + c.close) / 3) * c.volume
    cumulativeTPV += tpv
    cumulativeVol += c.volume
    return { time: c.time as Time, value: cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : NaN }
  })
}

function calcATR(candles: Candle[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low)
    } else {
      const hl = candles[i].high - candles[i].low
      const hc = Math.abs(candles[i].high - candles[i - 1].close)
      const lc = Math.abs(candles[i].low - candles[i - 1].close)
      tr.push(Math.max(hl, hc, lc))
    }
  }
  const atr: number[] = new Array(tr.length).fill(NaN)
  if (tr.length < period) return atr
  let avg = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  atr[period - 1] = avg
  for (let i = period; i < tr.length; i++) {
    avg = (avg * (period - 1) + tr[i]) / period
    atr[i] = avg
  }
  return atr
}

function calcVolumeSMA(volumes: number[], period = 20): number[] {
  const sma: number[] = new Array(volumes.length).fill(NaN)
  if (volumes.length < period) return sma
  let avg = volumes.slice(0, period).reduce((a, b) => a + b, 0) / period
  sma[period - 1] = avg
  for (let i = period; i < volumes.length; i++) {
    avg = (avg * (period - 1) + volumes[i]) / period
    sma[i] = avg
  }
  return sma
}

// ─────────────────────────────────────────────────────────────────
// Chart component
// ─────────────────────────────────────────────────────────────────

export default function KLineChart({
  candles,
  darkPoolMarkers = [],
  newsMarkers = [],
  color,
  showRSI = true,
  indicators: indicatorsIn,
  onIndicatorsChange,
}: KLineChartProps) {
  const indicatorsProp = useMemo(
    () => ({ ...DEFAULT_INDICATORS, ...indicatorsIn }),
    [indicatorsIn]
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)
  const atrRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const emaLineRefs = useRef<Partial<Record<ChartEmaPeriod, ISeriesApi<'Line'>>>>({})
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const rsiLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiObRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiOsRef = useRef<ISeriesApi<'Line'> | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const macdSignalRef = useRef<ISeriesApi<'Line'> | null>(null)
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const macdZeroRef = useRef<ISeriesApi<'Line'> | null>(null)
  const atrChartRef = useRef<IChartApi | null>(null)
  const atrLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const volSmaRef = useRef<ISeriesApi<'Line'> | null>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)

  const prevCandlesLenRef = useRef(0)
  const firstBarTimeRef = useRef<string | number | null>(null)

  /** Bumped when async chart `init()` finishes so the data effect runs after `candleRef` exists. */
  const [chartReadyGen, setChartReadyGen] = useState(0)
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>('3M')

  const indicators = useMemo(() => indicatorsProp, [indicatorsProp])

  const [vis, setVis] = useState<Record<VisKey, boolean>>(() => buildVisFromProps(indicatorsProp))

  const [crosshairData, setCrosshairData] = useState<{
    price: number
    time: string
    open: number
    high: number
    low: number
    close: number
    volume: number
  } | null>(null)

  useEffect(() => {
    setVis(buildVisFromProps(indicatorsProp))
  }, [indicatorsProp])

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
  }, [indicatorsProp])

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

  // ── A. Mount: create chart once ─────────────────────────────────
  useEffect(() => {
    let mounted = true
    if (!containerRef.current) return

    const init = async () => {
      const { createChart, CrosshairMode, LineStyle } = await import('lightweight-charts')
      if (!mounted || !containerRef.current) return

      const main = createChart(containerRef.current, {
        layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: '#64748b',
            labelBackgroundColor: '#0f172a',
            lineStyle: LineStyle.Dashed,
            lineWidth: 1,
            labelVisible: true,
            showLabelOnlyOnLastLine: true,
          },
          horzLine: {
            color: '#64748b',
            labelBackgroundColor: '#0f172a',
            lineStyle: LineStyle.Dashed,
            lineWidth: 1,
            labelVisible: true,
            showLabelOnlyOnLastLine: true,
          },
        },
        rightPriceScale: { borderColor: '#1e1e2e' },
        timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false, rightOffset: 5 },
        width: containerRef.current.clientWidth,
        height: showRSI ? 280 : 380,
      })

      // Subscribe to crosshair move for OHLCV tooltip
      main.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData.size) {
          setCrosshairData(null)
          return
        }
        const candleData = param.seriesData.get(candleRef.current)
        const volumeData = param.seriesData.get(volumeRef.current)
        if (candleData && 'open' in candleData) {
          setCrosshairData({
            time: String(param.time),
            open: candleData.open,
            high: candleData.high,
            low: candleData.low,
            close: candleData.close,
            price: candleData.close,
            volume: volumeData && 'value' in volumeData ? volumeData.value : 0,
          })
        }
      })
      chartRef.current = main

      const cs = main.addCandlestickSeries({
        upColor: '#00d084',
        downColor: '#ff4757',
        borderUpColor: '#00d084',
        borderDownColor: '#ff4757',
        wickUpColor: '#00d084',
        wickDownColor: '#ff4757',
      })
      candleRef.current = cs

      const vs = main.addHistogramSeries({
        color: '#3b82f630',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volumeRef.current = vs

      // Volume SMA(20) — always created, visibility toggled via applyOptions
      const volSmaSeries = main.addLineSeries({
        color: '#6366f180',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        visible: false,
        priceScaleId: 'volume',
      })
      volSmaRef.current = volSmaSeries

      const indMount = { ...DEFAULT_INDICATORS, ...indicatorsIn }
      for (const p of CHART_EMA_PERIODS) {
        emaLineRefs.current[p] = main.addLineSeries({
          color: CHART_EMA_COLORS[p],
          lineWidth: 1,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          visible: isEmaLineVisible(indMount, p),
        })
      }
      vwapRef.current = main.addLineSeries({
        color: '#06b6d4',
        lineWidth: 1,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        visible: indMount.vwap === true,
      })
      // Always create BB series so preset / legend toggles work after mount.
      bbUpperRef.current = main.addLineSeries({
        color: '#fbbf2480',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: indMount.bollingerBands === true,
      })
      bbMidRef.current = main.addLineSeries({
        color: '#fbbf2440',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: indMount.bollingerBands === true,
      })
      bbLowerRef.current = main.addLineSeries({
        color: '#fbbf2480',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        visible: indMount.bollingerBands === true,
      })

      if (showRSI && rsiRef.current) {
        const rc = createChart(rsiRef.current, {
          layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
          rightPriceScale: { borderColor: '#1e1e2e' },
          timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          width: rsiRef.current.clientWidth,
          height: 90,
        })
        rsiChartRef.current = rc
        const rl = rc.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        rsiLineRef.current = rl
        rsiObRef.current = rc.addLineSeries({
          color: '#ff475760',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: LineStyle.Dashed,
        })
        rsiOsRef.current = rc.addLineSeries({
          color: '#00d08460',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: LineStyle.Dashed,
        })
        rc.timeScale().fitContent()
        main.subscribeCrosshairMove((param) => {
          if (!param.time) return
          rc.setCrosshairPosition(param.point ? param.point.y : 0, param.time, rl)
        })
        rc.subscribeCrosshairMove((param) => {
          if (!param.time) return
          main.setCrosshairPosition(param.point ? param.point.y : 0, param.time, cs)
        })
      }

      if (showRSI && macdRef.current) {
        const mc = createChart(macdRef.current, {
          layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
          rightPriceScale: { borderColor: '#1e1e2e' },
          timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          width: macdRef.current.clientWidth,
          height: 90,
        })
        macdChartRef.current = mc
        const ml = mc.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        const sl = mc.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        const hl = mc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
        const zl = mc.addLineSeries({ color: '#475569', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        macdLineRef.current = ml
        macdSignalRef.current = sl
        macdHistRef.current = hl
        macdZeroRef.current = zl
        mc.timeScale().fitContent()
        main.subscribeCrosshairMove((param) => {
          if (!param.time) return
          mc.setCrosshairPosition(param.point ? param.point.y : 0, param.time, ml)
        })
        mc.subscribeCrosshairMove((param) => {
          if (!param.time) return
          main.setCrosshairPosition(param.point ? param.point.y : 0, param.time, cs)
        })
      }

      // ATR(14) panel — new volatility panel alongside RSI/MACD
      if (showRSI && atrRef.current) {
        const ac = createChart(atrRef.current, {
          layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
          rightPriceScale: { borderColor: '#1e1e2e' },
          timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          width: atrRef.current.clientWidth,
          height: 80,
        })
        atrChartRef.current = ac
        const al = ac.addLineSeries({
          color: '#a78bfa',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
        })
        atrLineRef.current = al
        ac.timeScale().fitContent()
        main.subscribeCrosshairMove((param) => {
          if (!param.time) return
          ac.setCrosshairPosition(param.point ? param.point.y : 0, param.time, al)
        })
        ac.subscribeCrosshairMove((param) => {
          if (!param.time) return
          main.setCrosshairPosition(param.point ? param.point.y : 0, param.time, cs)
        })
      }

      resizeRef.current = new ResizeObserver((entries) => {
        if (!mounted) return
        const { width } = entries[0].contentRect
        main.applyOptions({ width })
        rsiChartRef.current?.applyOptions({ width })
        macdChartRef.current?.applyOptions({ width })
        atrChartRef.current?.applyOptions({ width })
      })
      resizeRef.current.observe(containerRef.current)

      if (mounted) setChartReadyGen((g) => g + 1)
    }

    init()

    return () => {
      mounted = false
      prevCandlesLenRef.current = 0
      firstBarTimeRef.current = null
      resizeRef.current?.disconnect()
      resizeRef.current = null
      chartRef.current?.remove()
      chartRef.current = null
      rsiChartRef.current?.remove()
      rsiChartRef.current = null
      macdChartRef.current?.remove()
      macdChartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      for (const p of CHART_EMA_PERIODS) {
        delete emaLineRefs.current[p]
      }
      vwapRef.current = null
      bbUpperRef.current = null
      bbMidRef.current = null
      bbLowerRef.current = null
      rsiLineRef.current = null
      macdLineRef.current = null
      macdSignalRef.current = null
      macdHistRef.current = null
      atrChartRef.current?.remove()
      atrChartRef.current = null
      atrLineRef.current = null
      volSmaRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── B. Data update ──────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || candles.length === 0) return

    const chart = chartRef.current
    const prevLen = prevCandlesLenRef.current
    const len = candles.length
    const firstTime = candles[0]?.time ?? null

    const fullReset =
      prevLen === 0 ||
      len < prevLen ||
      len > prevLen + 1 ||
      (firstBarTimeRef.current !== null &&
        firstTime !== null &&
        String(firstBarTimeRef.current) !== String(firstTime))

    /** If the series is still empty, never use incremental `update` — fixes “one bar” after remount / async init. */
    let barsInSeries = 0
    try {
      barsInSeries = candleRef.current.data().length
    } catch {
      barsInSeries = 0
    }

    const touchLast =
      !fullReset &&
      len > 0 &&
      barsInSeries > 0 &&
      (len === prevLen || len === prevLen + 1)

    const saveRange = chart?.timeScale().getVisibleLogicalRange() ?? null

    const candleArr = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })) as CandlestickData<Time>[]

    const closes = candles.map((c) => c.close)
    const volumes = candles.map((c) => c.volume)
    const volSMA = calcVolumeSMA(volumes, 20)

    const lineData = (values: number[]) =>
      candles
        .map((c, i) => ({ time: c.time as Time, value: values[i] }))
        .filter((d) => !isNaN(d.value)) as LineData<Time>[]

    const volArr = candles.map((c, i) => {
      const isUp = c.close >= c.open
      const isUnusual = volSMA[i] && c.volume > volSMA[i] * 2
      // Vivid green/red for up/down bars, brighter for unusual volume
      const baseColor = isUp ? '#22c55e' : '#ef4444'
      return {
        time: c.time as Time,
        value: c.volume,
        color: isUnusual ? baseColor + 'dd' : baseColor + '60',
      }
    }) as HistogramData<Time>[]

    if (touchLast) {
      const c = candles[len - 1]
      candleRef.current.update({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      } as CandlestickData<Time>)
      const lastVol = volArr[volArr.length - 1]
      volumeRef.current?.update(lastVol)
    } else {
      candleRef.current.setData(candleArr)
      volumeRef.current?.setData(volArr)
    }

    // Volume SMA(20) line
    if (volSmaRef.current) {
      volSmaRef.current.setData(lineData(volSMA))
    }

    for (const p of CHART_EMA_PERIODS) {
      const series = emaLineRefs.current[p]
      if (!series) continue
      series.setData(lineData(calcEMA(closes, p)))
    }

    // Use `vis` (not props-only `indicators`) so in-chart legend toggles refresh series data.
    if (vis.vwap && vwapRef.current) {
      const vwapData = calcVWAP(candles)
      vwapRef.current.setData(vwapData.filter((d) => !isNaN(d.value)) as LineData<Time>[])
    }

    if (vis.bollingerBands && bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
      const bb = calcBollingerBands(closes)
      bbUpperRef.current.setData(lineData(bb.map((b) => b.upper)))
      bbMidRef.current.setData(lineData(bb.map((b) => b.mid)))
      bbLowerRef.current.setData(lineData(bb.map((b) => b.lower)))
    }

    const dpMarkers: SeriesMarker<Time>[] = darkPoolMarkers
      .filter((m) => candles.some((c) => c.time === m.time))
      .map((m) => ({
        time: m.time as Time,
        position: (m.sentiment === 'BULLISH' ? 'belowBar' : 'aboveBar') as SeriesMarkerPosition,
        color: m.sentiment === 'BULLISH' ? '#3b82f6' : '#a855f7',
        shape: 'circle' as SeriesMarkerShape,
        text: `${(m.size / 1000).toFixed(0)}K`,
        size: 0.6,
      }))

    const nMarkers: SeriesMarker<Time>[] = newsMarkers
      .filter((n) => n.time && candles.some((c) => c.time === n.time))
      .map((n) => ({
        time: n.time as Time,
        position: (n.impact === 'negative' ? 'aboveBar' : 'belowBar') as SeriesMarkerPosition,
        color: n.impact === 'positive' ? '#00d084' : n.impact === 'negative' ? '#ff4757' : '#94a3b8',
        shape: (n.impact === 'positive' ? 'arrowUp' : n.impact === 'negative' ? 'arrowDown' : 'circle') as SeriesMarkerShape,
        text: '📰',
        size: 0.8,
      }))

    if (dpMarkers.length + nMarkers.length > 0) candleRef.current.setMarkers([...dpMarkers, ...nMarkers])

    if (showRSI && rsiLineRef.current && rsiChartRef.current) {
      const rsiVals = calcRSI(closes)
      rsiLineRef.current.setData(lineData(rsiVals))
      // RSI 70 (overbought) and 30 (oversold) horizontal ref lines
      if (rsiObRef.current && rsiOsRef.current) {
        rsiObRef.current.setData(lineData(rsiVals.map(() => 70)))
        rsiOsRef.current.setData(lineData(rsiVals.map(() => 30)))
      }
    }

    if (showRSI && macdLineRef.current && macdSignalRef.current && macdHistRef.current && macdChartRef.current) {
      const macdVals = calcMACD(closes)
      macdLineRef.current.setData(lineData(macdVals.map((m) => m.macd)))
      macdSignalRef.current.setData(lineData(macdVals.map((m) => m.signal)))
      macdHistRef.current.setData(
        candles
          .map((c, i) => ({
            time: c.time as Time,
            value: macdVals[i].histogram,
            color: macdVals[i].histogram >= 0 ? '#00d08490' : '#ff475790',
          }))
          .filter((d) => !isNaN(d.value)) as HistogramData<Time>[]
      )
      // MACD zero line
      if (macdZeroRef.current) {
        macdZeroRef.current.setData(lineData(macdVals.map(() => 0)))
      }
    }

    // ATR(14) data
    if (showRSI && atrLineRef.current && atrChartRef.current) {
      const atrVals = calcATR(candles, 14)
      atrLineRef.current.setData(lineData(atrVals))
      if (!touchLast) {
        try { atrChartRef.current.timeScale().fitContent() } catch { /* ignore */ }
      }
    }

    firstBarTimeRef.current = firstTime
    prevCandlesLenRef.current = len

    // First paint / timeframe change: ensure bars are visible (logical range was often empty before data).
    if (!touchLast && chart) {
      try {
        chart.timeScale().fitContent()
        rsiChartRef.current?.timeScale().fitContent()
        macdChartRef.current?.timeScale().fitContent()
      } catch {
        /* ignore */
      }
    } else if (saveRange !== null && chart) {
      try {
        chart.timeScale().setVisibleLogicalRange(saveRange)
      } catch {
        /* ignore */
      }
    }
  }, [candles, darkPoolMarkers, newsMarkers, showRSI, indicatorsProp, vis, chartReadyGen])

  const toggleIndicator = useCallback((key: VisKey) => {
    let next = {} as Record<VisKey, boolean>
    setVis((prev) => {
      next = { ...prev, [key]: !prev[key] }
      const emaMatch = /^ema(\d+)$/.exec(key)
      if (emaMatch) {
        const p = Number(emaMatch[1]) as ChartEmaPeriod
        emaLineRefs.current[p]?.applyOptions({ visible: next[key] })
      } else if (key === 'vwap' && vwapRef.current) {
        vwapRef.current.applyOptions({ visible: next.vwap })
      } else if (key === 'bollingerBands') {
        bbUpperRef.current?.applyOptions({ visible: next.bollingerBands })
        bbMidRef.current?.applyOptions({ visible: next.bollingerBands })
        bbLowerRef.current?.applyOptions({ visible: next.bollingerBands })
      }
      return next
    })
    // Sync to external state (e.g. side panel)
    onIndicatorsChange?.(next)
  }, [onIndicatorsChange])

  const handleTimeframeChange = useCallback((tf: Timeframe) => {
    setSelectedTimeframe(tf)
    onTimeframeChange?.(tf)
  }, [onTimeframeChange])

  const latestCandle = candles[candles.length - 1]
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

  return (
    <div className="relative select-none">
      {/* ── Timeframe Selector ── */}
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
          <span className="text-[10px] text-slate-600 font-mono">VP</span>
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
            <div className="text-[10px] font-mono text-slate-600">
              {priceStr} {isUp ? '+' : ''}{chgPct}%
            </div>
          )}
        </div>
      </div>

      {/* ── Enhanced legend with price / change / volume ── */}
      <div className="absolute top-[52px] left-3 right-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-slate-950/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-800/50 max-h-[min(40vh,220px)] overflow-y-auto">
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
          <span className="text-[10px] font-mono text-slate-600">
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

      <div ref={containerRef} className="w-full rounded-t-lg overflow-hidden min-h-[200px]" />

      {showRSI && (
        <>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">
              RSI(14) {latestCandle && (() => {
                const closes2 = candles.map(c => c.close)
                const rsiVals = calcRSI(closes2, 14)
                const last = rsiVals[rsiVals.length - 1]
                return Number.isFinite(last) ? last.toFixed(1) : '—'
              })()}
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
              ATR(14) {latestCandle && (() => {
                const atrVals = calcATR(candles, 14)
                const last = atrVals[atrVals.length - 1]
                return Number.isFinite(last) ? `$${last.toFixed(2)}` : '—'
              })()}
            </div>
            <div ref={atrRef} className="w-full rounded-b-lg overflow-hidden" />
          </div>
        </>
      )}
    </div>
  )
}
