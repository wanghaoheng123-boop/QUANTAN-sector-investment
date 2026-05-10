'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import SectorCard from '@/components/SectorCard'
import SignalCard from '@/components/SignalCard'
import PriceTicker from '@/components/PriceTicker'
import { SECTORS } from '@/lib/sectors'
import { PriceSignal } from '@/lib/sectors'
import { buildSessionSignalsFromQuotes } from '@/lib/sessionSignalsFromQuotes'
import { useErrorToast } from '@/hooks/useErrorToast'
import { ErrorToastList } from '@/components/ErrorToastList'

// Real news brief from Yahoo Finance API
interface NewsBrief {
  id: string
  title: string
  summary: string
  sector: string
  sectorName: string
  sectorColor: string
  timestamp: string | null
  readTime: number
  tags: string[]
  link: string
  publisher: string
  tickers: string[]
}

interface Quote {
  ticker: string
  price: number
  change: number
  changePct: number
  quoteTime?: string | null
}

function formatUtcDateTime(ts: string): string {
  const d = new Date(ts)
  if (!Number.isFinite(d.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(d)
}

export default function HomePage() {
  const { toasts, showToast, dismissToast } = useErrorToast()
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(15)
  const [newsBriefs, setNewsBriefs] = useState<NewsBrief[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<string>('ALL')

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/prices')
      const data = await res.json()
      if (data.quotes) {
        const map: Record<string, Quote> = {}
        data.quotes.forEach((q: Quote) => { map[q.ticker] = q })
        setQuotes(map)
        setLastUpdate(new Date())
      }
    } catch (e: unknown) {
      showToast(`Price refresh failed: ${e instanceof Error ? e.message : 'Network error'}`, 'warn', 4000)
    }
  }, [showToast])

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(() => {
      fetchPrices()
      setCountdown(15)
    }, 15000)
    return () => clearInterval(interval)
  }, [fetchPrices])

  // Fetch real news from Yahoo Finance
  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch('/api/briefs')
        if (res.ok) {
          const data = await res.json()
          if (data.briefs) {
            setNewsBriefs(data.briefs)
          }
        }
      } catch (e: unknown) {
        showToast(`News feed failed: ${e instanceof Error ? e.message : 'Network error'}`, 'warn', 5000)
      } finally {
        setNewsLoading(false)
      }
    }
    fetchNews()
  }, [])

  // Countdown timer
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const signals = useMemo(() => buildSessionSignalsFromQuotes(quotes), [quotes])

  const buySignals = useMemo(() => signals.filter((s) => s.direction === 'BUY'), [signals])
  const sellSignals = useMemo(() => signals.filter((s) => s.direction === 'SELL'), [signals])
  const holdSignals = useMemo(() => signals.filter((s) => s.direction === 'HOLD'), [signals])

  const topBuy = useMemo(() => buySignals.sort((a, b) => Math.abs(b.sessionChangePct ?? 0) - Math.abs(a.sessionChangePct ?? 0)).slice(0, 3), [buySignals])
  const topSell = useMemo(() => sellSignals.sort((a, b) => Math.abs(b.sessionChangePct ?? 0) - Math.abs(a.sessionChangePct ?? 0)).slice(0, 2), [sellSignals])
  const topSignals = useMemo(() => [...topBuy, ...topSell], [topBuy, topSell])

  const signalMap = useMemo(() => signals.reduce<Record<string, PriceSignal>>((acc, s) => {
    acc[s.etf] = s
    return acc
  }, {}), [signals])

  const medianAbsMove = useMemo(() => {
    const xs = signals.map((s) => Math.abs(s.sessionChangePct ?? 0)).sort((a, b) => a - b)
    if (!xs.length) return 0
    const m = Math.floor(xs.length / 2)
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
  }, [signals])

  const avgConfidence = useMemo(() => Math.round(signals.reduce((a, b) => a + b.confidence, 0) / (signals.length || 1)), [signals])
  const sortedSignals = useMemo(() => [...signals].sort((a, b) => (b.sessionChangePct ?? 0) - (a.sessionChangePct ?? 0)), [signals])

  const tickerItems = useMemo(() => SECTORS.map(s => ({
    ticker: s.etf,
    name: s.name,
    price: quotes[s.etf]?.price ?? 0,
    changePct: quotes[s.etf]?.changePct ?? 0,
  })).filter(t => t.price > 0), [quotes])

  const filteredSectors = useMemo(() => activeFilter === 'ALL'
    ? SECTORS
    : SECTORS.filter(s => signalMap[s.etf]?.direction === activeFilter), [activeFilter, signalMap])

  return (
    <div className="min-h-screen">
      {/* Error toast notifications — replaces silent .catch(() => {}) (Phase 12 H5) */}
      <ErrorToastList toasts={toasts} onDismiss={dismissToast} />

      {/* Price Ticker */}
      {tickerItems.length > 0 && <PriceTicker items={tickerItems} />}

      <div className="max-w-7xl mx-auto px-4 py-10 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-4 py-6">
          <div className="inline-flex items-center gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1.5 text-xs text-amber-400 mb-2 shadow-lg shadow-amber-900/20">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            Live · {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Connecting…'}
            <span className="ml-1 text-amber-600 font-mono">↻ {countdown}s</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="gradient-text">Sector Intelligence</span>
          </h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto leading-relaxed">
            Institutional-grade market intelligence across all 11 GICS sectors — real-time prices, K-line charts, dark pool data, and curated signal briefs.
          </p>
        </div>

        {/* Backtest CTA */}
        <section className="bg-gradient-to-r from-amber-950/40 via-slate-900/80 to-amber-950/30 rounded-2xl border border-amber-800/30 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">NEW</span>
                <h2 className="text-lg font-bold text-white">Institutional Backtest Dashboard</h2>
              </div>
              <p className="text-sm text-slate-400 max-w-lg">
                5Y walk-forward backtest across all 11 sectors (55 stocks) + BTC. 200EMA deviation regime strategy with RSI/MACD/ATR/BB confirmations, Half-Kelly position sizing, and 10% stop-loss.
              </p>
            </div>
            <Link
              href="/backtest"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-amber-900/40"
            >
              <span>View Backtest</span>
              <span>→</span>
            </Link>
          </div>
        </section>

        {/* Top Signals */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">Largest session moves</h2>
              <p className="text-xs text-slate-500 mt-0.5">From Yahoo change % (normalized). UP/DOWN = vs prior close — not buy/sell advice.</p>
            </div>
            <Link href="/briefs" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
              View all briefs →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {topSignals.map((signal, i) => {
              const sector = SECTORS.find(s => s.etf === signal.etf)
              if (!sector) return null
              return (
                <Link key={i} href={`/sector/${sector.slug}`}>
                  <SignalCard signal={signal} color={sector.color} compact />
                </Link>
              )
            })}
          </div>
        </section>

        {/* Market Overview Stats */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Sectors Bullish', value: buySignals.length, of: 11, color: '#00d084' },
            { label: 'Sectors Bearish', value: sellSignals.length, of: 11, color: '#ff4757' },
            { label: 'Neutral', value: holdSignals.length, of: 11, color: '#f59e0b' },
            { label: 'Avg Confidence', value: `${avgConfidence}%`, color: '#f59e0b', noOf: true },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-slate-800 p-4 bg-slate-900/60 hover:border-slate-700/80 transition-colors">
              <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>
                {stat.value}
                {stat.of && <span className="text-slate-600 text-base font-normal">/{stat.of}</span>}
              </div>
              <div className="text-xs text-slate-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </section>

        {/* Market Breadth */}
        <section className="rounded-2xl border border-slate-800 p-5 bg-slate-900/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Market Breadth</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">Session direction distribution across all sectors</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-slate-400">Up {buySignals.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-slate-400">Down {sellSignals.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-slate-400">Neutral {holdSignals.length}</span>
              </div>
            </div>
          </div>

          {/* Horizontal stacked bar */}
          <div className="w-full h-6 bg-slate-800 rounded-lg overflow-hidden flex">
            {buySignals.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(buySignals.length / 11) * 100}%` }}
              >
                {buySignals.length >= 3 && (
                  <span className="text-[10px] font-bold text-white font-mono">{buySignals.length}</span>
                )}
              </div>
            )}
            {holdSignals.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(holdSignals.length / 11) * 100}%` }}
              >
                {holdSignals.length >= 2 && (
                  <span className="text-[10px] font-bold text-white font-mono">{holdSignals.length}</span>
                )}
              </div>
            )}
            {sellSignals.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-red-400 to-red-500 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(sellSignals.length / 11) * 100}%` }}
              >
                {sellSignals.length >= 3 && (
                  <span className="text-[10px] font-bold text-white font-mono">{sellSignals.length}</span>
                )}
              </div>
            )}
          </div>

          {/* Sector list below bar */}
          <div className="mt-4 flex flex-wrap gap-2">
            {sortedSignals
              .map((signal) => {
                const sector = SECTORS.find((s) => s.etf === signal.etf)
                const isUp = signal.direction === 'BUY'
                const isDown = signal.direction === 'SELL'
                const color = isUp ? '#00d084' : isDown ? '#ff4757' : '#eab308'
                return (
                  <div
                    key={signal.etf}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50"
                  >
                    <span className="text-xs">{sector?.icon}</span>
                    <span className="text-[10px] font-mono text-slate-400">{signal.etf}</span>
                    <span className="text-[10px] font-mono font-medium" style={{ color }}>
                      {signal.sessionChangePct != null
                        ? `${signal.sessionChangePct >= 0 ? '+' : ''}${signal.sessionChangePct.toFixed(2)}%`
                        : '—'}
                    </span>
                  </div>
                )
              })}
          </div>
        </section>

        {/* Sector Grid */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">All Sectors</h2>
              <p className="text-xs text-slate-500 mt-0.5">Click any sector to view K-line chart, dark pool data, and signals</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {['ALL', 'BUY', 'SELL', 'HOLD'].map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    activeFilter === f
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredSectors.map(sector => (
              <SectorCard
                key={sector.slug}
                sector={sector}
                quote={quotes[sector.etf]}
                signal={signalMap[sector.etf]}
              />
            ))}
          </div>
        </section>

        {/* Recent Briefs - Live from Yahoo Finance */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">Latest Financial News</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {newsLoading ? 'Loading latest news...' : `Live from Yahoo Finance · ${newsBriefs.length} articles`}
              </p>
            </div>
            <Link href="/briefs" className="text-sm text-amber-400 hover:text-amber-300 transition-colors">
              View all →
            </Link>
          </div>
          {newsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-slate-800 p-5 bg-slate-900/40">
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 hidden sm:flex">
                      <div className="w-10 h-10 rounded-lg bg-slate-800 animate-pulse" />
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-20 bg-slate-800 rounded animate-pulse" />
                      <div className="h-5 w-full bg-slate-800 rounded animate-pulse" />
                      <div className="h-4 w-3/4 bg-slate-800 rounded animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : newsBriefs.length > 0 ? (
            <div className="space-y-4">
              {newsBriefs.slice(0, 3).map(brief => (
                <a
                  key={brief.id}
                  href={brief.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-slate-800 p-5 hover:border-amber-500/40 hover:bg-slate-900/40 transition-all group"
                >
                  <div className="flex items-start gap-4">
                    <div className="shrink-0 hidden sm:flex">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                        style={{ backgroundColor: `${brief.sectorColor || '#f59e0b'}20` }}
                      >
                        {brief.tickers[0] ? `💼` : '📰'}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {brief.sectorName && (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded"
                            style={{ backgroundColor: `${brief.sectorColor}20`, color: brief.sectorColor }}
                          >
                            {brief.sectorName}
                          </span>
                        )}
                        {brief.tickers.slice(0, 2).map(t => (
                          <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {t}
                          </span>
                        ))}
                        <span className="text-xs text-slate-600">
                          {brief.publisher}
                        </span>
                        {brief.timestamp && (
                          <span className="text-xs text-slate-600">
                            {formatUtcDateTime(brief.timestamp)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-white group-hover:text-slate-200 mb-1.5 leading-snug line-clamp-2">
                        {brief.title}
                      </h3>
                      <p className="text-sm text-slate-500 line-clamp-2">{brief.summary}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {brief.tags.slice(0, 4).map(tag => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-500">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-slate-600 group-hover:text-amber-400 transition-colors">↗</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 p-8 text-center">
              <p className="text-slate-500">No news available at the moment. Check back shortly.</p>
            </div>
          )}
        </section>

        {/* What's inside */}
        <section className="rounded-2xl border border-slate-800 p-8 bg-slate-900/30">
          <h2 className="text-lg font-bold text-white mb-6 text-center">What every sector brief includes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: '📊', title: 'K-Line Chart', desc: 'Candlestick charts with EMA overlays, volume, dark pool print markers, and news event pins.' },
              { icon: '🔵', title: 'Dark Pool Intelligence', desc: 'Block prints, sweep orders, institutional flow sentiment, and VWAP premium/discount analysis.' },
              { icon: '⚡', title: 'Price Signals', desc: 'Entry, stop loss, and target levels with confidence scores and risk/reward ratios.' },
            ].map((item, i) => (
              <div key={i} className="text-center space-y-2 p-4 rounded-xl border border-slate-800 hover:border-amber-800/40 hover:bg-amber-500/5 transition-all">
                <div className="text-2xl">{item.icon}</div>
                <div className="font-semibold text-white text-sm">{item.title}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
