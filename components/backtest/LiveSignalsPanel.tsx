'use client'

/**
 * LiveSignalsPanel — live signal table + sector breadth + market regime
 * for the backtest page Signals tab.
 *
 * Q-054-NEW (Phase 16 S2): extracted from app/backtest/page.tsx. Has its
 * own fetch lifecycle (loading + AbortController), sort/filter state, and
 * derived market-regime summary.
 *
 * Pre-extract: the function lived at app/backtest/page.tsx:607. The diff
 * is a pure move — body identical, only imports differ.
 */

import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '@/lib/apiBase'

type SortKey = 'ticker' | 'sector' | 'price' | 'changePct' | 'zone' | 'action' | 'confidence' | 'rsi14' | 'atrPct' | 'deviationPct' | 'slopePct'

export function LiveSignalsPanel() {
  const [signals, setSignals] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterSector, setFilterSector] = useState<string>('All')
  const [filterAction, setFilterAction] = useState<string>('All')

  // Phase 14 wave 9: signal-aware fetch with diagnostic logging on failure.
  const fetchLive = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(apiUrl('/api/backtest/live'), { cache: 'no-store', signal })
      if (!res.ok) return
      const json = await res.json()
      if (signal?.aborted) return
      setSignals(json)
      setLastFetched(new Date().toLocaleTimeString())
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return
      console.warn('[backtest/LiveSignalsPanel] fetch failed', err)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchLive(controller.signal)
    return () => controller.abort()
  }, [fetchLive])

  if (loading) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-slate-400 text-sm py-8 justify-center">
        <div className="w-5 h-5 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin" />
        Loading live signals…
      </div>
    </div>
  )
  if (!signals) return <div className="text-slate-400 text-sm py-8 text-center">No live signal data available.</div>

  const rawInsts = (signals.instruments as Array<Record<string, unknown>>) ?? []
  const summary = signals.summary as Record<string, number>

  // ── Sector + data freshness ──────────────────────────────────────────────
  const sectors = ['All', ...Array.from(new Set(rawInsts.map(i => i.sector as string))).sort()]
  const allDates = rawInsts.map(i => i.lastDate as string | null).filter(Boolean) as string[]
  const latestDataDate = allDates.length > 0 ? allDates.sort().at(-1) : null

  // ── Market regime AI summary ──────────────────────────────────────────────
  const buyCount = summary.buySignals ?? 0
  const holdCount = summary.holdSignals ?? 0
  const sellCount = summary.sellSignals ?? 0
  const total = buyCount + holdCount + sellCount
  const buyPct = total > 0 ? (buyCount / total * 100).toFixed(0) : '0'

  // Sector breadth: how many sectors have BUY signals
  const sectorWithBuy = new Set(rawInsts.filter(i => i.action === 'BUY').map(i => i.sector as string)).size
  const totalSectors = new Set(rawInsts.map(i => i.sector as string)).size

  let marketRegimeLabel = 'NEUTRAL'
  let regimeEmoji = '⚖️'
  let regimeColor = 'text-slate-400'
  let regimeDesc = ''

  if (buyPct !== '0' && Number(buyPct) > 40) {
    marketRegimeLabel = 'BULL REGIME'
    regimeEmoji = '🟢'
    regimeColor = 'text-emerald-400'
    regimeDesc = `${sectorWithBuy}/${totalSectors} sectors showing BUY signals — selective buying in corrections.`
  } else if (sellCount > buyCount * 2) {
    marketRegimeLabel = 'BEAR REGIME'
    regimeEmoji = '🔴'
    regimeColor = 'text-red-400'
    regimeDesc = `Broad weakness: ${sellCount} instruments in sell regime. Risk-off environment.`
  } else if (holdCount > total * 0.7) {
    marketRegimeLabel = 'PAUSE / DISTRIBUTION'
    regimeEmoji = '⚠️'
    regimeColor = 'text-amber-400'
    regimeDesc = `Market in digestion phase — ${holdCount} instruments on hold. Awaiting setups.`
  } else {
    regimeDesc = `${buyCount} BUY / ${holdCount} HOLD / ${sellCount} SELL across ${total} instruments.`
  }

  // RSI market breadth: % of instruments with RSI < 30 (oversold) vs RSI > 70 (overbought)
  const oversoldCount = rawInsts.filter(i => (i.rsi14 as number) != null && (i.rsi14 as number) < 30).length
  const overboughtCount = rawInsts.filter(i => (i.rsi14 as number) != null && (i.rsi14 as number) > 70).length
  const rsiBreadth = oversoldCount + overboughtCount > 0
    ? `${oversoldCount} oversold / ${overboughtCount} overbought`
    : 'RSI breadth neutral'

  // ── Filtering ──────────────────────────────────────────────────────────────
  let insts = [...rawInsts]
  if (filterSector !== 'All') insts = insts.filter(i => i.sector === filterSector)
  if (filterAction !== 'All') insts = insts.filter(i => i.action === filterAction)

  // ── Sorting ────────────────────────────────────────────────────────────────
  insts.sort((a, b) => {
    const getVal = (obj: Record<string, unknown>, key: SortKey): number | string | null => {
      switch (key) {
        case 'ticker': return obj.ticker as string
        case 'sector': return obj.sector as string
        case 'price': return obj.price as number
        case 'changePct': return obj.changePct as number
        case 'zone': return obj.zone as string
        case 'action': return obj.action as string
        case 'confidence': return obj.confidence as number
        case 'rsi14': return obj.rsi14 as number
        case 'atrPct': return obj.atrPct as number
        case 'deviationPct': return obj.deviationPct as number
        case 'slopePct': return obj.slopePct as number
        default: return null
      }
    }
    const av = getVal(a, sortKey)
    const bv = getVal(b, sortKey)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const zoneColorMap: Record<string, string> = {
    EXTREME_BULL: '#ef4444', EXTENDED_BULL: '#f97316', HEALTHY_BULL: '#22c55e',
    FIRST_DIP: '#84cc16', DEEP_DIP: '#eab308', BEAR_ALERT: '#f97316',
    CRASH_ZONE: '#ef4444', INSUFFICIENT_DATA: '#64748b',
  }

  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const thClass = (key: SortKey) => `px-3 py-2 text-left text-slate-500 uppercase tracking-wider font-medium cursor-pointer hover:text-slate-300 select-none ${sortKey === key ? 'text-cyan-400' : ''}`

  return (
    <div className="space-y-4">
      {/* ── Market Intelligence Summary ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Market regime badge */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{regimeEmoji}</span>
            <span className={`text-lg font-bold ${regimeColor}`}>{marketRegimeLabel}</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{regimeDesc}</p>
        </div>
        {/* Breadth indicators */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs text-slate-500 uppercase tracking-widest mb-2">Signal Breadth</div>
          <div className="flex items-center gap-4 mb-1">
            <div className="flex gap-2">
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold">{buyCount} BUY</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-700/50 border border-slate-600 text-slate-400 font-bold">{holdCount} HOLD</span>
              <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 font-bold">{sellCount} SELL</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-500">{rsiBreadth}</div>
          <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
            <div className="h-full bg-emerald-500" style={{ width: `${buyPct}%` }} />
            <div className="h-full bg-slate-600" style={{ width: `${(holdCount / Math.max(total, 1)) * 100}%` }} />
            <div className="h-full bg-red-500" style={{ width: `${(sellCount / Math.max(total, 1)) * 100}%` }} />
          </div>
        </div>
        {/* Data freshness + filters */}
        <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
          <div className="text-xs text-slate-500 uppercase tracking-widest mb-2">Filters</div>
          <div className="flex flex-wrap gap-2 mb-1">
            <select value={filterSector} onChange={e => setFilterSector(e.target.value)}
              className="bg-slate-800 text-slate-300 text-[11px] rounded px-2 py-1 border border-slate-700">
              {sectors.map(s => <option key={s} value={s}>{s === 'All' ? `All Sectors (${total})` : s}</option>)}
            </select>
            <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
              className="bg-slate-800 text-slate-300 text-[11px] rounded px-2 py-1 border border-slate-700">
              {[['All','All Actions'],['BUY','BUY only'],['HOLD','HOLD only'],['SELL','SELL only']].map(([v,l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {latestDataDate && (
            <div className="text-[10px] text-slate-400">
              Data as of: <span className="text-slate-500 font-mono">{latestDataDate}</span> · Live data refreshes every 60s
            </div>
          )}
        </div>
      </div>

      {/* ── Sector regime matrix ── */}
      <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4">
        <div className="text-xs text-slate-500 uppercase tracking-widest mb-3">Sector Regime Map</div>
        <div className="flex flex-wrap gap-2">
          {sectors.filter(s => s !== 'All').map(sector => {
            const sInsts = rawInsts.filter(i => i.sector === sector)
            const sBuy = sInsts.filter(i => i.action === 'BUY').length
            const sSell = sInsts.filter(i => i.action === 'SELL').length
            const dominant = sBuy > sSell ? 'BUY' : sSell > sBuy ? 'SELL' : 'HOLD'
            const col = dominant === 'BUY' ? '#22c55e' : dominant === 'SELL' ? '#ef4444' : '#64748b'
            return (
              <div key={sector} className="flex flex-col items-center px-3 py-2 rounded-lg border border-slate-800" style={{ backgroundColor: col + '15' }}>
                <span className="text-[10px] text-slate-400 mb-1">{sector}</span>
                <span className="text-sm font-bold font-mono" style={{ color: col }}>{sBuy}↑ {sSell}↓</span>
                <span className="text-[9px] text-slate-500 mt-0.5">{sInsts.length} instr.</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Signals table ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {[['ticker','Ticker'],['sector','Sector'],['price','Price'],['changePct','Chg%'],['zone','Regime'],['action','Signal'],['confidence','Conf%'],['rsi14','RSI'],['atrPct','ATR%'],['deviationPct','200EMA Dev'],['slopePct','Slope']].map(([k, h]) => (
                <th key={k} className={thClass(k as SortKey)} onClick={() => {
                  if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                  else { setSortKey(k as SortKey); setSortDir('desc') }
                }}>{h}{sortIcon(k as SortKey)}</th>
              ))}
              <th className="px-3 py-2 text-left text-slate-500 uppercase tracking-wider font-medium">Kelly</th>
              <th className="px-3 py-2 text-left text-slate-500 uppercase tracking-wider font-medium">Last Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {insts.slice(0, 200).map((inst: Record<string, unknown>, i: number) => {
              const action = inst.action as string
              const actionColor = action === 'BUY' ? 'text-emerald-400' : action === 'SELL' ? 'text-red-400' : 'text-slate-400'
              const zoneColor = zoneColorMap[inst.zone as string] ?? '#64748b'
              return (
                <tr key={i} className={`hover:bg-slate-800/30 transition-colors ${action === 'BUY' ? 'border-l-2 border-l-emerald-500/50' : action === 'SELL' ? 'border-l-2 border-l-red-500/50' : ''}`}>
                  <td className="px-3 py-2 font-mono font-bold text-white">{inst.ticker as string}</td>
                  <td className="px-3 py-2 text-slate-400 text-[10px]">{inst.sector as string}</td>
                  <td className="px-3 py-2 font-mono text-white">${(inst.price as number)?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                  <td className={`px-3 py-2 font-mono font-medium ${(inst.changePct as number) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(inst.changePct as number) != null ? `${(inst.changePct as number) >= 0 ? '+' : ''}${(inst.changePct as number).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium" style={{ color: zoneColor, backgroundColor: zoneColor + '20' }}>
                      {(inst.zone as string)?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-bold text-sm ${actionColor}`}>{action}</td>
                  <td className="px-3 py-2 font-mono">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${(inst.confidence as number) >= 70 ? 'bg-emerald-500/20 text-emerald-400' : (inst.confidence as number) >= 55 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/50 text-slate-400'}`}>
                      {(inst.confidence as number)?.toFixed(0)}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {(inst.rsi14 as number) != null
                      ? <span className={(inst.rsi14 as number) > 70 ? 'text-red-400' : (inst.rsi14 as number) < 30 ? 'text-emerald-400' : 'text-slate-300'}>
                          {(inst.rsi14 as number).toFixed(1)}
                        </span>
                      : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {(inst.atrPct as number) != null ? `${(inst.atrPct as number).toFixed(2)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono font-medium ${(inst.deviationPct as number) != null && (inst.deviationPct as number) < -20 ? 'text-red-400' : (inst.deviationPct as number) != null && (inst.deviationPct as number) < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {(inst.deviationPct as number) != null ? `${(inst.deviationPct as number) >= 0 ? '+' : ''}${(inst.deviationPct as number).toFixed(1)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono ${(inst.slopePct as number) != null && (inst.slopePct as number) > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {(inst.slopePct as number) != null ? `${(inst.slopePct as number) >= 0 ? '+' : ''}${(inst.slopePct as number * 100).toFixed(4)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">{((inst.KellyFraction as number) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 font-mono text-slate-400 text-[10px]">{inst.lastDate as string ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {insts.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-xs">No instruments match current filters.</div>
        )}
        {insts.length > 200 && (
          <div className="py-2 text-center text-[10px] text-slate-400 border-t border-slate-800">
            Showing 200 of {insts.length} instruments · Sort or filter to see more
          </div>
        )}
      </div>
    </div>
  )
}
