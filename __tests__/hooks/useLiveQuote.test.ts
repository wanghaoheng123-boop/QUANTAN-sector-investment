/**
 * Unit tests for the useLiveQuote SSE client — pure-helper layer.
 *
 * The hook itself (state-machine + EventSource reconnect loop) is
 * exercised in integration via the existing smoke tests; here we cover
 * the boundary contract — the validator that decides whether a raw
 * server payload is a usable quote. Defence in depth: the API route
 * already gates with Number.isFinite, but the client must NOT trust
 * upstream blindly.
 *
 * Why no React-testing-library? The project doesn't depend on it, and
 * the hook's state transitions are trivially derived from this pure
 * function plus EventSource events. Keeping the test stack minimal.
 */

import { describe, it, expect } from 'vitest'
import { parseLiveQuote } from '@/hooks/useLiveQuote'

describe('parseLiveQuote', () => {
  const validPayload = {
    ticker: 'AAPL',
    price: 190.55,
    change: 1.25,
    changePct: 0.66,
    volume: 50_000_000,
    marketOpen: true,
    timestamp: '2026-05-19T15:30:00Z',
  }

  it('accepts a well-formed payload', () => {
    const parsed = parseLiveQuote(validPayload)
    expect(parsed).not.toBeNull()
    expect(parsed?.price).toBe(190.55)
    expect(parsed?.marketOpen).toBe(true)
  })

  it('returns null for non-object input', () => {
    expect(parseLiveQuote(null)).toBeNull()
    expect(parseLiveQuote(undefined)).toBeNull()
    expect(parseLiveQuote('quote')).toBeNull()
    expect(parseLiveQuote(42)).toBeNull()
    expect(parseLiveQuote([])).toBeNull()
  })

  it('rejects NaN / Infinity / non-positive prices', () => {
    expect(parseLiveQuote({ ...validPayload, price: NaN })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, price: Infinity })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, price: -1 })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, price: 0 })).toBeNull()
  })

  it('rejects missing / empty ticker', () => {
    expect(parseLiveQuote({ ...validPayload, ticker: '' })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, ticker: undefined })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, ticker: 123 })).toBeNull()
  })

  it('rejects missing / empty timestamp', () => {
    expect(parseLiveQuote({ ...validPayload, timestamp: '' })).toBeNull()
    expect(parseLiveQuote({ ...validPayload, timestamp: undefined })).toBeNull()
  })

  it('coerces NaN change / changePct to 0 (lossy default)', () => {
    const parsed = parseLiveQuote({ ...validPayload, change: NaN, changePct: NaN })
    expect(parsed?.change).toBe(0)
    expect(parsed?.changePct).toBe(0)
  })

  it('drops non-finite or negative volume to undefined', () => {
    expect(parseLiveQuote({ ...validPayload, volume: NaN })?.volume).toBeUndefined()
    expect(parseLiveQuote({ ...validPayload, volume: -1 })?.volume).toBeUndefined()
    expect(parseLiveQuote({ ...validPayload, volume: 0 })?.volume).toBe(0)
  })

  it('treats marketOpen=truthy-non-boolean as false (strict equality)', () => {
    // Only the literal value `true` flips marketOpen to true. This guards
    // against the server-side bug where a stringly-typed "true" leaks through.
    expect(parseLiveQuote({ ...validPayload, marketOpen: 'true' })?.marketOpen).toBe(false)
    expect(parseLiveQuote({ ...validPayload, marketOpen: 1 })?.marketOpen).toBe(false)
    expect(parseLiveQuote({ ...validPayload, marketOpen: undefined })?.marketOpen).toBe(false)
    expect(parseLiveQuote({ ...validPayload, marketOpen: true })?.marketOpen).toBe(true)
  })
})
