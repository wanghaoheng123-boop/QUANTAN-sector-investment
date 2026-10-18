'use client'

import { slopeState, slopeText } from '@/lib/quant/technicals'
import { UI_LOCALE } from '@/lib/format'
import { LocalTime } from '@/components/LocalTime'
import { useState, useEffect } from 'react'
import { DataFreshnessIndicator } from '@/components/DataFreshnessIndicator'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

type DipSignal = 'STRONG_DIP' | 'WATCH_DIP' | 'FALLING_KNIFE' | 'OVERBOUGHT' | 'IN_TREND' | 'INSUFFICIENT_DATA'

interface MA200Regime {
  zone: string
  deviationPct: number | null
  slopePositive: boolean | null
  slopePct: number | null       // change of the 200-day average over 20 days, e.g. 0.00087 = +0.087%
  label: string
  color: string
  riskLevel: 'low' | 'medium' | 'high' | 'extreme'
  interpretation: string
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
  /** The route's disclaimer; carried on degraded answers too (Q153-C12). */
  disclaimer?: string
  /** Q-140: set when most sector fetches failed; the board is incomplete. */
  degraded?: boolean
  error?: { code: string; message: string }
  /**
   * I2 (Q110-P2) — this route holds a 5-minute module-level cache and served
   * stored rows with nothing saying so, so a value up to five minutes old was
   * indistinguishable from a fresh computation. `_cachedAt` carries the real
   * age; a bare boolean would say "a cache was involved" and not "how old".
   */
  _cached?: boolean
  _cachedAt?: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * One neutral colour for every zone (Q153-C6). The zones were coloured as a
 * traffic light — green 0–10% above, lime 0–10% below, red at both extremes —
 * which carried "buy the dip / stop" without the words. Red/green is kept only
 * for the SIGN of the measured slope (SlopeChip).
 */
const NEUTRAL = '#94a3b8'

// Q-153: a LEGEND of the zones — the band and its name. It was an "Empirical
// Forward Return Reference" of median 3M/6M/12M returns and hit rates "based on …
// S&P 500 & sector ETF daily data (1990–2024)": hardcoded figures from an
// analysis this repository has never run (I5). Q153-C2: its Classification
// column mapped each band to one class, which the band alone cannot determine
// (the slope decides), so it contradicted the classifier in 7 of 21 band ×
// slope cases. The column is gone.
const ZONE_LEGEND: Array<{ zone: string; label: string }> = [
  { zone: '> +20%',    label: 'More than 20% above' },
  { zone: '+10–20%',   label: '10–20% above' },
  { zone: '0 to +10%', label: '0–10% above' },
  { zone: '0 to -10%', label: '0–10% below' },
  { zone: '-10–20%',   label: '10–20% below' },
  { zone: '-20–30%',   label: '20–30% below' },
  { zone: '< -30%',    label: 'More than 30% below' },
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

/**
 * The MEASURED 20-day change of the 200-day average (Q-153), in three states
 * with the classifier's threshold (Q153-C11: by sign alone, +0.19% read "▲ up"
 * beside a classification that does not call it rising).
 */
function SlopeChip({ slopePct }: { slopePct?: number | null }) {
  const state = slopeState(slopePct)
  if (state == null) return <span className="text-slate-400 text-xs">—</span>
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded ${state === 'rising' ? 'text-emerald-400 bg-emerald-500/10' : state === 'falling' ? 'text-red-400 bg-red-500/10' : 'text-slate-300 bg-slate-500/10'}`}>
      {slopeText(slopePct)}
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

function SortTh({ label, skey, sortKey, sortDir, handleSort }: {
  label: string
  skey: SortKey
  sortKey: SortKey
  sortDir: SortDir
  handleSort: (key: SortKey) => void
}) {
  const active = sortKey === skey
  const ariaLabel = active
    ? `${label}, sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}`
    : `Sort by ${label}`
  return (
    <button
      className={`text-left text-[11px] font-medium tracking-wide flex items-center gap-1 transition-colors ${active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-300'}`}
      onClick={() => handleSort(skey)}
      aria-label={ariaLabel}
    >
      {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  )
}

export default function MADeviationPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('deviation')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  const [showLegend, setShowLegend] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // `cache: 'no-store'` is load-bearing, not hygiene. This route sets
    // `Cache-Control: max-age=300`, so a default fetch on a repeat visit inside
    // five minutes is answered by the BROWSER's HTTP cache with the stored body
    // — whose `_cached: false` was frozen at the moment it was first computed.
    // Measured 2026-09-05: two default fetches returned `_cached:false` with an
    // identical `_cachedAt`, while the same pair with `no-store` returned
    // `_cached:true`. A freshness flag defeated by a cache one layer above the
    // code that sets it is the very substitution I2 forbids, so the page that
    // renders the flag must reach the server that computes it. The sibling
    // surfaces (`LiveSignalsPanel`, `app/backtest/page.tsx`) already do this.
    fetch('/api/ma-deviation', { cache: 'no-store' })
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
      const cmp = a.name.localeCompare(b.name, UI_LOCALE)
      return sortDir === 'asc' ? cmp : -cmp
    }
    return sortDir === 'asc' ? av - bv : bv - av
  }) ?? []

  // Q153-C1: the summary counted sectors per CLASS ("1 Below a rising average ·
  // 4 Below the average · 0 Below an average that is not rising"), a screen of
  // what to buy whose labels were not true of the classes — on 2026-10-17 the
  // "0" sat beside four rows below a non-rising average. It counts measured
  // facts instead: which side of its average each row is on.
  const aboveCount = data?.rows.filter(r => r.regime?.deviationPct != null && r.regime.deviationPct >= 0).length ?? 0
  const belowCount = data?.rows.filter(r => r.regime?.deviationPct != null && r.regime.deviationPct < 0).length ?? 0

  return (
    <div className="min-h-screen">
      {/* Hero Header */}
      <div className="border-b border-slate-800 py-10 bg-gradient-to-b from-blue-950/20 to-transparent">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Link href="/" className="text-xs text-slate-400 hover:text-slate-200">Markets</Link>
                <span className="text-slate-700 text-xs" aria-hidden="true">/</span>
                <span className="text-xs text-blue-400">200MA Deviation</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                200-Day MA Deviation Gauge
              </h1>
              <p className="text-slate-400 text-sm max-w-2xl leading-relaxed">
                How far each sector ETF trades from its 200-day simple moving average, how that average has moved over 20 days,
                and the 14-day RSI. A description of where price sits relative to its long-run average; not a forecast or a trade signal.
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {data && (
                <div className="flex items-center gap-3">
                  <DataFreshnessIndicator
                    quoteTime={data._cachedAt ?? Date.parse(data.computedAt)}
                    cached={data._cached === true}
                    label="Data"
                  />
                  <div className="text-xs text-slate-400 font-mono">
                    Computed: <LocalTime value={data.computedAt} />
                  </div>
                </div>
              )}
              <button
                onClick={() => setShowLegend(p => !p)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors"
              >
                {showLegend ? 'Hide' : 'Show'} zone legend
              </button>
            </div>
          </div>

          {/* Summary pills */}
          {!loading && data && (
            <div className="flex flex-wrap gap-3 mt-6">
              {[
                { label: 'Above their 200-day average', count: aboveCount },
                { label: 'Below their 200-day average', count: belowCount },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900/40 text-xs font-medium text-slate-200">
                  <span className="text-lg font-bold font-mono">{s.count}</span>
                  <span className="text-slate-400">{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Zone legend (Q-153: it was a table of unsourced forward returns) */}
        {showLegend && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-sm font-bold text-white mb-1">Zone legend</h2>
            <p className="text-xs text-slate-400 mb-4">
              How the gauge names a distance from the 200-day average. It describes where price is, not what it will do;
              this platform has not measured forward returns for these zones.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Deviation zones</caption>
                <thead>
                  <tr className="border-b border-slate-700">
                    {['Distance from the 200-day average', 'Zone'].map(h => (
                      <th key={h} scope="col" className="text-left pb-2 pr-4 text-slate-400 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ZONE_LEGEND.map((row) => (
                    <tr key={row.zone} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                      <td className="py-2 pr-4 font-mono font-semibold text-slate-300">{row.zone}</td>
                      <td className="py-2 pr-4 text-white font-medium">{row.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Q-140 (I2): a board that is mostly fetch failures says so. */}
        {data?.degraded && (
          <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-amber-300 text-sm">
            {data.error?.message ?? 'Price data is unavailable for most sectors right now; the board is incomplete.'}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-900/20 p-6 text-red-300 text-sm">
            Failed to load MA deviation data: {error}
          </div>
        )}

        {/* Main Table */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/30 overflow-hidden">
          <div className="overflow-x-auto">
          {/* Table Header */}
          <div className="px-5 py-4 border-b border-slate-800 grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_4rem_4rem_1fr] gap-3 items-center">
            <span />
            <SortTh label="Sector / ETF" skey="name" sortKey={sortKey} sortDir={sortDir} handleSort={handleSort} />
            <SortTh label="Price" skey="price" sortKey={sortKey} sortDir={sortDir} handleSort={handleSort} />
            <span className="text-[11px] text-slate-400 font-medium">SMA 200</span>
            <SortTh label="Dev %" skey="deviation" sortKey={sortKey} sortDir={sortDir} handleSort={handleSort} />
            <SortTh label="RSI 14" skey="rsi" sortKey={sortKey} sortDir={sortDir} handleSort={handleSort} />
            <span className="text-[11px] text-slate-400 font-medium">200MA Slope</span>
          </div>

          {loading && Array.from({ length: 13 }).map((_, i) => <SkeletonRow key={i} />)}

          {!loading && sorted.map((row) => {
            const regime = row.regime
            const isExpanded = expandedTicker === row.ticker
            const devPct = regime?.deviationPct

            return (
              <div key={row.ticker} className="border-b border-slate-800/50 last:border-0">
                {/* Main row */}
                <button
                  className="w-full text-left grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_4rem_4rem_1fr] gap-3 items-center px-5 py-3.5 hover:bg-slate-800/30 transition-colors group"
                  onClick={() => setExpandedTicker(isExpanded ? null : row.ticker)}
                  aria-expanded={isExpanded}
                  aria-controls={`detail-${row.ticker}`}
                >
                  {/* Icon */}
                  <span className="text-base">{row.icon}</span>

                  {/* Name + ticker */}
                  <div>
                    <div className="text-sm font-semibold text-white">{row.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{row.ticker}</div>
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
                    <span className="text-sm font-bold font-mono text-slate-200">
                      {devPct != null ? `${devPct >= 0 ? '+' : ''}${devPct.toFixed(1)}%` : '—'}
                    </span>
                    {devPct != null && (
                      <DeviationBar pct={devPct} color={NEUTRAL} />
                    )}
                  </div>

                  {/* RSI */}
                  {/* Q153-C6: RSI below 30 was emerald — the contrarian buy cue in colour. */}
                  <div className={`text-sm font-mono font-semibold ${row.rsi14 != null ? 'text-slate-300' : 'text-slate-400'}`}>
                    {row.rsi14 != null ? row.rsi14.toFixed(0) : '—'}
                  </div>

                  {/* Slope */}
                  <SlopeChip slopePct={regime?.slopePct ?? null} />
                </button>

                {/* Expanded detail panel */}
                {isExpanded && regime && (
                  <div id={`detail-${row.ticker}`} className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-slate-900/50 border-t border-slate-800/50">
                    {/* Zone info */}
                    <div className="rounded-xl border border-slate-700 p-4">
                      <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">Zone</div>
                      <div className="text-base font-bold mb-2 text-slate-200">{regime.label}</div>
                      <p className="text-xs text-slate-400 leading-relaxed">{regime.interpretation}</p>
                    </div>

                    {/* What was measured, in one sentence (Q153-C1: no class label). */}
                    <div className="rounded-xl border border-slate-700 p-4">
                      <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">Measured</div>
                      <p className="text-xs text-slate-400 leading-relaxed">{regime.dipSignalExplained}</p>
                    </div>

                    {/* Quick stats */}
                    <div className="rounded-xl border border-slate-700 p-4 md:col-span-2 lg:col-span-3">
                      <div className="flex flex-wrap gap-4 text-xs">
                        {[
                          { label: 'Price', value: row.price != null ? `$${row.price.toFixed(2)}` : '—' },
                          { label: '200MA', value: row.sma200 != null ? `$${row.sma200.toFixed(2)}` : '—' },
                          { label: '50MA', value: row.sma50 != null ? `$${row.sma50.toFixed(2)}` : '—' },
                          { label: 'Deviation', value: devPct != null ? `${devPct >= 0 ? '+' : ''}${devPct.toFixed(2)}%` : '—' },
                          { label: 'RSI(14)', value: row.rsi14 != null ? row.rsi14.toFixed(1) : '—' },
                          { label: 'Trading Days', value: String(row.tradingDays) },
                          { label: '200MA change (20d)', value: regime.slopePct != null
                              ? `${regime.slopePct > 0 ? '+' : ''}${(regime.slopePct * 100).toFixed(2)}%`
                              : '—', color: slopeState(regime.slopePct) === 'rising' ? '#22c55e' : slopeState(regime.slopePct) === 'falling' ? '#ef4444' : undefined },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-slate-800/50 rounded-lg px-3 py-2">
                            <div className="text-slate-400 text-[10px] mb-0.5">{label}</div>
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
          </div>
        </section>

        {/* Visual Deviation Bar Chart */}
        {!loading && sorted.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6">
            <h2 className="text-sm font-bold text-white mb-1">Deviation Spectrum — All Sectors vs 200-Day MA</h2>
            <p className="text-xs text-slate-400 mb-5">
              Each bar shows how far the sector ETF is trading above (right) or below (left) its 200-day SMA. Center line = 0%.
            </p>
            <div className="space-y-2">
              {sorted
                .filter(r => r.regime?.deviationPct != null)
                .sort((a, b) => (a.regime?.deviationPct ?? 0) - (b.regime?.deviationPct ?? 0))
                .map(row => {
                  const dev = row.regime!.deviationPct!
                  const color = NEUTRAL // Q153-C6: one neutral colour, not the zone traffic light
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
                      <div className="w-28 text-xs text-slate-400 shrink-0">{row.regime?.label}</div>
                    </div>
                  )
                })}
            </div>
            {/* X-axis labels */}
            <div className="flex items-center mt-3 text-[9px] text-slate-400 font-mono">
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

        {/* Key to reading this gauge (Q-153: it gave "Strong Dip Buy Conditions",
            "scale in with a maximum of 30–40% of your target position" and
            "screaming buy" — trade and sizing instructions, the copy Q-083 gates) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6">
          <h2 className="text-sm font-bold text-white mb-4">How to read this gauge</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-slate-400 leading-relaxed">
            <div className="space-y-3">
              <p>
                <strong className="text-white">Deviation</strong> is how far the latest price is from its 200-day simple moving average, in percent.
                The zones name bands of that distance.
              </p>
              <p>
                <strong className="text-white">Slope</strong> is how much the 200-day average itself moved over the last 20 days.
                It reads rising above +0.5%, falling below −0.5%, and flat in between.
              </p>
            </div>
            <div className="space-y-3">
              <p>
                <strong className="text-white">RSI(14)</strong> is the 14-day relative strength index on a 0–100 scale, shown as a number.
                None of these figures is a forecast, and this platform has not measured what followed each zone.
              </p>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-amber-950/30 border border-amber-500/20 text-amber-300/70 text-[11px]">
            ⚠️ <strong>Disclaimer:</strong> The zones on this page describe price relative to its 200-day average. They are research tooling,
            not investment advice, and not a forecast.
          </div>
        </section>

      </div>
    </div>
  )
}
