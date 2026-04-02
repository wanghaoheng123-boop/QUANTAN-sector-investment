'use client'

import { useState, useMemo } from 'react'
import type { Trade } from '@/lib/backtest/engine'

interface Props {
  trades: Trade[]
  sectorColors: Record<string, string>
}

export default function TradeLog({ trades, sectorColors }: Props) {
  const [filterSector, setFilterSector] = useState<string>('All')
  const [filterAction, setFilterAction] = useState<string>('All')
  const [filterTicker, setFilterTicker] = useState<string>('')

  const sectors = useMemo(() => {
    const s = new Set(trades.map(t => t.sector))
    return ['All', ...Array.from(s).sort()]
  }, [trades])

  const filtered = useMemo(() => {
    let rows = trades
    if (filterSector !== 'All') rows = rows.filter(t => t.sector === filterSector)
    if (filterAction !== 'All') rows = rows.filter(t => t.action === filterAction)
    if (filterTicker) rows = rows.filter(t => t.ticker.toLowerCase().includes(filterTicker.toLowerCase()))
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [trades, filterSector, filterAction, filterTicker])

  const winningTrades = filtered.filter(t => (t.pnlPct ?? 0) > 0)
  const losingTrades = filtered.filter(t => (t.pnlPct ?? 0) < 0)

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-950/30 rounded-xl p-4 border border-emerald-800/30">
          <div className="text-xs text-emerald-500 mb-1">Winning Trades</div>
          <div className="text-xl font-bold font-mono text-emerald-400">{winningTrades.length}</div>
          <div className="text-[10px] text-emerald-600 mt-1">
            avg +{(winningTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / Math.max(winningTrades.length, 1) * 100).toFixed(2)}%
          </div>
        </div>
        <div className="bg-red-950/30 rounded-xl p-4 border border-red-800/30">
          <div className="text-xs text-red-500 mb-1">Losing Trades</div>
          <div className="text-xl font-bold font-mono text-red-400">{losingTrades.length}</div>
          <div className="text-[10px] text-red-600 mt-1">
            avg −{Math.abs(losingTrades.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / Math.max(losingTrades.length, 1) * 100).toFixed(2)}%
          </div>
        </div>
        <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
          <div className="text-xs text-slate-500 mb-1">All Trades</div>
          <div className="text-xl font-bold font-mono text-white">{filtered.length}</div>
          <div className="text-[10px] text-slate-600 mt-1">
            {new Set(filtered.map(t => t.ticker)).size} instruments
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterSector}
          onChange={e => setFilterSector(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700"
        >
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700"
        >
          <option value="All">All Actions</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <input
          type="text"
          placeholder="Filter ticker…"
          value={filterTicker}
          onChange={e => setFilterTicker(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded-lg px-3 py-1.5 border border-slate-700 placeholder-slate-600"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {['Date', 'Ticker', 'Sector', 'Action', 'Entry Price', 'Exit Price', 'PnL %', 'Shares', 'Value', 'Regime', 'Signal', 'Conf%', 'Reason'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left text-slate-500 uppercase tracking-wider font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filtered.slice(0, 200).map((t, i) => {
              const pnl = t.pnlPct ?? 0
              const isWin = pnl > 0
              return (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-slate-400 whitespace-nowrap">{t.date}</td>
                  <td className="px-3 py-2.5 font-mono font-bold text-white">{t.ticker}</td>
                  <td className="px-3 py-2.5 text-slate-400 text-[10px]">{t.sector}</td>
                  <td className={`px-3 py-2.5 font-bold ${t.action === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.action}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">${t.entryPrice.toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-300">
                    {t.pnlPct !== null ? `$${t.exitPrice.toFixed(2)}` : '—'}
                  </td>
                  <td className={`px-3 py-2.5 font-mono font-bold ${isWin ? 'text-emerald-400' : pnl < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                    {t.pnlPct !== null ? `${isWin ? '+' : ''}${(pnl * 100).toFixed(2)}%` : 'Open'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{t.shares}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">${t.value.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-500">{t.regime}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-500">{t.dipSignal}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">{t.confidence}</td>
                  <td className="px-3 py-2.5 text-[10px] text-slate-500 max-w-[200px] truncate" title={t.reason}>{t.reason}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-slate-500 text-sm">No trades found.</div>
        )}
        {filtered.length > 200 && (
          <div className="py-2 text-center text-[10px] text-slate-600 border-t border-slate-800">
            Showing 200 of {filtered.length} trades
          </div>
        )}
      </div>
    </div>
  )
}
