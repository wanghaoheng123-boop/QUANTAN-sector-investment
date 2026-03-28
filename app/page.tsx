'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import SectorCard from '@/components/SectorCard'
import SignalCard from '@/components/SignalCard'
import PriceTicker from '@/components/PriceTicker'
import { SECTORS } from '@/lib/sectors'
import { generateSignals, BRIEFS } from '@/lib/mockData'
import { PriceSignal } from '@/lib/sectors'

interface Quote {
  ticker: string
  price: number
  change: number
  changePct: number
}

export default function HomePage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [signals, setSignals] = useState<PriceSignal[]>([])
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(15)
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
    } catch {}
  }, [])

  useEffect(() => {
    setSignals(generateSignals())
    fetchPrices()
    const interval = setInterval(() => {
      fetchPrices()
      setCountdown(15)
    }, 15000)
    return () => clearInterval(interval)
  }, [fetchPrices])

  // Countdown timer
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [])

  const topBuy = signals.filter(s => s.direction === 'BUY').sort((a, b) => b.confidence - a.confidence).slice(0, 3)
  const topSell = signals.filter(s => s.direction === 'SELL').sort((a, b) => b.confidence - a.confidence).slice(0, 2)
  const topSignals = [...topBuy, ...topSell]

  const signalMap = signals.reduce<Record<string, PriceSignal>>((acc, s) => {
    acc[s.etf] = s
    return acc
  }, {})

  const tickerItems = SECTORS.map(s => ({
    ticker: s.etf,
    name: s.name,
    price: quotes[s.etf]?.price ?? 0,
    changePct: quotes[s.etf]?.changePct ?? 0,
  })).filter(t => t.price > 0)

  const filteredSectors = activeFilter === 'ALL'
    ? SECTORS
    : SECTORS.filter(s => signalMap[s.etf]?.direction === activeFilter)

  return (
    <div className="min-h-screen">
      {/* Price Ticker */}
      {tickerItems.length > 0 && <PriceTicker items={tickerItems} />}

      <div className="max-w-7xl mx-auto px-4 py-10 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-4 py-6">
          <div className="inline-flex items-center gap-2 bg-blue-900/30 border border-blue-500/30 rounded-full px-4 py-1.5 text-xs text-blue-400 mb-2">
            <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
            Live · {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Connecting...'}
            <span className="ml-1 text-blue-600 font-mono">↻ {countdown}s</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="gradient-text">Sector Intelligence</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto leading-relaxed">
            <strong className="text-slate-300 font-medium">Live Yahoo quotes</strong> for sector ETFs refresh every 15s. Signal cards, sparklines, and dark-pool panels are{' '}
            <strong className="text-amber-200/90 font-medium">illustrative demos</strong> (deterministic per calendar day, not trading algorithms). Use{' '}
            <strong className="text-slate-300 font-medium">Quant Lab</strong> on any stock page for fundamentals and formulas sourced from Yahoo data.
          </p>
        </div>

        {/* Top Signals */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">Top Signals Today</h2>
              <p className="text-xs text-slate-500 mt-0.5">Demo only — stable for the UTC day; not live trade recommendations</p>
            </div>
            <Link href="/briefs" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
              View all briefs →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {topSignals.map((signal, i) => {
              const sector = SECTORS.find(s => s.etf === signal.etf)!
              return (
                <Link key={i} href={`/sector/${sector.slug}`}>
                  <SignalCard signal={signal} color={sector.color} compact />
                </Link>
              )
            })}
          </div>
        </section>

        {/* Market Overview Stats */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Sectors Bullish', value: signals.filter(s => s.direction === 'BUY').length, of: 11, color: '#00d084' },
            { label: 'Sectors Bearish', value: signals.filter(s => s.direction === 'SELL').length, of: 11, color: '#ff4757' },
            { label: 'Avg Confidence', value: `${Math.round(signals.reduce((a, b) => a + b.confidence, 0) / (signals.length || 1))}%`, color: '#3b82f6', noOf: true },
            { label: 'Signals Generated', value: signals.length, of: undefined, color: '#a855f7' },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-slate-800 p-4 bg-slate-900/40">
              <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>
                {stat.value}
                {stat.of && <span className="text-slate-600 text-base font-normal">/{stat.of}</span>}
              </div>
              <div className="text-xs text-slate-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </section>

        {/* Sector Grid */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">All Sectors</h2>
              <p className="text-xs text-slate-500 mt-0.5">Click any sector to view K-line chart, dark pool data, and signals</p>
            </div>
            <div className="flex gap-2">
              {['ALL', 'BUY', 'SELL', 'HOLD', 'WATCH'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    activeFilter === f
                      ? 'bg-blue-600 text-white'
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

        {/* Recent Briefs */}
        <section>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-white">Recent Intelligence Briefs</h2>
              <p className="text-xs text-slate-500 mt-0.5">In-depth sector analysis with embedded signals and data</p>
            </div>
            <Link href="/briefs" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
              View archive →
            </Link>
          </div>
          <div className="space-y-4">
            {BRIEFS.slice(0, 3).map(brief => {
              const sector = SECTORS.find(s => s.slug === brief.sector)
              return (
                <Link key={brief.id} href={`/briefs/${brief.id}`}>
                  <div className="rounded-xl border border-slate-800 p-5 hover:border-slate-600 hover:bg-slate-900/40 transition-all group">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 hidden sm:flex">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                          style={{ backgroundColor: `${sector?.color}20` }}
                        >
                          {sector?.icon}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ backgroundColor: `${sector?.color}20`, color: sector?.color }}>
                            {sector?.name ?? brief.sector}
                          </span>
                          <span className="text-xs text-slate-600">
                            {new Date(brief.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="text-xs text-slate-600">{brief.readTime} min read</span>
                        </div>
                        <h3 className="text-base font-semibold text-white group-hover:text-slate-200 mb-1.5 leading-snug">{brief.title}</h3>
                        <p className="text-sm text-slate-500 line-clamp-2">{brief.summary}</p>
                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                          {brief.tags.slice(0, 4).map(tag => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-500">{tag}</span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors">→</div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
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
              <div key={i} className="text-center space-y-2">
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
