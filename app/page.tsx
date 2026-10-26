'use client'

import { LocalTime } from '@/components/LocalTime'
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { BACKTEST_SCOPE_LINE } from '@/lib/backtest/strategyDescription'
import SectorCard from '@/components/SectorCard'
import PriceTicker from '@/components/PriceTicker'
import { SECTORS } from '@/lib/sectors'
import { formatMovePct, sessionMovesFromQuotes, type SessionMove } from '@/lib/sessionMoves'
import { useErrorToast } from '@/hooks/useErrorToast'
import { ErrorToastList } from '@/components/ErrorToastList'
import { useLiveQuotes } from '@/hooks/useLiveQuotes'
import { mergeLandingTick, type LandingQuote } from '@/lib/liveQuoteState'

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

// Q-145: change fields are null when the vendor supplied none; "—", never 0.00%.
// No `quoteTime`. See the note at the merge site: it was written and read by
// nobody, and a declared-but-unread data-state field is the shape Q-101 exists
// to remove. Re-add it together with a consumer, never before one.
type Quote = LandingQuote

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
        data.quotes.forEach((q: Quote) => { map[q.ticker] = q })
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
        // Q-145: the whole transition is mergeLandingTick — a tick with no
        // change is "—", never 0 and never the previous change.
        //
        // Q-101 review: `quoteTime` is NOT carried, deliberately. Nothing on
        // this page renders an age (SectorCard does not take it; the hero pill
        // keys off `live.marketOpen && streamConnected`). If a surface ever
        // needs it, take `q.quoteTime` (the vendor stamp) with
        // `calendar="us-equity"` — never `q.timestamp`, the emit time.
        next[ticker] = mergeLandingTick(ticker, q)
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
        setNewsDegraded('The news feed could not be reached. Please try again later.')
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
  // Red-team Q145-R8: this was "No quote", but a sector with a price and no
  // change has no move either, and its card shows the price. What the count
  // measures is sectors without change data.
  const noChangeData = SECTORS.length - moves.length

  // Spread before sort: sort mutates, and these arrays are memoised.
  const largestMoves = useMemo(() => [
    ...[...upMoves].sort((a, b) => b.changePct - a.changePct).slice(0, 3),
    ...[...downMoves].sort((a, b) => a.changePct - b.changePct).slice(0, 2),
  ], [upMoves, downMoves])

  const moveMap = useMemo(() => moves.reduce<Record<string, SessionMove>>((acc, m) => {
    acc[m.etf] = m
    return acc
  }, {}), [moves])

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
      <ErrorToastList toasts={toasts} onDismiss={dismissToast} />
      {tickerItems.length > 0 && <PriceTicker items={tickerItems} />}

      <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 hidden text-xs font-medium tracking-[0.16em] text-slate-400 uppercase sm:block">Research workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Market overview</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">A view across {SECTORS.length} GICS sectors. Start with the session, then explore the detail.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2 text-xs text-slate-300" role="status" aria-live="polite">
              <span className={`h-1.5 w-1.5 rounded-full ${streamConnected ? 'bg-amber-400' : 'bg-slate-500'}`} aria-hidden="true" />
              {streamConnected ? (live.marketOpen ? 'Stream connected' : 'Market closed') : 'Connecting'}
            </div>
            <Link href="/desk" aria-label="Open market desk" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800/60">
              <span className="sm:hidden">Market desk</span><span className="hidden sm:inline">Open market desk</span> <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>

        <section aria-label="Market overview stats" className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 sm:grid-cols-4">
          {[
            { label: 'Sectors up today', value: upMoves.length, detail: 'Above the prior close', className: 'text-[var(--color-up)]' },
            { label: 'Sectors down today', value: downMoves.length, detail: 'Below the prior close', className: 'text-[var(--color-down)]' },
            { label: 'Flat (0.00%)', value: flatMoves.length, detail: 'Unchanged vs prior close', className: 'text-slate-200' },
            { label: 'No change data', value: noChangeData, detail: 'Missing session change', className: noChangeData > 0 ? 'text-amber-400' : 'text-slate-200' },
          ].map((stat) => (
            <div key={stat.label} className="border-slate-800 p-4 odd:border-r sm:border-r sm:last:border-r-0 sm:p-5">
              <p className={`font-mono text-3xl font-medium tabular-nums ${stat.className}`}>{stat.value}<span className="text-sm font-normal text-slate-400">/{SECTORS.length}</span></p>
              <p className="mt-2 text-xs font-medium text-slate-300">{stat.label}</p>
              <p className="mt-1 hidden text-xs text-slate-400 sm:block">{stat.detail}</p>
            </div>
          ))}
        </section>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="section-all-sectors" className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/25">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-5">
                <div>
                  <h2 id="section-all-sectors" className="text-base font-semibold text-white">Sector watch</h2>
                  <p className="mt-1 text-xs text-slate-400">ETF moves versus the prior close</p>
                </div>
                <div className="flex gap-1 rounded-lg bg-slate-950/70 p-1" aria-label="Filter sectors by session direction">
                  {['ALL', 'UP', 'DOWN', 'FLAT'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setActiveFilter(f)}
                      aria-label={f}
                      aria-pressed={activeFilter === f}
                      className={`min-h-9 rounded-md px-3 text-xs font-medium transition-colors ${activeFilter === f ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
                    >
                      {f === 'ALL' ? 'All' : f === 'UP' ? 'Up' : f === 'DOWN' ? 'Down' : 'Flat'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
                {filteredSectors.map(sector => (
                  <SectorCard key={sector.slug} sector={sector} quote={quotes[sector.etf]} move={moveMap[sector.etf]} />
                ))}
              </div>
              {filteredSectors.length === 0 && <p className="px-5 pb-6 text-sm text-slate-400">No sectors with a measured {activeFilter.toLowerCase()} move.</p>}
              <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 px-4 py-3 text-xs text-slate-400 sm:px-5">
                <span>Yahoo Finance · Session measurements, not trade signals</span>
                <span>{lastUpdate ? <>Received <LocalTime value={lastUpdate} /></> : 'Awaiting first quote'}</span>
              </div>
            </section>

            <section aria-labelledby="section-top-signals" className="rounded-xl border border-slate-800 bg-slate-900/25">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                <div>
                  <h2 id="section-top-signals" className="text-base font-semibold text-white">Session leaders &amp; laggards</h2>
                  <p className="mt-1 text-xs text-slate-400">Up to three advancing and two declining sector ETFs</p>
                </div>
              </div>
              {largestMoves.length > 0 ? (
                <div className="divide-y divide-slate-800/80">
                  {largestMoves.map((move) => {
                    const sector = SECTORS.find(s => s.etf === move.etf)
                    if (!sector) return null
                    return (
                      <Link key={move.etf} href={`/sector/${sector.slug}`} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-800/50">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="w-10 shrink-0 font-mono text-xs font-medium text-slate-200">{move.etf}</span>
                          <span className="truncate text-sm text-slate-400">{sector.name}</span>
                        </div>
                        <span className={`shrink-0 font-mono text-sm tabular-nums ${move.direction === 'UP' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                          {formatMovePct(move.changePct)} <span aria-hidden="true" className="ml-3 text-slate-500">↗</span>
                        </span>
                      </Link>
                    )
                  })}
                </div>
              ) : <p className="px-5 py-6 text-sm text-slate-400">No advancing or declining moves available.</p>}
            </section>

            <section aria-labelledby="section-backtest" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
              <div className="max-w-xl">
                <p className="mb-2 text-xs font-medium tracking-wider text-amber-400 uppercase">Research tools</p>
                <h2 id="section-backtest" className="text-base font-semibold text-white">Explore the historical backtest</h2>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{BACKTEST_SCOPE_LINE}. The rules for the signal path that ran are on the backtest page. Simulated results, not a live accuracy guarantee.</p>
              </div>
              <Link href="/backtest" className="inline-flex min-h-10 items-center gap-3 rounded-lg border border-slate-700 px-4 text-sm font-medium text-slate-200 transition-colors hover:border-amber-500/60 hover:text-amber-300">
                View backtest <span aria-hidden="true">→</span>
              </Link>
            </section>
          </div>

          <aside className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/25" aria-labelledby="section-latest-news">
            <div className="border-b border-slate-800 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="section-latest-news" className="text-base font-semibold text-white">Latest briefs</h2>
                <Link href="/briefs" className="text-xs font-medium text-amber-400 hover:text-amber-300">View all <span aria-hidden="true">→</span></Link>
              </div>
              <p className="mt-2 text-xs text-slate-400">{newsLoading ? 'Loading latest news…' : newsDegraded ? (newsBriefs.length === 0 ? 'Unavailable · Yahoo Finance' : `Partial from Yahoo Finance · ${newsBriefs.length} articles`) : `Yahoo Finance · ${newsBriefs.length} articles`}</p>
              {!newsLoading && newsDegraded && <p role="status" className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-300">{newsDegraded}</p>}
            </div>
            {newsLoading ? (
              <div className="divide-y divide-slate-800" aria-label="Loading news">
                {[1, 2, 3].map(i => (
                  <div key={i} className="space-y-3 p-5">
                    <div className="h-3 w-24 animate-pulse rounded bg-slate-800" />
                    <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : newsBriefs.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {newsBriefs.slice(0, 5).map(brief => (
                  <a key={brief.id} href={brief.link} target="_blank" rel="noopener noreferrer" className="group block space-y-3 p-5 transition-colors hover:bg-slate-800/40">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>{brief.sectorName || 'Markets'}</span>
                      {brief.tickers.slice(0, 2).map(t => (
                        <span key={t} className="rounded border border-slate-700/80 px-1.5 py-0.5 font-mono text-slate-300">{t}</span>
                      ))}
                    </div>
                    <h3 className="text-sm font-medium leading-relaxed text-slate-100 group-hover:text-amber-200">
                      {brief.title} <span aria-hidden="true" className="text-slate-500">↗</span>
                    </h3>
                    <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">{brief.summary}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span>{brief.publisher}</span>
                      {brief.timestamp && <span>· {formatUtcDateTime(brief.timestamp)} UTC</span>}
                    </div>
                  </a>
                ))}
              </div>
            ) : newsDegraded ? null : <p className="p-5 text-sm leading-relaxed text-slate-400">No news available at the moment. Check back shortly.</p>}
            <div className="border-t border-slate-800 p-5">
              <p className="text-xs leading-relaxed text-slate-400">Explore a sector for charts, company research and related news. Research tooling, not investment advice.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
