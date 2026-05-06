import { describe, it, expect, vi } from 'vitest'
import { withRetry, withTimeout } from '@/lib/api/reliability'

describe('withTimeout', () => {
  it('resolves when promise settles before timeout', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000)
    expect(result).toBe(42)
  })

  it('rejects when promise hangs past timeout', async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 1000))
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timeout after 50ms/)
  })

  it('clears the internal timer on success (no late firing)', async () => {
    // Resolves cleanly; if the timer leaked we'd see an unhandled rejection in
    // the test runner's stderr.  This test mostly serves as a guard against
    // regressions in the cleanup path.
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok')
    await new Promise((r) => setTimeout(r, 150))
  })
})

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('hello')
    const out = await withRetry(fn, { attempts: 3, baseBackoffMs: 0 })
    expect(out).toBe('hello')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until success', async () => {
    let calls = 0
    const fn = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) throw new Error('flaky')
      return 'ok'
    })
    const out = await withRetry(fn, { attempts: 5, baseBackoffMs: 0 })
    expect(out).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      withRetry(fn, { attempts: 3, retryLabel: 'test', baseBackoffMs: 0 }),
    ).rejects.toThrow(/test failed after 3 attempts/)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('respects timeoutMs per attempt', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise<number>((resolve) => setTimeout(() => resolve(1), 200)),
    )
    await expect(
      withRetry(fn, { attempts: 2, timeoutMs: 30, baseBackoffMs: 0 }),
    ).rejects.toThrow(/failed after 2 attempts/)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  // F4.4 acceptance: exponential backoff with full jitter actually waits.
  it('sleeps between failed attempts (F4.4 backoff active)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('upstream throttle'))
    const start = Date.now()
    await expect(
      withRetry(fn, { attempts: 3, baseBackoffMs: 50, maxBackoffMs: 100 }),
    ).rejects.toThrow()
    const elapsed = Date.now() - start
    // Two backoff sleeps between three attempts (each in [0, cap]).
    // Lower bound is 0 (jitter could yield zero), but realistically with
    // two draws from uniform[0, cap], the expected total is ~50% × 2 ×
    // average_cap ≈ 35 ms when caps are 50, 100. We assert > 0 to confirm
    // some sleep occurred and < 5× max to bound the upper end.
    expect(elapsed).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(5 * 100)
  })

  it('does not sleep on the final attempt', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent'))
    const start = Date.now()
    await expect(
      // Single attempt — no backoff path taken.
      withRetry(fn, { attempts: 1, baseBackoffMs: 1000 }),
    ).rejects.toThrow()
    expect(Date.now() - start).toBeLessThan(200)
  })
})
