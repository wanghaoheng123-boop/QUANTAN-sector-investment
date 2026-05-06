import { NextResponse } from 'next/server'

type RetryOptions = {
  attempts?: number
  timeoutMs?: number
  retryLabel?: string
  /**
   * Base delay (ms) between retry attempts. Phase 13 S2 fix (F4.4):
   * exponential backoff with full jitter (Brooker, AWS Architecture Blog 2015).
   * Default 200 ms — at attempts=3 this gives sleeps drawn uniformly from
   * [0, 200], [0, 400], [0, 800].
   */
  baseBackoffMs?: number
  /** Cap the backoff at this value (ms). Default 5_000 (5 s). */
  maxBackoffMs?: number
}

/**
 * Run `fn` with timeout-bounded retries. Exponential backoff with full jitter
 * between attempts (Brooker 2015 / SRE Beyer 2016 Ch.22) — protects upstream
 * services from cascading-failure amplification when the failure mode is
 * upstream throttling (HTTP 429/503).
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  const baseBackoffMs = Math.max(0, opts.baseBackoffMs ?? 200)
  const maxBackoffMs = Math.max(baseBackoffMs, opts.maxBackoffMs ?? 5_000)
  let lastError: unknown = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await withTimeout(fn(), opts.timeoutMs ?? 8_000)
    } catch (error) {
      lastError = error
      // F4.4: sleep with full-jitter exponential backoff before next attempt.
      // No backoff on the final attempt — we're about to throw anyway.
      if (i < attempts - 1 && baseBackoffMs > 0) {
        const cap = Math.min(maxBackoffMs, baseBackoffMs * 2 ** i)
        const sleepMs = Math.floor(Math.random() * cap)
        await new Promise((resolve) => setTimeout(resolve, sleepMs))
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
