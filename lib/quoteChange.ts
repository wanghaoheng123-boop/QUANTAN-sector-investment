/**
 * Q-145 — the session change of a live tick, without inventing one.
 *
 * A tick can carry a price and no change. Two wrong answers were available:
 *   - substitute 0, which rendered a measured "0.00%" / FLAT (what the
 *     producers did until Q-145), or
 *   - keep the previous change, which shows a stale move as live (I2).
 * The prior close is fixed for a session, so when the previous quote and the
 * tick are from the SAME New York trading day, the change is derived exactly:
 * prior close = previous price − previous change. Across a day boundary, or
 * with no vendor stamps to tell, it stays null and renders "—".
 */
import { nyDateYmd } from '@/lib/api/marketHours'

export interface ChangeLike {
  price: number
  change: number | null
  changePct: number | null
  quoteTime?: string | null
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

function sameNySession(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false
  return nyDateYmd(new Date(ta)) === nyDateYmd(new Date(tb))
}

export function resolveTickChange(prev: ChangeLike | null | undefined, tick: ChangeLike): { change: number | null; changePct: number | null } {
  let change = finite(tick.change) ? tick.change : null
  let changePct = finite(tick.changePct) ? tick.changePct : null
  // One of the pair implies the other through the tick's own price.
  if (change != null && changePct == null) {
    const priorClose = tick.price - change
    changePct = priorClose > 0 ? (change / priorClose) * 100 : null
  } else if (change == null && changePct != null && changePct > -100) {
    change = tick.price - tick.price / (1 + changePct / 100)
  }
  if (change != null || changePct != null) return { change, changePct }
  // Neither: derive from the previous quote's prior close, same session only.
  if (prev && finite(prev.change) && sameNySession(prev.quoteTime, tick.quoteTime)) {
    const priorClose = prev.price - prev.change
    if (priorClose > 0) {
      const derived = tick.price - priorClose
      return { change: derived, changePct: (derived / priorClose) * 100 }
    }
  }
  return { change: null, changePct: null }
}
