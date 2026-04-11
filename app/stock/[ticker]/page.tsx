'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import DarkPoolPanel from '@/components/DarkPoolPanel'
import WatchlistButton from '@/components/WatchlistButton'
import QuantLabPanel from '@/components/stock/QuantLabPanel'
import NewsFeed from '@/components/NewsFeed'
import IndicatorPanel from '@/components/IndicatorPanel'
import OptionsChainTable from '@/components/options/OptionsChainTable'
import GexChart from '@/components/options/GexChart'
import MaxPainGauge from '@/components/options/MaxPainGauge'
import FlowScanner from '@/components/options/FlowScanner'
import { getNewsForSector, generateDarkPoolPrints } from '@/lib/mockData'
import { DarkPoolPrint } from '@/lib/sectors'
import type { DarkPoolAnalysis } from '@/lib/darkpool'
import { CHART_EMA_PERIODS, tradingDefaultEmaFlags, type ChartEmaKey } from '@/lib/chartEma'
import { STOCK_CHART_RANGES, isStockIntradayPollRange } from '@/lib/chartYahoo'
import type { EnrichedChain } from '@/lib/options/chain'
import type { GexResult } from '@/lib/options/gex'
import type { UnusualFlowItem, FlowSentimentLabel } from '@/lib/options/flow'

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

export default function StockPage({ params }: { params: { ticker: string } }) {
  const ticker = params.ticker.toUpperCase()

  const [candles, setCandles]           = useState<Candle[]>([])
  const [darkPoolMarkers, setDarkPoolMarkers] = useState<DpMarker[]>([])
  const [quote, setQuote]               = useState<{ price: number; change: number; changePct: number; marketCap: string } | null>(null)
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
  // Indicator visibility state — synced from KLineChart via onIndicatorsChange
  // Both activeIndicator (preset) and vis (individual toggles) feed into indicatorConfig
  const [vis, setVis] = useState<Record<VisKey, boolean>>(() => buildVisFromIndicatorPreset('ema'))

  // Build initial vis from preset key
  function buildVisFromIndicatorPreset(preset: string): Record<VisKey, boolean> {
    const allEmaOn: Record<string, boolean> = {}
    const allEmaOff: Record<string, boolean> = {}
    for (const p of CHART_EMA_PERIODS) {
      const k = `ema${p}` as ChartEmaKey
      allEmaOn[k] = true
      allEmaOff[k] = false
    }
    const emaTrading = tradingDefaultEmaFlags() as Record<string, boolean>
    if (preset === 'all') return { ...allEmaOn, vwap: true, bollingerBands: true, fibonacci: true, volSma: true } as Record<VisKey, boolean>
    if (preset === 'ema') return { ...emaTrading, vwap: false, bollingerBands: false, fibonacci: false, volSma: true } as Record<VisKey, boolean>
    if (preset === 'vwap') return { ...allEmaOff, vwap: true, bollingerBands: false, fibonacci: false, volSma: true } as Record<VisKey, boolean>
    if (preset === 'bb') return { ...allEmaOff, vwap: false, bollingerBands: true, fibonacci: false, volSma: true } as Record<VisKey, boolean>
    return { ...allEmaOff, vwap: false, bollingerBands: false, fibonacci: true, volSma: true } as Record<VisKey, boolean>
  }

  // indicatorConfig is derived from vis (individual toggles) + a base preset signal
  const indicatorConfig = useMemo(() => {
    // Start with the preset as baseline, then overlay individual vis toggles
    const base = buildVisFromIndicatorPreset(activeIndicator)
    return { ...base, ...vis }
  }, [activeIndicator, vis])

  const handleVisChange = useCallback((newVis: Record<VisKey, boolean>) => {
    setVis(newVis)
  }, [])

  const color = '#3b82f6'

  // Stable callbacks — defined with useCallback to avoid stale closures
  const fetchChartData = useCallback((range: string) => {
    setLoading(true)
    fetch(`/api/chart/${encodeURIComponent(ticker)}?range=${encodeURIComponent(range)}`)
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.json()
      })
      .then((data) => {
        if (data.candles) {
          setCandles(data.candles)
          setDarkPoolMarkers(data.darkPoolMarkers ?? [])
        }
      })
      .catch((e) => console.error('[Chart] Error:', e))
      .finally(() => setLoading(false))
  }, [ticker])

  const fetchQuote = useCallback(() => {
    fetch(`/api/prices?tickers=${encodeURIComponent(ticker)}`)
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.json()
      })
      .then((data) => {
        const q = data.quotes?.find((q: { ticker: string }) => q.ticker === ticker)
        if (q) setQuote(q)
      })
      .catch(() => {})
  }, [ticker])

  // Chart data: fetch on mount and whenever timeframe changes
  useEffect(() => {
    if (activeTab !== 'chart') return
    fetchChartData(activeRange)
  }, [activeTab, activeRange, fetchChartData])

  // Chart polling — short intervals for 1m/3m/5m so bars stay near live quote
  useEffect(() => {
    if (activeTab !== 'chart') return
    if (!isStockIntradayPollRange(activeRange)) return

    const ms = CHART_POLL_MS(activeRange)
    const poll = setInterval(() => fetchChartData(activeRange), ms)
    return () => clearInterval(poll)
  }, [activeTab, activeRange, fetchChartData])

  // Quote polling: every 15 seconds
  useEffect(() => {
    fetchQuote()
    const poll = setInterval(fetchQuote, 15_000)
    return () => clearInterval(poll)
  }, [fetchQuote])

  // Dark pool prints generation
  useEffect(() => {
    setDarkPoolPrints(generateDarkPoolPrints(ticker))
  }, [ticker])

  // Dark pool API (only when tab is active)
  useEffect(() => {
    if (activeTab !== 'darkpool') return
    setDarkPoolApiLoading(true)
    setDarkPoolApiData(null)
    fetch(`/api/darkpool/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => { setDarkPoolApiData(data); setDarkPoolApiLoading(false) })
      .catch(() => setDarkPoolApiLoading(false))
  }, [ticker, activeTab])

  // Options chain (lazy — only when options tab is first activated)
  useEffect(() => {
    if (activeTab !== 'options') return
    if (optionsChain) return  // already loaded
    setOptionsLoading(true)
    fetch(`/api/options/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(data => {
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
      .catch(() => setOptionsLoading(false))
  }, [ticker, activeTab, optionsChain])

  const news = getNewsForSector('technology')
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
                  <div className="text-2xl font-bold text-white font-mono">${quote.price.toFixed(2)}</div>
                  <div className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {isUp ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePct).toFixed(2)}%)
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono">Market Cap: {quote.marketCap}</div>
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
          <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
            {STOCK_MAIN_TABS.map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={`px-3 sm:px-4 py-1.5 text-xs font-medium rounded-md transition-all ${activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'chart' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {STOCK_CHART_RANGES.map((r) => (
                  <button key={r} onClick={() => setActiveRange(r)}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeRange === r ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {STOCK_INDICATOR_PRESETS.map(([val, label]) => (
                  <button key={val} type="button" onClick={() => { setActiveIndicator(val); setVis(buildVisFromIndicatorPreset(val)) }}
                    className={`px-2.5 py-1 text-[11px] rounded-md transition-all ${activeIndicator === val ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {activeTab === 'quant' ? (
          <QuantLabPanel ticker={ticker} />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            <div className="xl:col-span-3 space-y-6">
              {activeTab === 'chart' && (
                <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-white">{ticker} · Advanced Technicals</span>
                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono">
                      {isStockIntradayPollRange(activeRange) && (
                        <span className="text-green-400/60">
                          ● REFRESHES EVERY {CHART_POLL_MS(activeRange) / 1000}s
                        </span>
                      )}
                      <span>{activeRange === '1D' || activeRange === '1W' || activeRange === '5m' || activeRange === '15m' || activeRange === '1H' || activeRange === '4H' ? 'INTRADAY' : 'DAILY+'} BARS</span>
                    </div>
                  </div>
                  {loading && candles.length === 0 ? (
                    <div className="h-[480px] bg-slate-800/20 rounded-xl animate-pulse flex flex-col items-center justify-center border border-slate-800/50">
                      <span className="text-slate-500 text-sm font-mono mb-2">Connecting to Data Feed...</span>
                    </div>
                  ) : candles.length > 0 ? (
                    <KLineChart
                      candles={candles}
                      darkPoolMarkers={darkPoolMarkers}
                      newsMarkers={newsMarkers}
                      color={color}
                      ticker={ticker}
                      range={activeRange}
                      showRSI
                      indicators={indicatorConfig}
                      onIndicatorsChange={handleVisChange}
                    />
                  ) : (
                    <div className="h-[480px] bg-slate-800/10 rounded-xl flex items-center justify-center border border-dashed border-slate-800">
                      <span className="text-slate-600 text-sm">No historical data available for {ticker}</span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'options' && (
                <div className="space-y-6">
                  {optionsLoading && (
                    <div className="text-center py-12 text-gray-400 text-sm">Loading options chain...</div>
                  )}
                  {!optionsLoading && !optionsChain && (
                    <div className="text-center py-12 text-gray-500 text-sm">No options data available for {ticker}.</div>
                  )}
                  {optionsChain && (
                    <>
                      {/* Chain table */}
                      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                        <h3 className="text-sm font-semibold text-white mb-4">Options Chain</h3>
                        <OptionsChainTable chain={optionsChain} />
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* GEX chart */}
                        {optionsGex && (
                          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                            <h3 className="text-sm font-semibold text-white mb-4">Gamma Exposure (GEX)</h3>
                            <GexChart gex={optionsGex} spot={optionsChain.underlyingPrice} />
                          </div>
                        )}

                        {/* Max Pain */}
                        {optionsSentiment?.maxPain != null && (
                          <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                            <h3 className="text-sm font-semibold text-white mb-4">Max Pain</h3>
                            <MaxPainGauge maxPain={optionsSentiment.maxPain} spot={optionsChain.underlyingPrice} />
                            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                              <div>
                                <span className="text-gray-500">P/C Vol Ratio: </span>
                                <span className="text-gray-300 font-mono">
                                  {optionsSentiment.putCallVolumeRatio?.toFixed(2) ?? '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">P/C OI Ratio: </span>
                                <span className="text-gray-300 font-mono">
                                  {optionsSentiment.putCallOiRatio?.toFixed(2) ?? '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Unusual Flow */}
                      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                        <h3 className="text-sm font-semibold text-white mb-4">Unusual Flow Scanner</h3>
                        <FlowScanner
                          items={optionsFlow}
                          sentiment={optionsSentiment?.flowLabel ?? 'NEUTRAL'}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'darkpool' && (
                <DarkPoolPanel prints={darkPoolPrints} ticker={ticker} color={color}
                  apiData={darkPoolApiData} apiLoading={darkPoolApiLoading} />
              )}

              {activeTab === 'news' && <NewsFeed news={news} color={color} />}
            </div>

            {/* Sidebar — 2-col layout: Session Snapshot + IndicatorPanel */}
            <div className="xl:col-span-1 space-y-6">
              {activeTab === 'chart' && (
                <IndicatorPanel
                  vis={vis}
                  onToggle={(key) => {
                    const next = { ...vis, [key]: !vis[key] }
                    setVis(next)
                    handleVisChange(next)
                  }}
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
                    ) : <span className="text-sm text-slate-600">—</span>}
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
                        {(darkPoolPrints.reduce((s, p) => s + p.size, 0) / 1e6).toFixed(2)}M
                      </div>
                    </div>
                    <div className="bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Bullish Prints</div>
                      <div className="text-lg font-bold text-green-400 font-mono">
                        {darkPoolPrints.filter(p => p.sentiment === 'BULLISH').length}
                        <span className="text-slate-600 text-sm font-normal">/{darkPoolPrints.length}</span>
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
