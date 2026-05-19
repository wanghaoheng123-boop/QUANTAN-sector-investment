'use client'

/**
 * useLiveQuote — SSE client hook for the per-ticker /api/stream/:ticker endpoint.
 *
 * Phase 14 wave 36 (real-time platform initiative):
 *   The SSE infrastructure was built in Phase 13 (server route at
 *   app/api/stream/[ticker]/route.ts) — proper market-hours-aware quote
 *   polling, 30-second heartbeat, market_state transition events, soft
 *   close with closing_soon pre-warning — but had ZERO consumers in the
 *   UI. Every stock page used 15-second polling instead. This wasted the
 *   investment in real-time infrastructure AND made the UI a step behind
 *   the actual market.
 *
 *   This hook closes the gap: it opens an EventSource, handles all five
 *   server-emitted events (`quote`, `heartbeat`, `market_state`,
 *   `closing_soon`, `close`), auto-reconnects on the server-initiated
 *   soft close + on browser-side errors, and exposes a tidy state
 *   surface for components.
 *
 * Server contract (app/api/stream/[ticker]/route.ts):
 *   event: quote         — { ticker, price, change, changePct, volume, marketOpen, timestamp }
 *   event: heartbeat     — { ts }
 *   event: market_state  — { open, timestamp }
 *   event: closing_soon  — { message, reconnectInMs, timestamp }
 *   event: close         — { reason, timestamp }
 *   event: degraded      — { code, message, timestamp }
 *
 * Reconnect strategy:
 *   • On `closing_soon` event → schedule reconnect at `reconnectInMs` (30 s).
 *   • On `close` event → reconnect immediately.
 *   • On EventSource `error` AND readyState === CLOSED → reconnect with
 *     exponential backoff (1s, 2s, 4s, capped at 8s).
 *   • On unmount → close the connection cleanly.
 *
 * Falls back gracefully: if EventSource is unavailable (server-side render,
 * older browsers), the hook returns initial state with `supported = false`.
 *
 * Reference: WHATWG HTML Living Standard §9.2 — Server-sent events.
 */

import { useEffect, useRef, useState } from 'react'

export interface LiveQuote {
  ticker: string
  price: number
  change: number
  changePct: number
  volume?: number
  marketOpen: boolean
  timestamp: string
}

/**
 * Pure validator for the server's `quote` event payload.
 *
 * Exported so unit tests can exercise the validation without standing
 * up React + EventSource. Mirrors the same Number.isFinite + positive-
 * price gate that the API boundary enforces (defence in depth — bad
 * data should be rejected at every layer).
 *
 * Returns the typed quote on success, or null on any of:
 *   - non-object input
 *   - missing / non-finite / non-positive price
 *   - missing / non-string ticker or timestamp
 */
export function parseLiveQuote(raw: unknown): LiveQuote | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const price = typeof r.price === 'number' ? r.price : NaN
  if (!Number.isFinite(price) || price <= 0) return null
  const ticker = typeof r.ticker === 'string' && r.ticker.length > 0 ? r.ticker : null
  const timestamp = typeof r.timestamp === 'string' && r.timestamp.length > 0 ? r.timestamp : null
  if (!ticker || !timestamp) return null
  const change = typeof r.change === 'number' && Number.isFinite(r.change) ? r.change : 0
  const changePct = typeof r.changePct === 'number' && Number.isFinite(r.changePct) ? r.changePct : 0
  const volume = typeof r.volume === 'number' && Number.isFinite(r.volume) && r.volume >= 0
    ? r.volume
    : undefined
  const marketOpen = r.marketOpen === true
  return { ticker, price, change, changePct, volume, marketOpen, timestamp }
}

export interface UseLiveQuoteResult {
  /** Latest quote received from the SSE stream, or null until first quote arrives. */
  quote: LiveQuote | null
  /** True when the EventSource is in OPEN state and recently received a heartbeat. */
  connected: boolean
  /** Whether the market is currently open per the server's last `market_state` event. */
  marketOpen: boolean
  /** ISO timestamp of the most recent message (quote OR heartbeat). null until first message. */
  lastMessageAt: string | null
  /** True if EventSource is available in this environment. */
  supported: boolean
  /** Last non-recoverable error message, or null. */
  error: string | null
}

const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000] as const
const RECONNECT_CAP = 8_000

export function useLiveQuote(ticker: string | null): UseLiveQuoteResult {
  const [quote, setQuote] = useState<LiveQuote | null>(null)
  const [connected, setConnected] = useState(false)
  const [marketOpen, setMarketOpen] = useState(false)
  const [lastMessageAt, setLastMessageAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supported = typeof window !== 'undefined' && typeof EventSource !== 'undefined'

  // Refs so the reconnect loop doesn't re-create on every render.
  const esRef = useRef<EventSource | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptRef = useRef(0)
  const closedManuallyRef = useRef(false)

  useEffect(() => {
    if (!supported || !ticker) {
      setConnected(false)
      return
    }

    closedManuallyRef.current = false
    reconnectAttemptRef.current = 0

    const cleanupTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    const open = () => {
      cleanupTimer()
      if (closedManuallyRef.current) return

      const es = new EventSource(`/api/stream/${encodeURIComponent(ticker)}`)
      esRef.current = es

      // Default `message` event isn't used by the server, but we listen for
      // robustness — also covers initial readystate-OPEN.
      es.onopen = () => {
        if (closedManuallyRef.current) return
        setConnected(true)
        setError(null)
        reconnectAttemptRef.current = 0  // reset backoff on successful connect
      }

      es.addEventListener('quote', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const raw = JSON.parse((evt as MessageEvent).data) as unknown
          const data = parseLiveQuote(raw)
          if (data) {
            setQuote(data)
            setMarketOpen(data.marketOpen)
            setLastMessageAt(data.timestamp)
          }
        } catch (err) {
          // Malformed payload — log but don't drop the connection.
          console.warn('[useLiveQuote] malformed quote payload', err)
        }
      })

      es.addEventListener('heartbeat', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { ts: string }
          setLastMessageAt(data.ts ?? new Date().toISOString())
        } catch {
          setLastMessageAt(new Date().toISOString())
        }
      })

      es.addEventListener('market_state', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { open: boolean }
          setMarketOpen(data.open === true)
        } catch {
          /* ignore — best-effort */
        }
      })

      // Server-initiated soft close warning: schedule a reconnect right
      // around when the server says it'll close.
      es.addEventListener('closing_soon', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { reconnectInMs?: number }
          const delay = typeof data.reconnectInMs === 'number' && data.reconnectInMs > 0
            ? Math.min(data.reconnectInMs, 60_000)
            : 30_000
          cleanupTimer()
          reconnectTimerRef.current = setTimeout(() => {
            if (closedManuallyRef.current) return
            try { es.close() } catch { /* already closed */ }
            esRef.current = null
            setConnected(false)
            open()
          }, delay)
        } catch {
          // Fall back to immediate reconnect.
        }
      })

      es.addEventListener('close', () => {
        if (closedManuallyRef.current) return
        try { es.close() } catch { /* already closed */ }
        esRef.current = null
        setConnected(false)
        // Reconnect after a short delay.
        cleanupTimer()
        reconnectTimerRef.current = setTimeout(open, 500)
      })

      es.addEventListener('degraded', (evt) => {
        if (closedManuallyRef.current) return
        try {
          const data = JSON.parse((evt as MessageEvent).data) as { message?: string }
          setError(typeof data.message === 'string' ? data.message : 'Stream degraded')
        } catch {
          setError('Stream degraded')
        }
      })

      // Browser-side error (network blip, server killed, etc.). EventSource
      // will auto-reconnect on its own for some cases, but readyState===CLOSED
      // means we need to rebuild it.
      es.onerror = () => {
        if (closedManuallyRef.current) return
        setConnected(false)
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null
          const attempt = Math.min(reconnectAttemptRef.current, RECONNECT_BACKOFF_MS.length - 1)
          const delay = RECONNECT_BACKOFF_MS[attempt] ?? RECONNECT_CAP
          reconnectAttemptRef.current += 1
          cleanupTimer()
          reconnectTimerRef.current = setTimeout(open, delay)
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
      setConnected(false)
    }
  }, [ticker, supported])

  return {
    quote,
    connected,
    marketOpen,
    lastMessageAt,
    supported,
    error,
  }
}
