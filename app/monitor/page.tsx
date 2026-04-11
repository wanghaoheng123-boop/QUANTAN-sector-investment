'use client'

/**
 * System Monitor Dashboard — /monitor
 *
 * Real-time view of:
 *   - Data infrastructure health (SQLite, JSON, ticker inventory)
 *   - ML sidecar status and latency
 *   - Nightly backtest latest results
 *   - Environment variables presence
 *   - Optimizer quick-run panel (run grid search inline for any available ticker)
 */

import { useState, useEffect, useCallback } from 'react'

// ────────────────────────────────────────────────────────────────
// Types (mirror /api/monitor response shape)
// ────────────────────────────────────────────────────────────────

interface MonitorData {
  status: string
  timestamp: string
  dataInfrastructure: {
    sqlite: { available: boolean; tickerCount: number }
    jsonFallback: { tickerCount: number }
    totalTickersAvailable: number
  }
  mlSidecar: { available: boolean; latency?: number }
  nightlyBacktest: {
    available?: boolean
    runDate?: string
    totalTickers?: number
    summary?: {
      avgOosSharpe: number
      avgDegradation: number
      bestTicker: string | null
      bestOosSharpe: number | null
    }
    message?: string
  }
  environment: {
    POLYGON_API_KEY: boolean
    ALPHAVANTAGE_API_KEY: boolean
    FRED_API_KEY: boolean
    NEXTAUTH_SECRET: boolean
    NODE_ENV: string
  }
}

// ────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-500'}`} />
  )
}

function MetricCard({
  label, value, sub, accent = false,
}: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-white/10 bg-white/5'}`}>
      <p className="mb-1 text-xs text-white/50">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-white/40">{sub}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-indigo-400">{title}</h2>
      {children}
    </div>
  )
}

function EnvRow({ name, present }: { name: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2">
      <span className="font-mono text-sm text-white/70">{name}</span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${present ? 'text-emerald-400' : 'text-red-400'}`}>
        <StatusDot ok={present} />
        {present ? 'SET' : 'MISSING'}
      </span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Inline optimizer panel
// ────────────────────────────────────────────────────────────────

interface OptimizerPanelProps {
  tickers: string[]
}

interface OptimizeResult {
  bestParams: Record<string, number | string | boolean>
  bestInSampleSharpe: number
  bestOosSharpe: number | null
  degradation: number | null
  totalCombinations: number
  validCombinations: number
  elapsedMs: number
}

function OptimizerPanel({ tickers }: OptimizerPanelProps) {
  const [selectedTicker, setSelectedTicker] = useState(tickers[0] ?? '')
  const [running, setRunning]   = useState(false)
  const [result, setResult]     = useState<OptimizeResult | null>(null)
  const [error, setError]       = useState('')

  const handleRun = async () => {
    if (!selectedTicker) { setError('Select a ticker'); return }
    setRunning(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: selectedTicker }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-white/50">Ticker</label>
          <select
            value={selectedTicker}
            onChange={(e) => setSelectedTicker(e.target.value)}
            className="rounded bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button
          onClick={handleRun}
          disabled={running || tickers.length === 0}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {running ? 'Optimizing…' : 'Run Grid Search'}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {result && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-4 font-mono text-sm">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
            <span className="text-white/50">Best params</span>
            <span className="text-indigo-300">
              fast={result.bestParams['fastPeriod']}, slow={result.bestParams['slowPeriod']}
            </span>
            <span className="text-white/50">IS Sharpe</span>
            <span>{result.bestInSampleSharpe.toFixed(3)}</span>
            <span className="text-white/50">OOS Sharpe</span>
            <span className={result.bestOosSharpe != null && result.bestOosSharpe > 0 ? 'text-emerald-400' : 'text-red-400'}>
              {result.bestOosSharpe?.toFixed(3) ?? '—'}
            </span>
            <span className="text-white/50">Degradation</span>
            <span className={result.degradation != null && result.degradation > 0.5 ? 'text-yellow-400' : ''}>
              {result.degradation?.toFixed(3) ?? '—'}
            </span>
            <span className="text-white/50">Combinations</span>
            <span>{result.validCombinations} / {result.totalCombinations} valid</span>
            <span className="text-white/50">Elapsed</span>
            <span>{result.elapsedMs}ms</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [data, setData]       = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tickers, setTickers] = useState<string[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/monitor')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to fetch monitor data')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch available tickers for the optimizer panel
  useEffect(() => {
    fetch('/api/sector-rotation')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setTickers(d.map((s: { ticker: string }) => s.ticker).slice(0, 20))
      })
      .catch(() => {/* no tickers available */})
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)  // auto-refresh every 30s
    return () => clearInterval(id)
  }, [refresh])

  return (
    <main className="min-h-screen bg-[#0d0f17] text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">System Monitor</h1>
            <p className="mt-1 text-sm text-white/50">
              {data ? `Last updated: ${new Date(data.timestamp).toLocaleTimeString()}` : 'Loading…'}
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 disabled:opacity-40"
          >
            {loading ? 'Refreshing…' : '↺ Refresh'}
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Top metrics */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricCard
                label="System Status"
                value={<span className="flex items-center gap-2"><StatusDot ok={data.status === 'ok'} /> {data.status.toUpperCase()}</span>}
                accent
              />
              <MetricCard
                label="SQLite Warehouse"
                value={<span className="flex items-center gap-2"><StatusDot ok={data.dataInfrastructure.sqlite.available} />{data.dataInfrastructure.sqlite.available ? 'Online' : 'Offline'}</span>}
                sub={`${data.dataInfrastructure.sqlite.tickerCount} tickers`}
              />
              <MetricCard
                label="ML Sidecar"
                value={<span className="flex items-center gap-2"><StatusDot ok={data.mlSidecar.available} />{data.mlSidecar.available ? 'Online' : 'Offline'}</span>}
                sub={data.mlSidecar.latency != null ? `${data.mlSidecar.latency}ms` : 'Port 8001'}
              />
              <MetricCard
                label="Total Tickers"
                value={data.dataInfrastructure.totalTickersAvailable}
                sub="warehouse + JSON"
              />
            </div>

            {/* Nightly backtest */}
            <SectionCard title="Nightly Backtest">
              {data.nightlyBacktest.runDate ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-white/50">Last run</p>
                    <p className="font-medium">{data.nightlyBacktest.runDate}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/50">Tickers tested</p>
                    <p className="font-medium">{data.nightlyBacktest.totalTickers ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-white/50">Avg OOS Sharpe</p>
                    <p className={`font-bold ${(data.nightlyBacktest.summary?.avgOosSharpe ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {data.nightlyBacktest.summary?.avgOosSharpe?.toFixed(2) ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-white/50">Best ticker</p>
                    <p className="font-semibold text-indigo-300">
                      {data.nightlyBacktest.summary?.bestTicker ?? '—'}
                      {data.nightlyBacktest.summary?.bestOosSharpe != null &&
                        ` (${data.nightlyBacktest.summary.bestOosSharpe.toFixed(2)})`}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-white/40">{data.nightlyBacktest.message}</p>
              )}
            </SectionCard>

            {/* Environment */}
            <SectionCard title="Environment">
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                <div>
                  <EnvRow name="POLYGON_API_KEY"      present={data.environment.POLYGON_API_KEY} />
                  <EnvRow name="ALPHAVANTAGE_API_KEY" present={data.environment.ALPHAVANTAGE_API_KEY} />
                  <EnvRow name="FRED_API_KEY"         present={data.environment.FRED_API_KEY} />
                </div>
                <div>
                  <EnvRow name="NEXTAUTH_SECRET"      present={data.environment.NEXTAUTH_SECRET} />
                  <div className="flex items-center justify-between border-b border-white/5 py-2">
                    <span className="font-mono text-sm text-white/70">NODE_ENV</span>
                    <span className="text-xs font-semibold text-indigo-300">{data.environment.NODE_ENV}</span>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Inline optimizer */}
            <SectionCard title="Inline Grid Search Optimizer">
              {tickers.length > 0 ? (
                <OptimizerPanel tickers={tickers} />
              ) : (
                <p className="text-sm text-white/40">
                  No tickers available for optimization. Run{' '}
                  <code className="rounded bg-white/10 px-1 text-xs">node scripts/fetchBacktestData.mjs</code>{' '}
                  to populate price data.
                </p>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </main>
  )
}
