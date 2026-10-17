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
 *
 * KNOWN GAP (red-team S4, 2026-10-17; Q-145): a quote that carries a price but
 * NO change arrives here as `changePct: 0`, because the producers
 * (`normalizedChangePercent`, `parseLiveQuote`) substitute 0 for a missing
 * change. It then reads as a measured FLAT. The fix is at the producers, which
 * about thirty consumers share, so it is its own package.
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

/** Decimal places a move is shown to. */
export const MOVE_DECIMALS = 2

/** The move as displayed: rounded to MOVE_DECIMALS, with no negative zero. */
export function shownMovePct(changePct: number): number {
  const shown = Number(changePct.toFixed(MOVE_DECIMALS))
  return shown === 0 ? 0 : shown
}

/**
 * The direction is decided on the DISPLAYED value, so the label can never
 * disagree with the number beside it. Red-team S5: with a ±0.01 band and
 * two-decimal display, 0.01 showed "+0.01%" labelled FLAT while 0.0149 showed
 * "+0.01%" labelled UP. FLAT now means exactly "shows 0.00%".
 */
export function moveDirection(changePct: number): MoveDirection {
  const shown = shownMovePct(changePct)
  if (shown > 0) return 'UP'
  if (shown < 0) return 'DOWN'
  return 'FLAT'
}

/** "+1.23%", "-0.50%", "0.00%" — the one formatter every move surface uses. */
export function formatMovePct(changePct: number): string {
  const shown = shownMovePct(changePct)
  return `${shown > 0 ? '+' : ''}${shown.toFixed(MOVE_DECIMALS)}%`
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
