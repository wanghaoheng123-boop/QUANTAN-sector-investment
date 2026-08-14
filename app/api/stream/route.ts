/**
 * Multiplexed SSE streaming endpoint — one connection, many tickers.
 *
 * GET /api/stream?tickers=XLK,XLE,SPY,…
 *
 * WHY THIS EXISTS (2026-08-14)
 * ────────────────────────────
 * The dashboard subscribes to 13 symbols (11 GICS sector ETFs + SPY + QQQ).
 * With the per-ticker route (/api/stream/[ticker]) that meant 13 EventSource
 * connections, and two things went wrong:
 *
 *   1. Browsers cap simultaneous HTTP/1.1 connections at ~6 per origin, so
 *      only 6 of the 13 streams ever opened — the badge literally rendered
 *      "6/13 streams" and 7 sectors silently never went live.
 *   2. Every open stream pins its OWN serverless invocation for up to the
 *      300 s function ceiling. 13 streams × N users is 13× the concurrency
 *      bill for the same data.
 *
 * One multiplexed stream fixes both: 1 connection, 1 invocation, 1 batched
 * upstream quote call per poll tick instead of 13 separate ones.
 *
 * ADDITIVE — /api/stream/[ticker] is untouched and still serves the singular
 * consumers (app/sector/[slug], app/stock/[ticker] via hooks/useLiveQuote).
 *
 * Emits Server-Sent Events (same wire format as the singular route; the
 * `quote` payload already carries `ticker`, which is what lets a client
 * demultiplex):
 *   - "quote"        one event PER TICKER per poll tick
 *   - "market_state" ONE aggregated open/closed state (initial + transitions)
 *   - "heartbeat"    every 30 s (keep-alive)
 *   - "closing_soon" / "close" — timed from lib/api/streamBudget.ts
 *   - "degraded"     when a whole batch fetch fails
 *
 * Vercel compatible: uses ReadableStream (Web Streams API), no Node streams.
 */

import { isMarketOpen } from '@/lib/api/marketHours'
import { applyRateLimit } from '@/lib/api/rateLimit'
import YahooFinance from 'yahoo-finance2'
import { withRetry } from '@/lib/api/reliability'
import { STREAM_AUTO_CLOSE_MS, STREAM_CLOSE_WARN_LEAD_MS } from '@/lib/api/streamBudget'
import { parseTickerParam } from '@/lib/api/streamTickers'

const yahooFinance = new YahooFinance()

/**
 * Vercel function timeout for this route, in SECONDS (Next.js route segment
 * config). Same budget and the same hard-won constraint as the singular
 * route — see lib/api/streamBudget.ts for the incident write-up.
 *
 * MUST BE A LITERAL. Next.js reads route segment config by STATIC ANALYSIS at
 * build time, so `= STREAM_MAX_DURATION_S` fails the build with
 * `Unknown identifier "STREAM_MAX_DURATION_S" at "maxDuration"` — a failure
 * neither tsc nor vitest can catch. __tests__/api/streamMultiplex.test.ts
 * asserts this export equals the SSOT so the two can never diverge.
 */
export const maxDuration = 300

// NOTE: `maxDuration` and the HTTP method handlers are the ONLY things this
// file may export. Next.js type-checks the route's export surface at build
// time and rejects anything else ("X is not a valid Route export field") —
// which is why the ticker cap and the parser live in
// lib/api/streamTickers.ts. tsc and vitest both pass with the extra exports
// in place; only the Next build catches it.

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

/** Minimal structural view of a yahoo-finance2 quote row (validateResult: false). */
interface RawQuoteRow {
  symbol?: unknown
  regularMarketPrice?: unknown
  regularMarketChange?: unknown
  regularMarketChangePercent?: unknown
  regularMarketVolume?: unknown
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/**
 * ONE batched upstream call for the whole subscription.
 *
 * yahoo-finance2's `quote()` accepts an array and returns an array (a single
 * object when one symbol is requested — see app/api/prices/route.ts for the
 * same shape guard). Results are matched back BY SYMBOL, never by index:
 * Yahoo does not guarantee one row per requested symbol nor stable ordering,
 * so index-matching would silently mislabel prices.
 *
 * `validateResult: false` matches the singular route — without it a schema
 * mismatch on ONE symbol throws and blanks the entire batch.
 *
 * Never throws: a rejected promise inside the setInterval callback below
 * would surface as an unhandled rejection (the interval callback is async and
 * nothing awaits it), so failures are logged and reported as an empty batch.
 */
async function fetchQuotes(symbols: readonly string[]): Promise<QuoteEvent[]> {
  try {
    const raw = await withRetry(
      () => yahooFinance.quote([...symbols], undefined, { validateResult: false }),
      { attempts: 2, timeoutMs: 7000, retryLabel: 'stream quote batch' },
    )
    const rows: RawQuoteRow[] = Array.isArray(raw) ? raw : raw ? [raw] : []
    const marketOpen = isMarketOpen()
    const timestamp = new Date().toISOString()
    const out: QuoteEvent[] = []
    for (const row of rows) {
      if (!row) continue
      const symbol = typeof row.symbol === 'string' && row.symbol.length > 0 ? row.symbol : null
      const price = finite(row.regularMarketPrice)
      if (!symbol || price == null) continue
      out.push({
        ticker: symbol,
        price,
        change: finite(row.regularMarketChange) ?? 0,
        changePct: finite(row.regularMarketChangePercent) ?? 0,
        volume: finite(row.regularMarketVolume) ?? undefined,
        marketOpen,
        timestamp,
      })
    }
    return out
  } catch (err) {
    // Mirrors the singular route's diagnostic: a silent catch left operators
    // with no signal when stream quotes started failing (Phase 13 S2).
    console.warn('[stream:multi] batch quote fetch failed for', symbols.join(','), err)
    return []
  }
}

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function jsonError(error: string, message: string): Response {
  return new Response(
    JSON.stringify({ error, message }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}

export async function GET(req: Request): Promise<Response> {
  // Validate BEFORE the rate limit (same ordering rationale as the singular
  // route): invalid-ticker probes return 400 without consuming a token from
  // the IP's bucket.
  const parsed = parseTickerParam(new URL(req.url).searchParams.get('tickers'))
  if (!parsed.ok) return jsonError(parsed.error, parsed.message)
  const symbols = parsed.symbols

  // SSE connections are expensive (long-lived, one serverless slot each).
  // Own bucket, separate from the singular route, so a dashboard reconnect
  // storm can't lock a user out of the per-ticker stock pages.
  const rateLimitResponse = await applyRateLimit(req, 'stream-multi', { maxRequests: 10, windowSeconds: 60 })
  if (rateLimitResponse) return rateLimitResponse

  // Aborted when the client drops the HTTP connection.
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

      /** Enqueue; returns false (and tears down) if the client is gone. */
      function emit(event: string, data: unknown): boolean {
        if (closed) return false
        try {
          controller.enqueue(encode(sseMessage(event, data)))
          return true
        } catch {
          close()
          return false
        }
      }

      // Stop all timers when the client disconnects. Without this the
      // interval callbacks keep running against a dead controller.
      if (clientSignal) {
        clientSignal.addEventListener('abort', () => close(), { once: true })
      }

      // Initial batch, emitted UNCONDITIONALLY — exactly like the singular
      // route. Outside market hours the client still needs the last close to
      // render, and the poll below is what's gated on market hours.
      const initial = await fetchQuotes(symbols)
      if (closed) return
      if (initial.length > 0) {
        for (const q of initial) {
          if (!emit('quote', q)) return
        }
      } else {
        if (!emit('degraded', {
          code: 'initial_quote_unavailable',
          message: 'Initial quote fetch failed, continuing heartbeat stream.',
          timestamp: new Date().toISOString(),
        })) return
      }

      // ONE aggregated market_state for the whole subscription (the singular
      // route emits per-connection state; multiplexed, it is emitted once up
      // front and then only on transition).
      let lastMarketOpen = isMarketOpen()
      if (!emit('market_state', { open: lastMarketOpen, timestamp: new Date().toISOString() })) return

      // The quote timer is ALWAYS armed and the market-hours check lives
      // INSIDE it — a client connecting pre-market (09:25 ET) must start
      // receiving quotes when the bell rings, not stay dead for the whole
      // connection (Phase 13 S2 regression on the singular route).
      quoteTimer = setInterval(async () => {
        if (closed) return
        const open = isMarketOpen()
        if (open !== lastMarketOpen) {
          lastMarketOpen = open
          if (!emit('market_state', { open, timestamp: new Date().toISOString() })) return
        }
        if (!open) return  // skip the upstream fetch outside market hours
        const batch = await fetchQuotes(symbols)
        if (closed) return
        for (const q of batch) {
          if (!emit('quote', q)) return
        }
      }, QUOTE_INTERVAL_MS)

      heartbeatTimer = setInterval(() => {
        emit('heartbeat', { ts: new Date().toISOString() })
      }, HEARTBEAT_INTERVAL_MS)

      // Server-initiated soft close with pre-close warning, timed from the
      // streamBudget SSOT. The close timer is CHAINED INSIDE the warn handler
      // so warn-then-close ordering is guaranteed structurally rather than by
      // wall-clock comparison (P15-NEW-7: under clock skew two independently
      // armed timers could fire out of order).
      closeWarnTimer = setTimeout(() => {
        if (closed) return
        emit('closing_soon', {
          message: 'Stream will auto-close shortly. Reconnect to continue.',
          reconnectInMs: STREAM_CLOSE_WARN_LEAD_MS,
          timestamp: new Date().toISOString(),
        })
        autoCloseTimer = setTimeout(() => {
          if (closed) return
          emit('close', {
            reason: 'auto_close_max_duration',
            timestamp: new Date().toISOString(),
          })
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
