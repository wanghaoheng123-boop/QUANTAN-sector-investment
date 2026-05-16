'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { COMMODITY_INSTRUMENTS, CommodityCategory } from '@/lib/commodities'
import WatchlistButton from '@/components/WatchlistButton'

interface Quote {
  ticker: string
  price: number
  change: number
  changePct: number
  volume: number
}

const CATEGORY_ORDER: CommodityCategory[] = ['broad', 'energy', 'metals', 'agriculture', 'volatility']

export default function CommoditiesPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({})
  const [filter, setFilter] = useState<CommodityCategory | 'ALL'>('ALL')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  const tickers = useMemo(() => COMMODITY_INSTRUMENTS.map((c) => c.ticker), [])

  const fetchPrices = useCallback(async () => {
    try {
      const q = tickers.map(encodeURIComponent).join(',')
      const res = await fetch(`/api/prices?tickers=${q}`)
      const data = await res.json()
      if (data.quotes) {
        const map: Record<string, Quote> = {}
        data.quotes.forEach((row: Quote) => {
          map[row.ticker] = row
        })
        setQuotes(map)
        setLastUpdate(new Date())
      }
    } catch {
      /* network */
    }
  }, [tickers])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 20_000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const rows = useMemo(() => {
    const list =
      filter === 'ALL' ? COMMODITY_INSTRUMENTS : COMMODITY_INSTRUMENTS.filter((c) => c.category === filter)
    return list.sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [filter])

  return (
    <div className="min-h-screen max-w-7xl mx-auto px-4 py-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Commodities & futures proxies</h1>
          <p className="text-slate-400 text-sm mt-2 max-w-2xl leading-relaxed">
            ETF and ETP proxies for energy, metals, and agriculture. Use charts on each symbol page; verify roll yield and tax treatment with your desk before sizing.
          </p>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {lastUpdate ? `Last update ${lastUpdate.toLocaleTimeString()}` : 'Loading…'}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filter === 'ALL' ? 'bg-amber-600/20 border-amber-500/40 text-amber-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'
          }`}
        >
          All
        </button>
        {CATEGORY_ORDER.filter((c) => c !== 'volatility').map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border capitalize transition-colors ${
              filter === c ? 'bg-amber-600/20 border-amber-500/40 text-amber-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden md:table-cell">Category</th>
                <th className="px-4 py-3 text-right font-mono">Last</th>
                <th className="px-4 py-3 text-right font-mono">Chg %</th>
                <th className="px-4 py-3 text-right hidden sm:table-cell font-mono">Volume</th>
                <th className="px-4 py-3">Watch</th>
                <th className="px-4 py-3">Chart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const q = quotes[c.ticker]
                const up = (q?.changePct ?? 0) >= 0
                return (
                  <tr key={c.ticker} className="border-b border-slate-800/80 hover:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-white">{c.ticker}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 max-w-[200px]">
                      <div className="truncate" title={c.description}>
                        {c.name}
                      </div>
                      <div className="text-xs text-slate-400 truncate">{c.benchmarkNote}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell capitalize text-slate-500">{c.category}</td>
                    <td className="px-4 py-3 text-right font-mono text-white">
                      {q ? q.price.toFixed(2) : '—'}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono ${q ? (up ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400'}`}
                    >
                      {q ? `${up ? '+' : ''}${q.changePct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-500 hidden sm:table-cell">
                      {q && q.volume ? `${(q.volume / 1e6).toFixed(2)}M` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <WatchlistButton ticker={c.ticker} iconOnly className="!px-2 !py-1" />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/stock/${c.ticker.toLowerCase()}`}
                        className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                      >
                        Open →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
