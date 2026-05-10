'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

type DipSignal = 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE' | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'

interface MA200Regime {
  zone: string
  deviationPct: number | null
  slopePositive: boolean | null
  slopePct: number | null       // raw numeric slope, e.g. 0.00087 = +0.087%/bar
  label: string
  color: string
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'
  interpretation: string
  forwardReturnContext: string
  dipSignal: DipSignal
  dipSignalExplained: string
}

interface SectorRow {
  ticker: string
  name: string
  color: string
  icon: string
  slug: string
  price: number | null
  sma200: number | null
  sma50: number | null
  rsi14: number | null
  tradingDays: number
  regime: MA200Regime | null
  error?: string
}

interface ApiResponse {
  rows: SectorRow[]
  computedAt: string
  disclaimer: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DIP_SIGNAL_CONFIG: Record<DipSignal, { label: string; badgeClass: string; icon: string }> = {
  STRONG_DIP:        { label: 'Strong Dip Buy', badgeClass: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300', icon: '🟢' },
  WATCH_DIP:         { label: 'Watch — Caution', badgeClass: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300', icon: '🟡' },
  FALLING_KNIFE:     { label: 'Falling Knife ⚠', badgeClass: 'bg-red-500/20 border-red-500/40 text-red-300',    icon: '🔴' },
  OVERBOUGHT:        { label: 'Overbought', badgeClass: 'bg-orange-500/20 border-orange-500/40 text-orange-300', icon: '🟠' },
  IN_TREND:          { label: 'In Uptrend', badgeClass: 'bg-blue-500/20 border-blue-500/40 text-blue-300',       icon: '🔵' },
  INSUFFICIENT_DATA: { label: 'No Data', badgeClass: 'bg-slate-700/50 border-slate-600 text-slate-500',          icon: '⚫' },
}

// empirical reference table (static educational content)
const EMPIRICAL_TABLE = [
  { zone: '> +20%',     label: 'Extreme Overextension', color: '#ef4444', dipSignal: 'OVERBOUGHT',    fwd3m: '+1.2%', fwd6m: '+2.8%', fwd12m: '+3.5%', hitRate12m: '52%', note: 'Highest mean-reversion risk. Trim positions.' },
  { zone: '+10–20%',   label: 'Extended Bull',          color: '#f97316', dipSignal: 'OVERBOUGHT',    fwd3m: '+2.1%', fwd6m: '+4.2%', fwd12m: '+6.4%', hitRate12m: '58%', note: 'Stretched momentum. Monitor for exhaustion candles.' },
  { zone: '0 to +10%', label: 'Healthy Uptrend',        color: '#22c55e', dipSignal: 'IN_TREND',      fwd3m: '+3.6%', fwd6m: '+6.8%', fwd12m: '+11.2%', hitRate12m: '68%', note: 'Best risk-adjusted returns. Ideal holding zone.' },
  { zone: '0 to -10%', label: 'First Dip Zone ✅',       color: '#84cc16', dipSignal: 'STRONG_DIP',   fwd3m: '+4.8%', fwd6m: '+8.4%', fwd12m: '+15.3%', hitRate12m: '72%', note: 'Strongest buy signal when 200MA slope is rising.' },
  { zone: '-10–20%',   label: 'Deep Dip / Caution',     color: '#eab308', dipSignal: 'WATCH_DIP',     fwd3m: '+2.9%', fwd6m: '+6.1%', fwd12m: '+11.8%', hitRate12m: '61%', note: 'High variance — confirm 200MA slope before entering.' },
  { zone: '-20–30%',   label: 'Bear Alert',             color: '#f97316', dipSignal: 'FALLING_KNIFE', fwd3m: '+0.4%', fwd6m: '+4.2%', fwd12m: '+10.1%', hitRate12m: '55%', note: 'Falling knife if 200MA declining. Only staged buying.' },
  { zone: '< -30%',    label: 'Crash / Capitulation',   color: '#ef4444', dipSignal: 'STRONG_DIP',    fwd3m: '+6.1%', fwd6m: '+14.3%', fwd12m: '+28.7%', hitRate12m: '63%', note: 'Maximum long-term opportunity but extreme near-term pain.' },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function DeviationBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(-35, Math.min(35, pct))
  const isPositive = clamped >= 0
  const width = Math.abs(clamped) / 35 * 50 // 50% = max half-width
  return (
    <div className="flex items-center gap-1 w-full h-5">
      {/* left half (negative) */}
      <div className="flex-1 flex justify-end">
        {!isPositive && (
          <div
            className="h-3 rounded-l-full transition-all duration-700"
            style={{ width: `${width}%`, backgroundColor: color, opacity: 0.85 }}
          />
        )}
        {isPositive && <div className="h-3" style={{ width: '0%' }} />}
      </div>
      {/* center line */}
      <div className="w-px h-4 bg-slate-600 shrink-0" />
      {/* right half (positive) */}
      <div className="flex-1">
        {isPositive && (
          <div
            className="h-3 rounded-r-full transition-all duration-700"
            style={{ width: `${width}%`, backgroundColor: color, opacity: 0.85 }}
          />
        )}
      </div>
    </div>
  )
}

function SlopeChip({ positive, slopePct }: { positive: boolean | null; slopePct?: number | null }) {
  if (positive === null) return <span className="text-slate-600 text-xs">—</span>
  const pct = slopePct != null ? `${slopePct > 0 ? '+' : ''}${(slopePct * 100).toFixed(3)}%` : null
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded ${positive ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
      {positive ? '▲' : '▼'} {positive ? 'Rising' : 'Declining'}{pct ? ` ${pct}` : ''}
    </span>
  )
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-[2rem_1fr_5rem_7rem_6rem_5rem_5rem_8rem] gap-3 items-center py-3 border-b border-slate-800/50 animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-4 bg-slate-800 rounded" />
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SortKey = 'deviation' | 'rsi' | 'name' | 'price'
type SortDir = 'asc' | 'desc'

export default function MADeviationPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('deviation')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  const [showEmpiricalTable, setShowEmpiricalTable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/ma-deviation')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = data?.rows.slice().sort((a, b) => {
    let av: number, bv: number
    if (sortKey === 'deviation') {
      av = a.regime?.deviationPct ?? 999
      bv = b.regime?.deviationPct ?? 999
    } else if (sortKey === 'rsi') {
      av = a.rsi14 ?? 999
      bv = b.rsi14 ?? 999
    } else if (sortKey === 'price') {
      av = a.price ?? 0
      bv = b.price ?? 0
    } else {
      av = 0; bv = 0 // name: handled separately
    }
    if (sortKey === 'name') {
      const cmp = a.name.localeCompare(b.name)
      return sortDir === 'asc' ? cmp : -cmp
    }
    return sortDir === 'asc' ? av - bv : bv - av
  }) ?? []

  // Summary counts
  const dipCount = data?.rows.filter(r => r.regime?.dipSignal === 'STRONG_DIP').length ?? 0
  const watchCount = data?.rows.filter(r => r.regime?.dipSignal === 'WATCH_DIP').length ?? 0
  const knifeCount = data?.rows.filter(r => r.regime?.dipSignal === 'FALLING_KNIFE').length ?? 0
  const bullCount  = data?.rows.filter(r => r.regime?.dipSignal === 'IN_TREND' || r.regime?.dipSignal === 'OVERBOUGHT').length ?? 0

  function SortTh({ label, skey }: { label: string; skey: SortKey }) {
    const active = sortKey === skey
    return (
      <button
        className={`text-left text-[11px] font-medium tracking-wide flex items-center gap-1 transition-colors ${active ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
        onClick={() => handleSort(skey)}
      >
        {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Hero Header */}
      <div className="border-b border-slate-800 py-10 bg-gradient-to-b from-blue-950/20 to-transparent">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link href="/" className="text-xs text-slate-500 hover:text-slate-400">Markets</Link>
                <span className="text-slate-700 text-xs">/</span>
                <span className="text-xs text-blue-400">200MA Deviation</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                200-Day MA Deviation Gauge
              </h1>
              <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
                Quantitative analysis of how far each sector ETF trades from its 200-day Simple Moving Average —
                the institutional benchmark for long-term trend direction and dip-buying opportunity zones.
                Combines deviation%, 200MA slope, and RSI to distinguish <strong className="text-emerald-400">true dips</strong> from{' '}
                <strong className="text-red-400">falling knives</strong>.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {data && (
                <div className="text-xs text-slate-600 font-mono">
                  Computed: {new Date(data.computedAt).toLocaleTimeString()}
                </div>
              )}
              <button
                onClick={() => setShowEmpiricalTable(p => !p)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors"
              >
                {showEmpiricalTable ? 'Hide' : 'Show'} Empirical Return Table
              </button>
            </div>
          </div>

          {/* Summary pills */}
          {!loading && data && (
            <div className="flex flex-wrap gap-3 mt-6">
              {[
                { label: 'Strong Dip Buy', count: dipCount,   color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
                { label: 'Watch / Caution', count: watchCount, color: 'text-yellow-400',  bg: 'bg-yellow-500/10 border-yellow-500/30' },
                { label: 'Falling Knife',   count: knifeCount, color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' },
                { label: 'In Uptrend',       count: bullCount,  color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/30' },
              ].map(s => (
                <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${s.bg} ${s.color}`}>
                  <span className="text-lg font-bold font-mono">{s.count}</span>
                  <span className="text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Empirical Reference Table */}
        {showEmpiricalTable && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-bold text-white mb-1">📊 Empirical Forward Return Reference</h2>
            <p className="text-xs text-slate-500 mb-4">
              Based on historical cross-section analysis of S&amp;P 500 &amp; sector ETF daily data (1990–2024).
              Returns shown are <em>median</em> forward returns following instances where price entered each zone.
              Forward returns when 200MA slope is positive vs negative diverge significantly — see interpretation column.
              <strong className="text-amber-300"> Not investment advice. Past performance ≠ future results.</strong>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    {['Deviation Zone', 'Zone Label', 'Dip Signal', '3M Fwd', '6M Fwd', '12M Fwd', '12M Hit Rate', 'Context'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {EMPIRICAL_TABLE.map((row) => {
                    const cfg = DIP_SIGNAL_CONFIG[row.dipSignal as DipSignal]
                    return (
                      <tr key={row.zone} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                        <td className="py-2 pr-4 font-mono font-semibold" style={{ color: row.color }}>{row.zone}</td>
                        <td className="py-2 pr-4 text-white font-medium">{row.label}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${cfg.badgeClass}`}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-mono text-slate-300">{row.fwd3m}</td>
                        <td className="py-2 pr-4 font-mono text-slate-300">{row.fwd6m}</td>
                        <td className="py-2 pr-4 font-mono font-semibold text-white">{row.fwd12m}</td>
                        <td className="py-2 pr-4 font-mono text-slate-400">{row.hitRate12m}</td>
                        <td className="py-2 pr-4 text-slate-500 max-w-[200px]">{row.note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-6 text-red-300 text-sm">
            Failed to load MA deviation data: {error}
          </div>
        )}

        {/* Main Table */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/30 overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-4 border-b border-slate-800 grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_4rem_4rem_120px_1fr] gap-3 items-center">
            <span />
            <SortTh label="Sector / ETF" skey="name" />
            <SortTh label="Price" skey="price" />
            <span className="text-[11px] text-slate-500 font-medium">SMA 200</span>
            <SortTh label="Dev %" skey="deviation" />
            <SortTh label="RSI 14" skey="rsi" />
            <span className="text-[11px] text-slate-500 font-medium">200MA Slope</span>
            <span className="text-[11px] text-slate-500 font-medium">Dip Signal</span>
          </div>

          {loading && Array.from({ length: 13 }).map((_, i) => <SkeletonRow key={i} />)}

          {!loading && sorted.map((row) => {
            const regime = row.regime
            const cfg = DIP_SIGNAL_CONFIG[regime?.dipSignal ?? 'INSUFFICIENT_DATA']
            const isExpanded = expandedTicker === row.ticker
            const devPct = regime?.deviationPct

            return (
              <div key={row.ticker} className="border-b border-slate-800/50 last:border-0">
                {/* Main row */}
                <button
                  className="w-full text-left grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_4rem_4rem_120px_1fr] gap-3 items-center px-5 py-3.5 hover:bg-slate-800/30 transition-colors group"
                  onClick={() => setExpandedTicker(isExpanded ? null : row.ticker)}
                >
                  {/* Icon */}
                  <span className="text-base">{row.icon}</span>

                  {/* Name + ticker */}
                  <div>
                    <div className="text-sm font-semibold text-white">{row.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{row.ticker}</div>
                  </div>

                  {/* Price */}
                  <div className="text-sm font-mono text-white">
                    {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                  </div>

                  {/* SMA200 */}
                  <div className="text-sm font-mono text-slate-400">
                    {row.sma200 != null ? `$${row.sma200.toFixed(2)}` : '—'}
                  </div>

                  {/* Deviation % */}
                  <div className="flex flex-col gap-0.5">
                    <span
                      className="text-sm font-bold font-mono"
                      style={{ color: regime?.color ?? '#64748b' }}
                    >
                      {devPct != null ? `${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}%` : '—'}
                    </span>
                    {devPct != null && (
                      <DeviationBar pct={devPct} color={regime?.color ?? '#64748b'} />
                    )}
                  </div>

                  {/* RSI */}
                  <div className={`text-sm font-mono font-semibold ${row.rsi14 != null ? (row.rsi14 < 30 ? 'text-emerald-400' : row.rsi14 > 70 ? 'text-red-400' : 'text-slate-300') : 'text-slate-600'}`}>
                    {row.rsi14 != null ? row.rsi14.toFixed(0) : '—'}
                  </div>

                  {/* Slope */}
                  <SlopeChip positive={regime?.slopePositive ?? null} slopePct={regime?.slopePct ?? null} />

                  {/* Dip Signal badge */}
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium ${cfg.badgeClass} w-fit`}>
                    <span>{cfg.icon}</span>
                    {cfg.label}
                  </span>
                </button>

                {/* Expanded detail panel */}
                {isExpanded && regime && (
                  <div className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-900/50 border-t border-slate-800/50">
                    {/* Zone info */}
                    <div className="rounded-xl border border-slate-700 p-4" style={{ borderColor: `${regime.color}30` }}>
                      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider">Zone</div>
                      <div className="text-base font-bold mb-2" style={{ color: regime.color }}>{regime.label}</div>
                      <p className="text-xs text-slate-400 leading-relaxed">{regime.interpretation}</p>
                    </div>

                    {/* Forward return context */}
                    <div className="rounded-xl border border-slate-700 p-4">
                      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider">Historical Return Context</div>
                      <p className="text-xs text-slate-300 leading-relaxed">{regime.forwardReturnContext}</p>
                    </div>

                    {/* Dip signal detail */}
                    <div className={`rounded-xl border p-4 ${cfg.badgeClass.replace('text-', 'border-').split(' ')[1]}`} style={{ borderColor: `${regime.color}30` }}>
                      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider">🔬 Dip Signal Analysis</div>
                      <div className={`text-xs font-semibold mb-2 ${cfg.badgeClass.split(' ').find(c => c.startsWith('text-')) ?? 'text-slate-300'}`}>
                        {cfg.label}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">{regime.dipSignalExplained}</p>
                    </div>

                    {/* Quick stats */}
                    <div className="rounded-xl border border-slate-700 p-4 md:col-span-2 lg:col-span-3">
                      <div className="flex flex-wrap gap-4 text-xs">
                        {[
                          { label: 'Price', value: row.price != null ? `$${row.price.toFixed(2)}` : '—' },
                          { label: '200MA', value: row.sma200 != null ? `$${row.sma200.toFixed(2)}` : '—' },
                          { label: '50MA', value: row.sma50 != null ? `$${row.sma50.toFixed(2)}` : '—' },
                          { label: 'Deviation', value: devPct != null ? `${devPct >= 0 ? '+' : ''}${devPct.toFixed(2)}%` : '—', color: regime.color },
                          { label: 'RSI(14)', value: row.rsi14 != null ? row.rsi14.toFixed(1) : '—' },
                          { label: 'Trading Days', value: String(row.tradingDays) },
                          { label: '200MA Slope', value: regime.slopePct != null
                              ? `${regime.slopePct > 0 ? '+' : ''}${(regime.slopePct * 100).toFixed(4)}% (${regime.slopePositive ? '▲' : '▼'})`
                              : '—', color: regime.slopePct != null ? (regime.slopePct > 0 ? '#22c55e' : '#ef4444') : undefined },
                          { label: 'Risk Level', value: regime.riskLevel.toUpperCase() },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-slate-800/50 rounded-lg px-3 py-2">
                            <div className="text-slate-500 text-[10px] mb-0.5">{label}</div>
                            <div className="font-mono font-semibold" style={{ color: color ?? '#cbd5e1' }}>{value}</div>
                          </div>
                        ))}
                        {(row.slug === 'spy' || row.slug === 'qqq') ? null : (
                          <Link
                            href={`/sector/${row.slug}`}
                            className="bg-blue-600/20 border border-blue-500/30 hover:bg-blue-600/30 transition-colors rounded-lg px-3 py-2 text-blue-300 font-medium flex items-center gap-1"
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          >
                            View Sector Chart →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </section>

        {/* Visual Deviation Bar Chart */}
        {!loading && sorted.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
            <h2 className="text-sm font-bold text-white mb-1">Deviation Spectrum — All Sectors vs 200-Day MA</h2>
            <p className="text-xs text-slate-500 mb-5">
              Each bar shows how far the sector ETF is trading above (right) or below (left) its 200-day SMA. Center line = 0%.
            </p>
            <div className="space-y-2">
              {sorted
                .filter(r => r.regime?.deviationPct != null)
                .sort((a, b) => (a.regime?.deviationPct ?? 0) - (b.regime?.deviationPct ?? 0))
                .map(row => {
                  const dev = row.regime!.deviationPct!
                  const color = row.regime!.color
                  const isPos = dev >= 0
                  const width = Math.min(Math.abs(dev) / 35 * 45, 45)
                  return (
                    <div key={row.ticker} className="flex items-center gap-2 text-xs">
                      <div className="w-20 text-right font-mono text-slate-400 shrink-0">{row.ticker}</div>
                      <div className="flex-1 flex items-center h-6">
                        {/* left zone */}
                        <div className="flex-1 flex justify-end pr-px">
                          {!isPos && (
                            <div
                              className="h-4 rounded-l-md flex items-center justify-end pr-1.5"
                              style={{ width: `${width * 2}%`, backgroundColor: `${color}cc` }}
                            >
                              <span className="text-[9px] font-mono text-white/90 font-bold">
                                {dev.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                        {/* divider */}
                        <div className="w-0.5 h-5 bg-slate-600 shrink-0" />
                        {/* right zone */}
                        <div className="flex-1 pl-px">
                          {isPos && (
                            <div
                              className="h-4 rounded-r-md flex items-center pl-1.5"
                              style={{ width: `${width * 2}%`, backgroundColor: `${color}cc` }}
                            >
                              <span className="text-[9px] font-mono text-white/90 font-bold">
                                +{dev.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="w-28 text-xs text-slate-500 shrink-0">{row.regime?.label}</div>
                    </div>
                  )
                })}
            </div>
            {/* X-axis labels */}
            <div className="flex items-center mt-3 text-[9px] text-slate-600 font-mono">
              <div className="w-20 shrink-0" />
              <div className="flex-1 flex justify-between">
                <span>-35%</span><span>-20%</span><span>-10%</span>
              </div>
              <div className="w-0.5 shrink-0 text-center">0</div>
              <div className="flex-1 flex justify-between">
                <span>+10%</span><span>+20%</span><span>+35%</span>
              </div>
              <div className="w-28 shrink-0" />
            </div>
          </section>
        )}

        {/* Key to reading this gauge */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6">
          <h2 className="text-sm font-bold text-white mb-4">📖 How to Use This Gauge — Buying Dips, Not Falling Knives</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-400 leading-relaxed">
            <div className="space-y-3">
              <div>
                <div className="text-emerald-400 font-semibold mb-1">✅ Strong Dip Buy Conditions</div>
                <ul className="list-disc list-inside space-y-1 text-slate-500">
                  <li>Price is 0–10% below the 200-day SMA</li>
                  <li>The 200MA slope is <strong className="text-white">still positive</strong> (rising)</li>
                  <li>RSI is below 40 (oversold confirmation)</li>
                  <li>Market breadth (% stocks above their 200MA) is not collapsing</li>
                </ul>
              </div>
              <div>
                <div className="text-red-400 font-semibold mb-1">🔪 Falling Knife Warning Signs</div>
                <ul className="list-disc list-inside space-y-1 text-slate-500">
                  <li>Price is &gt;15% below a <strong className="text-white">declining</strong> 200MA</li>
                  <li>RSI is 35–50 (momentum deteriorating, not capitulating)</li>
                  <li>The 200MA has been declining for &gt;30 days</li>
                  <li>Sector breadth is &lt;20% (most stocks also breaking down)</li>
                </ul>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-yellow-400 font-semibold mb-1">⚠️ Watch Zone Discipline</div>
                <p className="text-slate-500">
                  When the signal shows "Watch / Caution", scale in with a maximum of 30–40% of your target position.
                  Use a staged entry (e.g., 3 tranches over 2–4 weeks). Only add if the 200MA slope shows signs of flattening.
                </p>
              </div>
              <div>
                <div className="text-blue-400 font-semibold mb-1">📐 The 200MA Slope is the Key Variable</div>
                <p className="text-slate-500">
                  A rising 200MA acting as support = institutional buy zone. A declining 200MA acting as resistance = falling knife territory.
                  The same -12% deviation can be a screaming buy (rising 200MA, 2010/2016) or a warning (declining 200MA, 2008/2022).
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-amber-950/30 border border-amber-500/20 text-amber-300/70 text-[11px]">
            ⚠️ <strong>Disclaimer:</strong> All deviation zones, forward return references, and dip signals on this page are for educational and research purposes only.
            They are based on historical statistical analysis and do not constitute investment advice. Past performance is not indicative of future results.
            Always consult a licensed financial advisor before making investment decisions.
          </div>
        </section>

      </div>
    </div>
  )
}
