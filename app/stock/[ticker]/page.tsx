'use client'

// Q-070 (routing expectation, UI audit F-02): there is NO standalone
// /quant-lab route — by design. The Quant Lab lives as a TAB on this page
// (QuantLabPanel below), so it always has a ticker context. Do not add a
// bare /quant-lab page; link to /stock/<ticker> with the quant tab instead.

import { useState, useEffect, useCallback, useMemo, useRef, use } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import DarkPoolPanel from '@/components/DarkPoolPanel'
import WatchlistButton from '@/components/WatchlistButton'
import QuantLabPanel from '@/components/stock/QuantLabPanel'
import NewsFeed from '@/components/NewsFeed'
import IndicatorPanel from '@/components/IndicatorPanel'
import OptionsChainTable from '@/components/options/OptionsChainTable'
import GexChart from '@/components/options/GexChart'
import { useLiveQuote } from '@/hooks/useLiveQuote'
import MaxPainGauge from '@/components/options/MaxPainGauge'
import FlowScanner from '@/components/options/FlowScanner'
import { getNewsForSector, generateDarkPoolPrints } from '@/lib/mockData'
import { DarkPoolPrint, SECTORS } from '@/lib/sectors'
import type { DarkPoolAnalysis } from '@/lib/darkpool'
import { buildVisFromIndicatorPreset, type ChartEmaKey } from '@/lib/chartEma'
import { STOCK_CHART_RANGES, isStockIntradayPollRange } from '@/lib/chartYahoo'
import { ChartErrorBoundary } from '@/components/ChartErrorBoundary'
import type { EnrichedChain } from '@/lib/options/chain'
import type { GexResult } from '@/lib/options/gex'
import type { UnusualFlowItem, FlowSentimentLabel } from '@/lib/options/flow'
import { formatCompactNumber, formatCurrency, formatFreshness, formatSignedNumber } from '@/lib/format'

type VisKey = ChartEmaKey | 'vwap' | 'bollingerBands' | 'fibonacci' | 'volSma'

const KLineChart = dynamic(() => import('@/components/KLineChart'), { ssr: false })

interface Candle {
  time: string; open: number; high: number; low: number; close: number; volume: number;
}
interface DpMarker {
  time: string; price: number; size: number; sentiment: 'BULLISH' | 'BEARISH'
}

const CHART_POLL_MS = (range: string) =>
  ['1m', '3m', '5m'].includes(range) ? 30_000 : 60_000

const STOCK_MAIN_TABS = [
  ['chart', 'Chart'],
  ['quant', 'Quant Lab'],
  ['options', 'Options'],
  ['darkpool', 'Dark Pool'],
  ['news', 'News'],
] as const

const STOCK_INDICATOR_PRESETS = [
  ['ema', 'EMA'],
  ['vwap', 'VWAP'],
  ['bb', 'BB'],
  ['fib', 'Fib'],
  ['all', 'All'],
] as const

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: tickerRaw } = use(params)
  const ticker = tickerRaw.toUpperCase()

  const [candles, setCandles]           = useState<Candle[]>([])
  const [darkPoolMarkers, setDarkPoolMarkers] = useState<DpMarker[]>([])
  const [quote, setQuote]               = useState<{ price: number; change: number; changePct: number; marketCap: string; quoteTime?: string | null } | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [darkPoolPrints, setDarkPoolPrints] = useState<DarkPoolPrint[]>([])
  const [darkPoolApiData, setDarkPoolApiData] = useState<DarkPoolAnalysis | null>(null)
  const [darkPoolApiLoading, setDarkPoolApiLoading] = useState(false)
  const [optionsChain, setOptionsChain] = useState<EnrichedChain | null>(null)
  const [optionsGex, setOptionsGex] = useState<GexResult | null>(null)
  const [optionsFlow, setOptionsFlow] = useState<UnusualFlowItem[]>([])
  const [optionsSentiment, setOptionsSentiment] = useState<{ flowLabel: FlowSentimentLabel; maxPain: number | null; putCallVolumeRatio: number | null; putCallOiRatio: number | null } | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [activeTab, setActiveTab]       = useState<'chart' | 'quant' | 'options' | 'darkpool' | 'news'>('chart')
  const [activeRange, setActiveRange]   = useState('1Y')
  const [activeIndicator, setActiveIndicator] = useState('ema')
  const [loading, setLoading]           = useState(true)
  const [chartError, setChartError]     = useState<string | null>(null)
  // Indicator visibility state. The page owns this; the sidebar IndicatorPanel
  // and the preset row write it, and it flows down into `indicatorConfig`.
  // Both activeIndicator (preset) and vis (individual toggles) feed into indicatorConfig.
  const [vis, setVis] = useState<Record<VisKey, boolean>>(() => buildVisFromIndicatorPreset('ema'))

  const indicatorConfig = useMemo(() => {
    const base = buildVisFromIndicatorPreset(activeIndicator)
    return { ...base, ...vis }
  }, [activeIndicator, vis])

  const tickerSector = useMemo(() => {
    for (const s of SECTORS) {
      if (s.topHoldings.some(h => h.toUpperCase() === ticker || h.replace('.', '-').toUpperCase() === ticker)) {
        return s
      }
    }
    return null
  }, [ticker])

  const color = tickerSector?.color ?? '#3b82f6'

  // Stable callbacks — defined with useCallback to avoid stale closures
  const fetchChartData = useCallback((range: string, signal?: AbortSignal) => {
    setLoading(true)
    setChartError(null)
    fetch(`/api/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`, { signal })
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.json()
      })
      .then((data) => {
        if (signal?.aborted) return
        if (data.error) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Chart data unavailable')
        }
        if (data.candles?.length) {
          setCandles(data.candles)
          setDarkPoolMarkers(data.darkPoolMarkers ?? [])
        } else {
          setCandles([])
          setDarkPoolMarkers([])
          setChartError('No historical data returned for this range')
        }
      })
      .catch((e) => {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        const msg = e instanceof Error ? e.message : 'Chart fetch failed'
        console.error('[Chart] Error:', e)
        setChartError(msg)
        setCandles([])
        setDarkPoolMarkers([])
      })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [ticker])

  // Phase 14 wave 36 (real-time platform initiative):
  //   Initial REST fetch — wakes the page with a current quote while the
  //   SSE stream is connecting (typical first-event latency: ~1-2 s).
  //   The 15-second setInterval below is REPLACED by `useLiveQuote` SSE
  //   subscription further down (lines 175-189). REST is now boot-only.
  // NEW-C-4 (2026-07-06): accepts an AbortSignal so the boot effect can cancel
  // an in-flight fetch on unmount — matches every sibling fetch on this page
  // (the F3 abort-guard pattern). AbortError is expected on teardown.
  const fetchQuote = useCallback((signal?: AbortSignal) => {
    fetch(`/api/prices?tickers=${encodeURIComponent(ticker)}`, { signal })
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.json()
      })
      .then((data) => {
        if (signal?.aborted) return
        const q = data.quotes?.find((q: { ticker: string }) => q.ticker === ticker)
        if (q) {
          setQuote(q)
          setQuoteError(null)
        }
      })
      .catch((e) => {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setQuoteError(e instanceof Error ? e.message : 'Quote unavailable')
      })
  }, [ticker])

  // Chart data: fetch on mount and whenever timeframe changes
  useEffect(() => {
    if (activeTab !== 'chart') return
    const controller = new AbortController()
    fetchChartData(activeRange, controller.signal)
    return () => controller.abort()
  }, [activeTab, activeRange, fetchChartData])

  // Chart polling — short intervals for 1m/3m/5m so bars stay near live quote
  useEffect(() => {
    if (activeTab !== 'chart') return
    if (!isStockIntradayPollRange(activeRange)) return

    const ms = CHART_POLL_MS(activeRange)
    let activeController = new AbortController()
    const poll = setInterval(() => {
      activeController.abort()
      activeController = new AbortController()
      fetchChartData(activeRange, activeController.signal)
    }, ms)
    return () => {
      clearInterval(poll)
      activeController.abort()
    }
  }, [activeTab, activeRange, fetchChartData])

  // Phase 14 wave 36 — REAL-TIME QUOTE STREAM (replaces 15 s polling).
  //
  // The SSE endpoint /api/stream/:ticker delivers quotes ~every 15 s during
  // market hours and a 30 s heartbeat outside of them — but DOES NOT depend
  // on the client to poll. Reconnect, market-hours awareness, and the
  // soft-close warning are all handled inside useLiveQuote. We keep the
  // REST fetchQuote() for the initial paint (line 156 calls it once on
  // mount); thereafter the SSE updates take over.
  useEffect(() => {
    const controller = new AbortController()
    fetchQuote(controller.signal)  // Boot-only — populates the UI before SSE first event.
    return () => controller.abort()
  }, [fetchQuote])

  // Subscribe to the SSE stream. State propagates to the existing `quote`
  // state via the live-quote merge effect below.
  const live = useLiveQuote(ticker)

  // Merge live quote into the page's quote state. Preserves the marketCap
  // field from the initial REST fetch (SSE payloads don't include it).
  useEffect(() => {
    if (!live.quote) return
    setQuote((prev) => ({
      price: live.quote!.price,
      change: live.quote!.change,
      changePct: live.quote!.changePct,
      marketCap: prev?.marketCap ?? '',
      quoteTime: live.quote!.timestamp,
    }))
    setQuoteError(null)
  }, [live.quote])

  // Dark pool prints generation
  useEffect(() => {
    setDarkPoolPrints(generateDarkPoolPrints(ticker))
  }, [ticker])

  // Dark pool API (only when tab is active).
  // Phase 14 wave 8: log the error so a silent fetch failure leaves a trace
  // (prior `.catch(() => setLoading(false))` made debugging impossible).
  useEffect(() => {
    if (activeTab !== 'darkpool') return
    let cancelled = false
    setDarkPoolApiLoading(true)
    setDarkPoolApiData(null)
    fetch(`/api/darkpool/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        setDarkPoolApiData(data)
        setDarkPoolApiLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[stock/darkpool] fetch failed', ticker, err)
        setDarkPoolApiLoading(false)
      })
    return () => { cancelled = true }
  }, [ticker, activeTab])

  // Options chain (lazy — only when options tab is first activated).
  // Phase 14 wave 8: cancellation flag prevents a late response from a
  // previous ticker from overwriting state after the user navigates.
  useEffect(() => {
    if (activeTab !== 'options') return
    if (optionsChain) return  // already loaded
    let cancelled = false
    setOptionsLoading(true)
    fetch(`/api/options/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.calls) {
          setOptionsChain({
            ticker: data.symbol,
            underlyingPrice: data.underlyingPrice,
            expirationDates: data.expirationDates.map((d: string) => new Date(d)),
            currentExpiry: data.currentExpiry ? new Date(data.currentExpiry) : null,
            calls: data.calls,
            puts: data.puts,
          })
          setOptionsGex(data.gex)
          setOptionsFlow(data.unusualFlow ?? [])
          setOptionsSentiment(data.sentiment ?? null)
        }
        setOptionsLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[stock/options] fetch failed', ticker, err)
        setOptionsLoading(false)
      })
    return () => { cancelled = true }
  }, [ticker, activeTab, optionsChain])

  const news = getNewsForSector(tickerSector?.slug ?? 'technology')
  const newsMarkers = news.slice(0, 3).map((n, i) => {
    if (candles.length === 0) return null
    const idx = Math.max(0, candles.length - 15 - i * 10)
    return { time: candles[idx]?.time ?? '', headline: n.title, impact: 'neutral' as const }
  }).filter(Boolean) as { time: string; headline: string; impact: 'positive' | 'negative' | 'neutral' }[]

  const isUp = (quote?.changePct ?? 0) >= 0

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-slate-800 py-8" style={{ background: `linear-gradient(180deg, ${color}08 0%, transparent 100%)` }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl shadow-lg font-bold font-mono text-white"
                style={{ backgroundColor: `${color}20`, border: `1px solid ${color}40` }}>
                {ticker}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">Markets</Link>
                  <span className="text-slate-700 text-xs">/</span>
                  <span className="text-xs text-slate-400">Individual Stock</span>
                </div>
                <h1 className="text-2xl font-bold text-white tracking-wide">{ticker}</h1>
                <p className="text-sm text-slate-400 mt-0.5">
                  Live prices & charts + Quant Lab (fundamentals, DCF scenarios, Codex frameworks).
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4 flex-wrap">
              <WatchlistButton ticker={ticker} className="shrink-0 self-start" />
              {quote ? (
                <div className="text-right">
                  <div className="text-2xl font-bold text-white font-mono">{formatCurrency(quote.price)}</div>
                  <div className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {isUp ? '▲' : '▼'} {formatSignedNumber(quote.change)} ({Math.abs(quote.changePct).toFixed(2)}%)
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">Market Cap: {quote.marketCap}</div>
                  {/* Phase 14 wave 36: real-time stream status pill. */}
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                        live.connected
                          ? live.marketOpen
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-700/40 text-slate-400 border border-slate-600/40'
                      }`}
                      title={
                        live.connected
                          ? live.marketOpen
                            ? 'Live stream connected — market open'
                            : 'Live stream connected — market closed (snapshot)'
                          : live.supported
                            ? 'Reconnecting…'
                            : 'Polling (SSE unavailable)'
                      }
                      role="status"
                    >
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          live.connected && live.marketOpen
                            ? 'bg-emerald-400 animate-pulse'
                            : live.connected
                              ? 'bg-amber-400'
                              : 'bg-slate-500'
                        }`}
                        aria-hidden="true"
                      />
                      {live.connected ? (live.marketOpen ? 'LIVE' : 'CLOSED') : 'RECONNECT'}
                    </span>
                    <span className="text-[10px] text-slate-400">{formatFreshness(quote.quoteTime)}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-right w-32">
                  <div className="h-7 bg-slate-800 rounded animate-pulse" />
                  <div className="h-5 bg-slate-800 rounded animate-pulse" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div
            role="tablist"
            className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800"
            onKeyDown={(e) => {
              const tabs = STOCK_MAIN_TABS.map(([t]) => t)
              const idx = tabs.indexOf(activeTab)
              if (e.key === 'ArrowRight') { e.preventDefault(); setActiveTab(tabs[(idx + 1) % tabs.length]) }
              if (e.key === 'ArrowLeft')  { e.preventDefault(); setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length]) }
            }}
          >
            {STOCK_MAIN_TABS.map(([tab, label]) => (
              <button
                key={tab}
                id={`tab-${tab}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                className={`px-3 sm:px-4 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'chart' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {STOCK_CHART_RANGES.map((r) => (
                  <button key={r} onClick={() => setActiveRange(r)}
                    aria-pressed={activeRange === r}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeRange === r ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {STOCK_INDICATOR_PRESETS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => { setActiveIndicator(val); setVis(buildVisFromIndicatorPreset(val)) }}
                    aria-pressed={activeIndicator === val}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeIndicator === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'quant' ? (
          <div role="tabpanel" id="panel-quant" aria-labelledby="tab-quant">
            <QuantLabPanel ticker={ticker} />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            <div className="xl:col-span-3 space-y-6">
              {activeTab === 'chart' && (
                <div role="tabpanel" id="panel-chart" aria-labelledby="tab-chart" className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-white">{ticker} · Advanced Technicals</span>
                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                      {isStockIntradayPollRange(activeRange) && (
                        <span className="text-green-400/60">
                          ● REFRESHES EVERY {CHART_POLL_MS(activeRange) / 1000}s
                        </span>
                      )}
                      {/* F6.8: announce quote degradation to screen readers.
                          Deliberately NOT applied to the live price itself —
                          announcing every SSE tick is an aria-live anti-pattern. */}
                      {quoteError && <span role="status" aria-live="polite" className="text-amber-400/70">QUOTE DEGRADED</span>}
                      <span>{activeRange === '1D' || activeRange === '1W' || activeRange === '5m' || activeRange === '15m' || activeRange === '1H' || activeRange === '4H' ? 'INTRADAY' : 'DAILY+'} BARS</span>
                    </div>
                  </div>
                  {loading && candles.length === 0 ? (
                    <div className="h-[480px] bg-slate-800/20 rounded-xl animate-pulse flex flex-col items-center justify-center border border-slate-800/50">
                      <span className="text-slate-500 text-sm font-mono mb-2">Connecting to Data Feed...</span>
                    </div>
                  ) : chartError ? (
                    <div className="h-[480px] bg-slate-800/10 rounded-xl flex flex-col items-center justify-center gap-3 border border-dashed border-amber-500/30">
                      <span className="text-amber-400/90 text-sm font-medium">Chart unavailable</span>
                      <p className="text-slate-500 text-xs font-mono max-w-md text-center px-4">{chartError}</p>
                      <button
                        type="button"
                        onClick={() => fetchChartData(activeRange)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs hover:border-cyan-500/40 hover:text-cyan-400"
                      >
                        Retry chart
                      </button>
                    </div>
                  ) : candles.length > 0 ? (
                    <ChartErrorBoundary label={ticker} fallbackHeight={480}>
                      <KLineChart
                        candles={candles}
                        darkPoolMarkers={darkPoolMarkers}
                        newsMarkers={newsMarkers}
                        color={color}
                        ticker={ticker}
                        range={activeRange}
                        hideTimeframeSelector
                        showRSI
                        indicators={indicatorConfig}
                      />
                    </ChartErrorBoundary>
                  ) : (
                    <div className="h-[480px] bg-slate-800/10 rounded-xl flex flex-col items-center justify-center gap-3 border border-dashed border-slate-800">
                      <span className="text-slate-400 text-sm">No historical data available for {ticker}</span>
                      <button
                        type="button"
                        onClick={() => fetchChartData(activeRange)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-xs hover:border-cyan-500/40 hover:text-cyan-400"
                      >
                        Retry chart
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'options' && (
                <div role="tabpanel" id="panel-options" aria-labelledby="tab-options" className="space-y-6">
                  {/* Phase 14 wave 41 UX-F6: distinguishable loading state with a spinner
                      so users see "still working" vs the gray "no data" empty state. */}
                  {optionsLoading && (
                    <div className="flex items-center justify-center gap-3 py-12 text-gray-400 text-sm">
                      <span
                        className="inline-block w-4 h-4 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin"
                        aria-hidden="true"
                      />
                      Loading options chain…
                    </div>
                  )}
                  {!optionsLoading && !optionsChain && (
                    <div className="text-center py-12 text-gray-500 text-sm" role="status">
                      No options data available for {ticker}.
                    </div>
                  )}
                  {optionsChain && (
                    <>
                      {/* Chain table */}
                      {/* Phase 14 wave 41 (UX-F1): every options panel is now wrapped
                          in ChartErrorBoundary individually so one panel's crash
                          can never blank the whole stock page. Each boundary has
                          a `label` for the fallback message and a small fallbackHeight
                          appropriate for the panel size. */}
                      <ChartErrorBoundary label="Options Chain" fallbackHeight={360}>
                        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                          <h3 className="text-sm font-semibold text-white mb-4">Options Chain</h3>
                          <OptionsChainTable chain={optionsChain} />
                        </div>
                      </ChartErrorBoundary>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* GEX chart */}
                        {optionsGex && (
                          <ChartErrorBoundary label="Gamma Exposure (GEX)" fallbackHeight={320}>
                            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                              <h3 className="text-sm font-semibold text-white mb-4">Gamma Exposure (GEX)</h3>
                              <GexChart
                                gex={optionsGex}
                                // Phase 14 wave 41 (UX-F4): defensive spot guard at call site.
                                // GexChart's internal .toFixed call assumed finite spot; a halted
                                // symbol returning NaN/0 would crash the panel.
                                spot={Number.isFinite(optionsChain.underlyingPrice) && optionsChain.underlyingPrice > 0
                                  ? optionsChain.underlyingPrice
                                  : 0}
                              />
                            </div>
                          </ChartErrorBoundary>
                        )}

                        {/* Max Pain / Sentiment card */}
                        {/* Phase 14 wave 41 (UX-F3): render the card whenever ANY
                            sentiment field exists. Previously the entire card was
                            gated on `maxPain != null`, which hid the still-useful
                            P/C ratios whenever max pain was degraded. The
                            MaxPainGauge component has its own null-guard for the
                            gauge subtree. */}
                        {optionsSentiment && (
                          <ChartErrorBoundary label="Max Pain & Sentiment" fallbackHeight={320}>
                            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                              <h3 className="text-sm font-semibold text-white mb-4">Max Pain</h3>
                              <MaxPainGauge
                                maxPain={optionsSentiment.maxPain}
                                spot={Number.isFinite(optionsChain.underlyingPrice) && optionsChain.underlyingPrice > 0
                                  ? optionsChain.underlyingPrice
                                  : 0}
                              />
                              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                <div>
                                  <span className="text-gray-500">P/C Vol Ratio: </span>
                                  <span className="text-gray-300 font-mono">
                                    {/* Phase 14 wave 41 (UX-F2): explicit Number.isFinite guard.
                                        The prior `?.toFixed(2) ?? '—'` did NOT catch NaN or
                                        Infinity (PCR_MAX = 99 from the sentiment.ts F1 fix,
                                        plus pre-fix Infinity slip-through). */}
                                    {Number.isFinite(optionsSentiment.putCallVolumeRatio)
                                      ? (optionsSentiment.putCallVolumeRatio as number).toFixed(2)
                                      : '—'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-gray-500">P/C OI Ratio: </span>
                                  <span className="text-gray-300 font-mono">
                                    {Number.isFinite(optionsSentiment.putCallOiRatio)
                                      ? (optionsSentiment.putCallOiRatio as number).toFixed(2)
                                      : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </ChartErrorBoundary>
                        )}
                      </div>

                      {/* Unusual Flow */}
                      <ChartErrorBoundary label="Unusual Flow Scanner" fallbackHeight={280}>
                        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                          <h3 className="text-sm font-semibold text-white mb-4">Unusual Flow Scanner</h3>
                          <FlowScanner
                            items={optionsFlow}
                            sentiment={optionsSentiment?.flowLabel ?? 'NEUTRAL'}
                          />
                        </div>
                      </ChartErrorBoundary>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'darkpool' && (
                <div role="tabpanel" id="panel-darkpool" aria-labelledby="tab-darkpool">
                  <DarkPoolPanel prints={darkPoolPrints} ticker={ticker} color={color}
                    apiData={darkPoolApiData} apiLoading={darkPoolApiLoading} />
                </div>
              )}

              {activeTab === 'news' && (
                <div role="tabpanel" id="panel-news" aria-labelledby="tab-news">
                  <NewsFeed news={news} color={color} />
                </div>
              )}
            </div>

            {/* Sidebar — 2-col layout: Session Snapshot + IndicatorPanel */}
            <div className="xl:col-span-1 space-y-6">
              {activeTab === 'chart' && (
                <IndicatorPanel
                  vis={vis}
                  onToggle={(key) => setVis((prev) => ({ ...prev, [key]: !prev[key] }))}
                  title="Chart Indicators"
                />
              )}

              <div className="bg-slate-900/40 rounded-2xl border border-slate-800 p-6">
                <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-4">Session snapshot</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-slate-800/50 pb-2">
                    <span className="text-sm text-slate-400">1d change</span>
                    {quote ? (
                      <span className={`text-sm font-mono font-medium ${quote.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {quote.changePct >= 0 ? '+' : ''}{quote.changePct.toFixed(2)}%
                      </span>
                    ) : <span className="text-sm text-slate-400">—</span>}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Open <strong className="text-slate-400">Quant Lab</strong> for live fundamentals, DCF bear/base/bull, volatility-aware buy/sell bands, and Codex-style allocator checklists (not trade advice).
                  </p>
                </div>
              </div>

              {darkPoolPrints.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3">Dark Pool Summary</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Total Block Vol</div>
                      <div className="text-lg font-bold text-white font-mono">
                        {formatCompactNumber(darkPoolPrints.reduce((s, p) => s + p.size, 0))}
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Bullish Prints</div>
                      <div className="text-lg font-bold text-green-400 font-mono">
                        {darkPoolPrints.filter(p => p.sentiment === 'BULLISH').length}
                        <span className="text-slate-400 text-sm font-normal">/{darkPoolPrints.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none" />
                <h3 className="text-sm font-bold text-white mb-2 relative z-10">Real-Time Data Feed Status</h3>
                <p className="text-xs text-slate-400 leading-relaxed relative z-10">
                  Intraday charts auto-refresh every 60s. Quotes update every 15s. All data from Yahoo Finance.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
