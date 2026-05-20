'use client'

/**
 * useLiveQuotes — multi-ticker SSE fan-out hook.
 *
 * Phase 14 wave 38 (real-time platform initiative, plural variant):
 *   The dashboard (app/page.tsx) and heatmap views need real-time quotes
 *   for all 11 sector ETFs + SPY + QQQ at once. Calling the singular
 *   useLiveQuote N times from a component would work but creates a lot
 *   of stateful boilerplate at the call site. This hook owns one
 *   EventSource per ticker and exposes a Record<ticker, LiveQuote | null>.
 *
 * Guardrails:
 *   • MAX_LIVE_STREAMS = 20 — browsers limit ~6 simultaneous connections
 *     per origin under HTTP/1.1; HTTP/2 lifts the limit but still wastes
 *     server slots. The cap prevents accidental connection storms when a
 *     caller passes a huge list (e.g. the full S&P 500). Excess tickers
 *     are silently dropped (no error — the caller chose the list).
 *   • Tickers list passed by reference must be STABLE (memoised by the
 *     caller via useMemo or a constant). If the array identity changes
 *     every render, the effect tears down + reconnects every render.
 *   • parseLiveQuote (the singular hook's validator) is reused, so the
 *     same finite-price / non-empty-string gates apply at this layer too.
 *
 * Why one EventSource per ticker (not a single multi-ticker stream)?
 *   The current /api/stream/:ticker server endpoint is single-ticker by
 *   design — built in Phase 13. Migrating it to a multi-symbol payload
 *   would change the wire format and break the singular hook. Future
 *   waves can add a `/api/stream` (no ticker) variant that multiplexes.
 *
 * Reference: WHATWG HTML Living Standard §9.2 — Server-sent events;
 *            RFC 6202 §3 — Multiplexing constraints.
 */

import { useEffect, useRef, useState } from 'react'
import { parseLiveQuote, type LiveQuote } from './useLiveQuote'

/** Cap on simultaneous EventSource connections per call site. */
export const MAX_LIVE_STREAMS = 20

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const
const RECONNECT_CAP = 8_000

export interface UseLiveQuotesResult {
  /** Map of ticker → most recent quote, or null if none received yet. */
  quotes: Record<string, LiveQuote | null>
  /** Map of ticker → connection state (true once EventSource is OPEN and a tick has arrived). */
  connections: Record<string, boolean>
  /**
   * True when at least one of the streams has emitted a quote AND its underlying
   * `marketOpen` flag is true. Provides a single dashboard-level "market is live"
   * signal without forcing callers to introspect every ticker's state.
   */
  marketOpen: boolean
  /** True if EventSource is available in this environment. */
  supported: boolean
  /** Number of tickers actually subscribed (after MAX_LIVE_STREAMS cap). */
  active: number
  /** Number of tickers DROPPED because they exceeded the cap. */
  dropped: number
}

/**
 * Per-ticker connection tracker held in a ref so the reconnect loop
 * doesn't re-create on every render.
 */
interface TickerConnection {
  es: EventSource | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  closedManually: boolean
}

export function useLiveQuotes(tickers: ReadonlyArray<string>): UseLiveQuotesResult {
  const supported = typeof window !== 'undefined' && typeof EventSource !== 'undefined'

  // Apply the cap, deduplicate, drop empties.
  const cleaned = Array.from(new Set(tickers.filter((t) => t && t.length > 0)))
  const active = cleaned.slice(0, MAX_LIVE_STREAMS)
  const dropped = Math.max(0, cleaned.length - MAX_LIVE_STREAMS)
  const activeKey = active.join(',')  // stable string for effect dep comparison

  const [quotes, setQuotes] = useState<Record<string, LiveQuote | null>>(() =>
    Object.fromEntries(active.map((t) => [t, null])),
  )
  const [connections, setConnections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(active.map((t) => [t, false])),
  )
  const [marketOpen, setMarketOpen] = useState(false)

  // Tracker map: ticker → connection-state object.
  const trackersRef = useRef<Map<string, TickerConnection>>(new Map())

  useEffect(() => {
    if (!supported || active.length === 0) {
      return
    }

    const trackers = trackersRef.current

    // Reset state for the new ticker set (preserve quotes for tickers still in the list).
    setQuotes((prev) => {
      const next: Record<string, LiveQuote | null> = {}
      for (const t of active) next[t] = prev[t] ?? null
      return next
    })
    setConnections(() => Object.fromEntries(active.map((t) => [t, false])))

    const openOne = (ticker: string) => {
      const tracker = trackers.get(ticker)
      if (!tracker || tracker.closedManually) return

      if (tracker.reconnectTimer) {
        clearTimeout(tracker.reconnectTimer)
        tracker.reconnectTimer = null
      }

      const es = new EventSource(`/api/stream/${encodeURIComponent(ticker)}`)
      tracker.es = es

      es.onopen = () => {
        if (tracker.closedManually) return
        setConnections((c) => ({ ...c, [ticker]: true }))
        tracker.reconnectAttempt = 0
      }

      es.addEventListener('quote', (evt) => {
        if (tracker.closedManually) return
        try {
          const raw = JSON.parse((evt as MessageEvent).data) as unknown
          const data = parseLiveQuote(raw)
          if (data) {
            setQuotes((q) => ({ ...q, [ticker]: data }))
            if (data.marketOpen) setMarketOpen(true)
          }
        } catch (err) {
          console.warn(`[useLiveQuotes] malformed quote payload for ${ticker}`, err)
        }
      })

      es.addEventListener('market_state', (evt) => {
        if (tracker.closedManually) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { open: boolean }
          if (data.open === true) setMarketOpen(true)
          // Note: we do NOT set marketOpen=false here because OTHER tickers may
          // still report marketOpen=true (24x7 futures, crypto). The aggregate
          // marketOpen flag is "ANY ticker is live" not "ALL tickers are live".
        } catch {
          /* ignore — best-effort */
        }
      })

      es.addEventListener('closing_soon', (evt) => {
        if (tracker.closedManually) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { reconnectInMs?: number }
          const delay = typeof data.reconnectInMs === 'number' && data.reconnectInMs > 0
            ? Math.min(data.reconnectInMs, 60_000)
            : 30_000
          if (tracker.reconnectTimer) clearTimeout(tracker.reconnectTimer)
          tracker.reconnectTimer = setTimeout(() => {
            if (tracker.closedManually) return
            try { es.close() } catch { /* already closed */ }
            tracker.es = null
            setConnections((c) => ({ ...c, [ticker]: false }))
            openOne(ticker)
          }, delay)
        } catch {
          /* schedule fallback */
        }
      })

      es.addEventListener('close', () => {
        if (tracker.closedManually) return
        try { es.close() } catch { /* already closed */ }
        tracker.es = null
        setConnections((c) => ({ ...c, [ticker]: false }))
        if (tracker.reconnectTimer) clearTimeout(tracker.reconnectTimer)
        tracker.reconnectTimer = setTimeout(() => openOne(ticker), 500)
      })

      es.onerror = () => {
        if (tracker.closedManually) return
        setConnections((c) => ({ ...c, [ticker]: false }))
        if (es.readyState === EventSource.CLOSED) {
          tracker.es = null
          const attempt = Math.min(tracker.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)
          const delay = RECONNECT_BACKOFF_MS[attempt] ?? RECONNECT_CAP
          tracker.reconnectAttempt += 1
          if (tracker.reconnectTimer) clearTimeout(tracker.reconnectTimer)
          tracker.reconnectTimer = setTimeout(() => openOne(ticker), delay)
        }
      }
    }

    // Spin up one connection per ticker.
    for (const t of active) {
      let tracker = trackers.get(t)
      if (!tracker) {
        tracker = { es: null, reconnectTimer: null, reconnectAttempt: 0, closedManually: false }
        trackers.set(t, tracker)
      } else {
        // Reset for fresh open.
        tracker.closedManually = false
        tracker.reconnectAttempt = 0
      }
      openOne(t)
    }

    return () => {
      // Close every tracker; clear timers.
      for (const tracker of trackers.values()) {
        tracker.closedManually = true
        if (tracker.reconnectTimer) {
          clearTimeout(tracker.reconnectTimer)
          tracker.reconnectTimer = null
        }
        if (tracker.es) {
          try { tracker.es.close() } catch { /* already closed */ }
          tracker.es = null
        }
      }
      trackers.clear()
    }
    // activeKey is a stable string fingerprint; supported is constant per
    // browser. We don't want to thrash on every render — only on actual
    // ticker-list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, supported])

  return {
    quotes,
    connections,
    marketOpen,
    supported,
    active: active.length,
    dropped,
  }
}
