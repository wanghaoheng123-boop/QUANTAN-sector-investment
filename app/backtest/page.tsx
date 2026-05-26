'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '@/lib/apiBase'
import InstrumentTable from '@/components/backtest/InstrumentTable'
import TradeLog from '@/components/backtest/TradeLog'
import type { BacktestResult } from '@/lib/backtest/engine'
import { formatFreshness } from '@/lib/format'
import { SECTOR_COLORS_BY_NAME } from '@/lib/sectorColors'
// Q-054-NEW (Phase 16 S2): god-component decomposition. Previously
// AnalysisTab / WalkForwardPanel / LiveSignalsPanel / MetricCard +
// the key-metrics strip + overview-tab content lived inline (887 LOC).
// Each is now its own module under components/backtest/; this page is
// the orchestration shell.
import { AnalysisTab } from '@/components/backtest/AnalysisTab'
import { LiveSignalsPanel } from '@/components/backtest/LiveSignalsPanel'
import { OverviewTab } from '@/components/backtest/OverviewTab'
import { KeyMetricsStrip } from '@/components/backtest/KeyMetricsStrip'

interface BacktestData {
  runId: string
  computedAt: string
  instruments: { ticker: string; sector: string; candles: number }[]
  results: BacktestResult[]
  portfolio: {
    avgReturn: number
    avgAnnReturn: number
    bnhAvg: number
    alpha: number
    sharpeRatio: number | null
    sortinoRatio: number | null
    maxPortfolioDd: number
    winRate: number
    profitFactor: number
    avgTradeReturn: number
    totalTrades: number
    totalInstruments: number
    sectorSummary: Record<string, { totalReturn: number; annReturn: number; tickers: string[] }>
  }
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [data, setData] = useState<BacktestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'instruments' | 'trades' | 'signals' | 'analysis'>('overview')
  const [refreshing, setRefreshing] = useState(false)
  // Ticker selector state
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [tickerQuery, setTickerQuery] = useState('')

  // Phase 14 wave 9: accept an optional AbortSignal so rapid selectedTickers
  // changes don't race. Prior code could resolve out-of-order — the older
  // fetch sometimes won the race and overwrote state with stale data.
  const fetchData = useCallback(async (showRefresh = false, tickers?: string[], signal?: AbortSignal) => {
    if (showRefresh) setRefreshing(true)
    try {
      const url = tickers && tickers.length > 0
        ? apiUrl(`/api/backtest?tickers=${tickers.join(',')}`)
        : apiUrl('/api/backtest')
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: BacktestData = await res.json()
      // Re-check signal before committing state — if the effect was torn down
      // while the response was in flight, do NOT update.
      if (signal?.aborted) return
      setData(json)
      setError(null)
    } catch (e) {
      // AbortError is expected on rapid re-fetch — swallow silently.
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
      setError(e instanceof Error ? e.message : 'Failed to load backtest data')
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void fetchData(false, selectedTickers.length > 0 ? selectedTickers : undefined, controller.signal)
    return () => controller.abort()
  }, [fetchData, selectedTickers])

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading backtest data…</p>
          <p className="text-slate-400 text-xs mt-1">Fetching 5Y history for 56 instruments (may take ~20s)</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-red-400 text-lg font-bold mb-2">Failed to load backtest</div>
          <p className="text-slate-400 text-sm mb-4">{error ?? 'Unknown error'}</p>
          <button onClick={() => fetchData(true)} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700">
            Retry
          </button>
        </div>
      </div>
    )
  }

  const { results, portfolio, computedAt } = data
  const sectorSummary = portfolio.sectorSummary
  const INITIAL_CAPITAL = 100_000

  // Phase 14 (R5-M-2): sector colors now sourced from the lib/sectorColors
  // SSOT (which itself derives from lib/sectors.ts) — the previous inline
  // literal had drifted from the canonical palette for Materials, Utilities,
  // Real Estate, and Consumer Staples.
  const sectorColors = SECTOR_COLORS_BY_NAME

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="border-b border-slate-800 py-6" style={{ background: 'linear-gradient(180deg, #0f172a 0%, transparent 100%)' }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-white text-lg font-bold">
                  BT
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">Institutional Backtest</h1>
                  <p className="text-xs text-slate-400">5Y Walk-Forward · 56 Instruments · Long Only · Regime SSOT (200SMA zones)</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-slate-500">Last computed</div>
                <div className="text-sm font-mono text-slate-300">{new Date(computedAt).toLocaleString()}</div>
                <div className="text-[10px] text-slate-400">{formatFreshness(computedAt)}</div>
              </div>
              <button
                onClick={() => fetchData(true, selectedTickers.length > 0 ? selectedTickers : undefined)}
                disabled={refreshing}
                className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg border border-slate-700 hover:bg-slate-700 disabled:opacity-50"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Ticker selector bar */}
          <div className="mt-4 flex flex-wrap gap-3 items-center border border-slate-800 rounded-lg px-4 py-3 bg-slate-900/40">
            <span className="text-[11px] text-slate-400 shrink-0">Instruments:</span>
            {/* Search input */}
            <input
              type="text"
              value={tickerQuery}
              onChange={(e) => setTickerQuery(e.target.value.toUpperCase())}
              placeholder="Search ticker (e.g. AAPL, NVDA)"
              className="w-40 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
            />
            {/* Quick-add button */}
            {tickerQuery && !selectedTickers.includes(tickerQuery) && (
              <button
                onClick={() => {
                  if (tickerQuery.trim()) {
                    setSelectedTickers(prev => [...prev, tickerQuery.trim()])
                    setTickerQuery('')
                  }
                }}
                className="px-2 py-1 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] rounded hover:bg-cyan-500/30"
              >
                + Add {tickerQuery}
              </button>
            )}
            {/* Selected tickers pills */}
            {selectedTickers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {selectedTickers.map(t => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] rounded">
                    {t}
                    <button onClick={() => setSelectedTickers(prev => prev.filter(x => x !== t))} className="text-cyan-400 hover:text-white ml-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            {selectedTickers.length > 0 && (
              <button
                onClick={() => setSelectedTickers([])}
                className="text-[10px] text-slate-500 hover:text-slate-300 underline"
              >
                Clear all
              </button>
            )}
            {selectedTickers.length === 0 && (
              <span className="text-[10px] text-slate-400">Showing all 56 instruments. Type a ticker to filter.</span>
            )}
          </div>

          {/* Strategy info bar */}
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 border border-slate-800 rounded-lg px-4 py-2 bg-slate-900/40">
            <span><span className="text-slate-400">Strategy:</span> resolveBacktestSignal (regime dip-buy; enhanced in dev only)</span>
            <span><span className="text-slate-400">Capital:</span> $100,000 per instrument</span>
            <span><span className="text-slate-400">Stop Loss:</span> ATR-adaptive (1.5× ATR, 3–15%)</span>
            <span><span className="text-slate-400">Trailing Stop:</span> 2× ATR → break-even, 4× ATR → 1× ATR lock</span>
            <span><span className="text-slate-400">Kelly:</span> Half-Kelly sizing (max 25%)</span>
            <span><span className="text-slate-400">Confidence threshold:</span> 55%</span>
            <span><span className="text-slate-400">Max Portfolio DD:</span> 25% circuit breaker</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Key metrics strip ── */}
        <KeyMetricsStrip portfolio={portfolio} instrumentCount={results.length} />

        {/* ── Tabs ── */}
        <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 w-fit">
          {(['overview', 'instruments', 'trades', 'signals', 'analysis'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-xs rounded-md transition-all capitalize ${
                activeTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {tab}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        {activeTab === 'overview' && (
          <OverviewTab
            results={results}
            sectorSummary={sectorSummary}
            sectorColors={sectorColors}
            initialCapital={INITIAL_CAPITAL}
          />
        )}

        {activeTab === 'instruments' && (
          <InstrumentTable results={results} sectorColors={sectorColors} />
        )}

        {activeTab === 'trades' && (
          <TradeLog trades={results.flatMap(r => r.closedTrades)} sectorColors={sectorColors} />
        )}

        {activeTab === 'signals' && (
          <LiveSignalsPanel />
        )}

        {activeTab === 'analysis' && (
          <AnalysisTab results={results} sectorColors={sectorColors} />
        )}
      </div>
    </div>
  )
}
