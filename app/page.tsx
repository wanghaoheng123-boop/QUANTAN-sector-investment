'use client'

import { LocalTime } from '@/components/LocalTime'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { BACKTEST_SCOPE_LINE } from '@/lib/backtest/strategyDescription'
import SectorCard from '@/components/SectorCard'
import SessionMoveCard from '@/components/SessionMoveCard'
import PriceTicker from '@/components/PriceTicker'
import { SECTORS } from '@/lib/sectors'
import { formatMovePct, sessionMovesFromQuotes, type SessionMove } from '@/lib/sessionMoves'
import { useErrorToast } from '@/hooks/useErrorToast'
import { ErrorToastList } from '@/components/ErrorToastList'
import { useLiveQuotes } from '@/hooks/useLiveQuotes'
import { resolveTickChange } from '@/lib/quoteChange'

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
  /** Q-145: null when the vendor supplied none; renders "—", never 0.00%. */
  change: number | null
  changePct: number | null
  /**
   * The vendor's stamp. Re-added with its reader (Q-145): resolveTickChange
   * derives a missing tick change only within one New York session.
   */
  quoteTime: string | null
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
  // Phase 14 wave 38: removed legacy `countdown` state. The 15 s polling
  // countdown was tied to setInterval and the badge that displayed it.
  // The new LIVE badge sourced from useLiveQuotes replaces both — no
  // countdown to track because SSE is push-based.
  const [newsBriefs, setNewsBriefs] = useState<NewsBrief[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  /** Q-140: /api/briefs said the feed failed or is incomplete. */
  const [newsDegraded, setNewsDegraded] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('ALL')

  // Phase 14 wave 10: signal-aware fetch.
  // Prior code had two issues: (1) the 15-second poll could stack requests
  // on slow networks (no abort of in-flight fetch when a new tick fired),
  // and (2) setQuotes/setLastUpdate could fire on an unmounted component
  // after page navigation away from the dashboard.
  const fetchPrices = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/prices', { signal })
      // Q-140 red-team B2: a 500 body parses fine, so without this the failure
      // threw nothing and the old prices stayed up with no notice.
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (signal?.aborted) return
      if (data.quotes) {
        const map: Record<string, Quote> = {}
        data.quotes.forEach((q: Quote) => { map[q.ticker] = { ...q, quoteTime: q.quoteTime ?? null } })
        setQuotes(map)
        setLastUpdate(new Date())
      }
    } catch (e: unknown) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      showToast(`Price refresh failed: ${e instanceof Error ? e.message : 'Network error'}`, 'warn', 4000)
    }
  }, [showToast])

  // Phase 14 wave 38 — REAL-TIME DASHBOARD via useLiveQuotes (replaces 15 s polling).
  //
  // The REST boot fetch runs ONCE on mount to populate the dashboard before
  // the SSE streams hand off their first events (typical: 1-2 s). After that,
  // useLiveQuotes maintains N parallel EventSource connections — one per
  // ETF — and merges each tick into the `quotes` state map.
  //
  // The countdown timer below stays informational (15 → 0 visual) but no
  // longer triggers a fetch. We may remove it in a future wave once users
  // are accustomed to the LIVE badge as the freshness indicator.
  useEffect(() => {
    const controller = new AbortController()
    void fetchPrices(controller.signal)
    return () => controller.abort()
  }, [fetchPrices])

  // Memoize the ticker list so useLiveQuotes' effect dep is stable.
  // SECTORS is a module-level constant, so the .map result is also stable
  // across renders — but useMemo makes the intent explicit and protects
  // against future refactors that might reshape SECTORS dynamically.
  const liveTickers = useMemo(
    () => [...SECTORS.map((s) => s.etf), 'SPY', 'QQQ'],
    [],
  )
  const live = useLiveQuotes(liveTickers)

  // One multiplexed SSE transport backs every subscribed ticker, so the
  // per-ticker `connections` map is all-true or all-false. Collapse it once
  // instead of recomputing the same `.some()` five times in the badge below.
  const streamConnected = Object.values(live.connections).some(Boolean)

  // Merge live updates into the `quotes` state map. We don't replace the
  // whole map (the boot REST fetch may carry fields the SSE payload doesn't,
  // e.g. dataSource/provenance) — instead we overlay price/change/changePct
  // per ticker as each tick arrives.
  useEffect(() => {
    const entries = Object.entries(live.quotes)
    if (entries.length === 0) return
    setQuotes((prev) => {
      let touched = false
      const next = { ...prev }
      for (const [ticker, q] of entries) {
        if (!q) continue
        const old = next[ticker]
        // Skip if the live tick is identical to what we already have (avoids
        // pointless re-renders of every SectorCard on every heartbeat).
        if (
          old &&
          old.price === q.price &&
          old.change === q.change &&
          old.changePct === q.changePct
        ) {
          continue
        }
        // Q-145: a tick with no change no longer overwrites a known one with 0.
        // resolveTickChange derives it from the prior close within one session,
        // or leaves it null ("—").
        const { change, changePct } = resolveTickChange(old, q)
        next[ticker] = {
          ticker,
          price: q.price,
          change,
          changePct,
          // The VENDOR's stamp (Q-101) — never `q.timestamp`, which is this
          // server's emit time. Read by resolveTickChange on the next tick.
          quoteTime: q.quoteTime,
        }
        touched = true
      }
      if (touched) setLastUpdate(new Date())
      return touched ? next : prev
    })
  }, [live.quotes])

  // Fetch real news from Yahoo Finance. Cancellation flag prevents the
  // late `setNewsBriefs` / `setNewsLoading` updates from firing after unmount.
  useEffect(() => {
    const controller = new AbortController()
    async function fetchNews() {
      try {
        const res = await fetch('/api/briefs', { signal: controller.signal })
        if (controller.signal.aborted) return
        if (res.ok) {
          const data = await res.json()
          if (controller.signal.aborted) return
          if (data.briefs) {
            setNewsBriefs(data.briefs)
          }
          if (data.degraded) {
            setNewsDegraded(typeof data.error?.message === 'string' ? data.error.message : 'The news feed is degraded; this list may be incomplete.')
          }
        } else {
          // Q-140 red-team B2: a 429 or 502 rendered "Live … 0 articles".
          setNewsDegraded(res.status === 429
            ? 'Too many requests — the news feed will load on the next visit.'
            : `The news feed failed to load (server error ${res.status}).`)
        }
      } catch (e: unknown) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        showToast(`News feed failed: ${e instanceof Error ? e.message : 'Network error'}`, 'warn', 5000)
      } finally {
        if (!controller.signal.aborted) setNewsLoading(false)
      }
    }
    void fetchNews()
    return () => controller.abort()
    // showToast is intentionally excluded — it's stable from the error-toast hook
    // and we don't want re-fetches when its identity occasionally changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Phase 14 wave 38: countdown setInterval removed. Live SSE streams have
  // no poll cadence to count down to — the LIVE / MARKET CLOSED / CONNECTING
  // badge plus the `lastUpdate` timestamp already communicate freshness.

  // Q-135: measured session moves — sectors without a usable quote are absent,
  // not a 0% "Neutral" row (they are counted separately below).
  const moves = useMemo(() => sessionMovesFromQuotes(quotes), [quotes])
  const upMoves = useMemo(() => moves.filter((m) => m.direction === 'UP'), [moves])
  const downMoves = useMemo(() => moves.filter((m) => m.direction === 'DOWN'), [moves])
  const flatMoves = useMemo(() => moves.filter((m) => m.direction === 'FLAT'), [moves])
  const noQuote = SECTORS.length - moves.length

  // Spread before sort: sort mutates, and these arrays are memoised.
  const largestMoves = useMemo(() => [
    ...[...upMoves].sort((a, b) => b.changePct - a.changePct).slice(0, 3),
    ...[...downMoves].sort((a, b) => a.changePct - b.changePct).slice(0, 2),
  ], [upMoves, downMoves])

  const moveMap = useMemo(() => moves.reduce<Record<string, SessionMove>>((acc, m) => {
    acc[m.etf] = m
    return acc
  }, {}), [moves])

  const sortedMoves = useMemo(() => [...moves].sort((a, b) => b.changePct - a.changePct), [moves])

  const tickerItems = useMemo(() => SECTORS.map(s => ({
    ticker: s.etf,
    name: s.name,
    price: quotes[s.etf]?.price ?? 0,
    // Q-145: null stays null (the tape shows "—"); `?? 0` turned it into 0.00%.
    changePct: quotes[s.etf]?.changePct ?? null,
  })).filter(t => t.price > 0), [quotes])

  const filteredSectors = useMemo(() => activeFilter === 'ALL'
    ? SECTORS
    : SECTORS.filter(s => moveMap[s.etf]?.direction === activeFilter), [activeFilter, moveMap])

  return (
    <div className="min-h-screen">
      {/* Error toast notifications — replaces silent .catch(() => {}) (Phase 12 H5) */}
      <ErrorToastList toasts={toasts} onDismiss={dismissToast} />

      {/* Price Ticker */}
      {tickerItems.length > 0 && <PriceTicker items={tickerItems} />}

      <div className="max-w-7xl mx-auto px-4 py-10 space-y-14">

        {/* Hero */}
        <div className="text-center space-y-4 py-6">
          {/* Status pill — three states keyed off useLiveQuotes:
                • emerald + pulsing  — stream connected, market open
                • amber              — stream connected, market closed (snapshot only)
                • slate              — reconnecting / EventSource unavailable
              2026-08-14: the trailing "N/M streams" counter is gone. It existed
              because the dashboard once held one SSE connection PER ticker and
              the browser's ~6-per-origin cap silently starved most of them, so
              the count was real signal ("6/13"). With a single multiplexed
              stream there is nothing to count — and connection topology was
              never something to put in front of a user anyway. */}
          <div
            className={`inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-xs mb-2 shadow-lg ${
              live.marketOpen && streamConnected
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 shadow-emerald-900/20'
                : streamConnected
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-amber-900/20'
                  : 'bg-slate-700/30 border border-slate-600/40 text-slate-400'
            }`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                live.marketOpen && streamConnected
                  ? 'bg-emerald-400 animate-pulse'
                  : streamConnected
                    ? 'bg-amber-400'
                    : 'bg-slate-500'
              }`}
              aria-hidden="true"
            />
            {live.marketOpen && streamConnected
              ? 'LIVE'
              : streamConnected
                ? 'MARKET CLOSED'
                : 'CONNECTING'}
            <span className="text-slate-400">·</span>
            {lastUpdate ? <>Updated <LocalTime value={lastUpdate} /></> : 'Awaiting first tick…'}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            <span className="gradient-text">Sector Intelligence</span>
          </h1>
          <p className="text-slate-400 text-base max-w-xl mx-auto leading-relaxed">
            Market data across all {SECTORS.length} GICS sectors — Yahoo Finance quotes, K-line charts with RSI, MACD and ATR, and sector briefs. Research tooling, not investment advice.
          </p>
        </div>

        {/* Backtest CTA */}
        <section aria-labelledby="section-backtest" className="bg-gradient-to-r from-amber-950/40 via-slate-900/80 to-amber-950/30 rounded-2xl border border-amber-800/30 p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              {/* 2026-08-14: dropped the hardcoded "NEW" badge — the backtest
                  dashboard shipped months ago, so the badge was stale copy
                  nothing could ever expire. */}
              <div className="flex items-center gap-2 mb-1">
                <h2 id="section-backtest" className="text-lg font-bold text-white">Institutional Backtest Dashboard</h2>
              </div>
              {/* Q-105: this also said "label WR ~55% gross / ~54% net" — a
                  hand-written, stale figure from the 20-day LABEL benchmark
                  (a different rulebook from the 60-bar engine described
                  beside it), whose net value sat at the always-buy base rate. */}
              <p className="text-sm text-slate-400 max-w-lg">
                {BACKTEST_SCOPE_LINE}. The rules, for the signal path that ran, are on the backtest page. Simulated results, not a live accuracy guarantee.
              </p>
            </div>
            <Link
              href="/backtest"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold rounded-xl transition-colors shadow-lg shadow-amber-900/40"
            >
              <span>View Backtest</span>
              <span>→</span>
            </Link>
          </div>
        </section>

        {/* Largest session moves */}
        <section aria-labelledby="section-top-signals">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 id="section-top-signals" className="text-lg font-bold text-white">Largest session moves</h2>
              <p className="text-xs text-slate-400 mt-0.5">From Yahoo change % (normalized). UP/DOWN = vs prior close — not buy/sell advice.</p>
            </div>
            <Link href="/briefs" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
              View all briefs →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {largestMoves.map((move) => {
              const sector = SECTORS.find(s => s.etf === move.etf)
              if (!sector) return null
              return (
                <Link key={move.etf} href={`/sector/${sector.slug}`}>
                  <SessionMoveCard move={move} compact />
                </Link>
              )
            })}
          </div>
        </section>

        {/* Market Overview Stats */}
        <section aria-label="Market overview stats" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            // Q-135: "Bullish/Bearish" named a session move as a view, and
            // "Avg Confidence" averaged a fabricated 42 + 14×|Δ%| score.
            { label: 'Sectors up today', value: upMoves.length, of: SECTORS.length, color: '#00d084' },
            { label: 'Sectors down today', value: downMoves.length, of: SECTORS.length, color: '#ff6b7a' },
            { label: 'Flat (0.00%)', value: flatMoves.length, of: SECTORS.length, color: '#94a3b8' },
            { label: 'No quote', value: noQuote, of: SECTORS.length, color: noQuote > 0 ? '#f59e0b' : '#64748b' },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-slate-800 p-4 bg-slate-900/60 hover:border-slate-700/80 transition-colors">
              <div className="text-2xl font-bold font-mono" style={{ color: stat.color }}>
                {stat.value}
                {stat.of && <span className="text-slate-400 text-base font-normal">/{stat.of}</span>}
              </div>
              <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </section>

        {/* Market Breadth */}
        <section aria-labelledby="section-market-breadth" className="rounded-2xl border border-slate-800 p-5 bg-slate-900/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 id="section-market-breadth" className="text-sm font-bold text-white">Market Breadth</h2>
              <p className="text-[10px] text-slate-400 mt-0.5">Session direction distribution across all sectors</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-slate-400">Up {upMoves.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-slate-400">Down {downMoves.length}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-slate-400">Flat {flatMoves.length}{noQuote > 0 ? ` · no quote ${noQuote}` : ''}</span>
              </div>
            </div>
          </div>

          {/* Horizontal stacked bar */}
          <div className="w-full h-6 bg-slate-800 rounded-lg overflow-hidden flex">
            {upMoves.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(upMoves.length / SECTORS.length) * 100}%` }}
              >
                {upMoves.length >= 3 && (
                  <span className="text-[10px] font-bold text-white font-mono">{upMoves.length}</span>
                )}
              </div>
            )}
            {flatMoves.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(flatMoves.length / SECTORS.length) * 100}%` }}
              >
                {flatMoves.length >= 2 && (
                  <span className="text-[10px] font-bold text-white font-mono">{flatMoves.length}</span>
                )}
              </div>
            )}
            {downMoves.length > 0 && (
              <div
                className="h-full bg-gradient-to-r from-red-400 to-red-500 flex items-center justify-center transition-all duration-700"
                style={{ width: `${(downMoves.length / SECTORS.length) * 100}%` }}
              >
                {downMoves.length >= 3 && (
                  <span className="text-[10px] font-bold text-white font-mono">{downMoves.length}</span>
                )}
              </div>
            )}
          </div>

          {/* Sector list below bar */}
          <div className="mt-4 flex flex-wrap gap-2">
            {sortedMoves
              .map((move) => {
                const sector = SECTORS.find((s) => s.etf === move.etf)
                const color = move.direction === 'UP' ? '#00d084' : move.direction === 'DOWN' ? '#ff6b7a' : '#94a3b8'
                return (
                  <div
                    key={move.etf}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50"
                  >
                    <span className="text-xs">{sector?.icon}</span>
                    <span className="text-[10px] font-mono text-slate-400">{move.etf}</span>
                    <span className="text-[10px] font-mono font-medium" style={{ color }}>
                      {formatMovePct(move.changePct)}
                    </span>
                  </div>
                )
              })}
          </div>
        </section>

        {/* Sector Grid */}
        <section aria-labelledby="section-all-sectors">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h2 id="section-all-sectors" className="text-lg font-bold text-white">All Sectors</h2>
              <p className="text-xs text-slate-400 mt-0.5">Click any sector for its K-line chart and news</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* Q-135: these filtered on BUY / SELL / HOLD — trade words for session moves. */}
              {['ALL', 'UP', 'DOWN', 'FLAT'].map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  aria-pressed={activeFilter === f}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    activeFilter === f
                      ? 'bg-amber-500 text-slate-950'
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
                move={moveMap[sector.etf]}
              />
            ))}
          </div>
        </section>

        {/* Recent Briefs - Live from Yahoo Finance */}
        <section aria-labelledby="section-latest-news">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 id="section-latest-news" className="text-lg font-bold text-white">Latest Financial News</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {newsLoading
                  ? 'Loading latest news...'
                  // L6: "Partial" understated a total outage.
                  : newsDegraded
                    ? (newsBriefs.length === 0 ? 'Unavailable · Yahoo Finance' : `Partial from Yahoo Finance · ${newsBriefs.length} articles`)
                    : `Live from Yahoo Finance · ${newsBriefs.length} articles`}
              </p>
              {/* Q-140 (I2): a failed or thinned feed is said, not shown as a quiet news day. */}
              {!newsLoading && newsDegraded && (
                <p role="status" className="text-xs text-amber-400 mt-1">{newsDegraded}</p>
              )}
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
                        <span className="text-xs text-slate-400">
                          {brief.publisher}
                        </span>
                        {brief.timestamp && (
                          <span className="text-xs text-slate-400">
                            {formatUtcDateTime(brief.timestamp)}
                          </span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-white group-hover:text-slate-200 mb-1.5 leading-snug line-clamp-2">
                        {brief.title}
                      </h3>
                      <p className="text-sm text-slate-400 line-clamp-2">{brief.summary}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {brief.tags.slice(0, 4).map(tag => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div className="shrink-0 text-slate-400 group-hover:text-amber-400 transition-colors">↗</div>
                  </div>
                </a>
              ))}
            </div>
          ) : newsDegraded ? null : (
            // A failed feed is announced above; "no news" is only for a feed that answered.
            <div className="rounded-xl border border-slate-800 p-8 text-center">
              <p className="text-slate-400">No news available at the moment. Check back shortly.</p>
            </div>
          )}
        </section>

        {/* What's inside */}
        <section aria-labelledby="section-whats-inside" className="rounded-2xl border border-slate-800 p-8 bg-slate-900/30">
          <h2 id="section-whats-inside" className="text-lg font-bold text-white mb-6 text-center">What every sector page includes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              // Q-135: the third card promised entry, stop and target levels with
              // risk/reward that no producer supplies; the first promised dark-pool
              // markers and news pins Q-096 removed from the chart.
              { icon: '📊', title: 'K-Line Chart', desc: 'Candlestick charts with EMA overlays, volume, and RSI, MACD and ATR panels.' },
              { icon: '🔵', title: 'Dark-Pool Tab', desc: 'Volume and short-interest fields from Yahoo Finance where it publishes them. For sector ETFs it mostly does not, and the tab shows — rather than a number. Its block-print table is illustrative, and labelled so.' },
              { icon: '⚡', title: 'Session Moves', desc: 'Each sector ETF\u2019s move versus the prior close, with its quote time — a measurement, not a trade signal.' },
            ].map((item, i) => (
              <div key={i} className="text-center space-y-2 p-4 rounded-xl border border-slate-800 hover:border-amber-800/40 hover:bg-amber-500/5 transition-all">
                <div className="text-2xl">{item.icon}</div>
                <div className="font-semibold text-white text-sm">{item.title}</div>
                <div className="text-xs text-slate-400 leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
