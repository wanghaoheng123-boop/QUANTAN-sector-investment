'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiUrl } from '@/lib/apiBase'
import EquityCurveChart from '@/components/backtest/EquityCurveChart'
import SectorHeatmap from '@/components/backtest/SectorHeatmap'
import InstrumentTable from '@/components/backtest/InstrumentTable'
import TradeLog from '@/components/backtest/TradeLog'
import type { BacktestResult } from '@/lib/backtest/engine'

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

// ─── Number formatters ─────────────────────────────────────────────────────────

function fmtPct(v: number, sign = true): string {
  const s = sign && v >= 0 ? '+' : ''
  return `${s}${(v * 100).toFixed(2)}%`
}
function fmtMoney(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtRatio(v: number | null): string {
  return v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2)
}

// ─── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-4 border border-slate-800">
      <div className="text-xs text-slate-500 mb-1 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [data, setData] = useState<BacktestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'instruments' | 'trades' | 'signals'>('overview')
  const [refreshing, setRefreshing] = useState(false)
  // Ticker selector state
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [tickerQuery, setTickerQuery] = useState('')

  const fetchData = useCallback(async (showRefresh = false, tickers?: string[]) => {
    if (showRefresh) setRefreshing(true)
    try {
      const url = tickers && tickers.length > 0
        ? apiUrl(`/api/backtest?tickers=${tickers.join(',')}`)
        : apiUrl('/api/backtest')
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: BacktestData = await res.json()
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load backtest data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(false, selectedTickers.length > 0 ? selectedTickers : undefined)
  }, [fetchData, selectedTickers])

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading backtest data…</p>
          <p className="text-slate-600 text-xs mt-1">Fetching 5Y history for 56 instruments</p>
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

  const sectorColors: Record<string, string> = {
    Technology: '#3b82f6', Energy: '#f59e0b', Financials: '#10b981', Healthcare: '#ec4899',
    'Consumer Disc.': '#f97316', Industrials: '#6366f1', Communication: '#8b5cf6',
    Materials: '#84cc16', Utilities: '#06b6d4', 'Real Estate': '#a78bfa',
    'Consumer Staples': '#34d399', Crypto: '#f7931a',
  }

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
                  <p className="text-xs text-slate-400">5Y Walk-Forward · 56 Instruments · Long Only · 200EMA Regime Strategy</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xs text-slate-500">Last computed</div>
                <div className="text-sm font-mono text-slate-300">{new Date(computedAt).toLocaleString()}</div>
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
              <span className="text-[10px] text-slate-600">Showing all 56 instruments. Type a ticker to filter.</span>
            )}
          </div>

          {/* Strategy info bar */}
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 border border-slate-800 rounded-lg px-4 py-2 bg-slate-900/40">
            <span><span className="text-slate-400">Strategy:</span> 200EMA Deviation Regime + RSI/MACD/ATR%/BB% Confirmations</span>
            <span><span className="text-slate-400">Capital:</span> $100,000 per instrument</span>
            <span><span className="text-slate-400">Stop Loss:</span> ATR-adaptive (1.5× ATR, 5–15%)</span>
            <span><span className="text-slate-400">Trailing Stop:</span> 2× ATR → break-even, 4× ATR → 1× ATR lock</span>
            <span><span className="text-slate-400">Kelly:</span> Half-Kelly sizing (max 25%)</span>
            <span><span className="text-slate-400">Confidence threshold:</span> 55%</span>
            <span><span className="text-slate-400">Max Portfolio DD:</span> 25% circuit breaker</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* ── Key metrics strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard
            label="Portfolio Return"
            value={fmtPct(portfolio.avgReturn)}
            sub={`Ann: ${fmtPct(portfolio.avgAnnReturn)}`}
            color={portfolio.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
          <MetricCard
            label="Alpha vs B&H"
            value={fmtPct(portfolio.alpha)}
            sub={`B&H avg: ${fmtPct(portfolio.bnhAvg)}`}
            color={portfolio.alpha > 0 ? 'text-cyan-400' : 'text-orange-400'}
          />
          <MetricCard
            label="Sharpe Ratio"
            value={fmtRatio(portfolio.avgAnnReturn > 0 && portfolio.maxPortfolioDd > 0 ? (portfolio.avgAnnReturn / (portfolio.maxPortfolioDd || 1)) : null)}
            sub="Risk-adj return"
            color={portfolio.alpha > 0 ? 'text-cyan-400' : 'text-slate-400'}
          />
          <MetricCard
            label="Max Drawdown"
            value={`-${(portfolio.maxPortfolioDd * 100).toFixed(1)}%`}
            sub="Portfolio peak-to-trough"
            color="text-red-400"
          />
          <MetricCard
            label="Win Rate"
            value={`${(portfolio.winRate * 100).toFixed(1)}%`}
            sub={`${portfolio.totalTrades} total trades`}
            color={portfolio.winRate > 0.5 ? 'text-emerald-400' : 'text-slate-400'}
          />
          <MetricCard
            label="Instruments"
            value={String(results.length)}
            sub="Active in backtest"
            color="text-slate-300"
          />
        </div>

        {/* ── Tabs ── */}
        <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 w-fit">
          {(['overview', 'instruments', 'trades', 'signals'] as const).map(tab => (
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
          <div className="space-y-6">
            {/* Sector heatmap */}
            <SectorHeatmap sectorSummary={sectorSummary} sectorColors={sectorColors} />

            {/* Equity curves — top performers */}
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
              <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">Equity Curves — Top 8 by Return</h3>
              <EquityCurveChart
                instruments={results.slice().sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
                initialCapital={INITIAL_CAPITAL}
              />
            </div>

            {/* Strategy explanation */}
            <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
              <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
                {[
                  ['BUY Signal', '200EMA in FIRST_DIP/CRASH_ZONE + 200MA rising + RSI/OS + MACD bullish + low ATR → BUY with Half-Kelly (10-25%)'],
                  ['HOLD', 'Any regime where confidence < 60% or HEALTHY_BULL / EXTENDED_BULL → No action'],
                  ['SELL Signal', 'FALLING_KNIFE regime (DEEP_DIP/BEAR_ALERT with declining 200MA) → Exit full position'],
                  ['Stop Loss', '10% stop loss per position. Triggers automatic exit.'],
                  ['Max DD Cap', 'Portfolio drawdown > 25% → circuit breaker, close all positions'],
                  ['Position Sizing', 'Half-Kelly: STRONG_DIP → 25%, confirmed BUY → 15%, conservative → 10%. Max 50% portfolio per position.'],
                ].map(([title, desc]) => (
                  <div key={title} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                    <div className="text-slate-300 font-medium mb-1">{title}</div>
                    <div className="text-slate-500 leading-relaxed">{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'instruments' && (
          <InstrumentTable results={results} sectorColors={sectorColors} />
        )}

        {activeTab === 'trades' && (
          <TradeLog trades={results.flatMap(r => r.closedTrades)} sectorColors={sectorColors} />
        )}

        {activeTab === 'signals' && (
          <LiveSignalsPanel computedAt={computedAt} />
        )}
      </div>
    </div>
  )
}

// ─── Live Signals Panel (fetches /api/backtest/live) ─────────────────────────

function LiveSignalsPanel({ computedAt }: { computedAt: string }) {
  const [signals, setSignals] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<string | null>(null)

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/backtest/live'), { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json()
      setSignals(json)
      setLastFetched(new Date().toLocaleTimeString())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchLive() }, [fetchLive])

  if (loading) return <div className="text-slate-400 text-sm py-8 text-center">Loading live signals…</div>
  if (!signals) return <div className="text-slate-400 text-sm py-8 text-center">No live signal data available.</div>

  const insts = (signals.instruments as Array<Record<string, unknown>>) ?? []

  const colorMap: Record<string, string> = {
    EXTREME_BULL: '#ef4444', EXTENDED_BULL: '#f97316', HEALTHY_BULL: '#22c55e',
    FIRST_DIP: '#84cc16', DEEP_DIP: '#eab308', BEAR_ALERT: '#f97316',
    CRASH_ZONE: '#ef4444', INSUFFICIENT_DATA: '#64748b',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          Live signals · Updated {lastFetched} · Refreshes every 60s
        </div>
        <div className="flex gap-2">
          <span className="text-xs px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            {(signals.summary as Record<string, number>).buySignals} BUY
          </span>
          <span className="text-xs px-2 py-1 rounded bg-slate-700/50 border border-slate-600 text-slate-400">
            {(signals.summary as Record<string, number>).holdSignals} HOLD
          </span>
          <span className="text-xs px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-400">
            {(signals.summary as Record<string, number>).sellSignals} SELL
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 border-b border-slate-800">
            <tr>
              {['Ticker', 'Sector', 'Price', 'Chg%', 'Regime', 'Signal', 'Conf%', 'Kelly', 'RSI', 'ATR(14)', 'BB %B', '200EMA Dev', 'Slope'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-slate-500 uppercase tracking-wider font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {insts.map((inst: Record<string, unknown>, i: number) => {
              const action = inst.action as string
              const actionColor = action === 'BUY' ? 'text-emerald-400' : action === 'SELL' ? 'text-red-400' : 'text-slate-400'
              const zoneColor = colorMap[inst.zone as string] ?? '#64748b'
              return (
                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-3 py-2 font-mono font-bold text-white">{inst.ticker as string}</td>
                  <td className="px-3 py-2 text-slate-400">{inst.sector as string}</td>
                  <td className="px-3 py-2 font-mono text-white">${(inst.price as number)?.toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                  <td className={`px-3 py-2 font-mono ${(inst.changePct as number) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(inst.changePct as number) != null ? `${(inst.changePct as number) >= 0 ? '+' : ''}${(inst.changePct as number).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium" style={{ color: zoneColor, backgroundColor: zoneColor + '20' }}>
                      {(inst.zone as string)?.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={`px-3 py-2 font-bold ${actionColor}`}>{action}</td>
                  <td className="px-3 py-2 font-mono">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${(inst.confidence as number) >= 70 ? 'bg-emerald-500/20 text-emerald-400' : (inst.confidence as number) >= 50 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700/50 text-slate-400'}`}>
                      {inst.confidence as number}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">{((inst.KellyFraction as number) * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {(inst.rsi14 as number) != null ? (inst.rsi14 as number).toFixed(1) : '—'}
                    {(inst.rsi14 as number) != null && (inst.rsi14 as number) > 70 ? ' 🔴' : (inst.rsi14 as number) != null && (inst.rsi14 as number) < 30 ? ' 🟢' : ''}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {(inst.atr14 as number) != null ? `$${(inst.atr14 as number).toFixed(0)}` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {(inst.bbPctB as number) != null ? (inst.bbPctB as number).toFixed(2) : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-300">
                    {(inst.deviationPct as number) != null ? `${(inst.deviationPct as number) >= 0 ? '+' : ''}${(inst.deviationPct as number).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {(inst.slopePct as number) != null ? `${(inst.slopePct as number) >= 0 ? '+' : ''}${(inst.slopePct as number * 100).toFixed(4)}%/bar` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
