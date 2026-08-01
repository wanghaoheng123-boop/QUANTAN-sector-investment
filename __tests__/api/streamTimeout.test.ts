/**
 * Regression lock for the SSE soft-close budget (2026-07-28).
 *
 * Production observed 13 × `Vercel Runtime Timeout Error: Task timed out after
 * 300 seconds` on /api/stream/[ticker]. Root cause: the route hard-coded a
 * 9-minute soft close against a stale "Vercel Pro = 10 minute timeout"
 * assumption, while the platform default is 300 s on all plans. The soft close
 * (and its `closing_soon` warning) was therefore scheduled ~3.5 minutes AFTER
 * the function had already been killed — the graceful-close path never ran, so
 * clients were dropped with no flush and no reconnect cue.
 *
 * These assertions bind to the REAL constants the route consumes (via the
 * shared SSOT in lib/api/streamBudget.ts), and lock the ORDERING INVARIANT
 * rather than only the literals: the numbers may be tuned, but the soft close
 * can never again be scheduled past the platform ceiling.
 */
import { describe, it, expect } from 'vitest'
import {
  STREAM_MAX_DURATION_S,
  STREAM_AUTO_CLOSE_MS,
  STREAM_CLOSE_WARN_LEAD_MS,
} from '@/lib/api/streamBudget'

const CEILING_MS = STREAM_MAX_DURATION_S * 1000
const WARN_AT_MS = STREAM_AUTO_CLOSE_MS - STREAM_CLOSE_WARN_LEAD_MS

describe('SSE stream close budget vs the Vercel function ceiling', () => {
  it('declares a finite, positive maxDuration within the platform ceiling', () => {
    expect(Number.isFinite(STREAM_MAX_DURATION_S)).toBe(true)
    expect(STREAM_MAX_DURATION_S).toBeGreaterThan(0)
    // A larger value would be silently clamped by the platform, reintroducing
    // exactly the drift this module exists to prevent.
    expect(STREAM_MAX_DURATION_S).toBeLessThanOrEqual(300)
  })

  it('THE INVARIANT: soft close fires strictly before the platform kill', () => {
    expect(STREAM_AUTO_CLOSE_MS).toBeLessThan(CEILING_MS)
  })

  it('leaves at least a full warn-lead of headroom for the close event to flush', () => {
    expect(CEILING_MS - STREAM_AUTO_CLOSE_MS).toBeGreaterThanOrEqual(STREAM_CLOSE_WARN_LEAD_MS)
  })

  it('the closing_soon warning fires before the soft close, with the full lead', () => {
    expect(WARN_AT_MS).toBeGreaterThan(0)
    expect(WARN_AT_MS).toBeLessThan(STREAM_AUTO_CLOSE_MS)
    expect(STREAM_AUTO_CLOSE_MS - WARN_AT_MS).toBe(STREAM_CLOSE_WARN_LEAD_MS)
  })

  it('the whole warn → close sequence completes inside the ceiling', () => {
    expect(WARN_AT_MS + STREAM_CLOSE_WARN_LEAD_MS).toBeLessThan(CEILING_MS)
  })

  it('pins the current derived values (300 s ceiling, 270 s soft close, 240 s warning)', () => {
    expect(STREAM_MAX_DURATION_S).toBe(300)
    expect(STREAM_AUTO_CLOSE_MS).toBe(270_000)
    expect(WARN_AT_MS).toBe(240_000)
    // The pre-fix value that caused the incident must never come back.
    expect(STREAM_AUTO_CLOSE_MS).not.toBe(9 * 60 * 1000)
  })

  it('the route re-exports the same ceiling as its Next.js maxDuration', async () => {
    const route = await import('@/app/api/stream/[ticker]/route')
    expect(route.maxDuration).toBe(STREAM_MAX_DURATION_S)
  })
})
