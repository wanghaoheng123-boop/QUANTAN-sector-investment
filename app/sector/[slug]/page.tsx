'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import SignalCard from '@/components/SignalCard'
import DarkPoolPanel from '@/components/DarkPoolPanel'
import NewsFeed from '@/components/NewsFeed'
import WatchlistButton from '@/components/WatchlistButton'
import { SECTORS, getSectorBySlug } from '@/lib/sectors'
import { generateDarkPoolPrints } from '@/lib/mockData'
import { DarkPoolPrint } from '@/lib/sectors'
import type { DarkPoolAnalysis } from '@/lib/darkpool'
import { buildSingleSessionSignal } from '@/lib/sessionSignalsFromQuotes'

const KLineChart = dynamic(() => import('@/components/KLineChart'), { ssr: false })

interface Candle {
  time: string; open: number; high: number; low: number; close: number; volume: number;
}
interface DpMarker {
  time: string; price: number; size: number; sentiment: 'BULLISH' | 'BEARISH';
}

const SECTOR_MAIN_TABS = [
  ['chart', 'Chart'],
  ['darkpool', 'Dark Pool'],
  ['news', 'News'],
] as const

export default function SectorPage({ params }: { params: { slug: string } }) {
  const sector = getSectorBySlug(params.slug)
  if (!sector) notFound()

  const [candles, setCandles] = useState<Candle[]>([])
  const [darkPoolMarkers, setDarkPoolMarkers] = useState<DpMarker[]>([])
  const [quote, setQuote] = useState<{
    price: number
    change: number
    changePct: number
    volume: number
    high52w: number
    low52w: number
    pe: number
    quoteTime?: string | null
  } | null>(null)
  const [darkPoolPrints, setDarkPoolPrints] = useState<DarkPoolPrint[]>([])
  const [darkPoolApiData, setDarkPoolApiData] = useState<DarkPoolAnalysis | null>(null)
  const [darkPoolApiLoading, setDarkPoolApiLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('chart')
  const [activeRange, setActiveRange] = useState('6M')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/chart/${encodeURIComponent(sector.etf)}?range=${encodeURIComponent(activeRange)}`)
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`))
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        setCandles(data.candles ?? [])
        setDarkPoolMarkers(data.darkPoolMarkers ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sector.etf, activeRange])

  useEffect(() => {
    const pull = () => {
      fetch(`/api/prices?tickers=${encodeURIComponent(sector.etf)}`)
        .then((r) => r.json())
        .then((data) => {
          const q = data.quotes?.find((x: { ticker: string }) => x.ticker === sector.etf)
          if (q) setQuote(q)
        })
        .catch(() => {})
    }
    pull()
    const id = setInterval(pull, 15000)
    return () => clearInterval(id)
  }, [sector.etf])

  useEffect(() => {
    setDarkPoolPrints(generateDarkPoolPrints(sector.etf))
  }, [sector.etf])

  useEffect(() => {
    if (activeTab !== 'darkpool') return
    setDarkPoolApiLoading(true)
    setDarkPoolApiData(null)
    fetch(`/api/darkpool/${encodeURIComponent(sector.etf)}`)
      .then((r) => r.json())
      .then((data) => {
        setDarkPoolApiData(data)
        setDarkPoolApiLoading(false)
      })
      .catch(() => {
        setDarkPoolApiLoading(false)
      })
  }, [sector.etf, activeTab])

  const signal = useMemo(
    () => (quote ? buildSingleSessionSignal(sector.etf, quote) : null),
    [quote, sector.etf]
  )

  // newsMarkers removed — live news headlines now shown in NewsFeed panel below chart

  const isUp = (quote?.changePct ?? 0) >= 0

  return (
    <div className="min-h-screen">
      {/* Sector Header */}
      <div
        className="border-b border-slate-800 py-8"
        style={{ background: `linear-gradient(180deg, ${sector.color}08 0%, transparent 100%)` }}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-lg"
                style={{ backgroundColor: `${sector.color}20`, border: `1px solid ${sector.color}40` }}
              >
                {sector.icon}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">Markets</Link>
                  <span className="text-slate-700 text-xs">/</span>
                  <span className="text-xs" style={{ color: sector.color }}>{sector.name}</span>
                </div>
                <h1 className="text-2xl font-bold text-white">{sector.name} Sector</h1>
                <p className="text-sm text-slate-400 mt-0.5">{sector.description}</p>
              </div>
            </div>
            <div className="flex items-start gap-6">
              <WatchlistButton ticker={sector.etf} className="shrink-0" />
              {quote ? (
                <div className="text-right">
                  <div className="text-2xl font-bold text-white font-mono">${quote.price.toFixed(2)}</div>
                  <div className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {isUp ? '▲' : '▼'} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePct).toFixed(2)}%)
                  </div>
                  <div className="text-xs text-slate-600 mt-1 font-mono">ETF: {sector.etf}</div>
                </div>
              ) : (
                <div className="space-y-2 text-right w-32">
                  <div className="h-7 bg-slate-800 rounded animate-pulse" />
                  <div className="h-5 bg-slate-800 rounded animate-pulse" />
                </div>
              )}
            </div>
          </div>

          {/* Quick stats */}
          {quote && (
            <div className="flex flex-wrap gap-4 mt-4 text-xs text-slate-500">
              <span>52W High: <span className="text-white font-mono">${quote.high52w.toFixed(2)}</span></span>
              <span>52W Low: <span className="text-white font-mono">${quote.low52w.toFixed(2)}</span></span>
              <span>P/E: <span className="text-white font-mono">{quote.pe.toFixed(1)}×</span></span>
              <span>Vol: <span className="text-white font-mono">{(quote.volume / 1e6).toFixed(1)}M</span></span>
              <span className="flex items-center gap-2">
                Top Holdings:
                {sector.topHoldings.map(h => (
                  <Link key={h} href={`/stock/${h.toLowerCase()}`}>
                    <span className="font-mono text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer border border-slate-700 shadow-sm">{h}</span>
                  </Link>
                ))}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left: Chart + Tabs */}
          <div className="xl:col-span-2 space-y-6">
            {/* Tab navigation */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {SECTOR_MAIN_TABS.map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                      activeTab === tab
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeTab === 'chart' && (
                <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                  {['1M', '3M', '6M', '1Y'].map(r => (
                    <button
                      key={r}
                      onClick={() => setActiveRange(r)}
                      className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                        activeRange === r
                          ? 'bg-slate-700 text-white'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chart tab */}
            {activeTab === 'chart' && (
              <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">{sector.etf} · Candlestick Chart</span>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>1D bars · {activeRange} window</span>
                  </div>
                </div>
                {candles.length > 0 ? (
                  <KLineChart
                    candles={candles}
                    darkPoolMarkers={darkPoolMarkers}
                    color={sector.color}
                    ticker={sector.etf}
                    range={activeRange as '1M' | '3M' | '6M' | '1Y'}
                    showRSI
                  />
                ) : (
                  <div className="h-80 bg-slate-800/30 rounded-xl animate-pulse flex items-center justify-center">
                    <span className="text-slate-600 text-sm">Loading chart data...</span>
                  </div>
                )}
              </div>
            )}

            {/* Dark Pool tab */}
            {activeTab === 'darkpool' && (
              <div>
                <DarkPoolPanel
                  prints={darkPoolPrints}
                  ticker={sector.etf}
                  color={sector.color}
                  apiData={darkPoolApiData}
                  apiLoading={darkPoolApiLoading}
                />
              </div>
            )}

            {/* News tab */}
            {activeTab === 'news' && (
              <div>
                <h3 className="text-sm font-semibold text-slate-300 mb-4">
                  {sector.name} Sector — Latest News
                </h3>
                <NewsFeed sector={sector.slug} color={sector.color} />
              </div>
            )}
          </div>

          {/* Right: Signal + Dark Pool Summary */}
          <div className="space-y-6">
            {/* Signal Card */}
            {signal && (
              <div>
                <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3">
                  Session vs prior close (Yahoo)
                </h3>
                <SignalCard signal={signal} color={sector.color} />
              </div>
            )}

            {/* Dark Pool Summary (always visible) */}
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

            {/* Related Sectors */}
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-3">Other Sectors</h3>
              <div className="space-y-2">
                {SECTORS.filter(s => s.slug !== sector.slug).slice(0, 5).map(s => (
                  <Link key={s.slug} href={`/sector/${s.slug}`}>
                    <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800 hover:border-slate-700 hover:bg-slate-800/30 transition-all group">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm">{s.icon}</span>
                        <div>
                          <div className="text-xs font-medium text-white">{s.name}</div>
                          <div className="text-xs text-slate-600 font-mono">{s.etf}</div>
                        </div>
                      </div>
                      <span className="text-slate-600 group-hover:text-slate-400 text-xs transition-colors">→</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
