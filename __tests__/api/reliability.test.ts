import { describe, it, expect, vi } from 'vitest'
import { withRetry, withTimeout, backoffDelayMs } from '@/lib/api/reliability'

/**
 * Tests for lib/api/reliability.ts
 *
 * Pins down:
 *   - withTimeout rejects when the inner promise exceeds the timeout
 *   - withTimeout resolves when the inner promise completes in time
 *   - backoffDelayMs implements full-jitter exponential backoff
 *   - withRetry sleeps between attempts (regression: previously instant)
 *   - withRetry honors deterministic rng + sleep injection (no real timers)
 *   - withRetry returns the first successful result
 *   - withRetry throws after exhausting attempts with the last error
 */

describe('withTimeout', () => {
  it('resolves with the inner-promise value when it completes in time', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  it('rejects with timeout message when the inner promise hangs', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200))
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timeout after 50ms/)
  })

  it('propagates inner-promise rejections (not timeout)', async () => {
    const failing = Promise.reject(new Error('upstream 503'))
    await expect(withTimeout(failing, 1000)).rejects.toThrow('upstream 503')
  })
})

describe('backoffDelayMs', () => {
  it('returns 0..base-1 on attempt 0 with rng()=0.5 (full jitter formula)', () => {
    // exp = min(2000, 200 * 2^0) = 200; floor(0.5 * 200) = 100
    expect(backoffDelayMs(0, 200, 2000, () => 0.5)).toBe(100)
  })

  it('doubles the cap each attempt (full-jitter ceiling)', () => {
    // attempt 1: cap = 400; attempt 2: cap = 800; attempt 3: cap = 1600
    expect(backoffDelayMs(0, 200, 2000, () => 0.999)).toBe(199)  // floor(0.999 * 200)
    expect(backoffDelayMs(1, 200, 2000, () => 0.999)).toBe(399)
    expect(backoffDelayMs(2, 200, 2000, () => 0.999)).toBe(799)
    expect(backoffDelayMs(3, 200, 2000, () => 0.999)).toBe(1598)
  })

  it('respects maxMs cap when 2^attempt exceeds it', () => {
    // attempt 5 with base=200 → 200*32 = 6400, capped at 2000
    expect(backoffDelayMs(5, 200, 2000, () => 0.999)).toBe(1998)
  })

  it('returns 0 when rng returns 0 (full jitter floor)', () => {
    expect(backoffDelayMs(3, 200, 2000, () => 0)).toBe(0)
  })

  it('default rng (Math.random) yields a number in [0, exp)', () => {
    for (let i = 0; i < 20; i++) {
      const d = backoffDelayMs(2, 100, 1000)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThan(400) // 100 * 2^2 = 400
    }
  })
})

describe('withRetry', () => {
  it('returns immediately on success without sleeping', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const fn = vi.fn(() => Promise.resolve('ok'))
    const result = await withRetry(fn, { attempts: 3, sleep })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries once and succeeds on the second attempt', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    let attempt = 0
    const fn = vi.fn(() => {
      attempt++
      return attempt === 1 ? Promise.reject(new Error('flake')) : Promise.resolve('ok')
    })
    const result = await withRetry(fn, { attempts: 3, sleep, rng: () => 0.5 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
    // ONE sleep between the failure and the next try
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting attempts (regression: now sleeps between)', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const fn = vi.fn(() => Promise.reject(new Error('upstream down')))
    await expect(
      withRetry(fn, { attempts: 3, sleep, rng: () => 0.5, retryLabel: 'yahoo' })
    ).rejects.toThrow(/yahoo failed after 3 attempts.*upstream down/)
    expect(fn).toHaveBeenCalledTimes(3)
    // 2 sleeps between 3 attempts (no sleep after the LAST failure)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does NOT sleep after the final failed attempt (just throws)', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const fn = vi.fn(() => Promise.reject(new Error('x')))
    await expect(withRetry(fn, { attempts: 1, sleep })).rejects.toThrow()
    expect(sleep).not.toHaveBeenCalled() // single attempt, no sleep
  })

  it('uses exponential cap progression: 200 → 400 between attempts', async () => {
    const delays: number[] = []
    const sleep = (ms: number) => {
      delays.push(ms)
      return Promise.resolve()
    }
    const fn = () => Promise.reject(new Error('x'))
    await expect(
      withRetry(fn, {
        attempts: 3,
        sleep,
        rng: () => 0.999, // pin to ceiling
        backoffBaseMs: 200,
        backoffMaxMs: 2000,
      })
    ).rejects.toThrow()
    // Two sleeps between three attempts. Caps: floor(0.999*200) = 199,
    // floor(0.999*400) = 399.
    expect(delays).toEqual([199, 399])
  })

  it('respects backoffBaseMs = 0 (no actual delay, kept for back-compat)', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    const fn = vi.fn(() => Promise.reject(new Error('x')))
    await expect(
      withRetry(fn, { attempts: 2, sleep, backoffBaseMs: 0 })
    ).rejects.toThrow()
    // Sleep is still called but with delay 0
    expect(sleep).toHaveBeenCalledWith(0)
  })

  it('attempts <= 1 means no retry (single shot)', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'))
    expect(await withRetry(fn, { attempts: 0 })).toBe('ok') // clamped to 1
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
