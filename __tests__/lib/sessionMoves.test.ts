/** Q-135 — session moves are measurements; a missing quote is absent, not 0%. */
import { describe, expect, it } from 'vitest'
import { formatMovePct, moveDirection, sessionMoveFor, sessionMovesFromQuotes } from '@/lib/sessionMoves'
import { SECTORS } from '@/lib/sectors'

describe('sessionMoves', () => {
  it('classifies by the flat band', () => {
    expect(moveDirection(0.02)).toBe('UP')
    expect(moveDirection(-0.02)).toBe('DOWN')
    expect(moveDirection(0)).toBe('FLAT')
    // Red-team S5: the label is decided on the displayed value, so it can never
    // disagree with the number beside it.
    for (const v of [0.01, 0.0149, 0.0051, -0.0051, 0.0049, -0.0049, -0.001]) {
      const shown = formatMovePct(v)
      const want = shown.startsWith('+') ? 'UP' : shown.startsWith('-') ? 'DOWN' : 'FLAT'
      expect(moveDirection(v), `${v} shows ${shown}`).toBe(want)
    }
    expect(formatMovePct(-0.001)).toBe('0.00%')
    expect(formatMovePct(1.234)).toBe('+1.23%')
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
