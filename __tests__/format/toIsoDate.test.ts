/**
 * Tests for `toIsoDate` — the wave-41 SSOT date helper used by every
 * options component to safely convert a Date | string | number | unknown
 * into a YYYY-MM-DD string for display.
 *
 * History: this helper exists because after `fetch().then(r => r.json())`
 * a TypeScript-typed `Date` field arrives as a string at runtime. The
 * unconditional `.toISOString()` calls in FlowScanner crashed the panel.
 * Replacing every duplicated `instanceof Date` ternary with this helper
 * gives ONE place to harden + tests pin the contract.
 */

import { describe, it, expect } from 'vitest'
import { toIsoDate } from '@/lib/format'

describe('toIsoDate', () => {
  it('formats a Date instance', () => {
    expect(toIsoDate(new Date('2026-05-20T14:30:00Z'))).toBe('2026-05-20')
  })

  it('formats an ISO string (the JSON.parse case)', () => {
    expect(toIsoDate('2026-05-20T14:30:00Z')).toBe('2026-05-20')
  })

  it('formats a YYYY-MM-DD-only string', () => {
    expect(toIsoDate('2026-05-20')).toBe('2026-05-20')
  })

  it('formats an epoch-ms number', () => {
    const ms = Date.parse('2026-05-20T00:00:00Z')
    expect(toIsoDate(ms)).toBe('2026-05-20')
  })

  it('formats an epoch-seconds number (via the 1e12 heuristic)', () => {
    const seconds = Math.floor(Date.parse('2026-05-20T00:00:00Z') / 1000)
    expect(toIsoDate(seconds)).toBe('2026-05-20')
  })

  it('returns the default fallback for null / undefined', () => {
    expect(toIsoDate(null)).toBe('')
    expect(toIsoDate(undefined)).toBe('')
    expect(toIsoDate(null, '—')).toBe('—')
  })

  it('returns the default fallback for malformed input', () => {
    expect(toIsoDate('not-a-date')).toBe('')
    expect(toIsoDate('not-a-date', 'TBD')).toBe('TBD')
    expect(toIsoDate({}, '—')).toBe('—')
    expect(toIsoDate([], '—')).toBe('—')
    expect(toIsoDate(true, '—')).toBe('—')
  })

  it('returns the default fallback for NaN / Infinity', () => {
    expect(toIsoDate(NaN, '—')).toBe('—')
    expect(toIsoDate(Infinity, '—')).toBe('—')
    expect(toIsoDate(-Infinity, '—')).toBe('—')
  })

  it('handles V8 RangeError boundary (parseQuoteTime ancestor)', () => {
    // ms outside ±100 million days from epoch (V8 max) is rejected.
    expect(toIsoDate(1e20, '—')).toBe('—')
    expect(toIsoDate(-1e20, '—')).toBe('—')
  })

  it('does NOT throw for any input shape (defensive contract)', () => {
    // The whole point of the SSOT is that EVERY call site can trust
    // this never throws — that's what FlowScanner relied on after the
    // wave-41 fix. We verify across pathological inputs.
    const inputs: unknown[] = [
      null, undefined, '', 'x', '2026-99-99', {}, [], true, false, NaN, Infinity,
      Symbol('a'), () => 'x', { toString: () => 'oops' },
    ]
    for (const x of inputs) {
      expect(() => toIsoDate(x)).not.toThrow()
    }
  })
})
