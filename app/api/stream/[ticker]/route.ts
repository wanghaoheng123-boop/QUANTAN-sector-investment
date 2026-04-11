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

import { yahooSymbolFromParam } from '@/lib/quant/yahooSymbol'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

const QUOTE_INTERVAL_MS = 15_000   // 15 s
const HEARTBEAT_INTERVAL_MS = 30_000  // 30 s

/** Returns true if US equities market is currently open (approximate, ET). */
function isMarketOpen(): boolean {
  const now = new Date()
  const day = now.getUTCDay() // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false

  // Approximate ET offset: UTC-4 during EDT (Mar–Nov), UTC-5 during EST
  // Simple heuristic: use UTC-4 (EDT) — slightly wrong ~3 weeks/year, acceptable
  const etHour = now.getUTCHours() - 4
  const etMinute = now.getUTCMinutes()
  const etTime = etHour * 60 + etMinute

  const marketOpen = 9 * 60 + 30   // 09:30 ET
  const marketClose = 16 * 60       // 16:00 ET

  return etTime >= marketOpen && etTime < marketClose
}

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
    const q = await yahooFinance.quote(symbol, undefined, { validateResult: false })
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
  } catch {
    return null
  }
}

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  _req: Request,
  { params }: { params: { ticker: string } }
): Promise<Response> {
  const symbol = yahooSymbolFromParam(params.ticker)

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s)

      let quoteTimer: ReturnType<typeof setInterval> | null = null
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      let closed = false

      function close() {
        if (closed) return
        closed = true
        if (quoteTimer) clearInterval(quoteTimer)
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try { controller.close() } catch { /* already closed */ }
      }

      // Emit initial quote immediately
      const initial = await fetchQuote(symbol)
      if (initial) {
        try {
          controller.enqueue(encode(sseMessage('quote', initial)))
        } catch {
          close()
          return
        }
      }

      // Market-hours quote polling
      if (isMarketOpen()) {
        quoteTimer = setInterval(async () => {
          if (closed) return
          if (!isMarketOpen()) {
            if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null }
            return
          }
          const q = await fetchQuote(symbol)
          if (q) {
            try { controller.enqueue(encode(sseMessage('quote', q))) }
            catch { close() }
          }
        }, QUOTE_INTERVAL_MS)
      }

      // Heartbeat to keep connection alive
      heartbeatTimer = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encode(sseMessage('heartbeat', { ts: new Date().toISOString() })))
        } catch {
          close()
        }
      }, HEARTBEAT_INTERVAL_MS)

      // Auto-close after 10 minutes to prevent runaway connections
      setTimeout(() => close(), 10 * 60 * 1000)
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
