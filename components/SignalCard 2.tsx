'use client'

import { PriceSignal } from '@/lib/sectors'

interface SignalCardProps {
  signal: PriceSignal
  color: string
  compact?: boolean
}

const DIRECTION_CONFIG = {
  BUY: { label: 'BUY', bg: 'bg-green-900/30', border: 'border-green-500/40', text: 'text-green-400', dot: 'bg-green-400' },
  SELL: { label: 'SELL', bg: 'bg-red-900/30', border: 'border-red-500/40', text: 'text-red-400', dot: 'bg-red-400' },
  HOLD: { label: 'HOLD', bg: 'bg-yellow-900/20', border: 'border-yellow-500/30', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  WATCH: { label: 'WATCH', bg: 'bg-blue-900/20', border: 'border-blue-500/30', text: 'text-blue-400', dot: 'bg-blue-400' },
}

export default function SignalCard({ signal, color, compact = false }: SignalCardProps) {
  const config = DIRECTION_CONFIG[signal.direction]
  const riskPct = signal.direction === 'BUY'
    ? ((signal.target - signal.entry) / (signal.entry - signal.stopLoss)).toFixed(1)
    : ((signal.entry - signal.target) / (signal.stopLoss - signal.entry)).toFixed(1)

  if (compact) {
    return (
      <div className={`rounded-xl p-4 border ${config.bg} ${config.border} hover:brightness-110 transition-all`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-bold ${config.text} tracking-widest`}>{config.label}</span>
          <span className="text-xs text-slate-400 font-mono">{signal.etf}</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-full bg-slate-800 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full transition-all"
              style={{ width: `${signal.confidence}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-xs font-mono" style={{ color }}>{signal.confidence}%</span>
        </div>
        <div className="text-xs text-slate-500">{signal.sector} · {signal.timeframe}</div>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl p-5 border ${config.bg} ${config.border}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${config.dot} animate-pulse`} />
          <span className={`text-sm font-bold tracking-widest ${config.text}`}>{config.label} SIGNAL</span>
        </div>
        <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded font-mono">{signal.timeframe}</span>
      </div>

      {/* Confidence Ring + ETF */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="24" stroke="#1e293b" strokeWidth="5" fill="none" />
            <circle
              cx="30" cy="30" r="24"
              stroke={color}
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 24}`}
              strokeDashoffset={`${2 * Math.PI * 24 * (1 - signal.confidence / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.8s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-white">{signal.confidence}%</span>
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-white font-mono">{signal.etf}</div>
          <div className="text-sm text-slate-400">{signal.sector}</div>
          <div className="text-xs text-slate-600 mt-0.5">Confidence Score</div>
        </div>
      </div>

      {/* Levels */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
          <div className="text-xs text-slate-500">Entry</div>
          <div className="font-mono text-sm text-white font-semibold">${signal.entry.toFixed(2)}</div>
        </div>
        <div className="bg-red-950/30 rounded-lg p-2.5 border border-red-900/40">
          <div className="text-xs text-slate-500">Stop Loss</div>
          <div className="font-mono text-sm text-red-400 font-semibold">${signal.stopLoss.toFixed(2)}</div>
        </div>
        <div className="bg-green-950/30 rounded-lg p-2.5 border border-green-900/40">
          <div className="text-xs text-slate-500">Target</div>
          <div className="font-mono text-sm text-green-400 font-semibold">${signal.target.toFixed(2)}</div>
        </div>
      </div>

      {/* Risk/Reward */}
      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
        <span>Risk/Reward Ratio</span>
        <span className="font-mono text-white">1:{riskPct}</span>
      </div>

      {/* Rationale */}
      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
        <div className="text-xs text-slate-400 leading-relaxed">{signal.rationale}</div>
      </div>
    </div>
  )
}
