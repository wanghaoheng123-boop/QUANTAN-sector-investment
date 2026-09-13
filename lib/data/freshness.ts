/**
 * Freshness classification — the pure decision behind `DataFreshnessIndicator`.
 *
 * Q-101 (2026-09-13). Three things forced this out of the component and into a
 * pure module:
 *
 * 1. The decision grew a market calendar, and house style puts anything with
 *    real branching in a pure, unit-testable function rather than inside JSX.
 * 2. The property the architecture guard cares about — "a cached value must
 *    never render as Live" — was asserted by `indexOf` on the component's
 *    SOURCE TEXT. A behavioural assertion against this function is strictly
 *    stronger: it survives reformatting and it fails on a wrong answer rather
 *    than on a moved line.
 * 3. A vendor-DELAYED feed needs exactly the same protection as a cached one
 *    and did not have it (see PRECEDENCE below).
 *
 * PRECEDENCE — the ordering is the safety property, not the set of states.
 *
 *   cached  >  delayed  >  age/session states  >  unknown
 *
 * `cached` first because a stored copy with a recent timestamp would otherwise
 * render green and pulsing, telling the user it is live. `delayed` next for the
 * identical reason one level along: an options quote the vendor delays by 15
 * minutes, fetched two seconds ago, has an *age* of two seconds. Classifying it
 * `live` would be the same lie with a different cause. Neither claim is about
 * age, so neither may be reached past by an age test.
 *
 * WHY `atClose` IS NOT `stale`. Reference practice is explicit that a
 * disconnect, a stale quote, a delayed tick and a closed market are four
 * different states needing four different labels and four different next
 * actions (Smashing Magazine, "UX Strategies For Real-Time Dashboards", 2025).
 * This module collapsed the last two into the first two. Measured on production
 * 2026-09-13: /desk rendered "Data is stale, 151223 seconds old; consider
 * refreshing" next to the site's own CLOSED pill, naming an action that could
 * not help, for ~80% of every wall-clock week.
 *
 * WHAT THIS DOES NOT DO: it never suppresses the age. `ageSec` and `asOf` ride
 * on every state so the caller can always show the number; the fix is to the
 * ALARM, not to the disclosure.
 */

import { isMarketOpen, isFromLatestSession } from '@/lib/api/marketHours'

/**
 * Trading calendar the age should be judged against.
 *
 * `'always-open'` is the default ON PURPOSE. It is the naive wall-clock
 * behaviour — which over-alarms — and an over-alarming default is the safe one
 * to forget. A surface that forgets `'us-equity'` looks noisy; a surface that
 * defaulted the other way would go quiet about a genuinely dead feed.
 * `__tests__/architecture/data-state-consumed.test.ts` names the surfaces that
 * must pass it, so the omission is caught rather than relied upon.
 */
export type TradingCalendar = 'us-equity' | 'always-open'

export type FreshnessKind = 'cached' | 'delayed' | 'live' | 'recent' | 'stale' | 'atClose' | 'unknown'

export interface FreshnessInput {
  /** Unix ms of the datum. null/undefined = no timestamp available. */
  quoteTime?: number | null
  /** Evaluation instant; injected so the classifier is deterministic under test. */
  now: number
  /** The value was served from a store rather than fetched (I2). */
  cached?: boolean
  /** Vendor contractually delays this feed by N minutes (I1 provenance). */
  delayedMinutes?: number | null
  calendar?: TradingCalendar
}

export interface Freshness {
  kind: FreshnessKind
  /** Seconds between `quoteTime` and `now`; null when there is no timestamp. */
  ageSec: number | null
  /** Vendor delay in minutes when `kind === 'delayed'`, else null. */
  delayedMinutes: number | null
}

/** Under 10s: a live tick. */
export const LIVE_MAX_SEC = 10
/** 10–120s: visibly behind but within a polling cadence. Beyond it, alarm. */
export const RECENT_MAX_SEC = 120

/**
 * Classify a datum's state. Pure: same inputs → same output, no clock read.
 */
export function classifyFreshness(input: FreshnessInput): Freshness {
  const { quoteTime, now, cached = false, delayedMinutes = null, calendar = 'always-open' } = input

  const hasTime = quoteTime != null && Number.isFinite(quoteTime)
  const ageSec = hasTime ? Math.max(0, Math.floor((now - (quoteTime as number)) / 1000)) : null

  // 1. A stored copy is a stored copy whatever its timestamp says.
  if (cached) return { kind: 'cached', ageSec, delayedMinutes: null }

  // 2. A contractually delayed feed cannot be described by its fetch age.
  if (delayedMinutes != null && Number.isFinite(delayedMinutes) && delayedMinutes > 0) {
    return { kind: 'delayed', ageSec, delayedMinutes }
  }

  if (!hasTime) return { kind: 'unknown', ageSec: null, delayedMinutes: null }

  const age = ageSec as number

  // 3. Outside the session, "old" is the expected state, not a fault — unless
  //    the stamp predates the latest session's open, which means a whole
  //    session went by with no tick and IS a fault.
  if (calendar === 'us-equity') {
    const nowDate = new Date(now)
    if (!isMarketOpen(nowDate)) {
      return isFromLatestSession(new Date(quoteTime as number), nowDate)
        ? { kind: 'atClose', ageSec: age, delayedMinutes: null }
        : { kind: 'stale', ageSec: age, delayedMinutes: null }
    }
  }

  if (age < LIVE_MAX_SEC) return { kind: 'live', ageSec: age, delayedMinutes: null }
  if (age < RECENT_MAX_SEC) return { kind: 'recent', ageSec: age, delayedMinutes: null }
  return { kind: 'stale', ageSec: age, delayedMinutes: null }
}

/** Human age, e.g. "42s", "3m 05s", "2h 11m". Used in labels and aria text. */
export function formatAge(ageSec: number): string {
  if (ageSec < 60) return `${ageSec}s`
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ${String(ageSec % 60).padStart(2, '0')}s`
  return `${Math.floor(ageSec / 3600)}h ${String(Math.floor((ageSec % 3600) / 60)).padStart(2, '0')}m`
}

/**
 * Read a vendor delay out of an API payload's `dataProvenance` block.
 *
 * Boundary validation, not a cast: the value has been through `fetch` +
 * `JSON.parse`, so its declared type is a claim about a network response and
 * nothing more. Mirrors `parseLiveQuote` in `hooks/useLiveQuote.ts`.
 *
 * Returns null for anything that is not a positive finite number of minutes —
 * including `realtime: true` feeds, which have no delay to disclose.
 */
export function parseDelayedMinutes(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (p.realtime === true) return null
  const m = p.delayedMinutes
  if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0) return null
  return m
}
