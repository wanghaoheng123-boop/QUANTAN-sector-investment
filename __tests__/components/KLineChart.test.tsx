// @vitest-environment jsdom
/**
 * KL-10 — render smoke test for components/KLineChart.tsx + hooks/useKLineChart.ts.
 *
 * The chart hook drives an imperative lightweight-charts canvas and had ZERO
 * automated coverage. These tests mock `lightweight-charts` so we can assert,
 * without a real canvas, that EACH indicator toggle maps to a real series
 * operation — closing the loop on the three "user-visible lie" findings:
 *
 *   KL-1  Fibonacci: enabling `fibonacci` must draw retracement *price lines*
 *         on the candle series (previously NO createPriceLine existed anywhere).
 *   KL-2  Vol SMA(20): the series visibility must follow the `volSma` flag
 *         (previously created `visible:false` and never toggled, while the
 *         legend hard-coded it ON).
 *   KL-3  EMA / VWAP / Bollinger toggles map to series `visible` options.
 *
 * The lightweight-charts mock is built inside `vi.hoisted` so the hoisted
 * `vi.mock` factory can reference it (the established pattern in this repo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import KLineChart from '@/components/KLineChart'
import { CHART_EMA_COLORS, allEmaOff } from '@/lib/chartEma'

// ─── lightweight-charts mock ─────────────────────────────────────────────────

interface SeriesStub {
  kind: 'candle' | 'histogram' | 'line'
  opts: Record<string, unknown>
  applyOptionsCalls: Record<string, unknown>[]
  priceLines: Record<string, unknown>[]
  setData: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  applyOptions: ReturnType<typeof vi.fn>
  setMarkers: ReturnType<typeof vi.fn>
  data: ReturnType<typeof vi.fn>
  priceScale: ReturnType<typeof vi.fn>
  createPriceLine: ReturnType<typeof vi.fn>
  removePriceLine: ReturnType<typeof vi.fn>
}

interface ChartStub {
  series: SeriesStub[]
  addCandlestickSeries: ReturnType<typeof vi.fn>
  addHistogramSeries: ReturnType<typeof vi.fn>
  addLineSeries: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

const lwc = vi.hoisted(() => {
  const charts: ChartStub[] = []

  function makeSeries(kind: SeriesStub['kind'], opts: Record<string, unknown>): SeriesStub {
    let stored: Record<string, number>[] = []
    const priceLines: Record<string, unknown>[] = []
    const applyOptionsCalls: Record<string, unknown>[] = []
    return {
      kind,
      opts,
      applyOptionsCalls,
      priceLines,
      setData: vi.fn((d: Record<string, number>[]) => { stored = d }),
      update: vi.fn(),
      applyOptions: vi.fn((o: Record<string, unknown>) => { applyOptionsCalls.push(o) }),
      setMarkers: vi.fn(),
      data: vi.fn(() => stored),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
      createPriceLine: vi.fn((o: Record<string, unknown>) => {
        const pl = { ...o }
        priceLines.push(pl)
        return pl
      }),
      removePriceLine: vi.fn((pl: Record<string, unknown>) => {
        const i = priceLines.indexOf(pl)
        if (i >= 0) priceLines.splice(i, 1)
      }),
    }
  }

  function makeChart(): ChartStub {
    const series: SeriesStub[] = []
    const timeScale = {
      fitContent: vi.fn(),
      getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 1000 })),
      setVisibleLogicalRange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
    }
    return {
      series,
      addCandlestickSeries: vi.fn((o: Record<string, unknown>) => {
        const s = makeSeries('candle', o); series.push(s); return s
      }),
      addHistogramSeries: vi.fn((o: Record<string, unknown>) => {
        const s = makeSeries('histogram', o); series.push(s); return s
      }),
      addLineSeries: vi.fn((o: Record<string, unknown>) => {
        const s = makeSeries('line', o); series.push(s); return s
      }),
      subscribeCrosshairMove: vi.fn(),
      setCrosshairPosition: vi.fn(),
      timeScale: vi.fn(() => timeScale),
      applyOptions: vi.fn(),
      remove: vi.fn(),
    } as unknown as ChartStub
  }

  return {
    charts,
    createChart: vi.fn(() => { const c = makeChart(); charts.push(c); return c }),
    CrosshairMode: { Normal: 0, Magnet: 1, Hidden: 2 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
  }
})

vi.mock('lightweight-charts', () => ({
  createChart: lwc.createChart,
  CrosshairMode: lwc.CrosshairMode,
  LineStyle: lwc.LineStyle,
}))

// ─── fixtures + helpers ──────────────────────────────────────────────────────

const CANDLES = Array.from({ length: 30 }, (_, i) => {
  const base = 100 + i
  return {
    time: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: base,
    high: base + 5 + (i % 3),
    low: base - 4 - (i % 2),
    close: base + (i % 2 ? 2 : -1),
    volume: 1_000_000 + i * 10_000,
  }
})
const DATA_HIGH = Math.max(...CANDLES.map((c) => c.high))
const DATA_LOW = Math.min(...CANDLES.map((c) => c.low))

type Flags = Record<string, boolean>

/** Full indicator-flag object (avoids the dev "missing key" warning). */
function flags(overrides: Flags = {}): Flags {
  return {
    ...allEmaOff(),
    vwap: false,
    bollingerBands: false,
    fibonacci: false,
    volSma: true,
    ...overrides,
  }
}

/** Renders the chart and resolves once the async init + first data effect ran. */
async function mountChart(indicators: Flags) {
  const utils = render(
    <KLineChart
      candles={CANDLES}
      color="#3b82f6"
      ticker="TEST"
      showRSI={false}
      indicators={indicators}
    />,
  )
  await waitFor(() => expect(lwc.charts.length).toBeGreaterThan(0))
  const chart = lwc.charts[lwc.charts.length - 1]
  const candle = chart.series.find((s) => s.kind === 'candle')!
  // setData on the candle series is the last step of the data effect, after
  // which renderFib has run — so awaiting it guarantees the full path executed.
  await waitFor(() => expect(candle.setData).toHaveBeenCalled())
  return { chart, candle, ...utils }
}

/** Effective visibility = last applyOptions({visible}) if any, else creation opts. */
function effectiveVisible(s: SeriesStub | undefined): boolean | undefined {
  if (!s) return undefined
  for (let i = s.applyOptionsCalls.length - 1; i >= 0; i--) {
    const call = s.applyOptionsCalls[i]
    if ('visible' in call) return call.visible as boolean
  }
  return s.opts.visible as boolean | undefined
}

const lineByColor = (chart: ChartStub, color: string) =>
  chart.series.find((s) => s.kind === 'line' && s.opts.color === color)

/**
 * VWAP shares its color (#06b6d4 / cyan-500) with EMA period 6, and the EMA
 * lines are created before VWAP — so pick the LAST series with that color.
 */
const vwapSeries = (chart: ChartStub) => {
  const matches = chart.series.filter((s) => s.kind === 'line' && s.opts.color === '#06b6d4')
  return matches[matches.length - 1]
}

beforeEach(() => {
  lwc.charts.length = 0
  lwc.createChart.mockClear()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ─── tests ───────────────────────────────────────────────────────────────────

describe('KLineChart render smoke (KL-10)', () => {
  it('creates candle, volume and Vol-SMA series on mount', async () => {
    const { chart } = await mountChart(flags())

    expect(lwc.createChart).toHaveBeenCalledTimes(1)
    expect(chart.series.some((s) => s.kind === 'candle')).toBe(true)
    expect(chart.series.some((s) => s.kind === 'histogram')).toBe(true)
    expect(lineByColor(chart, '#6366f180')).toBeDefined() // Vol SMA(20)
  })

  it('KL-2: Vol SMA(20) series is VISIBLE by default and feeds data', async () => {
    const { chart } = await mountChart(flags({ volSma: true }))
    const volSma = lineByColor(chart, '#6366f180')

    expect(effectiveVisible(volSma)).toBe(true)
    expect(volSma!.setData).toHaveBeenCalled() // data pushed when visible
  })

  it('KL-2: toggling Vol SMA(20) off hides the real series and skips its data', async () => {
    const { chart } = await mountChart(flags({ volSma: false }))
    const volSma = lineByColor(chart, '#6366f180')

    expect(effectiveVisible(volSma)).toBe(false)
    expect(volSma!.setData).not.toHaveBeenCalled() // gated on visibility
  })

  it('KL-3: EMA line visibility follows the indicator flags', async () => {
    const { chart } = await mountChart(flags({ ema9: true, ema20: false }))

    expect(effectiveVisible(lineByColor(chart, CHART_EMA_COLORS[9]))).toBe(true)
    expect(effectiveVisible(lineByColor(chart, CHART_EMA_COLORS[20]))).toBe(false)
  })

  it('KL-6: hidden EMA series skip setData (per-tick perf); visible ones push data', async () => {
    // ema9 visible, ema20 hidden (default-off). The data effect must push data
    // only to the visible series — hidden EMAs are display-toggled off and
    // nothing reads their data, so skipping their per-tick setData is the perf
    // win (and behaviour-preserving). Mirrors the Vol-SMA gating above.
    const { chart } = await mountChart(flags({ ema9: true, ema20: false }))
    const ema9 = lineByColor(chart, CHART_EMA_COLORS[9])
    const ema20 = lineByColor(chart, CHART_EMA_COLORS[20])

    expect(ema9!.setData).toHaveBeenCalled()       // visible → data pushed
    expect(ema20!.setData).not.toHaveBeenCalled()  // hidden → gated (KL-6)
  })

  it('KL-4: surfaces an accessible fallback when async chart init fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Force createChart to throw on this mount so the async init() rejects —
    // simulating a dynamic-import chunk-load failure or a createChart throw.
    lwc.createChart.mockImplementationOnce(() => {
      throw new Error('chunk load failed')
    })

    const utils = render(
      <KLineChart candles={CANDLES} color="#3b82f6" ticker="TEST" showRSI={false} indicators={flags()} />,
    )

    // The hook's init().catch sets initError → the component renders an alert
    // fallback and an aria-label that announces the failure (instead of a
    // perpetual "loading" chart and an unhandled promise rejection).
    await waitFor(() => expect(utils.getByRole('alert')).toBeInTheDocument())
    expect(utils.getByRole('img', { name: /failed to load/i })).toBeInTheDocument()
    expect(errSpy).toHaveBeenCalled() // failure is logged for operators
    errSpy.mockRestore()
  })

  it('KL-3: VWAP and Bollinger toggles drive series visibility', async () => {
    const { chart } = await mountChart(flags({ vwap: true, bollingerBands: true }))

    expect(effectiveVisible(vwapSeries(chart))).toBe(true) // VWAP
    const bbBands = chart.series.filter(
      (s) => s.kind === 'line' && (s.opts.color === '#fbbf2480' || s.opts.color === '#fbbf2440'),
    )
    expect(bbBands).toHaveLength(3) // upper / mid / lower
    expect(bbBands.every((s) => effectiveVisible(s) === true)).toBe(true)
  })

  it('KL-3: VWAP and Bollinger are hidden when their flags are off', async () => {
    const { chart } = await mountChart(flags({ vwap: false, bollingerBands: false }))

    expect(effectiveVisible(vwapSeries(chart))).toBe(false)
    const bbBands = chart.series.filter(
      (s) => s.kind === 'line' && (s.opts.color === '#fbbf2480' || s.opts.color === '#fbbf2440'),
    )
    expect(bbBands.every((s) => effectiveVisible(s) === false)).toBe(true)
  })

  it('KL-1: Fibonacci preset draws 7 retracement price lines spanning the swing high/low', async () => {
    const { candle } = await mountChart(flags({ fibonacci: true }))

    expect(candle.createPriceLine).toHaveBeenCalledTimes(7)
    expect(candle.priceLines).toHaveLength(7)

    const prices = candle.createPriceLine.mock.calls.map((c) => (c[0] as { price: number }).price)
    expect(Math.min(...prices)).toBeCloseTo(DATA_LOW) // 0% level = swing low
    expect(Math.max(...prices)).toBeCloseTo(DATA_HIGH) // 100% level = swing high

    const titles = candle.createPriceLine.mock.calls.map((c) => (c[0] as { title: string }).title)
    expect(titles).toContain('Fib 61.8%')
  })

  it('KL-1: no price lines are drawn when Fibonacci is off', async () => {
    const { candle } = await mountChart(flags({ fibonacci: false }))
    expect(candle.createPriceLine).not.toHaveBeenCalled()
    expect(candle.priceLines).toHaveLength(0)
  })
})
