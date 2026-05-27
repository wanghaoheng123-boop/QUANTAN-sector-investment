import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CANONICAL_PARAMS,
  evaluateCanonicalBenchmark,
  generateCanonicalSignal,
} from '@/lib/optimize/canonicalBenchmark'

describe('canonicalBenchmark', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 20) * 5 + i * 0.02)

  it('generates HOLD before bar 200', () => {
    expect(generateCanonicalSignal(closes, 100, DEFAULT_CANONICAL_PARAMS)).toBe('HOLD')
  })

  it('evaluates aggregate metrics on synthetic data', () => {
    const result = evaluateCanonicalBenchmark([{ ticker: 'TEST', closes }])
    expect(result.totalInstruments).toBe(1)
    expect(result.aggregateWinRate).toBeGreaterThanOrEqual(0)
    expect(result.aggregateWinRate).toBeLessThanOrEqual(1)
  })

  it('default params match promoted benchmark-signals constants', () => {
    expect(DEFAULT_CANONICAL_PARAMS.slopeThreshold).toBe(0.01)
    expect(DEFAULT_CANONICAL_PARAMS.rsiBuyMax).toBe(36)
    expect(DEFAULT_CANONICAL_PARAMS.holdDays).toBe(29)
  })
})
