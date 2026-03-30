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
} from 'lightweight-charts'

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

interface KLineChartProps {
  candles: Candle[]
  darkPoolMarkers?: DarkPoolMarker[]
  newsMarkers?: NewsMarker[]
  color: string
  ticker: string
  range?: string
  showRSI?: boolean
  indicators?: {
    ema20?: boolean
    ema50?: boolean
    vwap?: boolean
    bollingerBands?: boolean
    fibonacci?: boolean
  }
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
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period; avgLoss /= period
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
  for (let i = slow - 1; i < prices.length; i++) result[i] = { macd: fastEma[i] - slowEma[i], signal: NaN, histogram: NaN }
  const validMacd = result.map(r => r.macd).slice(slow - 1)
  const signalEma = calcEMA(validMacd, signal)
  for (let i = 0; i < signalEma.length; i++) {
    const idx = i + slow - 1
    const m = result[idx].macd, s = signalEma[i]
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
    result[i] = { mid: mean, upper: mean + std * Math.sqrt(variance), lower: mean - std * Math.sqrt(variance) }
  }
  return result
}

function calcVWAP(candles: Candle[]): { time: Time; value: number }[] {
  let cumulativeTPV = 0, cumulativeVol = 0
  return candles.map(c => {
    const tpv = ((c.high + c.low + c.close) / 3) * c.volume
    cumulativeTPV += tpv; cumulativeVol += c.volume
    return { time: c.time as Time, value: cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : NaN }
  })
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
  indicators: indicatorsProp = { ema20: true, ema50: true, vwap: false, bollingerBands: false, fibonacci: false },
}: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const macdRef = useRef<HTMLDivElement>(null)

  // Chart refs — created once, survive all data updates
  const chartRef            = useRef<IChartApi | null>(null)
  const candleRef           = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef           = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ema20Ref            = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref            = useRef<ISeriesApi<'Line'> | null>(null)
  const vwapRef             = useRef<ISeriesApi<'Line'> | null>(null)
  const bbUpperRef          = useRef<ISeriesApi<'Line'> | null>(null)
  const bbMidRef            = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef          = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiChartRef         = useRef<IChartApi | null>(null)
  const rsiLineRef          = useRef<ISeriesApi<'Line'> | null>(null)
  const macdChartRef        = useRef<IChartApi | null>(null)
  const macdLineRef         = useRef<ISeriesApi<'Line'> | null>(null)
  const macdSignalRef       = useRef<ISeriesApi<'Line'> | null>(null)
  const macdHistRef         = useRef<ISeriesApi<'Histogram'> | null>(null)
  const resizeRef           = useRef<ResizeObserver | null>(null)

  /** Previous candle count — updated at end of data effect */
  const prevCandlesLenRef = useRef(0)
  /** First bar time — when it changes, dataset was replaced (timeframe / refresh) */
  const firstBarTimeRef = useRef<string | number | null>(null)

  // Memoize indicators to prevent effect re-runs on parent re-renders
  const indicators = useMemo(() => indicatorsProp, [indicatorsProp])

  /** Local visibility for legend + buttons (chart series toggles are ref-driven) */
  type VisKey = 'ema20' | 'ema50' | 'vwap' | 'bollingerBands' | 'fibonacci'
  const [vis, setVis] = useState<Record<VisKey, boolean>>(() => ({
    ema20: indicatorsProp.ema20 !== false,
    ema50: indicatorsProp.ema50 !== false,
    vwap: indicatorsProp.vwap === true,
    bollingerBands: indicatorsProp.bollingerBands === true,
    fibonacci: indicatorsProp.fibonacci === true,
  }))

  useEffect(() => {
    setVis({
      ema20: indicatorsProp.ema20 !== false,
      ema50: indicatorsProp.ema50 !== false,
      vwap: indicatorsProp.vwap === true,
      bollingerBands: indicatorsProp.bollingerBands === true,
      fibonacci: indicatorsProp.fibonacci === true,
    })
  }, [indicatorsProp])

  const INDICATOR_DEFS = useMemo(() => [
    { key: 'ema20' as const,          label: 'EMA 20',     color: 'bg-yellow-400' },
    { key: 'ema50' as const,          label: 'EMA 50',     color: 'bg-purple-400' },
    { key: 'vwap' as const,           label: 'VWAP',       color: 'bg-cyan-400' },
    { key: 'bollingerBands' as const, label: 'BB(20,2)',  color: 'bg-amber-400/60' },
    { key: 'fibonacci' as const,      label: 'Fib',        color: 'bg-rose-400/60' },
  ], [])

  // ── A. Mount: create chart once ─────────────────────────────────
  useEffect(() => {
    let mounted = true
    if (!containerRef.current) return

    const init = async () => {
      const { createChart, CrosshairMode, LineStyle } = await import('lightweight-charts')
      if (!mounted || !containerRef.current) return

      const main = createChart(containerRef.current, {
        layout:           { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
        grid:             { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#334155', labelBackgroundColor: '#1e293b' },
          horzLine: { color: '#334155', labelBackgroundColor: '#1e293b' },
        },
        rightPriceScale:  { borderColor: '#1e1e2e' },
        timeScale:        { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false, rightOffset: 5 },
        width:            containerRef.current.clientWidth,
        height:           showRSI ? 300 : 380,
      })
      chartRef.current = main

      const cs = main.addCandlestickSeries({
        upColor: '#00d084', downColor: '#ff4757',
        borderUpColor: '#00d084', borderDownColor: '#ff4757',
        wickUpColor: '#00d084', wickDownColor: '#ff4757',
      })
      candleRef.current = cs

      const vs = main.addHistogramSeries({
        color: '#3b82f630', priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      })
      vs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      volumeRef.current = vs

      ema20Ref.current = main.addLineSeries({
        color: '#f59e0b', lineWidth: 1, priceLineVisible: false,
        crosshairMarkerVisible: false, lastValueVisible: false,
        visible: indicators.ema20 !== false,
      })
      ema50Ref.current = main.addLineSeries({
        color: '#8b5cf6', lineWidth: 1, priceLineVisible: false,
        crosshairMarkerVisible: false, lastValueVisible: false,
        visible: indicators.ema50 !== false,
      })
      vwapRef.current = main.addLineSeries({
        color: '#06b6d4', lineWidth: 1, priceLineVisible: false,
        crosshairMarkerVisible: false, lastValueVisible: false,
        visible: indicators.vwap === true,
      })
      if (indicators.bollingerBands) {
        bbUpperRef.current = main.addLineSeries({ color: '#fbbf2480', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        bbMidRef.current   = main.addLineSeries({ color: '#fbbf2440', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
        bbLowerRef.current = main.addLineSeries({ color: '#fbbf2480', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      }

      // RSI sub-chart
      if (showRSI && rsiRef.current) {
        const rc = createChart(rsiRef.current, {
          layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
          rightPriceScale: { borderColor: '#1e1e2e' },
          timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          width: rsiRef.current.clientWidth, height: 90,
        })
        rsiChartRef.current = rc
        const rl = rc.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        const ob = rc.addLineSeries({ color: '#ff475750', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed })
        const os = rc.addLineSeries({ color: '#00d08450', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, lineStyle: LineStyle.Dashed })
        rsiLineRef.current = rl
        rc.timeScale().fitContent()
        main.subscribeCrosshairMove(param => {
          if (!param.time) return
          rc.setCrosshairPosition(param.point ? param.point.y : 0, param.time, rl)
        })
        rc.subscribeCrosshairMove(param => {
          if (!param.time) return
          main.setCrosshairPosition(param.point ? param.point.y : 0, param.time, cs)
        })
      }

      // MACD sub-chart
      if (showRSI && macdRef.current) {
        const mc = createChart(macdRef.current, {
          layout: { background: { color: '#0a0a12' }, textColor: '#94a3b8' },
          grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
          rightPriceScale: { borderColor: '#1e1e2e' },
          timeScale: { borderColor: '#1e1e2e', timeVisible: true, secondsVisible: false },
          crosshair: { mode: CrosshairMode.Normal },
          width: macdRef.current.clientWidth, height: 90,
        })
        macdChartRef.current = mc
        const ml = mc.addLineSeries({ color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        const sl = mc.addLineSeries({ color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
        const hl = mc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false })
        macdLineRef.current = ml
        macdSignalRef.current = sl
        macdHistRef.current = hl
        mc.timeScale().fitContent()
        main.subscribeCrosshairMove(param => {
          if (!param.time) return
          mc.setCrosshairPosition(param.point ? param.point.y : 0, param.time, ml)
        })
        mc.subscribeCrosshairMove(param => {
          if (!param.time) return
          main.setCrosshairPosition(param.point ? param.point.y : 0, param.time, cs)
        })
      }

      resizeRef.current = new ResizeObserver(entries => {
        if (!mounted) return
        const { width } = entries[0].contentRect
        main.applyOptions({ width })
        rsiChartRef.current?.applyOptions({ width })
        macdChartRef.current?.applyOptions({ width })
      })
      resizeRef.current.observe(containerRef.current)
    }

    init()

    return () => {
      mounted = false
      resizeRef.current?.disconnect()
      resizeRef.current = null
      chartRef.current?.remove();       chartRef.current = null
      rsiChartRef.current?.remove();     rsiChartRef.current = null
      macdChartRef.current?.remove();    macdChartRef.current = null
      candleRef.current = null; volumeRef.current = null
      ema20Ref.current = null; ema50Ref.current = null; vwapRef.current = null
      bbUpperRef.current = null; bbMidRef.current = null; bbLowerRef.current = null
      rsiLineRef.current = null
      macdLineRef.current = null; macdSignalRef.current = null; macdHistRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // ← Runs ONLY once on mount

  // ── B. Data update: incremental update() for live last-bar ticks; setData on range change ──
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

    const touchLast = !fullReset && len > 0 && (len === prevLen || len === prevLen + 1)

    const saveRange = chart?.timeScale().getVisibleLogicalRange() ?? null

    const candleArr = candles.map(c => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })) as CandlestickData<Time>[]

    const volArr = candles.map(c => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? '#00d08430' : '#ff475730',
    })) as HistogramData<Time>[]

    if (touchLast) {
      const c = candles[len - 1]
      candleRef.current.update({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      } as CandlestickData<Time>)
      volumeRef.current?.update({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? '#00d08430' : '#ff475730',
      } as HistogramData<Time>)
    } else {
      candleRef.current.setData(candleArr)
      volumeRef.current?.setData(volArr)
    }

    const closes = candles.map(c => c.close)

    const ema20Data = calcEMA(closes, 20)
    const ema50Data = calcEMA(closes, 50)

    const lineData = (values: number[]) =>
      candles
        .map((c, i) => ({ time: c.time as Time, value: values[i] }))
        .filter(d => !isNaN(d.value)) as LineData<Time>[]

    ema20Ref.current?.setData(lineData(ema20Data))
    ema50Ref.current?.setData(lineData(ema50Data))

    // VWAP
    if (indicators.vwap && vwapRef.current) {
      const vwapData = calcVWAP(candles)
      vwapRef.current.setData(vwapData.filter(d => !isNaN(d.value)) as LineData<Time>[])
    }

    // Bollinger Bands
    if (indicators.bollingerBands && bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
      const bb = calcBollingerBands(closes)
      bbUpperRef.current.setData(lineData(bb.map(b => b.upper)))
      bbMidRef.current.setData(lineData(bb.map(b => b.mid)))
      bbLowerRef.current.setData(lineData(bb.map(b => b.lower)))
    }

    // Markers
    const dpMarkers: SeriesMarker<Time>[] = darkPoolMarkers
      .filter(m => candles.some(c => c.time === m.time))
      .map(m => ({
        time: m.time as Time,
        position: (m.sentiment === 'BULLISH' ? 'belowBar' : 'aboveBar') as SeriesMarkerPosition,
        color: m.sentiment === 'BULLISH' ? '#3b82f6' : '#a855f7',
        shape: 'circle' as SeriesMarkerShape,
        text: `${(m.size / 1000).toFixed(0)}K`,
        size: 0.6,
      }))

    const nMarkers: SeriesMarker<Time>[] = newsMarkers
      .filter(n => n.time && candles.some(c => c.time === n.time))
      .map(n => ({
        time: n.time as Time,
        position: (n.impact === 'negative' ? 'aboveBar' : 'belowBar') as SeriesMarkerPosition,
        color: n.impact === 'positive' ? '#00d084' : n.impact === 'negative' ? '#ff4757' : '#94a3b8',
        shape: (n.impact === 'positive' ? 'arrowUp' : n.impact === 'negative' ? 'arrowDown' : 'circle') as SeriesMarkerShape,
        text: '📰',
        size: 0.8,
      }))

    if (dpMarkers.length + nMarkers.length > 0) candleRef.current.setMarkers([...dpMarkers, ...nMarkers])

    // RSI sub-chart
    if (showRSI && rsiLineRef.current && rsiChartRef.current) {
      const rsiVals = calcRSI(closes)
      rsiLineRef.current.setData(lineData(rsiVals))
    }

    // MACD sub-chart
    if (showRSI && macdLineRef.current && macdSignalRef.current && macdHistRef.current && macdChartRef.current) {
      const macdVals = calcMACD(closes)
      macdLineRef.current.setData(lineData(macdVals.map(m => m.macd)))
      macdSignalRef.current.setData(lineData(macdVals.map(m => m.signal)))
      macdHistRef.current.setData(
        candles.map((c, i) => ({
          time: c.time as Time,
          value: macdVals[i].histogram,
          color: macdVals[i].histogram >= 0 ? '#00d08480' : '#ff475780',
        })).filter(d => !isNaN(d.value)) as HistogramData<Time>[]
      )
    }

    firstBarTimeRef.current = firstTime
    prevCandlesLenRef.current = len

    // Restore zoom
    if (saveRange !== null && chart) {
      try { chart.timeScale().setVisibleLogicalRange(saveRange) } catch {}
    }
  }, [candles, darkPoolMarkers, newsMarkers, showRSI, indicators])

  // ── C. Toggle indicator visibility ─────────────────────────────
  const toggleIndicator = useCallback((key: VisKey) => {
    setVis(prev => {
      const next = { ...prev, [key]: !prev[key] }
      if (key === 'ema20' && ema20Ref.current) ema20Ref.current.applyOptions({ visible: next.ema20 })
      if (key === 'ema50' && ema50Ref.current) ema50Ref.current.applyOptions({ visible: next.ema50 })
      if (key === 'vwap' && vwapRef.current) vwapRef.current.applyOptions({ visible: next.vwap })
      if (key === 'bollingerBands') {
        if (bbUpperRef.current) bbUpperRef.current.applyOptions({ visible: next.bollingerBands })
        if (bbMidRef.current) bbMidRef.current.applyOptions({ visible: next.bollingerBands })
        if (bbLowerRef.current) bbLowerRef.current.applyOptions({ visible: next.bollingerBands })
      }
      return next
    })
  }, [])

  const activeIndicators = INDICATOR_DEFS.filter(d => vis[d.key])

  return (
    <div className="relative select-none">
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-3 text-xs bg-slate-950/80 backdrop-blur-sm px-2 py-1 rounded-lg border border-slate-800/50">
        {activeIndicators.map(d => (
          <span key={d.key} className="flex items-center gap-1.5">
            <span className={`w-4 h-0.5 ${d.color} inline-block rounded`} />
            <span className="text-slate-400">{d.label}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="text-blue-400 text-[10px]">●</span><span className="text-slate-400">Dark Pool</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-green-400 text-[10px]">▲</span><span className="text-slate-400">News</span>
        </span>
        <div className="flex items-center gap-1 border-l border-slate-700 pl-2 ml-1">
          {INDICATOR_DEFS.map(d => (
            <button
              key={d.key}
              onClick={() => toggleIndicator(d.key)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                vis[d.key]
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800 text-slate-600 hover:text-slate-400'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="w-full rounded-t-lg overflow-hidden" />

      {showRSI && (
        <>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">RSI(14)</div>
            <div ref={rsiRef} className="w-full overflow-hidden" />
          </div>
          <div className="relative border-t border-slate-800">
            <div className="absolute left-3 top-1 z-10 text-[10px] text-slate-500 font-mono">MACD(12,26,9)</div>
            <div ref={macdRef} className="w-full rounded-b-lg overflow-hidden" />
          </div>
        </>
      )}
    </div>
  )
}
