'use client'

/**
 * DataFreshnessIndicator — the badge that says what state a number is in.
 *
 * Phase 12 Sprint 2 (D4): warn traders before they act on a stale quote.
 * Q-101 (2026-09-13): the decision moved to `lib/data/freshness.ts` — this file
 * is now presentation only. Two states were added there; see that module for
 * why, and for the precedence rule, which is the actual safety property.
 *
 * States, and the next action each one implies:
 *   Live      (<10s, session open)   green pulse   — act
 *   ~Xs ago   (10–120s)              amber         — act, knowing the lag
 *   Stale     (>120s in session,     red           — refresh; something is wrong
 *              or a skipped session)
 *   At close  (session shut, stamp   slate         — nothing to do; this IS the
 *              from the latest                       freshest datum that exists
 *              session)
 *   Delayed   (vendor delays the     sky           — nothing to do; inherent to
 *              feed by N minutes)                    the entitlement
 *   Cached    (served from a store)  amber         — treat as a stored copy
 *   —         (no timestamp)         grey          — provenance unknown
 *
 * Usage:
 *   <DataFreshnessIndicator quoteTime={data?.quoteTime} calendar="us-equity" />
 *   <DataFreshnessIndicator delayedMinutes={15} label="Options" />
 */

import { useEffect, useState } from 'react'
import {
  classifyFreshness,
  formatAge,
  type TradingCalendar,
} from '@/lib/data/freshness'
import { formatNySessionStamp } from '@/lib/api/marketHours'

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
  /**
   * The vendor contractually delays this feed by N minutes (I1 provenance).
   *
   * `app/api/options/[ticker]/route.ts` has emitted
   * `dataProvenance {delayedMinutes: 15, realtime: false}` since Phase 13, with
   * a comment saying the UI should "render an explicit DELAYED label". Measured
   * 2026-09-13: one occurrence repo-wide — the producer. No component read it
   * and no user was ever told. Same dead-flag shape as `cached`, one layer up.
   */
  delayedMinutes?: number | null
  /**
   * Trading calendar the age is judged against. Defaults to `'always-open'`
   * (naive wall-clock). Pass `'us-equity'` for a US equities vendor quote, or
   * the badge will alarm for every hour the market is shut.
   */
  calendar?: TradingCalendar
}

export function DataFreshnessIndicator({
  quoteTime,
  compact = false,
  label,
  cached = false,
  delayedMinutes = null,
  calendar = 'always-open',
}: Props) {
  // Tick once per second to keep age fresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const state = classifyFreshness({ quoteTime, now, cached, delayedMinutes, calendar })
  const { kind, ageSec } = state
  const withLabel = (text: string) => (label ? `${label}: ${text}` : text)

  let dotClass: string
  let textClass: string
  let stateLabel: string
  let aria: string

  switch (kind) {
    case 'cached': {
      // CACHED OUTRANKS EVERY FRESHNESS STATE, INCLUDING "Live" — a stored copy
      // with a recent timestamp would otherwise render green and pulsing.
      dotClass = 'bg-amber-400/80 ring-1 ring-amber-300/40'
      textClass = 'text-amber-300'
      stateLabel = 'Cached'
      aria = ageSec == null
        ? 'Value served from cache, not fetched live; timestamp unknown'
        : `Value served from cache, not fetched live; underlying data is ${ageSec} seconds old`
      break
    }
    case 'delayed': {
      const mins = state.delayedMinutes ?? 0
      dotClass = 'bg-sky-400/90 ring-1 ring-sky-300/40'
      textClass = 'text-sky-300'
      stateLabel = `Delayed ${mins}m`
      aria = `Vendor feed is delayed by approximately ${mins} minutes; these are not real-time prices`
      break
    }
    case 'atClose': {
      // The market is shut and this is the latest session's data. There is no
      // fresher value in existence, so an alarm here names an action that
      // cannot help — and an alarm that is on 80% of the week is read by nobody
      // when it finally means something.
      const stamp = quoteTime != null ? formatNySessionStamp(new Date(quoteTime)) : ''
      dotClass = 'bg-slate-400/80'
      textClass = 'text-slate-300'
      stateLabel = stamp ? `At close · ${stamp}` : 'At close'
      aria = `Market closed. Data is as of the last session close${stamp ? `, ${stamp}` : ''}.`
      break
    }
    case 'live': {
      dotClass = 'bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]'
      textClass = 'text-emerald-300'
      stateLabel = 'Live'
      aria = `Data is live, ${ageSec} seconds old`
      break
    }
    case 'recent': {
      dotClass = 'bg-amber-400'
      textClass = 'text-amber-300'
      stateLabel = `~${formatAge(ageSec as number)} ago`
      aria = `Data is ${ageSec} seconds old`
      break
    }
    case 'stale': {
      dotClass = 'bg-red-500'
      textClass = 'text-red-300'
      stateLabel = 'Stale — refresh'
      aria = `Data is stale, ${ageSec} seconds old; consider refreshing`
      break
    }
    default: {
      dotClass = 'bg-slate-500/60'
      textClass = 'text-slate-400'
      stateLabel = '—'
      aria = 'Data timestamp unknown'
      break
    }
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10.5px] font-medium tabular-nums"
      role="status"
      aria-live={kind === 'unknown' ? 'off' : 'polite'}
      aria-label={withLabel(aria)}
      title={withLabel(aria)}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
      {!compact && <span className={textClass}>{withLabel(stateLabel)}</span>}
    </span>
  )
}

export default DataFreshnessIndicator
