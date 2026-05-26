import { describe, it, expect } from 'vitest'
import { parseLiveQuote } from '@/hooks/useLiveQuote'

describe('parseLiveQuote (Q-049)', () => {
  it('parses quote payload', () => {
    const q = parseLiveQuote({
      ticker: 'AAPL',
      price: 100,
      change: 1,
      changePct: 1,
      marketOpen: true,
      timestamp: new Date().toISOString(),
    })
    expect(q?.price).toBe(100)
  })

  it('returns null for invalid payload', () => {
    expect(parseLiveQuote(null)).toBeNull()
  })
})
