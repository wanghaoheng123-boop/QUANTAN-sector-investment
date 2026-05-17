'use client'

import { memo } from 'react'
import { PriceSignal } from '@/lib/sectors'
import { MetricTooltip } from '@/components/MetricTooltip'
import { safeFixed } from '@/lib/format'

interface SignalCardProps {
  signal: PriceSignal
  color: string
  compact?: boolean
}

// Phase 13 S2 fix (F6.3): colorblind-safe directional indicators.
// Each direction now carries an icon (▲/▼/●/◆) plus a sign/word so users
// with red-green color deficiency (~8% of men) can distinguish BUY/SELL
// without relying on hue alone. WCAG 2.2 SC 1.4.1 (Use of Color, Level A).
const DIRECTION_CONFIG = {
  BUY:   { label: 'BUY',   icon: '▲', bg: 'bg-green-900/30',  border: 'border-green-500/40',  text: 'text-green-400',  dot: 'bg-green-400' },
  SELL:  { label: 'SELL',  icon: '▼', bg: 'bg-red-900/30',    border: 'border-red-500/40',    text: 'text-red-400',    dot: 'bg-red-400' },
  HOLD:  { label: 'HOLD',  icon: '●', bg: 'bg-yellow-900/20', border: 'border-yellow-500/30', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  WATCH: { label: 'WATCH', icon: '◆', bg: 'bg-blue-900/20',   border: 'border-blue-500/30',   text: 'text-blue-400',   dot: 'bg-blue-400' },
}

function sessionDirectionLabel(direction: PriceSignal['direction']): string {
  if (direction === 'BUY') return 'UP'
  if (direction === 'SELL') return 'DOWN'
  return 'NEUTRAL'
}

function directionAriaLabel(direction: PriceSignal['direction'], session: boolean): string {
  if (direction === 'BUY') return session ? 'session up' : 'buy signal'
  if (direction === 'SELL') return session ? 'session down' : 'sell signal'
  return session ? 'session neutral' : `${direction.toLowerCase()} signal`
}

function formatRiskReward(signal: PriceSignal): string {
  if (signal.source === 'yahoo-session') return '—'
  if (signal.direction === 'BUY') {
    const risk = signal.entry - signal.stopLoss
    const reward = signal.target - signal.entry
    if (risk <= 0 || reward <= 0 || !Number.isFinite(risk) || !Number.isFinite(reward)) return '—'
    return (reward / risk).toFixed(2)
  }
  if (signal.direction === 'SELL') {
    const risk = signal.stopLoss - signal.entry
    const reward = signal.entry - signal.target
    if (risk <= 0 || reward <= 0 || !Number.isFinite(risk) || !Number.isFinite(reward)) return '—'
    return (reward / risk).toFixed(2)
  }
  return 'N/A'
}

// R5-H-2 (Phase 14 S1): wrap with React.memo so SignalCard only re-renders when its props
// change. Signal cards are rendered in lists; memo prevents cascading re-renders when
// unrelated parent state (e.g. a timeframe selector or quote stream) updates.
function SignalCard({ signal, color, compact = false }: SignalCardProps) {
  const config = DIRECTION_CONFIG[signal.direction]
  const riskPct = formatRiskReward(signal)
  const session = signal.source === 'yahoo-session'
  const headline = session ? sessionDirectionLabel(signal.direction) : config.label
  const barLabel = session ? 'Move scale' : 'Confidence'

  if (compact) {
    return (
      <div
        className={`rounded-xl p-4 border ${config.bg} ${config.border} hover:brightness-110 transition-all animate-card-enter`}
        style={{ boxShadow: `0 0 20px ${color}10` }}
        aria-label={directionAriaLabel(signal.direction, session)}
      >
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-bold ${config.text} tracking-widest inline-flex items-center gap-1`}>
            <span aria-hidden="true">{config.icon}</span>
            {headline}
          </span>
          <span className="text-xs text-slate-400 font-mono">{signal.etf}</span>
        </div>
        {session && signal.sessionChangePct != null && Number.isFinite(signal.sessionChangePct) && (
          <div className="text-[11px] font-mono text-slate-300 mb-1">
            {signal.sessionChangePct >= 0 ? '+' : ''}
            {safeFixed(signal.sessionChangePct, 2)}% vs prior close
          </div>
        )}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-full bg-slate-800 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${signal.confidence}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-xs font-mono" style={{ color }}>{signal.confidence}%</span>
        </div>
        <div className="text-xs text-slate-500">
          {signal.sector} · {signal.timeframe}
          {session ? ' · Yahoo' : ''}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`rounded-2xl p-5 border ${config.bg} ${config.border} animate-card-enter`}
      style={{ boxShadow: `0 0 40px ${color}15, 0 4px 20px rgba(0,0,0,0.3)` }}
      aria-label={directionAriaLabel(signal.direction, session)}
    >
      {/* Header — F6.3: icon + text so direction is clear without color */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${config.dot} ${session ? '' : 'animate-pulse'}`} aria-hidden="true" />
          <span className={`text-sm font-bold tracking-widest ${config.text} inline-flex items-center gap-2`}>
            <span aria-hidden="true">{config.icon}</span>
            {session ? `${headline} SESSION` : `${config.label} SIGNAL`}
          </span>
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
              className="animate-confidence-ring"
              style={{
                filter: `drop-shadow(0 0 4px ${color})`,
                ['--ring-offset' as string]: `${2 * Math.PI * 24 * (1 - signal.confidence / 100)}`,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center animate-pulse-subtle">
            <span className="text-xs font-bold text-white">{signal.confidence}%</span>
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-white font-mono">{signal.etf}</div>
          <div className="text-sm text-slate-400">{signal.sector}</div>
          <div className="text-xs text-slate-400 mt-0.5">{barLabel}</div>
          {session && signal.sessionChangePct != null && Number.isFinite(signal.sessionChangePct) && (
            <div className="text-xs font-mono text-slate-300 mt-1">
              Δ {signal.sessionChangePct >= 0 ? '+' : ''}
              {safeFixed(signal.sessionChangePct, 2)}% (Yahoo)
            </div>
          )}
          {session && signal.quoteTime && (
            <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
              Quote {new Date(signal.quoteTime).toLocaleString()}
            </div>
          )}
        </div>
      </div>

      {/* Levels */}
      {session ? (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
            <div className="text-xs text-slate-500">Last price</div>
            <div className="font-mono text-sm text-white font-semibold">${safeFixed(signal.entry, 2)}</div>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
            <div className="text-xs text-slate-500">Session vs prior</div>
            <div className="font-mono text-sm text-white font-semibold">
              {signal.sessionChangePct != null && Number.isFinite(signal.sessionChangePct)
                ? `${signal.sessionChangePct >= 0 ? '+' : ''}${safeFixed(signal.sessionChangePct, 2)}%`
                : '—'}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-slate-900/60 rounded-lg p-2.5 border border-slate-800">
            <div className="text-xs text-slate-500">Entry</div>
            <div className="font-mono text-sm text-white font-semibold">${safeFixed(signal.entry, 2)}</div>
          </div>
          <div className="bg-red-950/30 rounded-lg p-2.5 border border-red-900/40">
            <div className="text-xs text-slate-500 inline-flex items-center">
              Stop Loss<MetricTooltip metricKey="atrStop" compact />
            </div>
            <div className="font-mono text-sm text-red-400 font-semibold">${safeFixed(signal.stopLoss, 2)}</div>
          </div>
          <div className="bg-green-950/30 rounded-lg p-2.5 border border-green-900/40">
            <div className="text-xs text-slate-500">Target</div>
            <div className="font-mono text-sm text-green-400 font-semibold">${safeFixed(signal.target, 2)}</div>
          </div>
        </div>
      )}

      {/* Risk/Reward */}
      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
        <span className="inline-flex items-center">
          Risk/Reward Ratio<MetricTooltip metricKey="riskReward" compact />
        </span>
        <span className="font-mono text-white">{riskPct === 'N/A' || riskPct === '—' ? riskPct : `1:${riskPct}`}</span>
      </div>

      {/* Rationale */}
      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-800">
        <div className="text-xs text-slate-400 leading-relaxed">{signal.rationale}</div>
      </div>
    </div>
  )
}

export default memo(SignalCard)
