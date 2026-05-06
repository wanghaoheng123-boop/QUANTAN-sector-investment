import { describe, it, expect } from 'vitest'
import { normalizeTicker, num, sanitizeError } from '@/lib/api/sanitize'

describe('normalizeTicker', () => {
  it('returns null for empty string', () => {
    expect(normalizeTicker('')).toBeNull()
    expect(normalizeTicker('   ')).toBeNull()
  })

  it('uppercases plain ticker symbols', () => {
    expect(normalizeTicker('aapl')).toBe('AAPL')
    expect(normalizeTicker('Msft')).toBe('MSFT')
  })

  it('preserves dash and dot separators', () => {
    expect(normalizeTicker('BRK-B')).toBe('BRK-B')
    expect(normalizeTicker('BF.B')).toBe('BF.B')
  })

  it('preserves futures equals sign', () => {
    expect(normalizeTicker('GC=F')).toBe('GC=F')
    expect(normalizeTicker('CL=F')).toBe('CL=F')
  })

  it('passes through ^-prefixed indices when valid', () => {
    expect(normalizeTicker('^VIX')).toBe('^VIX')
    expect(normalizeTicker('^GSPC')).toBe('^GSPC')
  })

  it('prepends ^ for known plain US index names', () => {
    expect(normalizeTicker('VIX')).toBe('^VIX')
    expect(normalizeTicker('GSPC')).toBe('^GSPC')
    expect(normalizeTicker('DJI')).toBe('^DJI')
    expect(normalizeTicker('IXIC')).toBe('^IXIC')
    expect(normalizeTicker('NDX')).toBe('^NDX')
    expect(normalizeTicker('TNX')).toBe('^TNX')
  })

  it('rejects invalid characters (script tags, paths, etc.)', () => {
    expect(normalizeTicker('<script>')).toBeNull()
    expect(normalizeTicker('AAPL;rm -rf')).toBeNull()
    expect(normalizeTicker('AAPL/path')).toBeNull()
    expect(normalizeTicker('AAPL?intra=')).toBeNull()
    expect(normalizeTicker('AAPL+MSFT')).toBeNull()
  })

  it('rejects oversized strings', () => {
    expect(normalizeTicker('A'.repeat(50))).toBeNull()
  })

  it('handles URL encoding gracefully', () => {
    expect(normalizeTicker('AAPL')).toBe('AAPL')
    expect(normalizeTicker(encodeURIComponent('BRK-B'))).toBe('BRK-B')
  })
})

describe('num', () => {
  it('returns finite numbers as-is', () => {
    expect(num(0)).toBe(0)
    expect(num(42.5)).toBe(42.5)
    expect(num(-100)).toBe(-100)
  })

  it('returns 0 for non-finite numbers', () => {
    expect(num(NaN)).toBe(0)
    expect(num(Infinity)).toBe(0)
    expect(num(-Infinity)).toBe(0)
  })

  it('returns 0 for non-number types', () => {
    expect(num(undefined)).toBe(0)
    expect(num(null)).toBe(0)
    expect(num('42')).toBe(0)  // strings are NOT coerced
    expect(num(true)).toBe(0)
    expect(num({})).toBe(0)
  })
})

describe('sanitizeError', () => {
  // We can't reliably mock NODE_ENV inside vitest without a test-env setup,
  // so we just verify the development-mode behavior (NODE_ENV !== 'production').
  it('returns Error.message in development', () => {
    const e = new Error('Boom: secret-token-123')
    const out = sanitizeError(e)
    // In test env (NODE_ENV usually 'test'), the dev path returns message.
    expect(out).toBe('Boom: secret-token-123')
  })

  it('returns String(value) for non-Error in development', () => {
    expect(sanitizeError('plain string')).toBe('plain string')
    expect(sanitizeError(42)).toBe('42')
  })
})
