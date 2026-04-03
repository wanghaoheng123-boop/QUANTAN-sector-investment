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
  const [activeTab, setActiveTab] = useState<'overview' | 'instruments' | 'trades' | 'signals' | 'analysis'>('overview')
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
                  ['BUY Signal', '200EMA deviation dip zone + 200SMA rising (>0.5%/20bars) + price near SMA + ≥2 of: RSI<35, MACD hist>0, ATR%>2, BB%<0.20 → BUY with Half-Kelly (10-25%)'],
                  ['HOLD', 'Confidence <55% or HEALTHY_BULL / EXTENDED_BULL → No action. Slope insufficient or price not near SMA = no buy.'],
                  ['SELL Signal', 'FALLING_KNIFE (dip zone + declining SMA) or HEALTHY_BULL + RSI>70 → Exit full position'],
                  ['Stop Loss', 'ATR-adaptive: 1.5× ATR%, floor 5%, cap 15%. Volatility-adjusted per instrument.'],
                  ['Trailing Stop', '2× ATR profit → stop rises to break-even. 4× ATR profit → stop locks at 1× ATR above entry.'],
                  ['Max DD Cap', 'Portfolio equity drawdown >25% → circuit breaker, close all positions immediately'],
                  ['Position Sizing', 'Half-Kelly: STRONG_DIP+3 confirms → 25%, STRONG_DIP → 15%, normal BUY → 10%. 55% confidence minimum.'],
                  ['Transaction Costs', '~11bps round-trip (IBKR: $0.005/sh + 0.05% spread + 0.5bps slippage). Applied at both entry and exit.'],
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
          <LiveSignalsPanel />
        )}

        {activeTab === 'analysis' && (
          <AnalysisTab results={results} sectorColors={sectorColors} />
        )}
      </div>
    </div>
  )
}

// ─── Analysis Tab ────────────────────────────────────────────────────────────────

function AnalysisTab({ results, sectorColors }: { results: BacktestResult[]; sectorColors: Record<string, string> }) {
  // ── Sector performance table ──────────────────────────────────────────────
  const sectorRows = Object.entries(
    results.reduce<Record<string, { ret: number; ann: number; trades: number; winRate: number; sharpe: number | null; tickers: string[]; count: number }>>((acc, r) => {
      if (!acc[r.sector]) acc[r.sector] = { ret: 0, ann: 0, trades: 0, winRate: 0, sharpe: null, tickers: [], count: 0 }
      const s = acc[r.sector]
      s.ret += r.totalReturn
      s.ann += r.annualizedReturn
      s.trades += r.totalTrades
      s.tickers.push(r.ticker)
      s.count++
      return acc
    }, {})
  ).map(([sector, data]) => ({
    sector,
    color: sectorColors[sector] ?? '#64748b',
    totalReturn: data.ret / Math.max(data.count, 1),
    annReturn: data.ann / Math.max(data.count, 1),
    avgTrades: Math.round(data.trades / Math.max(data.count, 1)),
    tickers: data.tickers,
  })).sort((a, b) => b.annReturn - a.annReturn)

  // ── Risk/Return scatter by sector ─────────────────────────────────────────
  const maxAnn = Math.max(...results.map(r => r.annualizedReturn), 0.01)
  const maxDD = Math.max(...results.map(r => r.maxDrawdown), 0.01)

  return (
    <div className="space-y-6">
      {/* Sector Performance Table */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
          Performance Attribution by Sector
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                {['Sector', 'Ann. Return', 'Total Return', 'Avg Trades', 'vs B&H α', 'Rank'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sectorRows.map((row, i) => (
                <tr key={row.sector} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="text-slate-300 font-medium">{row.sector}</span>
                      <span className="text-slate-600 text-[10px]">({row.tickers.length} instr.)</span>
                    </div>
                  </td>
                  <td className={`px-4 py-3 font-mono font-bold ${row.annReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(row.annReturn * 100).toFixed(1)}%
                  </td>
                  <td className={`px-4 py-3 font-mono ${row.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(row.totalReturn * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{row.avgTrades}</td>
                  <td className="px-4 py-3 font-mono text-cyan-400">
                    {i === 0 ? '🏆 Top' : i === sectorRows.length - 1 ? '📉 Bot' : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${i < 3 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      #{i + 1}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Risk/Return Matrix */}
      <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
        <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
          Risk/Return Map
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800">
                {['Ticker', 'Sector', 'Ann. Ret', 'Max DD', 'Sharpe', 'Sortino', 'Win Rate', 'PF', 'B&H Ret', 'Alpha'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {[...results]
                .sort((a, b) => b.annualizedReturn - a.annualizedReturn)
                .map(r => {
                  const sectorColor = sectorColors[r.sector] ?? '#64748b'
                  return (
                    <tr key={r.ticker} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono font-bold text-white">{r.ticker}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: sectorColor, backgroundColor: sectorColor + '20' }}>
                          {r.sector}
                        </span>
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${r.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {(r.annualizedReturn * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-red-400">
                        -{((r.maxDrawdown) * 100).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 font-mono ${(r.sharpeRatio ?? 0) >= 1 ? 'text-emerald-400' : (r.sharpeRatio ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                        {r.sharpeRatio != null ? r.sharpeRatio.toFixed(2) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono ${(r.sortinoRatio ?? 0) >= 1 ? 'text-emerald-400' : (r.sortinoRatio ?? 0) >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                        {r.sortinoRatio != null ? r.sortinoRatio.toFixed(2) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono ${r.winRate >= 0.5 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {(r.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-400">
                        {r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 font-mono ${r.bnhReturn >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
                        {(r.bnhReturn * 100).toFixed(1)}%
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${r.excessReturn >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
                        {(r.excessReturn * 100).toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Walk-Forward Windows */}
      <WalkForwardPanel results={results} />
    </div>
  )
}

// ─── Walk-Forward Panel ─────────────────────────────────────────────────────────

function WalkForwardPanel({ results }: { results: BacktestResult[] }) {
  const [selectedTicker, setSelectedTicker] = useState(results[0]?.ticker ?? '')
  const selected = results.find(r => r.ticker === selectedTicker)
  const tickers = results.map(r => r.ticker)

  // ── Rolling quarterly performance split ─────────────────────────────────────
  const quarters = ((): { label: string; ret: number; sharpe: number | null; ann: number }[] => {
    if (!selected) return []
    const len = selected.equityCurve.length
    const qLen = Math.floor(len / 4)
    if (qLen < 30) return []
    return [0, 1, 2, 3].map(q => {
      const start = q * qLen
      const end = q === 3 ? len : (q + 1) * qLen
      const curve = selected.equityCurve.slice(start, end)
      const rets: number[] = []
      for (let i = 1; i < curve.length; i++) {
        const r = (curve[i] - curve[i - 1]) / curve[i - 1]
        if (Number.isFinite(r)) rets.push(r)
      }
      if (rets.length < 10) return null
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length
      const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1))
      const sharpe = sd > 1e-10 ? ((mean - 0.04 / 252) / sd) * Math.sqrt(252) : null
      const ret = (curve[curve.length - 1] - curve[0]) / curve[0]
      return {
        label: ['Q1', 'Q2', 'Q3', 'Q4'][q],
        ret,
        sharpe,
        ann: ((1 + ret) ** (252 / rets.length) - 1),
      }
    }).filter((x): x is { label: string; ret: number; sharpe: number | null; ann: number } => x !== null)
  })()

  if (!selected) return <div className="text-slate-500 text-sm py-8 text-center">No instrument data available.</div>

  return (
    <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider text-slate-400">
          Walk-Forward / Overfitting Check
        </h3>
        <select
          value={selectedTicker}
          onChange={e => setSelectedTicker(e.target.value)}
          className="bg-slate-800 text-slate-300 text-xs rounded px-2 py-1 border border-slate-700"
        >
          {tickers.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Rolling quarterly performance */}
      {quarters.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-slate-500 mb-2">Rolling Quarterly Performance — {selectedTicker}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {quarters.map(q => (
              <div key={q.label} className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                <div className="text-[10px] text-slate-500 mb-1">{q.label}</div>
                <div className={`text-lg font-bold font-mono ${q.ann >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(q.ann * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Sharpe: {q.sharpe != null ? q.sharpe.toFixed(2) : '—'}
                </div>
                <div className={`text-[10px] mt-0.5 ${q.ret >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  Total: {(q.ret * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overfitting metric */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">In-Sample Ann. Return</div>
          <div className={`text-xl font-bold font-mono ${selected.annualizedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {(selected.annualizedReturn * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">B&amp;H Ann. Return</div>
          <div className={`text-xl font-bold font-mono ${selected.bnhReturn >= 0 ? 'text-slate-300' : 'text-red-300'}`}>
            {(selected.bnhReturn * 100).toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
          <div className="text-[10px] text-slate-500 uppercase mb-1">Strategy Alpha</div>
          <div className={`text-xl font-bold font-mono ${selected.excessReturn >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
            {(selected.excessReturn * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      <div className="mt-3 text-[10px] text-slate-600">
        Walk-forward splits data into in-sample (train) and out-of-sample (test) windows. A robust strategy should maintain similar Sharpe ratios across both. 
        Large IS/OOS gap indicates potential overfitting to historical patterns.
      </div>
    </div>
  )
}

// ─── Live Signals Panel ──────────────────────────────────────────────────────────

type SortKey = 'ticker' | 'sector' | 'price' | 'changePct' | 'zone' | 'action' | 'confidence' | 'rsi14' | 'atrPct' | 'deviationPct' | 'slopePct'

function LiveSignalsPanel() {
  const [signals, setSignals] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterSector, setFilterSector] = useState<string>('All')
  const [filterAction, setFilterAction] = useState<string>('All')

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
            <div className="text-[10px] text-slate-600">
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
                  <td className="px-3 py-2 font-mono text-slate-600 text-[10px]">{inst.lastDate as string ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {insts.length === 0 && (
          <div className="py-8 text-center text-slate-500 text-xs">No instruments match current filters.</div>
        )}
        {insts.length > 200 && (
          <div className="py-2 text-center text-[10px] text-slate-600 border-t border-slate-800">
            Showing 200 of {insts.length} instruments · Sort or filter to see more
          </div>
        )}
      </div>
    </div>
  )
}
