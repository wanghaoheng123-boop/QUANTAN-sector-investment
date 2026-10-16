/**
 * lib/quant/regimeHmmClient.ts tests (Q-051-NEW + CI branch-coverage backfill).
 *
 * Covers: ruleBasedRegime min-bar guard + state logic (Bull/Normal/Bear);
 * fetchHmmRegime sidecar happy + sidecar HTTP fail + missing-env fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ruleBasedRegime, fetchHmmRegime } from '@/lib/quant/regimeHmmClient'

describe('ruleBasedRegime', () => {
  // Q-140 red-team H2: these tests used to assert the fallback's CONSTANT
  // "probabilities" (0.33/0.34/0.33, 0.65/0.175/0.175) — pinning a fabricated
  // posterior as correct. A rule has no posterior: it reports null.
  it('returns Normal and no probabilities when input < 60 bars', () => {
    const r = ruleBasedRegime(Array(30).fill(100))
    expect(r.currentState).toBe('Normal')
    expect(r.probabilities).toBeNull()
    expect(r.source).toBe('rule-fallback')
  })

  it('emits Bull when 63-bar return > 5% AND volRatio < 1.1', () => {
    // Steady uptrend with low vol: 8% return over 63 bars, no vol spike.
    const closes: number[] = []
    for (let i = 0; i < 100; i++) closes.push(100 * (1 + 0.001 * i))
    const r = ruleBasedRegime(closes)
    expect(r.currentState).toBe('Bull')
    expect(r.probabilities).toBeNull()
  })

  it('emits Bear when 63-bar return < -5%', () => {
    const closes: number[] = []
    for (let i = 0; i < 100; i++) closes.push(100 * (1 - 0.002 * i))
    const r = ruleBasedRegime(closes)
    expect(r.currentState).toBe('Bear')
  })

  it('emits Bear on vol spike (volRatio > 1.4)', () => {
    // Mostly flat, big spike in the last 20 bars.
    const closes: number[] = Array(80).fill(100)
    for (let i = 0; i < 20; i++) {
      closes.push(100 + (i % 2 === 0 ? 5 : -5))
    }
    const r = ruleBasedRegime(closes)
    expect(r.currentState).toBe('Bear')
  })

  it('Normal when no condition triggers', () => {
    // Tiny return + tiny vol → Normal
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 20) * 0.1)
    const r = ruleBasedRegime(closes)
    expect(r.currentState).toBe('Normal')
  })

  it('never reports a probability it did not estimate', () => {
    for (const closes of [Array(30).fill(100), Array.from({ length: 100 }, (_, i) => 100 * (1 + 0.0005 * i))]) {
      expect(ruleBasedRegime(closes).probabilities).toBeNull()
    }
  })
})

describe('fetchHmmRegime', () => {
  let savedEnv: string | undefined
  let savedFetch: typeof globalThis.fetch

  beforeEach(() => {
    savedEnv = process.env.QUANT_FRAMEWORK_URL
    savedFetch = globalThis.fetch
  })
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.QUANT_FRAMEWORK_URL
    else process.env.QUANT_FRAMEWORK_URL = savedEnv
    globalThis.fetch = savedFetch
  })

  it('returns rule-fallback with caller ticker when sidecar URL is unset', async () => {
    delete process.env.QUANT_FRAMEWORK_URL
    const r = await fetchHmmRegime('AAPL', Array(30).fill(100))
    expect(r.source).toBe('rule-fallback')
    expect(r.ticker).toBe('AAPL')
    // Not configured is the documented default, not a failure.
    expect(r.degraded).toBeUndefined()
  })

  it('returns sidecar response with python source when sidecar OK', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        ticker: 'IGNORE',
        currentState: 'Bull',
        probabilities: { Bull: 0.7, Normal: 0.2, Bear: 0.1 },
        source: 'python',
      }), { status: 200 })
    ) as unknown as typeof fetch
    const r = await fetchHmmRegime('AAPL', [])
    expect(r.source).toBe('python')
    expect(r.ticker).toBe('AAPL') // overridden from caller-supplied
    expect(r.currentState).toBe('Bull')
  })

  it('falls back to rule when sidecar returns non-OK', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () => new Response('', { status: 502 })) as unknown as typeof fetch
    const r = await fetchHmmRegime('AAPL', Array(30).fill(100))
    expect(r.source).toBe('rule-fallback')
    expect(r.ticker).toBe('AAPL')
    expect(r.degraded).toBe(true)
    expect(r.error?.message).toMatch(/HTTP 502/)
  })

  it('falls back to rule when sidecar fetch throws', async () => {
    process.env.QUANT_FRAMEWORK_URL = 'http://sidecar.local'
    globalThis.fetch = (async () => { throw new Error('timeout') }) as unknown as typeof fetch
    const r = await fetchHmmRegime('AAPL', Array(30).fill(100))
    expect(r.source).toBe('rule-fallback')
    expect(r.degraded).toBe(true)
  })
})
