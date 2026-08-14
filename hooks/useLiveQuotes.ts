'use client'

/**
 * useLiveQuotes — multi-ticker live quotes over ONE multiplexed SSE stream.
 *
 * Phase 14 wave 38 built this as a fan-out: one EventSource per ticker.
 * 2026-08-14 replaced the fan-out with a single connection to /api/stream.
 *
 * WHY (the fan-out was measurably broken):
 *   • Browsers cap simultaneous HTTP/1.1 connections at ~6 per origin. The
 *     dashboard subscribes to 13 symbols (11 sector ETFs + SPY + QQQ), so
 *     only 6 streams ever opened — the status badge rendered "6/13 streams"
 *     and 7 sectors silently never went live.
 *   • Each stream pinned its own serverless invocation for up to the 300 s
 *     function ceiling: 13× the concurrency cost for the same data.
 *
 * Now: ONE EventSource → `/api/stream?tickers=…`, which emits one `quote`
 * event per ticker per poll tick (the payload already carries `ticker`, so
 * demultiplexing is just a map lookup) plus one aggregated `market_state`.
 * The server also makes ONE batched upstream quote call per tick instead of
 * 13 independent ones.
 *
 * The PUBLIC API of this hook is unchanged — `quotes`, `connections`,
 * `marketOpen`, `supported`, `active`, `dropped`, and the MAX_LIVE_STREAMS
 * export all keep their meaning. `connections` is now all-or-nothing (the
 * single transport is either up or down), which is exactly what the previous
 * per-ticker map degenerated to in practice.
 *
 * `marketOpen` is DERIVED, never latched: a per-symbol open map reduced with
 * `any()`. See the `openBySymbol` comment below for why the scalar version was
 * a one-way latch that left the dashboard claiming LIVE over a frozen tape.
 *
 * Guardrails:
 *   • MAX_LIVE_STREAMS = 20 — cap on symbols per connection. Bounds upstream
 *     work per stream; the server enforces the identical cap (see
 *     MAX_STREAM_TICKERS in app/api/stream/route.ts, pinned equal by test).
 *     Excess tickers are silently dropped (no error — the caller chose the
 *     list) and reported via `dropped`.
 *   • Tickers list passed by reference must be STABLE (memoised by the
 *     caller via useMemo or a constant). If the array identity changes every
 *     render, the effect tears down + reconnects every render.
 *   • parseLiveQuote (the singular hook's validator) is reused, so the same
 *     finite-price / non-empty-string gates apply at this layer too.
 *
 * The singular hook (useLiveQuote → /api/stream/[ticker]) is untouched and
 * still serves the per-symbol stock and sector pages.
 *
 * Reference: WHATWG HTML Living Standard §9.2 — Server-sent events;
 *            RFC 6202 §3 — Multiplexing constraints.
 */

import { useEffect, useRef, useState } from 'react'
import { parseLiveQuote, type LiveQuote } from './useLiveQuote'
import { normalizeTicker } from '@/lib/api/sanitize'

/** Cap on symbols carried by one multiplexed stream. */
export const MAX_LIVE_STREAMS = 20

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const
const RECONNECT_CAP = 8_000
/** Fallback reconnect delay when a `closing_soon` payload is unreadable. */
const CLOSING_SOON_FALLBACK_MS = 30_000
/** Upper bound on a server-suggested reconnect delay. */
const CLOSING_SOON_MAX_MS = 60_000

export interface UseLiveQuotesResult {
  /** Map of ticker → most recent quote, or null if none received yet. */
  quotes: Record<string, LiveQuote | null>
  /** Map of ticker → connection state (all true while the stream is OPEN). */
  connections: Record<string, boolean>
  /**
   * True when at least one SUBSCRIBED SYMBOL is currently reported open —
   * ANY-semantics, not ALL, so a 24/7 instrument keeps the dashboard live while
   * the equity session is shut. Derived from a per-symbol map (see
   * `openBySymbol` below), so it falls back to false as soon as every symbol
   * that has reported is closed. Symbols that have never reported are unknown
   * and never count as open; before the first report the map is empty and this
   * is false, which is the pre-2026-08-15 initial state.
   */
  marketOpen: boolean
  /** True if EventSource is available in this environment. */
  supported: boolean
  /** Number of tickers actually subscribed (after MAX_LIVE_STREAMS cap). */
  active: number
  /** Number of tickers DROPPED because they exceeded the cap. */
  dropped: number
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

  /**
   * Per-symbol open state — the source of the aggregate `marketOpen`.
   *
   * A symbol is a KEY here only once it has told us something; an absent key is
   * "unknown", never "open". The aggregate is `any(open)` so the multi-asset
   * intent survives (one live 24/7 symbol among closed equities ⇒ live), which
   * a single scalar cannot express.
   *
   * WHY A MAP RATHER THAN A SCALAR (DQ-1, 2026-08-15): this used to be a plain
   * `useState(false)` that only ever latched TRUE — `if (data.marketOpen)
   * setMarketOpen(true)` in the quote handler and the same in `market_state`,
   * with nothing anywhere setting it back. The server detects the open→closed
   * transition and emits `market_state {open:false}` for exactly this purpose;
   * the client threw it away, so a dashboard left open across 16:00 ET kept its
   * LIVE affordance lit over a frozen tape — and `app/page.tsx`'s MARKET CLOSED
   * branch was unreachable after any open tick.
   */
  const [openBySymbol, setOpenBySymbol] = useState<Record<string, boolean>>({})

  // Refs so the reconnect loop doesn't re-create on every render.
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const closedManuallyRef = useRef(false)

  useEffect(() => {
    if (!supported || activeKey.length === 0) return

    // Derived from the dep string, not from the render-scoped array, so the
    // effect body can't close over a stale identity.
    const subscribed = activeKey.split(',')

    // Demultiplex map: the SERVER normalizes symbols (e.g. `VIX` → `^VIX`),
    // so a payload's `ticker` may not be byte-identical to the key the caller
    // subscribed with. Mapping both forms back to the caller's key keeps
    // `quotes` addressable by exactly the strings that were passed in.
    const keyByServerSymbol = new Map<string, string>()
    for (const t of subscribed) {
      keyByServerSymbol.set(t, t)
      const normalized = normalizeTicker(t)
      if (normalized) keyByServerSymbol.set(normalized, t)
    }

    closedManuallyRef.current = false
    reconnectAttemptRef.current = 0

    // Reset state for the new ticker set (preserve quotes for tickers still in the list).
    setQuotes((prev) => {
      const next: Record<string, LiveQuote | null> = {}
      for (const t of subscribed) next[t] = prev[t] ?? null
      return next
    })
    setConnections(() => Object.fromEntries(subscribed.map((t) => [t, false])))
    // Same rule as quotes: keep what we know about tickers still in the list,
    // forget the rest. Dropping a still-subscribed symbol's state here would
    // flash the pill to CLOSED on every ticker-list edit.
    setOpenBySymbol((prev) => {
      const next: Record<string, boolean> = {}
      for (const t of subscribed) if (t in prev) next[t] = prev[t]
      return next
    })

    const setAllConnections = (value: boolean) =>
      setConnections(() => Object.fromEntries(subscribed.map((t) => [t, value])))

    const cleanupTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    /** Tear the current transport down and schedule a fresh one. */
    const reconnectAfter = (delayMs: number) => {
      cleanupTimer()
      reconnectTimerRef.current = setTimeout(() => {
        if (closedManuallyRef.current) return
        open()
      }, delayMs)
    }

    const open = () => {
      cleanupTimer()
      if (closedManuallyRef.current) return

      // encodeURIComponent escapes the commas; URLSearchParams on the server
      // decodes them back into the delimited list.
      const es = new EventSource(`/api/stream?tickers=${encodeURIComponent(subscribed.join(','))}`)
      esRef.current = es

      const dropTransport = () => {
        try { es.close() } catch { /* already closed */ }
        if (esRef.current === es) esRef.current = null
        setAllConnections(false)
      }

      es.onopen = () => {
        if (closedManuallyRef.current) return
        // One transport for every subscribed ticker: when it is OPEN, they
        // are all connected.
        setAllConnections(true)
        reconnectAttemptRef.current = 0  // reset backoff on successful connect
      }

      es.addEventListener('quote', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const raw = JSON.parse((evt as MessageEvent).data) as unknown
          const data = parseLiveQuote(raw)
          if (!data) return
          const key = keyByServerSymbol.get(data.ticker)
          if (!key) return  // not a symbol this hook subscribed to
          setQuotes((q) => ({ ...q, [key]: data }))
          // Authoritative for THIS symbol, in both directions.
          setOpenBySymbol((m) => (m[key] === data.marketOpen ? m : { ...m, [key]: data.marketOpen }))
        } catch (err) {
          console.warn('[useLiveQuotes] malformed quote payload', err)
        }
      })

      es.addEventListener('market_state', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { open?: unknown }
          if (typeof data.open !== 'boolean') return
          const open = data.open
          // The server computes ONE isMarketOpen() per tick and stamps that
          // same scalar onto every quote in the batch AND onto this event — so
          // it carries no per-symbol information, and it is NOT written over
          // the aggregate (that is the singular hook's pattern: correct for one
          // symbol, wrong for a multi-asset subscription). It is folded into
          // the map instead, for the symbols already in it.
          //
          // Applying it to those symbols is what actually breaks the latch:
          // once the session closes the server STOPS polling quotes
          // (app/api/stream/route.ts — `if (!open) return`), so this event is
          // the last word we get about every symbol. Without it their per-
          // symbol `true` would freeze and the aggregate would stay lit for as
          // long as the tab is open.
          //
          // Symbols that have never reported stay absent: an aggregated scalar
          // is not evidence that a particular symbol is trading.
          setOpenBySymbol((m) => {
            let changed = false
            const next: Record<string, boolean> = {}
            for (const sym of Object.keys(m)) {
              if (m[sym] !== open) changed = true
              next[sym] = open
            }
            return changed ? next : m
          })
        } catch {
          /* ignore — best-effort */
        }
      })

      // Server-initiated soft close warning: schedule a reconnect right
      // around when the server says it'll close.
      es.addEventListener('closing_soon', (evt) => {
        if (closedManuallyRef.current) return
        let delay = CLOSING_SOON_FALLBACK_MS
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { reconnectInMs?: number }
          if (typeof data.reconnectInMs === 'number' && data.reconnectInMs > 0) {
            delay = Math.min(data.reconnectInMs, CLOSING_SOON_MAX_MS)
          }
        } catch {
          // Unreadable payload — keep the fallback delay rather than skipping
          // the reconnect entirely.
        }
        cleanupTimer()
        reconnectTimerRef.current = setTimeout(() => {
          if (closedManuallyRef.current) return
          dropTransport()
          open()
        }, delay)
      })

      es.addEventListener('close', () => {
        if (closedManuallyRef.current) return
        dropTransport()
        reconnectAfter(500)
      })

      // Browser-side error (network blip, server killed, etc.). EventSource
      // auto-reconnects on its own for some cases, but readyState===CLOSED
      // means we need to rebuild it.
      es.onerror = () => {
        if (closedManuallyRef.current) return
        setAllConnections(false)
        if (es.readyState === EventSource.CLOSED) {
          if (esRef.current === es) esRef.current = null
          const attempt = Math.min(reconnectAttemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
          const delay = RECONNECT_BACKOFF_MS[attempt] ?? RECONNECT_CAP
          reconnectAttemptRef.current += 1
          reconnectAfter(delay)
        }
        // For OPEN/CONNECTING states the browser handles reconnect; just
        // surface the not-connected state.
      }
    }

    open()

    return () => {
      closedManuallyRef.current = true
      cleanupTimer()
      const es = esRef.current
      esRef.current = null
      if (es) {
        try { es.close() } catch { /* already closed */ }
      }
      setConnections(() => Object.fromEntries(subscribed.map((t) => [t, false])))
    }
    // activeKey is a stable string fingerprint; supported is constant per
    // browser. We don't want to thrash on every render — only on actual
    // ticker-list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, supported])

  // ANY-semantics, derived — never latched. An empty map (nothing has reported
  // yet) is false, which is the initial state the pill has always rendered.
  const marketOpen = Object.values(openBySymbol).some(Boolean)

  return {
    quotes,
    connections,
    marketOpen,
    supported,
    active: active.length,
    dropped,
  }
}
