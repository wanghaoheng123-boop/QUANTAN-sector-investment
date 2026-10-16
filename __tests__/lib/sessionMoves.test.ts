/** Q-135 — session moves are measurements; a missing quote is absent, not 0%. */
import { describe, expect, it } from 'vitest'
import { FLAT_BAND_PCT, moveDirection, sessionMoveFor, sessionMovesFromQuotes } from '@/lib/sessionMoves'
import { SECTORS } from '@/lib/sectors'

describe('sessionMoves', () => {
  it('classifies by the flat band', () => {
    expect(moveDirection(FLAT_BAND_PCT * 2)).toBe('UP')
    expect(moveDirection(-FLAT_BAND_PCT * 2)).toBe('DOWN')
    expect(moveDirection(0)).toBe('FLAT')
    expect(moveDirection(FLAT_BAND_PCT)).toBe('FLAT')
  })

  it('a missing or unusable quote produces NO move (it used to be a 0% HOLD at $0)', () => {
    expect(sessionMoveFor('XLK', undefined)).toBeNull()
    expect(sessionMoveFor('XLK', { price: 0, changePct: 0 })).toBeNull()
    expect(sessionMoveFor('XLK', { price: 100, changePct: Number.NaN })).toBeNull()
    expect(sessionMoveFor('NOT-A-SECTOR', { price: 100, changePct: 1 })).toBeNull()
  })

  it('carries only measured fields — no confidence, entry, stop or target', () => {
    const m = sessionMoveFor('XLK', { price: 250, changePct: 1.2, quoteTime: '2026-10-16T20:00:00.000Z' })
    expect(m).toEqual({ sector: 'Technology', etf: 'XLK', direction: 'UP', changePct: 1.2, price: 250, quoteTime: '2026-10-16T20:00:00.000Z' })
  })

  it('skips sectors without a quote', () => {
    const moves = sessionMovesFromQuotes({ XLK: { price: 250, changePct: 1 }, XLE: { price: 90, changePct: -0.5 } })
    expect(moves.map((m) => m.etf)).toEqual(SECTORS.map((s) => s.etf).filter((e) => e === 'XLK' || e === 'XLE'))
  })
})
