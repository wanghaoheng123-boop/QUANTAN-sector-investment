'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiUrl } from '@/lib/apiBase'
import LiveQuoteCard from '@/components/simulator/LiveQuoteCard'
import SimulatorResults from '@/components/simulator/SimulatorResults'
import StrategyBuilder from '@/components/simulator/StrategyBuilder'
import EquityCurveChart from '@/components/backtest/EquityCurveChart'
import InstrumentTable from '@/components/backtest/InstrumentTable'
import TradeLog from '@/components/backtest/TradeLog'
import type { BacktestResult } from '@/lib/backtest/engine'
import type { StrategyConfig } from '@/lib/simulator/strategyConfig'
import {
  DEFAULT_STRATEGY_CONFIG,
  STRATEGY_PRESETS,
  MODE_LABELS,
  type PresetName,
} from '@/lib/simulator/strategyConfig'

// ─── Shared Types ─────────────────────────────────────────────────────────────

interface BacktestData {
  runId: string
  computedAt: string
  dataSource: 'local' | 'live'
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
    initialCapital: number
    finalCapital: number
  }
}

interface SimulatorApiResponse {
  runId: string
  computedAt: string
  config: StrategyConfig
  results: BacktestResult[]
  portfolio: {
    avgReturn: number; avgAnnReturn: number; bnhAvg: number; alpha: number
    sharpeRatio: number | null; sortinoRatio: number | null; maxPortfolioDd: number
    winRate: number; profitFactor: number; avgTradeReturn: number; totalTrades: number
    totalInstruments: number; initialCapital: number; finalCapital: number
  }
  liveQuotes?: Record<string, {
    price?: number; changePct?: number; rsi14?: number | null; atrPct?: number | null
    deviationPct?: number | null; macdHist?: number | null; bbPctB?: number | null
    regime?: string; action?: 'BUY' | 'HOLD' | 'SELL'; confidence?: number
  }>
  tickers: Array<{ ticker: string; success: boolean; error?: string }>
}

type CommandMode = 'live' | 'backtest'

// ─── Strategy Mode Descriptions ──────────────────────────────────────────────

const STRATEGY_MODE_INFO: Record<string, { title: string; desc: string; color: string; borderColor: string }> = {
  regime: {
    title: 'Regime Dip-Buy',
    desc: 'Buy when price dips below 200SMA into correction zones with bullish confirmations. The flagship institutional strategy.',
    color: 'text-cyan-400',
    borderColor: 'border-cyan-500/30',
  },
  momentum: {
    title: 'Momentum Breakout',
    desc: 'Buy when price breaks above SMA with positive slope. Does NOT dip-buy. Captures trending moves.',
    color: 'text-violet-400',
    borderColor: 'border-violet-500/30',
  },
  mean_reversion: {
    title: 'Mean Reversion',
    desc: 'Buy when price is statistically far below its mean (z-score entry). Sell when price reverts to mean.',
    color: 'text-amber-400',
    borderColor: 'border-amber-500/30',
  },
  breakout: {
    title: 'Breakout',
    desc: 'Buy on volume-confirmed price breakouts above recent consolidation. Sell on breakdown.',
    color: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
  },
}

// ─── Default watchlist & constants ────────────────────────────────────────────

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'MSFT', 'BTC-USD', 'GLD']
const MAX_WATCHLIST = 20
const INITIAL_CAPITAL = 100_000

// ─── Formatters ───────────────────────────────────────────────────────────────

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

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 text-center">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function SimulatorPageContent() {
  const searchParams = useSearchParams()

  // URL param parsing
  const urlTickers = searchParams.get('tickers')?.split(',').filter(Boolean) ?? []
  const urlPreset = searchParams.get('preset') as PresetName | null
  const urlMode = (searchParams.get('mode') as CommandMode | null) ?? 'live'

  // Initial config
  const initialConfig = (() => {
    if (urlPreset) {
      const preset = STRATEGY_PRESETS.find(p => p.name.toLowerCase() === urlPreset.toLowerCase())
      return preset?.config ?? DEFAULT_STRATEGY_CONFIG
    }
    return DEFAULT_STRATEGY_CONFIG
  })()

  // Core state
  const [mode, setMode] = useState<CommandMode>(urlMode)
  const [config, setConfig] = useState<StrategyConfig>(initialConfig)
  const [configSource, setConfigSource] = useState<'preset' | 'custom'>(urlPreset ? 'preset' : 'custom')
  const [watchlist, setWatchlist] = useState<string[]>(urlTickers.length > 0 ? urlTickers : DEFAULT_WATCHLIST)
  const [tickerQuery, setTickerQuery] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [showConfig, setShowConfig] = useState(true)

  // Live simulation state
  const [liveQuotes, setLiveQuotes] = useState<Record<string, {
    price?: number; changePct?: number; rsi14?: number | null; atrPct?: number | null
    deviationPct?: number | null; macdHist?: number | null; bbPctB?: number | null
    regime?: string; action?: 'BUY' | 'HOLD' | 'SELL'; confidence?: number
  }>>({})
  const [liveResults, setLiveResults] = useState<SimulatorApiResponse | null>(null)
  const [liveRunning, setLiveRunning] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [showLiveResults, setShowLiveResults] = useState(false)

  // Backtest state
  const [backtestData, setBacktestData] = useState<BacktestData | null>(null)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [backtestError, setBacktestError] = useState<string | null>(null)
  const [backtestRunning, setBacktestRunning] = useState(false)
  const [backtestTab, setBacktestTab] = useState<'overview' | 'instruments' | 'trades' | 'signals' | 'analysis'>('overview')

  // Shared refresh state
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')

  // Live quote refresh
  const refreshLiveQuotes = useCallback(async () => {
    if (watchlist.length === 0) return
    try {
      const res = await fetch(apiUrl('/api/simulator/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, tickers: watchlist, lookbackDays: 5 }),
      })
      if (!res.ok) return
      const json: SimulatorApiResponse = await res.json()
      if (json.liveQuotes) setLiveQuotes(prev => ({ ...prev, ...json.liveQuotes }))
      setLastRefreshed(new Date())
      setSecondsAgo(0)
    } catch { /* silent */ }
  }, [config, watchlist])

  // Clock tick
  useEffect(() => {
    const iv = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  // Auto-refresh live quotes every 60s
  useEffect(() => {
    const iv = setInterval(() => { if (watchlist.length > 0) void refreshLiveQuotes() }, 60_000)
    return () => clearInterval(iv)
  }, [refreshLiveQuotes, watchlist])

  // Initial live fetch
  useEffect(() => {
    if (watchlist.length > 0) void refreshLiveQuotes()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run Live Simulation ─────────────────────────────────────────────────────
  const runLiveSimulation = async () => {
    if (watchlist.length === 0) {
      setLiveError('Add at least one ticker to your watchlist.')
      return
    }
    setLiveRunning(true)
    setLiveError(null)
    setStatusMessage(`Running live simulation for ${watchlist.length} instruments…`)
    try {
      const res = await fetch(apiUrl('/api/simulator/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, tickers: watchlist, lookbackDays: config.backtestPeriod.lookbackYears * 252 }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const json: SimulatorApiResponse = await res.json()
      setLiveResults(json)
      if (json.liveQuotes) setLiveQuotes(prev => ({ ...prev, ...json.liveQuotes }))
      setShowLiveResults(true)
      setLastRefreshed(new Date())
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setLiveRunning(false)
      setStatusMessage('')
    }
  }

  // ── Run Historical Backtest ─────────────────────────────────────────────────
  const runBacktest = async () => {
    if (watchlist.length === 0) {
      setBacktestError('Add at least one ticker to your watchlist.')
      return
    }
    setBacktestRunning(true)
    setBacktestError(null)
    setStatusMessage(`Running historical backtest for ${watchlist.length} instruments…`)
    setBacktestLoading(true)
    try {
      const res = await fetch(apiUrl('/api/backtest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          tickers: watchlist,
          lookbackDays: config.backtestPeriod.lookbackYears * 252,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const json: BacktestData = await res.json()
      setBacktestData(json)
      setBacktestTab('overview')
    } catch (e) {
      setBacktestError(e instanceof Error ? e.message : 'Backtest failed')
    } finally {
      setBacktestRunning(false)
      setBacktestLoading(false)
      setStatusMessage('')
    }
  }

  // ── Watchlist management ────────────────────────────────────────────────────
  const addTicker = (ticker: string) => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    if (watchlist.includes(t)) return
    if (watchlist.length >= MAX_WATCHLIST) {
      if (mode === 'live') setLiveError(`Maximum ${MAX_WATCHLIST} tickers allowed.`)
      else setBacktestError(`Maximum ${MAX_WATCHLIST} tickers allowed.`)
      return
    }
    setWatchlist(prev => [...prev, t])
    setTickerQuery('')
    // Immediately fetch live quote for new ticker
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/simulator/run'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, tickers: [t], lookbackDays: 5 }),
        })
        if (!res.ok) return
        const json: SimulatorApiResponse = await res.json()
        if (json.liveQuotes?.[t]) setLiveQuotes(prev => ({ ...prev, [t]: json.liveQuotes![t] }))
      } catch { /* silent */ }
    })()
  }

  const removeTicker = (ticker: string) => {
    setWatchlist(prev => prev.filter(t => t !== ticker))
  }

  const clearWatchlist = () => setWatchlist([])

  // Strategy info
  const modeInfo = STRATEGY_MODE_INFO[config.strategyMode.strategyMode] ?? STRATEGY_MODE_INFO.regime
  const kellyLabel = config.positionSizing.kellyMode === 'half' ? 'Half-Kelly'
    : config.positionSizing.kellyMode === 'quarter' ? 'Quarter-Kelly'
    : config.positionSizing.kellyMode === 'full' ? 'Full Kelly' : 'Fixed'

  const modeBadge = mode === 'live'
    ? { label: 'LIVE SIMULATION', color: 'text-amber-400', bg: 'bg-amber-500/20', border: 'border-amber-500/40' }
    : { label: 'HISTORICAL BACKTEST', color: 'text-cyan-400', bg: 'bg-cyan-500/20', border: 'border-cyan-500/40' }

  return (
    <div className="min-h-screen bg-black">
      {/* ── Header ── */}
      <div
        className="border-b border-slate-800 py-6"
        style={{ background: 'linear-gradient(180deg, #0f172a 0%, transparent 100%)' }}
      >
        <div className="max-w-7xl mx-auto px-4">
          {/* Top row: logo + mode toggle + actions */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Left: branding */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-white text-lg font-bold">
                SIM
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Trading Command Center</h1>
                <p className="text-xs text-slate-400">
                  {mode === 'live'
                    ? 'Real-time strategy simulation · Yahoo Finance · Live signals'
                    : 'Historical backtest · 5Y walk-forward · Custom strategy configuration'}
                </p>
              </div>
            </div>

            {/* Center: mode toggle */}
            <div className="flex items-center gap-1 bg-slate-900 rounded-xl p-1 border border-slate-800">
              <button
                onClick={() => setMode('live')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  mode === 'live'
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Live Simulation
              </button>
              <button
                onClick={() => setMode('backtest')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  mode === 'backtest'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Historical Backtest
              </button>
            </div>

            {/* Right: status + refresh */}
            <div className="flex items-center gap-3">
              {/* Data source badge */}
              <div className={`px-3 py-1 rounded-lg border text-xs font-bold ${modeBadge.bg} ${modeBadge.color} ${modeBadge.border}`}>
                {mode === 'live' ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    LIVE
                  </span>
                ) : (
                  <span>5Y HISTORY</span>
                )}
              </div>

              {/* Last updated */}
              {lastRefreshed && (
                <div className="text-right hidden sm:block">
                  <div className="text-[10px] text-slate-500">Updated</div>
                  <div className="text-xs font-mono text-slate-400">
                    {secondsAgo < 5 ? 'Just now' : `${secondsAgo}s ago`}
                  </div>
                </div>
              )}

              {/* Refresh (live mode only) */}
              {mode === 'live' && (
                <button
                  onClick={() => void refreshLiveQuotes()}
                  className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg border border-slate-700 hover:bg-slate-700"
                >
                  Refresh
                </button>
              )}
            </div>
          </div>

          {/* Strategy info bar */}
          <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 border border-slate-800 rounded-lg px-4 py-2 bg-slate-900/40 mt-4">
            <span><span className="text-slate-400">Strategy:</span> {MODE_LABELS[config.strategyMode.strategyMode]}</span>
            <span><span className="text-slate-400">Kelly:</span> {kellyLabel} (max {config.positionSizing.maxKellyFraction * 100}%)</span>
            <span><span className="text-slate-400">Stop:</span> ATR {config.stopLoss.stopLossAtrMultiplier}×, {(config.stopLoss.stopLossFloor * 100).toFixed(0)}–{(config.stopLoss.stopLossCeiling * 100).toFixed(0)}%</span>
            <span><span className="text-slate-400">Lookback:</span> {config.backtestPeriod.lookbackYears}Y</span>
            <span><span className="text-slate-400">Tickers:</span> {watchlist.length}</span>
            {configSource === 'custom' && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 border border-amber-500/40 rounded text-amber-400 text-[10px] font-medium">
                Custom Config
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* ── Left Sidebar: StrategyBuilder ── */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">Strategy Builder</h2>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowGuide(g => !g)}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    {showGuide ? '− Hide guide' : '+ How to use'}
                  </button>
                  <button
                    onClick={() => setShowConfig(c => !c)}
                    className="text-[10px] text-slate-500 hover:text-slate-300"
                  >
                    {showConfig ? '▲ Collapse' : '▼ Expand'}
                  </button>
                </div>
              </div>

              {showGuide && (
                <div className="mb-4 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-xl text-xs text-slate-400 space-y-2">
                  <div className="text-cyan-400 font-bold mb-1">Trading Command Center Guide</div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400">
                    <li><strong className="text-slate-300">Choose mode</strong> — Live Simulation (real-time) or Historical Backtest (5Y).</li>
                    <li><strong className="text-slate-300">Build your watchlist</strong> — search and add any ticker freely.</li>
                    <li><strong className="text-slate-300">Configure</strong> your strategy using presets or fine-tune every parameter.</li>
                    <li><strong className="text-slate-300">Run</strong> the simulation or backtest and review results.</li>
                    <li><strong className="text-slate-300">Iterate</strong> — adjust parameters and re-run to improve performance.</li>
                  </ol>
                  <div className="border-t border-slate-700/50 pt-2 mt-2 space-y-1">
                    <div className="text-slate-300 font-medium">Strategy Modes:</div>
                    {Object.entries(STRATEGY_MODE_INFO).map(([m, info]) => (
                      <div key={m} className="flex items-start gap-2">
                        <span className={`font-bold ${info.color}`}>•</span>
                        <span><strong className="text-slate-300">{info.title}:</strong> {info.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showConfig && (
                <StrategyBuilder
                  initialConfig={config}
                  isRunning={liveRunning || backtestRunning}
                  onRun={(cfg) => { setConfig(cfg); setConfigSource('custom') }}
                  onReset={() => { setConfig(DEFAULT_STRATEGY_CONFIG); setConfigSource('custom') }}
                />
              )}
            </div>
          </div>

          {/* ── Right Sidebar: Watchlist + Run Button ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Watchlist */}
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider text-slate-400">
                  Watchlist
                  <span className="ml-2 text-xs font-mono text-slate-500">({watchlist.length}/{MAX_WATCHLIST})</span>
                </h2>
                {watchlist.length > 0 && (
                  <button onClick={clearWatchlist} className="text-[10px] text-red-400 hover:text-red-300">
                    Clear all
                  </button>
                )}
              </div>

              {/* Ticker search input */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={tickerQuery}
                  onChange={e => setTickerQuery(e.target.value.toUpperCase())}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void addTicker(tickerQuery) }
                  }}
                  placeholder="Search ticker (e.g. AAPL, TSLA)"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
                <button
                  onClick={() => void addTicker(tickerQuery)}
                  disabled={!tickerQuery.trim() || watchlist.includes(tickerQuery.trim().toUpperCase())}
                  className="px-3 py-2 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs rounded-lg hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>

              {/* Ticker pills */}
              {watchlist.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {watchlist.map(t => (
                    <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] rounded">
                      {t}
                      <button onClick={() => removeTicker(t)} className="text-cyan-400 hover:text-white ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}

              {/* Live quote cards */}
              <div className="space-y-2">
                {watchlist.length === 0 ? (
                  <div className="text-center py-6 text-slate-500 text-xs">
                    <div className="text-lg mb-1">📋</div>
                    <div>Add tickers to your watchlist to see live prices</div>
                  </div>
                ) : (
                  watchlist.map(ticker => {
                    const lq = liveQuotes[ticker]
                    return (
                      <LiveQuoteCard
                        key={ticker}
                        ticker={ticker}
                        price={lq?.price}
                        changePct={lq?.changePct}
                        rsi14={lq?.rsi14}
                        atrPct={lq?.atrPct}
                        deviationPct={lq?.deviationPct}
                        macdHist={lq?.macdHist}
                        bbPctB={lq?.bbPctB}
                        regime={lq?.regime}
                        action={lq?.action}
                        confidence={lq?.confidence}
                        onRemove={() => removeTicker(ticker)}
                      />
                    )
                  })
                )}
              </div>
            </div>

            {/* Run button — changes label by mode */}
            <button
              onClick={() => mode === 'live' ? void runLiveSimulation() : void runBacktest()}
              disabled={liveRunning || backtestRunning || watchlist.length === 0}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-3
                bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500
                text-white shadow-lg shadow-emerald-900/40
                disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 disabled:shadow-none"
            >
              {liveRunning || backtestRunning ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {statusMessage || 'Running…'}
                </>
              ) : (
                <>
                  <span className="text-xl">{mode === 'live' ? '▶' : '◉'}</span>
                  {mode === 'live' ? 'Run Live Simulation' : 'Run Historical Backtest'}
                  {watchlist.length > 0 && (
                    <span className="text-xs font-normal opacity-70">({watchlist.length} instr.)</span>
                  )}
                </>
              )}
            </button>

            {/* Error */}
            {(liveError || backtestError) && (
              <div className="bg-red-950/30 border border-red-800/40 rounded-xl p-3 text-xs text-red-400">
                <div className="font-bold mb-1">Error</div>
                <div className="text-red-300">{liveError ?? backtestError}</div>
                <button
                  onClick={() => { mode === 'live' ? setLiveError(null) : setBacktestError(null) }}
                  className="mt-2 px-3 py-1 bg-red-500/20 border border-red-500/40 text-red-300 rounded text-[10px]"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Live Simulation Results ── */}
        {mode === 'live' && showLiveResults && liveResults && (
          <div className="mt-8">
            <SimulatorResults
              results={liveResults.results}
              portfolio={liveResults.portfolio}
              config={liveResults.config}
              liveQuotes={liveResults.liveQuotes}
              computedAt={liveResults.computedAt}
              runId={liveResults.runId}
            />
          </div>
        )}

        {/* ── Historical Backtest Results ── */}
        {mode === 'backtest' && backtestData && (
          <div className="mt-8 space-y-6">
            {/* Key metrics strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="Portfolio Return"
                value={fmtPct(backtestData.portfolio.avgReturn)}
                sub={`Ann: ${fmtPct(backtestData.portfolio.avgAnnReturn)}`}
                color={backtestData.portfolio.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}
              />
              <MetricCard
                label="Alpha vs B&H"
                value={fmtPct(backtestData.portfolio.alpha)}
                sub={`B&H avg: ${fmtPct(backtestData.portfolio.bnhAvg)}`}
                color={backtestData.portfolio.alpha > 0 ? 'text-cyan-400' : 'text-orange-400'}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={fmtRatio(backtestData.portfolio.avgAnnReturn > 0 && backtestData.portfolio.maxPortfolioDd > 0
                  ? backtestData.portfolio.avgAnnReturn / backtestData.portfolio.maxPortfolioDd : null)}
                sub="Risk-adj return"
                color={backtestData.portfolio.alpha > 0 ? 'text-cyan-400' : 'text-slate-400'}
              />
              <MetricCard
                label="Max Drawdown"
                value={`-${(backtestData.portfolio.maxPortfolioDd * 100).toFixed(1)}%`}
                sub="Peak-to-trough"
                color="text-red-400"
              />
              <MetricCard
                label="Win Rate"
                value={`${(backtestData.portfolio.winRate * 100).toFixed(1)}%`}
                sub={`${backtestData.portfolio.totalTrades} trades`}
                color={backtestData.portfolio.winRate > 0.5 ? 'text-emerald-400' : 'text-slate-400'}
              />
              <MetricCard
                label="Instruments"
                value={String(backtestData.results.length)}
                sub={backtestData.dataSource === 'live' ? 'Live data' : 'Local 5Y history'}
                color="text-slate-300"
              />
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800 w-fit">
              {(['overview', 'instruments', 'trades', 'signals', 'analysis'] as const).map(tab => (
                <button key={tab} onClick={() => setBacktestTab(tab)}
                  className={`px-4 py-1.5 text-xs rounded-md transition-all capitalize ${
                    backtestTab === tab ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {tab}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {backtestTab === 'overview' && (
              <div className="space-y-6">
                {/* Equity curves — top 8 */}
                <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-6">
                  <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider text-slate-400">
                    Equity Curves — Top 8 by Return
                  </h3>
                  <EquityCurveChart
                    instruments={backtestData.results.slice().sort((a, b) => b.annualizedReturn - a.annualizedReturn).slice(0, 8)}
                    initialCapital={INITIAL_CAPITAL}
                  />
                </div>

                {/* Strategy Rules */}
                <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6">
                  <h3 className="text-sm font-semibold text-white mb-3 uppercase tracking-wider text-slate-400">Strategy Rules</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs text-slate-400">
                    {[
                      ['BUY Signal', '200EMA deviation dip zone + rising SMA + price near SMA + ≥2 confirmations (RSI<35, MACD>0, ATR%>2, BB%<0.20) → Half-Kelly (10–25%)'],
                      ['HOLD', 'Confidence <55% or HEALTHY_BULL / EXTENDED_BULL → No action. Await better entry.'],
                      ['SELL Signal', 'FALLING_KNIFE or HEALTHY_BULL + RSI>70 → Exit full position'],
                      ['Stop Loss', `ATR-adaptive: ${config.stopLoss.stopLossAtrMultiplier}× ATR%, floor ${(config.stopLoss.stopLossFloor*100).toFixed(0)}%, cap ${(config.stopLoss.stopLossCeiling*100).toFixed(0)}%`],
                      ['Trailing Stop', `2× ATR profit → break-even. 4× ATR profit → lock ${config.stopLoss.trailLockMultiplier}× ATR above entry`],
                      ['Max DD Cap', `${(config.stopLoss.maxDrawdownCap*100).toFixed(0)}% portfolio drawdown → circuit breaker, close all`],
                      ['Position Sizing', `${kellyLabel} — max ${config.positionSizing.maxKellyFraction*100}% per position`],
                      ['Transaction Costs', `${config.transactionCosts.txCostBpsPerSide} bps per side round-trip`],
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

            {backtestTab === 'instruments' && (
              <InstrumentTable
                results={backtestData.results}
                sectorColors={{ Technology: '#3b82f6', Energy: '#f59e0b', Financials: '#10b981', Healthcare: '#ec4899', 'Consumer Disc.': '#f97316', Industrials: '#6366f1', Communication: '#8b5cf6', Materials: '#84cc16', Utilities: '#06b6d4', 'Real Estate': '#a78bfa', 'Consumer Staples': '#34d399', Crypto: '#f7931a' }}
              />
            )}

            {backtestTab === 'trades' && (
              <TradeLog
                trades={backtestData.results.flatMap(r => r.closedTrades)}
                sectorColors={{ Technology: '#3b82f6', Energy: '#f59e0b', Financials: '#10b981', Healthcare: '#ec4899', 'Consumer Disc.': '#f97316', Industrials: '#6366f1', Communication: '#8b5cf6', Materials: '#84cc16', Utilities: '#06b6d4', 'Real Estate': '#a78bfa', 'Consumer Staples': '#34d399', Crypto: '#f7931a' }}
              />
            )}

            {backtestTab === 'signals' && (
              <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6 text-center text-slate-500 text-sm">
                Live signals panel — switch to Live Simulation mode for real-time signal generation.
              </div>
            )}

            {backtestTab === 'analysis' && (
              <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-6 text-center text-slate-500 text-sm">
                Detailed analysis (walk-forward, sector attribution, risk/return map) — coming soon.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Wrap in Suspense for useSearchParams ─────────────────────────────────────

export default function SimulatorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-500 border-t-cyan-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Loading Trading Command Center…</p>
        </div>
      </div>
    }>
      <SimulatorPageContent />
    </Suspense>
  )
}
