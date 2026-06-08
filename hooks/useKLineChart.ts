'use client'

/**
 * useKLineChart — imperative chart-lifecycle hook.
 *
 * Owns: chart/series instance creation, data updates, resize observation,
 * crosshair/tooltip subscriptions, and disposal on unmount.
 *
 * Returns refs to series instances (so the component can apply visibility
 * options) plus reactive state (chartReadyGen, crosshairData).
 */

import { useEffect, useRef, useState } from 'react'
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
} from 'lightweight-charts'
import {
  CHART_EMA_COLORS,
  CHART_EMA_PERIODS,
  type ChartEmaPeriod,
} from '@/lib/chartEma'
import {
  emaFull,
  rsiArray,
  macdArray,
  bollingerArray,
  atrArray,
  smaArray,
  vwapArray,
  type OhlcBar,
} from '@/lib/quant/indicators'
import { chartTimeKey, sortChartCandles } from '@/lib/sortChartCandles'
import type { KLineIndicatorFlags } from '@/components/KLineChart'

// ─── re-exported types used internally ───────────────────────────────────────

interface Candle {
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

// ─── indicator adapters (identical to those in KLineChart.tsx) ────────────────

function calcEMA(prices: number[], period: number): number[] {
  return emaFull(prices, period)
}

function calcRSI(prices: number[], period = 14): number[] {
  return rsiArray(prices, period)
}

interface MacdRow { macd: number; signal: number; histogram: number }

function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9): MacdRow[] {
  const { line, signal: sig, histogram } = macdArray(prices, fast, slow, signal)
  return prices.map((_, i) => ({
    macd: line[i],
    signal: sig[i],
    histogram: histogram[i],
  }))
}

interface BollingerRow { mid: number; upper: number; lower: number }

function calcBollingerBands(prices: number[], period = 20, std = 2): BollingerRow[] {
  const { mid, upper, lower } = bollingerArray(prices, period, std)
  return prices.map((_, i) => ({
    mid: mid[i],
    upper: upper[i],
    lower: lower[i],
  }))
}

function calcVWAP(candles: Candle[]): { time: Time; value: number }[] {
  const highs = candles.map((c) => c.high)
  const lows = candles.map((c) => c.low)
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const values = vwapArray(highs, lows, closes, volumes)
  return candles.map((c, i) => ({ time: c.time as Time, value: values[i] }))
}

function calcATR(candles: Candle[], period = 14): number[] {
  const bars: OhlcBar[] = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }))
  return atrArray(bars, period)
}

function calcVolumeSMA(volumes: number[], period = 20): number[] {
  return smaArray(volumes, period)
}

// ─── helper ──────────────────────────────────────────────────────────────────

function isEmaLineVisible(ind: KLineIndicatorFlags, period: ChartEmaPeriod): boolean {
  if (period === 9) return ind.ema9 !== false
  if (period === 20) return ind.ema20 !== false
  if (period === 50) return ind.ema50 !== false
  if (period === 200) return ind.ema200 !== false
  const k = `ema${period}` as keyof KLineIndicatorFlags
  return ind[k] === true
}

// ─── hook inputs / outputs ───────────────────────────────────────────────────

export interface CrosshairData {
  price: number
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface UseKLineChartParams {
  containerRef: React.RefObject<HTMLDivElement | null>
  rsiRef: React.RefObject<HTMLDivElement | null>
  macdRef: React.RefObject<HTMLDivElement | null>
  atrRef: React.RefObject<HTMLDivElement | null>
  candles: Candle[]
  darkPoolMarkers: DarkPoolMarker[]
  newsMarkers: NewsMarker[]
  color: string
  showRSI: boolean
  indicatorsProp: Required<KLineIndicatorFlags>
  visSerialised: string
  vis: Record<string, boolean>
}

export interface UseKLineChartResult {
  chartReadyGen: number
  crosshairData: CrosshairData | null
  setCrosshairData: React.Dispatch<React.SetStateAction<CrosshairData | null>>
  // Series refs — returned so the component can call applyOptions for visibility toggling
  emaLineRefs: React.MutableRefObject<Partial<Record<ChartEmaPeriod, ISeriesApi<'Line'>>>>
  vwapRef: React.MutableRefObject<ISeriesApi<'Line'> | null>
  bbUpperRef: React.MutableRefObject<ISeriesApi<'Line'> | null>
  bbMidRef: React.MutableRefObject<ISeriesApi<'Line'> | null>
  bbLowerRef: React.MutableRefObject<ISeriesApi<'Line'> | null>
}

// ─── hook ────────────────────────────────────────────────────────────────────

export function useKLineChart({
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
}: UseKLineChartParams): UseKLineChartResult {
  // Chart / series instance refs
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

  /** Bumped when async chart init() finishes so the data effect runs after candleRef exists. */
  const [chartReadyGen, setChartReadyGen] = useState(0)

  const [crosshairData, setCrosshairData] = useState<CrosshairData | null>(null)

  // ── A. Mount: create chart once ───────────────────────────────────────────
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
            style: LineStyle.Dashed,
            width: 1,
            labelVisible: true,
          },
          horzLine: {
            color: '#64748b',
            labelBackgroundColor: '#0f172a',
            style: LineStyle.Dashed,
            width: 1,
            labelVisible: true,
          },
        },
        rightPriceScale: { borderColor: '#1e1e2e' },
        timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false, rightOffset: 5 },
        width: containerRef.current.clientWidth,
        height: (() => {
          const vh = typeof window !== 'undefined' ? window.innerHeight : 800
          if (showRSI) return Math.max(220, Math.min(Math.round(vh * 0.45), 320))
          return Math.max(280, Math.min(Math.round(vh * 0.6), 420))
        })(),
      })

      // Subscribe to crosshair move for OHLCV tooltip
      main.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData.size || !candleRef.current || !volumeRef.current) {
          setCrosshairData(null)
          return
        }
        const candleSeries = candleRef.current
        const volumeSeries = volumeRef.current
        const candleData = param.seriesData.get(candleSeries)
        const volumeData = param.seriesData.get(volumeSeries)
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

      const indMount = indicatorsProp
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

      // ATR(14) panel — volatility panel alongside RSI/MACD
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

  // ── B. Data update ─────────────────────────────────────────────────────────
  useEffect(() => {
    const sortedCandles = sortChartCandles(candles)
    if (!candleRef.current || sortedCandles.length === 0) return

    const chart = chartRef.current
    const prevLen = prevCandlesLenRef.current
    const len = sortedCandles.length
    const firstTime = sortedCandles[0]?.time ?? null

    const fullReset =
      prevLen === 0 ||
      len < prevLen ||
      len > prevLen + 1 ||
      (firstBarTimeRef.current !== null &&
        firstTime !== null &&
        String(firstBarTimeRef.current) !== String(firstTime))

    /** If the series is still empty, never use incremental `update` — fixes "one bar" after remount / async init. */
    let barsInSeries = 0
    let lastSeriesTimeKey: number | null = null
    try {
      const seriesData = candleRef.current.data()
      barsInSeries = seriesData.length
      const last = seriesData[seriesData.length - 1]
      if (last?.time != null) lastSeriesTimeKey = chartTimeKey(last.time as string | number)
    } catch {
      barsInSeries = 0
    }

    const newLastKey = chartTimeKey(sortedCandles[len - 1].time)
    const touchLast =
      !fullReset &&
      len > 0 &&
      barsInSeries > 0 &&
      lastSeriesTimeKey !== null &&
      ((len === prevLen && newLastKey === lastSeriesTimeKey) ||
        (len === prevLen + 1 && newLastKey > lastSeriesTimeKey))

    const saveRange = chart?.timeScale().getVisibleLogicalRange() ?? null

    const candleArr = sortedCandles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })) as CandlestickData<Time>[]

    const closes = sortedCandles.map((c) => c.close)
    const volumes = sortedCandles.map((c) => c.volume)
    const volSMA = calcVolumeSMA(volumes, 20)

    const lineData = (values: number[]) =>
      sortedCandles
        .map((c, i) => ({ time: c.time as Time, value: values[i] }))
        .filter((d) => !isNaN(d.value)) as LineData<Time>[]

    const volArr = sortedCandles.map((c, i) => {
      const isUp = c.close >= c.open
      const isUnusual = volSMA[i] && c.volume > volSMA[i] * 2
      const baseColor = isUp ? '#22c55e' : '#ef4444'
      return {
        time: c.time as Time,
        value: c.volume,
        color: isUnusual ? baseColor + 'dd' : baseColor + '60',
      }
    }) as HistogramData<Time>[]

    if (touchLast) {
      const c = sortedCandles[len - 1]
      try {
        candleRef.current.update({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        } as CandlestickData<Time>)
        const lastVol = volArr[volArr.length - 1]
        volumeRef.current?.update(lastVol)
      } catch {
        candleRef.current.setData(candleArr)
        volumeRef.current?.setData(volArr)
      }
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
      const vwapData = calcVWAP(sortedCandles)
      vwapRef.current.setData(vwapData.filter((d) => !isNaN(d.value)) as LineData<Time>[])
    }

    if (vis.bollingerBands && bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
      const bb = calcBollingerBands(closes)
      bbUpperRef.current.setData(lineData(bb.map((b) => b.upper)))
      bbMidRef.current.setData(lineData(bb.map((b) => b.mid)))
      bbLowerRef.current.setData(lineData(bb.map((b) => b.lower)))
    }

    const dpMarkers: SeriesMarker<Time>[] = darkPoolMarkers
      .filter((m) => sortedCandles.some((c) => c.time === m.time))
      .map((m) => ({
        time: m.time as Time,
        position: (m.sentiment === 'BULLISH' ? 'belowBar' : 'aboveBar') as SeriesMarkerPosition,
        color: m.sentiment === 'BULLISH' ? '#3b82f6' : '#a855f7',
        shape: 'circle' as SeriesMarkerShape,
        text: `${(m.size / 1000).toFixed(0)}K`,
        size: 0.6,
      }))

    const nMarkers: SeriesMarker<Time>[] = newsMarkers
      .filter((n) => n.time && sortedCandles.some((c) => c.time === n.time))
      .map((n) => ({
        time: n.time as Time,
        position: (n.impact === 'negative' ? 'aboveBar' : 'belowBar') as SeriesMarkerPosition,
        color: n.impact === 'positive' ? '#00d084' : n.impact === 'negative' ? '#ff4757' : '#94a3b8',
        shape: (n.impact === 'positive' ? 'arrowUp' : n.impact === 'negative' ? 'arrowDown' : 'circle') as SeriesMarkerShape,
        text: '📰',
        size: 0.8,
      }))

    const allMarkers = [...dpMarkers, ...nMarkers].sort(
      (a, b) => chartTimeKey(a.time as string | number) - chartTimeKey(b.time as string | number),
    )
    if (allMarkers.length > 0) candleRef.current.setMarkers(allMarkers)

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
        sortedCandles
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
      const atrVals = calcATR(sortedCandles, 14)
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
  }, [candles, darkPoolMarkers, newsMarkers, showRSI, indicatorsProp, visSerialised, chartReadyGen])

  return {
    chartReadyGen,
    crosshairData,
    setCrosshairData,
    emaLineRefs,
    vwapRef,
    bbUpperRef,
    bbMidRef,
    bbLowerRef,
  }
}
