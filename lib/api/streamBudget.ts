/**
 * SSOT for the SSE stream close budget (/api/stream/[ticker]).
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * The route's soft close must fire strictly BEFORE Vercel terminates the
 * function, otherwise the graceful-close path (`closing_soon` → `close` →
 * flush) never runs and the client is dropped mid-stream.
 *
 * That invariant was previously split across two systems: the route hard-coded
 * a 9-minute soft close against a stale "Vercel Pro = 10 minute timeout"
 * assumption, while the platform default is 300 s on ALL plans. The soft close
 * was therefore scheduled ~3.5 minutes after the function had already been
 * killed — dead code in production, surfacing as repeated
 * `Vercel Runtime Timeout Error: Task timed out after 300 seconds`
 * (observed 2026-07-28: 13 occurrences on /api/stream/[ticker]).
 *
 * Keeping the numbers here — derived, not duplicated — lets the regression
 * suite assert the ordering invariant against the REAL values the route uses,
 * so the budget can be tuned but can never drift past the ceiling again.
 */

/**
 * Vercel function timeout for the stream route, in SECONDS.
 * Re-exported by the route as `maxDuration` (a Next.js route segment config).
 * 300 s is the current platform default/ceiling; a larger value would be
 * silently clamped and reintroduce the original bug.
 */
export const STREAM_MAX_DURATION_S = 300

/** Emit `closing_soon` this long before the soft close so the UI can pre-warm a reconnect. */
export const STREAM_CLOSE_WARN_LEAD_MS = 30_000

/**
 * Server-initiated soft close. Derived so a full warn-lead of headroom remains
 * inside the platform ceiling for the close event to be emitted and flushed.
 */
export const STREAM_AUTO_CLOSE_MS =
  STREAM_MAX_DURATION_S * 1000 - STREAM_CLOSE_WARN_LEAD_MS
