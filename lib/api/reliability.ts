import { NextResponse } from 'next/server'

type RetryOptions = {
  attempts?: number
  timeoutMs?: number
  retryLabel?: string
  /** Base backoff in ms for the first retry. Default 200ms. */
  backoffBaseMs?: number
  /** Max backoff in ms (cap on exponential growth). Default 2000ms. */
  backoffMaxMs?: number
  /**
   * Hook for tests / non-default jitter. Returns a number in [0, 1).
   * In production this defaults to Math.random.
   */
  rng?: () => number
  /** Sleep impl override (for tests). Default uses real setTimeout. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

/**
 * Computes exponential-backoff delay with full jitter (AWS-recommended
 * formula): delay = random(0, min(maxBackoff, base * 2^attempt)).
 *
 * Jitter prevents the "thundering herd" failure mode where many
 * concurrent retrying clients re-converge on the upstream at the same
 * time, perpetuating the original outage.
 *
 * Citation: Brooker, M. (2015). "Exponential Backoff and Jitter."
 *           AWS Architecture Blog. Recommends full jitter over capped
 *           exponential because it gives the lowest collision rate
 *           and the lowest p99 completion time under contention.
 */
export function backoffDelayMs(
  attemptIndex: number,
  baseMs = 200,
  maxMs = 2000,
  rng: () => number = Math.random,
): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attemptIndex))
  return Math.floor(rng() * exp)
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  const baseMs = Math.max(0, opts.backoffBaseMs ?? 200)
  const maxMs = Math.max(baseMs, opts.backoffMaxMs ?? 2000)
  const rng = opts.rng ?? Math.random
  const sleep = opts.sleep ?? defaultSleep
  let lastError: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), opts.timeoutMs ?? 8_000)
    } catch (error) {
      lastError = error
      // Don't sleep after the last attempt — we're about to throw.
      // This was previously a bug-shaped no-backoff loop: failures
      // were re-fired instantly, hammering the upstream and giving no
      // time for transient outages (DNS blip, brief 503, race-conditioned
      // rate-limit response) to self-heal. Full jitter prevents the
      // thundering-herd failure mode under correlated outages.
      if (i < attempts - 1) {
        await sleep(backoffDelayMs(i, baseMs, maxMs, rng))
      }
    }
  }
  throw new Error(`${opts.retryLabel ?? 'request'} failed after ${attempts} attempts: ${String(lastError)}`)
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export function degradedResponse(
  code: string,
  message: string,
  details?: string,
  status = 200
): NextResponse {
  return NextResponse.json(
    {
      degraded: true,
      error: { code, message, details: details ?? null },
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}

export function errorResponse(code: string, message: string, details?: string, status = 502): NextResponse {
  return NextResponse.json(
    {
      degraded: false,
      error: { code, message, details: details ?? null },
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}
