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

const yahooFinance = new YahooFinance()

const QUOTE_INTERVAL_MS = 15_000   // 15 s
const HEARTBEAT_INTERVAL_MS = 30_000  // 30 s
const STREAM_AUTO_CLOSE_MS = 10 * 60 * 1000  // 10 minutes

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
  { params }: { params: { ticker: string } }
): Promise<Response> {
  // Phase 13 S2: rate-limit SSE — connections are expensive (long-lived,
  // each consumes a serverless slot). Tighter than POST routes.
  const rateLimitResponse = applyRateLimit(req, 'stream', { maxRequests: 10, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  // Phase 13 S2 fix (F4.10 + F7.3): canonical normalizer with strict char
  // whitelist — was using yahooSymbolFromParam (only handled VIX).
  const symbol = normalizeTicker(params.ticker)
  if (!symbol) {
    return new Response(
      JSON.stringify({ error: 'Invalid ticker symbol' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Capture the request's AbortSignal so we can clean up when the client disconnects.
  // `req.signal` is aborted when the HTTP connection is dropped by the client.
  const clientSignal = req.signal

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s)

      let quoteTimer: ReturnType<typeof setInterval> | null = null
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let autoCloseTimer: ReturnType<typeof setTimeout> | null = null
      let closed = false

      function close() {
        if (closed) return
        closed = true
        if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null }
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
        if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null }
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

      // Auto-close after 10 minutes to prevent runaway connections.
      // Stored on autoCloseTimer so close() can clear it on early termination.
      autoCloseTimer = setTimeout(() => close(), STREAM_AUTO_CLOSE_MS)
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
