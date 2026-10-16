/**
 * Q-135 — each sector ETF's move versus the prior close. A MEASUREMENT, not a
 * signal.
 *
 * This replaces `lib/sessionSignalsFromQuotes.ts`, whose rows were typed as
 * trade signals (`PriceSignal`: BUY / SELL / HOLD, entry / stop / target,
 * "confidence") although the only thing measured was the session change:
 *   - `entry = stopLoss = target = price`, so the card's level and risk/reward
 *     branch could never render a real value (Q-135);
 *   - "confidence" was `42 + 14 × |Δ%|` — a made-up number shown as a
 *     percentage, and averaged into an "Avg Confidence" tile on the homepage;
 *   - a sector with NO quote became a 0% HOLD row at $0 and was counted as
 *     "Neutral" in market breadth (I2: missing displayed as data).
 * A move here exists only when Yahoo supplied a usable quote.
 */
import { SECTORS } from '@/lib/sectors'

export type MoveDirection = 'UP' | 'DOWN' | 'FLAT'

export interface SessionMove {
  sector: string
  etf: string
  direction: MoveDirection
  /** Session change versus the prior close, in percent (Yahoo, normalised). */
  changePct: number
  /** Last price from the same quote. */
  price: number
  /** Yahoo `regularMarketTime` of the quote, when it supplied one. */
  quoteTime: string | null
}

export interface QuoteLike {
  price: number
  changePct: number
  quoteTime?: string | null
}

/**
 * Moves smaller than this read as FLAT: one basis point, the smallest change
 * the two-decimal display can show.
 */
export const FLAT_BAND_PCT = 0.01

export function moveDirection(changePct: number): MoveDirection {
  if (changePct > FLAT_BAND_PCT) return 'UP'
  if (changePct < -FLAT_BAND_PCT) return 'DOWN'
  return 'FLAT'
}

/** One sector's move, or null when the quote is missing or unusable. */
export function sessionMoveFor(etf: string, q: QuoteLike | undefined | null): SessionMove | null {
  const sector = SECTORS.find((s) => s.etf === etf)
  if (!sector || !q) return null
  if (!Number.isFinite(q.price) || q.price <= 0 || !Number.isFinite(q.changePct)) return null
  return {
    sector: sector.name,
    etf,
    direction: moveDirection(q.changePct),
    changePct: q.changePct,
    price: q.price,
    quoteTime: q.quoteTime ?? null,
  }
}

/** Every sector with a usable quote. Sectors without one are absent, not 0%. */
export function sessionMovesFromQuotes(quotes: Record<string, QuoteLike | undefined>): SessionMove[] {
  return SECTORS.map((s) => sessionMoveFor(s.etf, quotes[s.etf])).filter((m): m is SessionMove => m != null)
}
