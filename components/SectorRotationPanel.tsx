'use client'

import { useEffect, useState } from 'react'
import type { SectorScore, SectorSignal } from '@/lib/quant/sectorRotation'

interface ApiResponse {
  scores: SectorScore[]
  fetchedAt: string
}

function SignalBadge({ signal }: { signal: SectorSignal }) {
  const cls =
    signal === 'OVERWEIGHT'  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
    signal === 'UNDERWEIGHT' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
    'bg-gray-500/20 text-gray-400 border-gray-500/30'
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${cls}`}>
      {signal}
    </span>
  )
}

function ScoreBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.abs(value) / Math.max(Math.abs(max), 0.001) * 100)
  const isPos = value >= 0
  return (
    <div className="flex items-center gap-1">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isPos ? 'bg-emerald-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums font-mono ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPos ? '+' : ''}{(value * 100).toFixed(1)}%
      </span>
    </div>
  )
}

export default function SectorRotationPanel() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sector-rotation')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e)); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-800 rounded-xl" />
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        Failed to load sector rotation data.
      </div>
    )
  }

  const maxComposite = Math.max(...data.scores.map((s) => Math.abs(s.composite)), 0.01)

  return (
    <div className="space-y-4">
      {/* Grid of sector cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {data.scores.map((s) => {
          const bgClass =
            s.signal === 'OVERWEIGHT'  ? 'bg-emerald-900/10 border-emerald-500/20' :
            s.signal === 'UNDERWEIGHT' ? 'bg-red-900/10 border-red-500/20' :
            'bg-gray-900/40 border-gray-700/30'

          return (
            <div
              key={s.etf}
              className={`rounded-xl border p-3 space-y-2 ${bgClass}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">{s.sector}</div>
                  <div className="text-xs text-gray-500 font-mono">{s.etf}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">#{s.rank}</div>
                  <SignalBadge signal={s.signal} />
                </div>
              </div>

              {/* Score bars */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Composite</span>
                  <ScoreBar value={s.composite} max={maxComposite} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">Momentum</span>
                  <ScoreBar value={s.momentum} max={maxComposite} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">MeanRev</span>
                  <span className={`text-xs font-mono ${s.meanReversion > 0 ? 'text-emerald-500' : s.meanReversion < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    {s.meanReversion > 0 ? '+' : ''}{(s.meanReversion * 100).toFixed(0)}bp
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-emerald-500 rounded-full" /> OVERWEIGHT (top 3)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-red-500 rounded-full" /> UNDERWEIGHT (bottom 3)
        </span>
        <span className="text-gray-600">
          Composite = 0.6 × momentum (3/6/12mo) + 0.4 × RSI mean-reversion
        </span>
      </div>

      <p className="text-xs text-gray-600">
        Updated: {new Date(data.fetchedAt).toLocaleString()} · 1-hour cache
      </p>
    </div>
  )
}
