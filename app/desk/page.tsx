'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DESK_TICKERS } from '@/lib/deskTickers'
import { SECTORS } from '@/lib/sectors'
import { COMMODITY_INSTRUMENTS } from '@/lib/commodities'
import { useWatchlist } from '@/hooks/useWatchlist'
import { useLivePrices } from '@/hooks/useLivePrices'
import { formatCompactNumber, formatCurrency, formatSignedNumber } from '@/lib/format'
import { DashboardGuide } from '@/components/DashboardGuide'
import { DataFreshnessIndicator } from '@/components/DataFreshnessIndicator'

const REFRESH_MS = { fast: 2000, normal: 5000, slow: 15000 } as const

function labelForTicker(t: string): string {
  if (t === '^VIX') return 'VIX'
  const sector = SECTORS.find((s) => s.etf === t)
  if (sector) return sector.name
  const comm = COMMODITY_INSTRUMENTS.find((c) => c.ticker === t)
  if (comm) return comm.name
  if (t === 'SPY') return 'S&P 500'
  if (t === 'QQQ') return 'Nasdaq 100'
  if (t === 'IWM') return 'Russell 2000'
  if (t === 'DIA') return 'Dow 30'
  return t
}

function groupForTicker(t: string): 'macro' | 'sector' | 'commodity' {
  if (['SPY', 'QQQ', 'IWM', 'DIA', '^VIX'].includes(t)) return 'macro'
  if (SECTORS.some((s) => s.etf === t)) return 'sector'
  return 'commodity'
}

export default function DeskPage() {
  const [intervalKey, setIntervalKey] = useState<keyof typeof REFRESH_MS>('normal')
  const [showWatchOnly, setShowWatchOnly] = useState(false)
  const { items: watchlist, has, hydrated } = useWatchlist()

  // SWR-backed price feed; refreshes at the user-selected cadence (2s / 5s / 15s).
  const { data: liveQuotes, error, quoteTime } = useLivePrices(DESK_TICKERS, {
    refreshInterval: REFRESH_MS[intervalKey],
  })
  const fetchError = error?.message ?? null

  const quotes = useMemo(() => {
    const map: Record<string, typeof liveQuotes[number]> = {}
    for (const q of liveQuotes) map[q.ticker] = q
    return map
  }, [liveQuotes])

  const rows = useMemo(() => {
    let list = [...DESK_TICKERS]
    if (showWatchOnly && hydrated) {
      const set = new Set(watchlist)
      list = list.filter((t) => set.has(t))
    }
    return list.map((t) => ({
      t,
      group: groupForTicker(t),
      label: labelForTicker(t),
      q: quotes[t],
      watch: has(t),
    }))
  }, [quotes, showWatchOnly, watchlist, hydrated, has])

  const groups: { key: 'macro' | 'sector' | 'commodity'; title: string }[] = [
    { key: 'macro', title: 'Macro & volatility' },
    { key: 'sector', title: 'GICS sector ETFs' },
    { key: 'commodity', title: 'Commodity proxies' },
  ]

  return (
    <div className="min-h-screen max-w-[1600px] mx-auto px-3 sm:px-4 py-6 space-y-4">
      <DashboardGuide
        pageKey="desk"
        title="Trading Desk — multi-asset monitor"
        summary="High-density quote strip across macro / sectors / commodities. Pick refresh interval to match your monitoring cadence."
        sections={[
          {
            title: 'What you see',
            body: (
              <p>
                Three groups: <strong>Macro</strong> (DXY, TNX, VIX, SPY benchmarks), <strong>Sectors</strong> (11 GICS ETFs),
                <strong> Commodities</strong> (oil, gold, copper, etc.). Each row: live price, % change, volume, sparkline.
                Click any row to drill into the detail page.
              </p>
            ),
          },
          {
            title: 'Refresh-rate toggle (2s / 5s / 15s)',
            body: (
              <p>
                <strong>2s</strong> = active trading (heaviest API usage). <strong>5s</strong> = standard institutional cadence. <strong>15s</strong> = passive monitoring.
                Faster intervals risk hitting rate limits on shared API keys — use 5s as default.
              </p>
            ),
          },
          {
            title: 'Watchlist filter',
            body: (
              <p>
                Toggle <strong>"Watchlist only"</strong> to hide everything except names you've starred via the watchlist button on detail pages.
                Per-browser localStorage — your watchlist is private.
              </p>
            ),
          },
          {
            title: 'How to use',
            body: (
              <p>
                Use the desk as a <strong>passive monitor</strong>: scan for outliers (large % moves vs sector average), then drill into the suspect name.
                Don't trade <em>from</em> the desk — confirm with chart + indicators on the detail page first.
              </p>
            ),
          },
        ]}
        legend={[
          { color: '#34d399', label: 'Up vs prior close', meaning: 'positive % change today' },
          { color: '#f87171', label: 'Down vs prior close', meaning: 'negative % change today' },
          { color: '#fbbf24', label: 'Watchlisted', meaning: 'starred name (when watchlist filter is off)' },
          { color: '#22d3ee', label: 'Active feed', meaning: 'data refreshing at chosen cadence' },
        ]}
      />
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Trading desk</h1>
          <p className="text-xs text-slate-500 mt-1">
            High-density quote strip for floor-style monitoring. Pair with your vendor feeds for execution.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['fast', 'normal', 'slow'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setIntervalKey(k)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono border ${
                intervalKey === k
                  ? 'bg-blue-600/30 border-blue-500/50 text-blue-200'
                  : 'border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
            >
              {k === 'fast' ? '2s' : k === 'normal' ? '5s' : '15s'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowWatchOnly((v) => !v)}
            disabled={!hydrated}
            className={`px-2.5 py-1 rounded-md text-xs font-medium border ${
              showWatchOnly ? 'bg-amber-500/20 border-amber-500/40 text-amber-200' : 'border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            Watchlist only
          </button>
          <span className="hidden sm:inline-flex">
            <DataFreshnessIndicator quoteTime={quoteTime} compact label="desk feed" />
          </span>
        </div>
      </div>
      {fetchError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">
          Quote feed degraded: {fetchError}
        </div>
      )}

      {groups.map(({ key, title }) => {
        const sectionRows = rows.filter((r) => r.group === key)
        if (sectionRows.length === 0) return null
        return (
          <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/50 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              {title}
            </div>
            <div className="overflow-x-auto">
              {/* F6.4 (Phase 13 S2): caption + scope for screen readers — WCAG 1.3.1. */}
              <table className="w-full text-xs font-mono">
                <caption className="sr-only">{`${title} live quotes — symbol, name, last price, dollar change, percent change, volume in millions, watchlist status, and drill-down link.`}</caption>
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800/80">
                    <th scope="col" className="text-left px-2 py-1.5 w-16">Sym</th>
                    <th scope="col" className="text-left px-2 py-1.5 min-w-[120px]">Name</th>
                    <th scope="col" className="text-right px-2 py-1.5">Last</th>
                    <th scope="col" className="text-right px-2 py-1.5">Chg</th>
                    <th scope="col" className="text-right px-2 py-1.5 hidden sm:table-cell">%</th>
                    <th scope="col" className="text-right px-2 py-1.5 hidden md:table-cell">Vol M</th>
                    <th scope="col" className="text-center px-2 py-1.5">W</th>
                    <th scope="col" className="text-left px-2 py-1.5">Drill</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map(({ t, label, q }) => {
                    const up = (q?.changePct ?? 0) >= 0
                    const sym = t === '^VIX' ? 'VIX' : t
                    return (
                      <tr key={t} className="border-b border-slate-800/40 hover:bg-slate-900/60">
                        <td className="px-2 py-1 text-slate-200 font-semibold">{sym}</td>
                        <td className="px-2 py-1 text-slate-500 truncate max-w-[180px]" title={label}>
                          {label}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-100">{q ? formatCurrency(q.price) : '—'}</td>
                        {/* F6.3 (Phase 13 S2): sign prefix + arrow glyph so direction
                            is clear without relying on color (WCAG 2.2 SC 1.4.1). */}
                        <td
                          className={`px-2 py-1 text-right ${q ? (up ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400'}`}
                          aria-label={q ? `${up ? 'up' : 'down'} ${Math.abs(q.change).toFixed(2)}` : 'no change data'}
                        >
                          {q ? (
                            <>
                              <span aria-hidden="true">{up ? '▲' : '▼'}</span>{' '}
                              {formatSignedNumber(q.change)}
                            </>
                          ) : '—'}
                        </td>
                        <td
                          className={`px-2 py-1 text-right hidden sm:table-cell ${q ? (up ? 'text-emerald-400' : 'text-red-400') : 'text-slate-400'}`}
                          aria-label={q ? `${up ? 'up' : 'down'} ${Math.abs(q.changePct).toFixed(2)} percent` : 'no change data'}
                        >
                          {q ? `${up ? '+' : '−'}${Math.abs(q.changePct).toFixed(2)}%` : '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-slate-400 hidden md:table-cell">
                          {q && q.volume ? formatCompactNumber(q.volume) : '—'}
                        </td>
                        <td className="px-2 py-1 text-center text-amber-500/90">{has(t) ? '★' : ''}</td>
                        <td className="px-2 py-1">
                          <Link href={`/stock/${t.replace(/^\^/, '').toLowerCase()}`} className="text-blue-400 hover:underline">
                            chart
                          </Link>
                          {SECTORS.some((s) => s.etf === t) && (
                            <>
                              {' · '}
                              <Link href={`/sector/${SECTORS.find((s) => s.etf === t)!.slug}`} className="text-slate-500 hover:text-slate-300">
                                sector
                              </Link>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
