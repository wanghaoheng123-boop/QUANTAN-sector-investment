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
  /**
   * The value was served from a cache rather than fetched live (I2).
   *
   * This exists because `_cached: true` was set by three API routes and read by
   * NOBODY — the substitution happened and the flag died in the JSON, which is
   * exactly what I2 names and forbids ("never substitute a cached value for a
   * live one without a visible flag"). The Q-079 audit rated I2 VIOLATED on this
   * clause alone.
   */
  cached?: boolean
}

export function DataFreshnessIndicator({ quoteTime, compact = false, label, cached = false }: Props) {
  // Tick once per second to keep age fresh
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Unknown timestamp but known-cached still deserves the cached flag: the
  // substitution is the thing I2 cares about, not the age.
  if (quoteTime == null && cached) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-amber-300"
        role="status"
        aria-label="Value served from cache, not fetched live; timestamp unknown"
        title="Value served from cache, not fetched live; timestamp unknown"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400/80 ring-1 ring-amber-300/40" aria-hidden="true" />
        {!compact && (label ? `${label}: Cached` : 'Cached')}
      </span>
    )
  }

  if (quoteTime == null) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10.5px] text-slate-400"
        title="Data timestamp unknown"
        role="status"
      >
        <span className="w-2 h-2 rounded-full bg-slate-500/60" aria-hidden="true" />
        {!compact && (label ? `${label}: —` : '—')}
      </span>
    )
  }

  const ageSec = Math.max(0, Math.floor((now - quoteTime) / 1000))

  // CACHED TAKES PRECEDENCE OVER EVERY FRESHNESS STATE, including "Live".
  //
  // A cached value with a recent timestamp would otherwise render green and
  // pulsing — telling the user it is live when it is a stored copy. That is a
  // worse outcome than showing no indicator at all, so this branch comes first
  // and is not reachable-past.
  if (cached) {
    const cachedAria =
      `Value served from cache, not fetched live; underlying data is ${ageSec} seconds old`
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10.5px] font-medium tabular-nums text-amber-300"
        role="status"
        aria-live="polite"
        aria-label={cachedAria}
        title={cachedAria}
      >
        <span className="w-2 h-2 rounded-full bg-amber-400/80 ring-1 ring-amber-300/40" aria-hidden="true" />
        {!compact && (label ? `${label}: Cached` : 'Cached')}
      </span>
    )
  }

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
