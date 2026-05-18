import { describe, it, expect } from 'vitest'
import { parseQuoteTime } from '@/lib/format'

/**
 * Phase 14 wave 17: regression coverage for parseQuoteTime boundary behaviour.
 *
 * Pre-fix bug: `new Date(ms).toISOString()` throws RangeError for any ms
 * outside V8's ±100 million days from epoch (≈ ±8.64e15 ms). A garbled
 * upstream timestamp would crash the API route. Now: defensive clamps +
 * try/catch return null instead of throwing.
 */
describe('parseQuoteTime', () => {
  it('returns null for null / undefined', () => {
    expect(parseQuoteTime(null)).toBeNull()
    expect(parseQuoteTime(undefined)).toBeNull()
  })

  it('passes Date instances through to ISO', () => {
    const d = new Date('2026-05-15T12:00:00Z')
    expect(parseQuoteTime(d)).toBe('2026-05-15T12:00:00.000Z')
  })

  it('parses ISO strings', () => {
    expect(parseQuoteTime('2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('returns null for malformed string', () => {
    expect(parseQuoteTime('not a date')).toBeNull()
    expect(parseQuoteTime('')).toBeNull()
  })

  it('infers seconds vs milliseconds via 1e12 threshold', () => {
    // 1700000000 sec = 2023-11-14T22:13:20Z
    const secs = 1_700_000_000
    expect(parseQuoteTime(secs)).toBe('2023-11-14T22:13:20.000Z')
    // 1700000000000 ms = same instant
    expect(parseQuoteTime(secs * 1000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('returns null for absurdly-large numbers (V8 RangeError boundary)', () => {
    // V8 max date is ±8.64e15 ms; anything beyond throws RangeError.
    // Pre-fix this would crash the calling route.
    expect(parseQuoteTime(1e20)).toBeNull()
    expect(parseQuoteTime(-1e20)).toBeNull()
  })

  it('returns null for NaN / Infinity', () => {
    expect(parseQuoteTime(NaN)).toBeNull()
    expect(parseQuoteTime(Infinity)).toBeNull()
    expect(parseQuoteTime(-Infinity)).toBeNull()
  })

  it('returns null for unsupported types', () => {
    expect(parseQuoteTime({})).toBeNull()
    expect(parseQuoteTime([])).toBeNull()
    expect(parseQuoteTime(true)).toBeNull()
  })
})
