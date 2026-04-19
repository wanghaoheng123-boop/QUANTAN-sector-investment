'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiUrl } from '@/lib/infra/apiBase'

interface BacktestSummary {
  runId: string
  computedAt: string
  portfolio: {
    winRate: number
    avgReturn: number
    avgAnnReturn: number
    maxPortfolioDd: number
    totalTrades: number
    totalInstruments: number
    sharpeRatio: number | null
  }
}

export default function MonitorPage() {
  const [data, setData] = useState<BacktestSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch(apiUrl('/api/backtest?tickers=SPY,QQQ,IWM'), { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const p = data?.portfolio

  return (
    <div className="min-h-screen bg-black text-slate-200">
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Monitor</h1>
          <p className="text-xs text-slate-500 mt-2 max-w-xl">
            Rolling snapshot from a lightweight <span className="font-mono">GET /api/backtest?tickers=SPY,QQQ,IWM</span> run.
            For scheduled CI checks, use the <span className="font-mono">nightly-backtest</span> workflow.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          <Link href="/simulator" className="text-cyan-400 hover:text-cyan-300">→ Simulator</Link>
          <a
            href="https://github.com/features/actions"
            target="_blank"
            rel="noreferrer"
            className="text-slate-500 hover:text-slate-300"
          >
            GitHub Actions docs
          </a>
        </div>

        {loading && <div className="text-slate-500 text-sm">Loading metrics…</div>}
        {err && <div className="text-red-400 text-sm">{err}</div>}

        {p && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Metric label="Win rate" value={`${(p.winRate * 100).toFixed(1)}%`} sub={`${p.totalTrades} trades`} />
            <Metric label="Portfolio return" value={`${(p.avgReturn * 100).toFixed(1)}%`} sub={`Ann ${(p.avgAnnReturn * 100).toFixed(1)}%`} />
            <Metric label="Max drawdown" value={`${(p.maxPortfolioDd * 100).toFixed(1)}%`} sub="Peak to trough" />
            <Metric label="Sharpe" value={p.sharpeRatio != null ? p.sharpeRatio.toFixed(2) : '—'} sub="Portfolio" />
            <Metric label="Instruments" value={String(p.totalInstruments)} sub={data?.computedAt ? new Date(data.computedAt).toLocaleString() : ''} />
            <Metric label="Run id" value={data?.runId?.slice(0, 12) ?? '—'} sub="Latest fetch" />
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-mono text-white mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}
