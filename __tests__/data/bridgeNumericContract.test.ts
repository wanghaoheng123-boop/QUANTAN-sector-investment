import { describe, it, expect } from 'vitest'
import { parseBridgeNumber, pickBridgeQuoteTime } from '@/lib/data/bloomberg/bridgeClient'

/**
 * Q-128 — the bridge parsed numerics with `parseFloat`, which reads a PREFIX
 * and discards the rest, and returned `0` when nothing parsed.
 *
 * Two separate failures in one function:
 *  • `'1,234.5'` became `1` and `'123oops'` became `123` — a malformed vendor
 *    field silently became a plausible number, and for `price` a plausible
 *    wrong number outranks a correct fallback.
 *  • the `0` default FABRICATED a value. For a price 0 is not a neutral
 *    default, it is a false quote.
 */

describe('Q-128 — bridge numerics parse on a full-string contract', () => {
  it('accepts genuine numbers in every ordinary spelling', () => {
    expect(parseBridgeNumber(123)).toBe(123)
    expect(parseBridgeNumber('123')).toBe(123)
    expect(parseBridgeNumber(' 123.45 ')).toBe(123.45)
    expect(parseBridgeNumber('-0.5')).toBe(-0.5)
    expect(parseBridgeNumber('+2')).toBe(2)
    expect(parseBridgeNumber('.5')).toBe(0.5)
    expect(parseBridgeNumber('1e3')).toBe(1000)
    expect(parseBridgeNumber(0)).toBe(0)
  })

  it('REJECTS the reported malformed values instead of parsing a prefix', () => {
    // These are the exact strings the red team reproduced.
    expect(parseBridgeNumber('1,234.5')).toBeNull()   // was 1
    expect(parseBridgeNumber('123oops')).toBeNull()   // was 123
  })

  it('rejects formatted, unit-bearing and partial values', () => {
    for (const bad of ['$123', '123%', '1 234', '12.3.4', '1,000', '3.5T', 'N/A', '--', 'NaN', 'Infinity', '', '   ']) {
      expect(parseBridgeNumber(bad), `${JSON.stringify(bad)} must not parse`).toBeNull()
    }
  })

  it('rejects non-finite numbers, including the overflow control', () => {
    expect(parseBridgeNumber('1e309')).toBeNull()  // parses, but is Infinity
    expect(parseBridgeNumber(Infinity)).toBeNull()
    expect(parseBridgeNumber(-Infinity)).toBeNull()
    expect(parseBridgeNumber(NaN)).toBeNull()
  })

  it('never fabricates a value for absent input', () => {
    // The old implementation returned 0 for every one of these.
    for (const absent of [null, undefined, {}, [], true, 'abc']) {
      expect(parseBridgeNumber(absent), `${JSON.stringify(absent)} must be null, not 0`).toBeNull()
    }
  })

  it('distinguishes "absent" from "genuinely zero" — the reason null exists', () => {
    expect(parseBridgeNumber('0')).toBe(0)
    expect(parseBridgeNumber('oops')).toBeNull()
    expect(parseBridgeNumber('0')).not.toBe(parseBridgeNumber('oops'))
  })
})

describe('Q-129 — the bridge reports its own clock', () => {
  it('reads the timestamp under each spelling a bridge may use', () => {
    expect(pickBridgeQuoteTime({ quoteTime: '2026-09-10T14:00:00Z' })).toBe('2026-09-10T14:00:00.000Z')
    expect(pickBridgeQuoteTime({ LAST_UPDATE: '2026-09-10T14:00:00Z' })).toBe('2026-09-10T14:00:00.000Z')
    expect(pickBridgeQuoteTime({ regularMarketTime: '2026-09-10T14:00:00Z' })).toBe('2026-09-10T14:00:00.000Z')
  })

  it('returns null rather than inventing a time', () => {
    expect(pickBridgeQuoteTime({})).toBeNull()
    expect(pickBridgeQuoteTime({ quoteTime: 'not-a-date' })).toBeNull()
    expect(pickBridgeQuoteTime({ quoteTime: null })).toBeNull()
  })

  it('WHAT THIS CANNOT DO — asserted, so a green run is not read as a proof', () => {
    // A bridge that reports a WRONG-but-parseable time is indistinguishable
    // from one reporting a right one. This carries the vendor's clock; it does
    // not verify the vendor's clock.
    expect(pickBridgeQuoteTime({ quoteTime: '1970-01-01T00:00:00Z' })).toBe('1970-01-01T00:00:00.000Z')
  })
})
