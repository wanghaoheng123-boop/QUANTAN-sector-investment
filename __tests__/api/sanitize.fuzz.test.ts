/**
 * Q-015 — Property-based fuzz tests for normalizeTicker (F7.3).
 * Validates that random inputs never bypass the whitelist regex.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { normalizeTicker } from '@/lib/api/sanitize'

// Q-015: mirror lib/api/sanitize.ts TICKER_REGEX — keep in sync with source.
const TICKER_REGEX = /^\^?[A-Z0-9][A-Z0-9.=]{0,14}(-[A-Z0-9]{1,10})?$/

describe('normalizeTicker fuzz (Q-015)', () => {
  it('property: result is null or matches whitelist regex (10k cases)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (s) => {
        const result = normalizeTicker(s)
        if (result === null) return true
        return TICKER_REGEX.test(result)
      }),
      { numRuns: 10_000 },
    )
  })

  it('known-bad inputs return null', () => {
    const bad = [
      '../etc/passwd',
      'AAPL; DROP TABLE',
      '%G1',
      '',
      '   ',
      '<script>alert(1)</script>',
      'AAPL/path',
      'AAPL?foo=bar',
      'AAPL+MSFT',
      '🔥🚀',
      '%',
      '%ZZ',
      'A'.repeat(50),
      ' \t\n',
      'BRK-B; DROP TABLE users',
      '../../secret',
      '%00',
      'AAPL\x00',
    ]
    for (const input of bad) {
      expect(normalizeTicker(input), `expected null for ${JSON.stringify(input)}`).toBeNull()
    }
  })
})
