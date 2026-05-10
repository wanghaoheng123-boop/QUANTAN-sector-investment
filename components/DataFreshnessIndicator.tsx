'use client'

/**
 * DataFreshnessIndicator — pulsing-dot badge showing data age.
 *
 * Phase 12 Sprint 2 (D4): Warns traders before they act on stale quotes.
 *
 * States:
 *   - Live   (< 10s old):    green pulsing dot
 *   - Recent (10–120s):       amber dot, "~Xs ago"
 *   - Stale  (> 120s):        red dot, "Stale — refresh"
 *   - Unknown (no timestamp): grey dot, "—"
 *
 * Usage:
 *   <DataFreshnessIndicator quoteTime={data?.quoteTime} />
 *   <DataFreshnessIndicator quoteTime={Date.now() - 5000} compact />
 */

import { useEffect, useState } from 'react'

interface Props {
  /** Unix milliseconds of latest data point. null/undefined = unknown */
  quoteTime?: number | null
  /** Compact (no label) */
  compact?: boolean
  /** Override label prefix */
  label?: string
}

export function DataFreshnessIndicator({ quoteTime, compact = false, label }: Props) {
  // Tick once per second to keep age fresh
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (quoteTime == null) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-500"
        title="Data timestamp unknown"
        role="status"
      >
        <span className="w-2 h-2 rounded-full bg-slate-500/60" aria-hidden="true" />
        {!compact && (label ? `${label}: —` : '—')}
      </span>
    )
  }

  const ageSec = Math.max(0, Math.floor((now - quoteTime) / 1000))

  let dotClass = ''
  let textClass = ''
  let stateLabel = ''
  let aria = ''
  if (ageSec < 10) {
    dotClass = 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]'
    textClass = 'text-emerald-300'
    stateLabel = 'Live'
    aria = `Data is live, ${ageSec} seconds old`
  } else if (ageSec < 120) {
    dotClass = 'bg-amber-400'
    textClass = 'text-amber-300'
    stateLabel = ageSec < 60 ? `~${ageSec}s ago` : `~${Math.floor(ageSec / 60)}m ${ageSec % 60}s ago`
    aria = `Data is ${ageSec} seconds old`
  } else {
    dotClass = 'bg-red-500'
    textClass = 'text-red-300'
    stateLabel = 'Stale — refresh'
    aria = `Data is stale, ${ageSec} seconds old; consider refreshing`
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] font-medium tabular-nums"
      role="status"
      aria-live="polite"
      aria-label={aria}
      title={aria}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
      {!compact && (
        <span className={textClass}>
          {label ? `${label}: ` : ''}
          {stateLabel}
        </span>
      )}
    </span>
  )
}

export default DataFreshnessIndicator
