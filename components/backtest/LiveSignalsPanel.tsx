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
  // Defensive: API can return a payload without `summary` (initial deploy,
  // partial cache miss, schema drift). The cast hides the absence — the
  // `?? {}` fallback keeps the buyCount/holdCount/sellCount destructure
  // safe (each picks a `?? 0` default below). Without this, the panel
  // crashed to the nearest error boundary.
  const summary = (signals.summary as Record<string, number> | undefined) ?? {}

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
  // The comparator must produce deterministic ordering even when the API
  // emits unexpected runtime types in a "numeric" column (NaN, string in a
  // number slot). Array.prototype.sort with a non-deterministic comparator
  // re-orders rows across renders.
  //
  // String columns: cast then `localeCompare`. Unknown / non-string falls
  // back to ''.
  // Number columns: `typeof === 'number' && isFinite(v)` narrowing. NaN /
  // non-number falls to the null branch (sorted to the end regardless of
  // direction).
  const STRING_KEYS = new Set<SortKey>(['ticker', 'sector', 'zone', 'action'])
  insts.sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (STRING_KEYS.has(sortKey)) {
      const as = typeof av === 'string' ? av : ''
      const bs = typeof bv === 'string' ? bv : ''
      if (as === '' && bs === '') return 0
      if (as === '') return 1
      if (bs === '') return -1
      const cmp = as.localeCompare(bs)
      return sortDir === 'asc' ? cmp : -cmp
    }
    const an = typeof av === 'number' && Number.isFinite(av) ? av : null
    const bn = typeof bv === 'number' && Number.isFinite(bv) ? bv : null
    if (an == null && bn == null) return 0
    if (an == null) return 1
    if (bn == null) return -1
    const cmp = an < bn ? -1 : an > bn ? 1 : 0
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
              // Hoist + narrow once per row. Cast-then-deref scattered through
              // the JSX hid these null cases; each `as number` was a runtime
              // no-op that silently let `null * 100 = 0` and `undefined * 100
              // = NaN` flow into `.toFixed()` (producing 'NaN%' or 'undefined'
              // text). Hoisting also lets className predicates check the same
              // narrowed value the text content uses — fixes the prior
              // `null >= 0 → true → text-emerald-400` bug that painted '—'
              // cells green.
              const action = inst.action as string | undefined
              const ticker = inst.ticker as string | undefined
              const sector = inst.sector as string | undefined
              const zone = inst.zone as string | undefined
              const lastDate = inst.lastDate as string | undefined
              const price = typeof inst.price === 'number' ? inst.price : null
              const changePct = typeof inst.changePct === 'number' ? inst.changePct : null
              const confidence = typeof inst.confidence === 'number' ? inst.confidence : null
              const rsi14 = typeof inst.rsi14 === 'number' ? inst.rsi14 : null
              const atrPct = typeof inst.atrPct === 'number' ? inst.atrPct : null
              const deviationPct = typeof inst.deviationPct === 'number' ? inst.deviationPct : null
              const slopePct = typeof inst.slopePct === 'number' ? inst.slopePct : null
              const kellyFraction = typeof inst.KellyFraction === 'number' ? inst.KellyFraction : null

              const actionColor = action === 'BUY' ? 'text-emerald-400' : action === 'SELL' ? 'text-red-400' : 'text-slate-400'
              const zoneColor = zone != null ? (zoneColorMap[zone] ?? '#64748b') : '#64748b'
              const zoneLabel = zone != null ? zone.replace(/_/g, ' ') : '—'

              const changePctColor = changePct == null ? 'text-slate-500' : changePct >= 0 ? 'text-emerald-400' : 'text-red-400'
              const confidenceColor = confidence == null
                ? 'bg-slate-700/50 text-slate-400'
                : confidence >= 70
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : confidence >= 55
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-slate-700/50 text-slate-400'
              const deviationColor = deviationPct == null
                ? 'text-slate-500'
                : deviationPct < -20
                  ? 'text-red-400'
                  : deviationPct < 0
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              const slopeColor = slopePct == null ? 'text-slate-500' : slopePct > 0 ? 'text-emerald-400' : 'text-slate-400'

              return (
                <tr key={i} className={`hover:bg-slate-800/30 transition-colors ${action === 'BUY' ? 'border-l-2 border-l-emerald-500/50' : action === 'SELL' ? 'border-l-2 border-l-red-500/50' : ''}`}>
                  <td className="px-3 py-2 font-mono font-bold text-white">{ticker ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-400 text-[10px]">{sector ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-white">
                    {price != null ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono font-medium ${changePctColor}`}>
                    {changePct != null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium" style={{ color: zoneColor, backgroundColor: zoneColor + '20' }}>
                      {zoneLabel}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-bold text-sm ${actionColor}`}>{action ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${confidenceColor}`}>
                      {confidence != null ? confidence.toFixed(0) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {rsi14 != null
                      ? <span className={rsi14 > 70 ? 'text-red-400' : rsi14 < 30 ? 'text-emerald-400' : 'text-slate-300'}>
                          {rsi14.toFixed(1)}
                        </span>
                      : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {atrPct != null ? `${atrPct.toFixed(2)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono font-medium ${deviationColor}`}>
                    {deviationPct != null ? `${deviationPct >= 0 ? '+' : ''}${deviationPct.toFixed(1)}%` : '—'}
                  </td>
                  <td className={`px-3 py-2 font-mono ${slopeColor}`}>
                    {slopePct != null ? `${slopePct >= 0 ? '+' : ''}${(slopePct * 100).toFixed(4)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {kellyFraction != null ? `${(kellyFraction * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400 text-[10px]">{lastDate ?? '—'}</td>
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

      {/* Q-063-NEW: factual caveat — this panel is current model state, not P&L. */}
      <p className="text-[10px] leading-relaxed text-slate-500">
        Live signals reflect the current model state, not realized trade P&amp;L.
        Backtested win rate and cost assumptions are shown in the metrics summary above.
      </p>
    </div>
  )
}
