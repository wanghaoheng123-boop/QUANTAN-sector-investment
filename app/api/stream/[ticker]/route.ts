/**
 * SSE streaming endpoint — real-time price + signal updates.
 *
 * GET /api/stream/:ticker
 *
 * Emits Server-Sent Events:
 *   - "quote"  every 15 s during market hours (or immediately when first connected)
 *   - "signal" when the last computed signal changes
 *   - "heartbeat" every 30 s (keep-alive)
 *
 * Market hours: Mon–Fri 09:30–16:00 ET (UTC-4/UTC-5 depending on DST).
 * Outside market hours, emits one snapshot then switches to heartbeat-only.
 *
 * Vercel compatible: uses ReadableStream (Web Streams API), no Node.js streams.
 */

import { normalizeTicker, sanitizeError } from '@/lib/api/sanitize'
import { isMarketOpen } from '@/lib/api/marketHours'
import { applyRateLimit } from '@/lib/api/rateLimit'
import YahooFinance from 'yahoo-finance2'
import { withRetry } from '@/lib/api/reliability'
import {
  STREAM_MAX_DURATION_S,
  STREAM_AUTO_CLOSE_MS,
  STREAM_CLOSE_WARN_LEAD_MS,
} from '@/lib/api/streamBudget'

const yahooFinance = new YahooFinance()

/**
 * Vercel function timeout for this route, in SECONDS (Next.js route segment
 * config). Declared EXPLICITLY rather than inheriting the platform default,
 * and sourced from the same module as the soft-close budget so the two can
 * never drift apart again — see lib/api/streamBudget.ts for the incident that
 * motivated this (soft close scheduled ~3.5 min AFTER the function was killed,
 * making the whole graceful-close path dead code in production).
 */
export const maxDuration = STREAM_MAX_DURATION_S

const QUOTE_INTERVAL_MS = 15_000     // 15 s
const HEARTBEAT_INTERVAL_MS = 30_000 // 30 s

interface QuoteEvent {
  ticker: string
  price: number
  change: number
  changePct: number
  volume?: number
  marketOpen: boolean
  timestamp: string
}

async function fetchQuote(symbol: string): Promise<QuoteEvent | null> {
  try {
    const q = await withRetry(
      () => yahooFinance.quote(symbol, undefined, { validateResult: false }),
      { attempts: 2, timeoutMs: 6000, retryLabel: 'stream quote' }
    )
    if (!q || q.regularMarketPrice == null) return null
    return {
      ticker: symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
      volume: q.regularMarketVolume ?? undefined,
      marketOpen: isMarketOpen(),
      timestamp: new Date().toISOString(),
    }
  } catch (err) {
    // Phase 13 S2 fix: previously a silent catch — operators had no diagnostic
    // when stream quotes started failing.
    console.warn('[stream] quote fetch failed for', symbol, err)
    return null
  }
}

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<Response> {
  // Fix (api-resilience): validate ticker BEFORE applying the rate limit so
  // invalid-ticker probes (e.g. port-scanner noise, path-traversal attempts)
  // return 400 without consuming a token from the IP's bucket.
  const { ticker: tickerParam } = await params
  // Phase 13 S2 fix (F4.10 + F7.3): canonical normalizer with strict char
  // whitelist — was using yahooSymbolFromParam (only handled VIX).
  const symbol = normalizeTicker(tickerParam)
  if (!symbol) {
    return new Response(
      JSON.stringify({ error: 'Invalid ticker symbol' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Phase 13 S2: rate-limit SSE — connections are expensive (long-lived,
  // each consumes a serverless slot). Tighter than POST routes.
  // Applied after ticker validation so invalid probes don't drain the bucket.
  const rateLimitResponse = await applyRateLimit(req, 'stream', { maxRequests: 10, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  // Capture the request's AbortSignal so we can clean up when the client disconnects.
  // `req.signal` is aborted when the HTTP connection is dropped by the client.
  const clientSignal = req.signal

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s)

      let quoteTimer: ReturnType<typeof setInterval> | null = null
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
      let closeWarnTimer: ReturnType<typeof setTimeout> | null = null
      let closed = false

      function close() {
        if (closed) return
        closed = true
        if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
        if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null }
        if (closeWarnTimer) { clearTimeout(closeWarnTimer); closeWarnTimer = null }
        try { controller.close() } catch { /* already closed */ }
      }

      // Stop all timers when the client disconnects (request AbortSignal).
      // Without this, setInterval callbacks keep running after the client drops.
      if (clientSignal) {
        clientSignal.addEventListener('abort', () => close(), { once: true })
      }

      // Emit initial quote immediately
      const initial = await fetchQuote(symbol)
      if (closed) return
      if (initial) {
        try {
          controller.enqueue(encode(sseMessage('quote', initial)))
        } catch {
          close()
          return
        }
      } else {
        try {
          controller.enqueue(encode(sseMessage('degraded', {
            code: 'initial_quote_unavailable',
            message: 'Initial quote fetch failed, continuing heartbeat stream.',
            timestamp: new Date().toISOString(),
          })))
        } catch {
          close()
          return
        }
      }

      // Phase 13 S2 fix: market-hours quote polling MUST always be armed
      // (not gated by `isMarketOpen()` at start). Previously a client
      // connecting pre-market (e.g. 9:25am ET) never received quote events
      // even after the market opened at 9:30 — the gate at connection time
      // permanently disabled the quote timer. Now the timer fires every
      // QUOTE_INTERVAL_MS unconditionally, and the inner check decides
      // whether to actually fetch + emit a quote OR skip silently.
      let lastMarketOpen = isMarketOpen()
      quoteTimer = setInterval(async () => {
        if (closed) return
        const open = isMarketOpen()
        // Notify client when market state transitions (open → close → open)
        // so the UI can re-render the "DELAYED" / "LIVE" badge instead of
        // assuming the initial-connection state forever.
        if (open !== lastMarketOpen) {
          lastMarketOpen = open
          try {
            controller.enqueue(encode(sseMessage('market_state', {
              open,
              timestamp: new Date().toISOString(),
            })))
          } catch {
            close()
            return
          }
        }
        if (!open) return  // skip the fetch outside market hours
        const q = await fetchQuote(symbol)
        if (closed) return
        if (q) {
          try { controller.enqueue(encode(sseMessage('quote', q))) }
          catch { close() }
        }
      }, QUOTE_INTERVAL_MS)

      // Heartbeat to keep connection alive
      heartbeatTimer = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encode(sseMessage('heartbeat', { ts: new Date().toISOString() })))
        } catch {
          close()
        }
      }, HEARTBEAT_INTERVAL_MS)

      // R4-C-3 (Phase 14 S1): server-initiated soft close with pre-close warning.
      //
      // Previously, a single hard close raced against the Vercel function
      // timeout — whichever fired first, the client saw an abrupt drop with no
      // chance to reconnect cleanly. Now:
      //   • At T - 30 s, emit `closing_soon` so the UI can pre-warm a reconnect.
      //   • At T, emit `close` then controller.close().
      // T is derived from `maxDuration` (see the top of this file), so the whole
      // sequence completes a full warn-lead inside the platform ceiling.
      //
      // P15-NEW-7 (Phase 15, 2026-05-23): unify the two chained setTimeouts
      // into a single warn-then-close timer. Prior code armed `closeWarnTimer`
      // and `autoCloseTimer` independently — under clock skew (NTP adjust,
      // system suspend resume, container migration) the autoclose could fire
      // BEFORE the warn, so a client never saw `closing_soon` and reconnected
      // late. With a single sequence, the warn-then-close ordering is
      // guaranteed by structured-construction, not by wall-clock comparison.
      closeWarnTimer = setTimeout(() => {
        if (closed) return
        try {
          controller.enqueue(encode(sseMessage('closing_soon', {
            message: 'Stream will auto-close shortly. Reconnect to continue.',
            reconnectInMs: STREAM_CLOSE_WARN_LEAD_MS,
            timestamp: new Date().toISOString(),
          })))
        } catch { /* client already gone; close() will handle it */ }
        // Inner timer — chained inside the warn handler so the order is
        // structurally guaranteed: closing_soon emit → wait warn-lead →
        // close emit + close(). Reassigning `autoCloseTimer` keeps the
        // `close()` cleanup loop unchanged.
        autoCloseTimer = setTimeout(() => {
          if (closed) return
          try {
            controller.enqueue(encode(sseMessage('close', {
              reason: 'auto_close_max_duration',
              timestamp: new Date().toISOString(),
            })))
          } catch { /* ignore */ }
          close()
        }, STREAM_CLOSE_WARN_LEAD_MS)
      }, STREAM_AUTO_CLOSE_MS - STREAM_CLOSE_WARN_LEAD_MS)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',  // Disable nginx buffering
    },
  })
}
