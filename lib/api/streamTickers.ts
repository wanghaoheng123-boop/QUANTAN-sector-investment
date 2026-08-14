/**
 * Ticker-list parsing for the multiplexed SSE endpoint (/api/stream).
 *
 * WHY THIS IS A LIB MODULE AND NOT PART OF THE ROUTE
 * ──────────────────────────────────────────────────
 * Next.js validates the export surface of `route.ts` by STATIC ANALYSIS at
 * build time: only HTTP method handlers and known route segment config fields
 * (`maxDuration`, `dynamic`, `runtime`, …) may be exported. A helper exported
 * for testability fails the build with
 *   `Type error: Route "app/api/stream/route.ts" does not match the required
 *    types of a Next.js Route. "parseTickerParam" is not a valid Route export
 *    field.`
 * — and, exactly like the `maxDuration`-must-be-a-literal constraint next
 * door in streamBudget.ts, NEITHER tsc NOR vitest catches it. Only the
 * Next/Vercel build does. (Observed 2026-08-14, first build of this route.)
 *
 * So the pure, unit-testable logic lives here and the route imports it.
 */

import { normalizeTicker } from '@/lib/api/sanitize'

/**
 * Max symbols accepted on one multiplexed connection.
 *
 * Mirrors MAX_LIVE_STREAMS in hooks/useLiveQuotes.ts (the client-side cap);
 * __tests__/api/streamMultiplex.test.ts pins the two equal so a client that
 * respects its own cap can never be rejected by the server. Bounds upstream
 * work per connection — OWASP API4:2023 (Unrestricted Resource Consumption).
 *
 * Defined HERE rather than imported from the hook: that module is
 * `'use client'` and must not be pulled into a route handler's server bundle.
 */
export const MAX_STREAM_TICKERS = 20

export type TickerParamResult =
  | { ok: true; symbols: string[] }
  | { ok: false; error: string; message: string }

/**
 * Parse + validate the `tickers` query parameter.
 *
 * Returns the normalized, de-duplicated symbol list, or an error envelope.
 *
 * STRICT: any token that fails the shared TICKER_REGEX whitelist rejects the
 * WHOLE request rather than being silently dropped. A client asking for a
 * symbol it will never receive quotes for should learn that immediately
 * instead of getting 12 of 13 streams and no explanation, and it keeps
 * path-traversal-shaped probes (`../etc`) out of the upstream call.
 *
 * Ordering note: the route runs this BEFORE the rate limiter, so invalid
 * probes return 400 without consuming a token from the IP's bucket — the same
 * deliberate ordering as app/api/stream/[ticker]/route.ts.
 */
export function parseTickerParam(rawParam: string | null): TickerParamResult {
  if (rawParam == null || rawParam.trim().length === 0) {
    return {
      ok: false,
      error: 'missing_tickers',
      message: 'Query parameter `tickers` is required (comma-separated symbols).',
    }
  }
  const tokens = rawParam.split(',')
  if (tokens.length > MAX_STREAM_TICKERS) {
    return {
      ok: false,
      error: 'too_many_tickers',
      message: `Maximum ${MAX_STREAM_TICKERS} tickers per stream.`,
    }
  }
  const symbols: string[] = []
  for (const token of tokens) {
    const normalized = normalizeTicker(token)
    if (!normalized) {
      return {
        ok: false,
        error: 'invalid_ticker',
        message: 'One or more ticker symbols are invalid.',
      }
    }
    if (!symbols.includes(normalized)) symbols.push(normalized)
  }
  return { ok: true, symbols }
}
