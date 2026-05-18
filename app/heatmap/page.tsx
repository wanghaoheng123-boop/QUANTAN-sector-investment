'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SECTORS } from '@/lib/sectors'

interface Quote {
  ticker: string
  price: number
  change: number
  changePct: number
  marketCap: string
  quoteTime?: string | null
}

export default function HeatmapPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  // Phase 14 wave 20: AbortSignal-aware poll. Each tick aborts any in-flight
  // previous fetch so a slow response from a prior tick cannot overwrite
  // a fresh response. Cleanup aborts the active controller on unmount.
  useEffect(() => {
    let activeController = new AbortController()
    const fetchPrices = async (signal: AbortSignal) => {
      try {
        const res = await fetch('/api/prices', { signal })
        if (signal.aborted) return
        const data = await res.json()
        if (signal.aborted) return
        if (data.quotes) {
          const map: Record<string, Quote> = {}
          data.quotes.forEach((q: Quote) => { map[q.ticker] = q })
          setQuotes(map)
          setLastUpdate(new Date())
        }
      } catch (e) {
        if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        console.warn('[heatmap] fetch failed', e)
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    void fetchPrices(activeController.signal)
    const interval = setInterval(() => {
      activeController.abort()
      activeController = new AbortController()
      void fetchPrices(activeController.signal)
    }, 15000)
    return () => {
      clearInterval(interval)
      activeController.abort()
    }
  }, [])

  // Order sectors by market cap or alphabetically. Right now using just standard order.
  const sectorsWithData = SECTORS.map(s => ({
    ...s,
    quote: quotes[s.etf]
  }))

  const getHeatmapColor = (changePct: number) => {
    if (changePct >= 2) return 'bg-green-600'
    if (changePct >= 1) return 'bg-green-700'
    if (changePct >= 0) return 'bg-green-900'
    if (changePct >= -1) return 'bg-red-900'
    if (changePct >= -2) return 'bg-red-700'
    return 'bg-red-600'
  }

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Sector Heatmap</h1>
            <p className="text-slate-400">Session change % vs prior close from Yahoo (normalized in /api/prices).</p>
            <p className="text-xs text-slate-400 mt-2 max-w-2xl leading-relaxed">
              Between exchange sessions the vendor quote usually does not move; the clock above is when we last polled, not a new auction print. Colors map fixed % buckets (0, ±1%, ±2%).
            </p>
          </div>
          <div className="text-sm text-slate-500 font-mono">
            {lastUpdate ? `Poll · ${lastUpdate.toLocaleTimeString()}` : 'Connecting...'}
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {sectorsWithData.map(sector => {
            const quote = sector.quote
            const isUp = (quote?.changePct ?? 0) >= 0
            const bgColor = quote ? getHeatmapColor(quote.changePct) : 'bg-slate-800'

            return (
              <Link key={sector.slug} href={`/sector/${sector.slug}`}>
                <div 
                  className={`relative p-4 h-32 rounded-lg flex flex-col justify-between transition-transform duration-300 hover:scale-105 hover:z-10 shadow-lg border border-black/20 overflow-hidden ${bgColor}`}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-white text-sm shadow-black/50 drop-shadow-md">{sector.etf}</span>
                    <span className="text-sm opacity-80">{sector.icon}</span>
                  </div>
                  
                  <div className="text-center">
                    {loading && !quote ? (
                      <div className="animate-pulse space-y-2 flex flex-col items-center">
                        <div className="h-4 w-12 bg-white/20 rounded"></div>
                        <div className="h-5 w-16 bg-white/20 rounded"></div>
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-white/70 font-medium mb-1 truncate px-1">
                          {sector.name}
                        </div>
                        <div className="text-2xl font-bold text-white tracking-tight drop-shadow-md">
                          {isUp ? '+' : ''}{quote?.changePct.toFixed(2)}%
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
        
        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-6">
          <span className="text-xs text-slate-500 mr-2">Bearish</span>
          <div className="w-6 h-4 bg-red-600 rounded-sm"></div>
          <div className="w-6 h-4 bg-red-700 rounded-sm"></div>
          <div className="w-6 h-4 bg-red-900 rounded-sm"></div>
          <div className="w-6 h-4 bg-green-900 rounded-sm"></div>
          <div className="w-6 h-4 bg-green-700 rounded-sm"></div>
          <div className="w-6 h-4 bg-green-600 rounded-sm"></div>
          <span className="text-xs text-slate-500 ml-2">Bullish</span>
        </div>

      </div>
    </div>
  )
}
