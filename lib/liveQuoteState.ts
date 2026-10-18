/**
 * Q-145 — the state transitions that put a quote on screen, as pure functions.
 *
 * The landing, stock and sector pages each built their next quote inline in a
 * `setQuote(prev => ({ … }))` updater. Red-team Q145-R1: the only guard on
 * those call sites was a regex over source text, which a call whose result is
 * thrown away satisfies. Reusing the previous change (a stale move shown as
 * live) or restoring `?? 0` passed every test. The transitions now live here
 * and are tested directly, and `__tests__/architecture/live-quote-merge.test.ts`
 * checks on the parse tree that each page's updater RETURNS one of them.
 */

import { normalizeTicker } from '@/lib/api/sanitize'

export interface TickLike {
  price: number
  change: number | null
  changePct: number | null
}

export interface SessionChange {
  change: number | null
  changePct: number | null
}

const NO_CHANGE: SessionChange = { change: null, changePct: null }

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The session change a tick carries, made consistent and never invented.
 *
 *   - A missing change is null and renders "—". It is never the previous
 *     quote's change, which would show a stale move as live (I2), and never 0,
 *     which is a measured FLAT.
 *   - One half of the pair implies the other through the tick's own price:
 *     prior close = price − change = price / (1 + pct/100).
 *   - An impossible pair is no change (red-team Q145-R6, R2-10): a prior close
 *     at or below 0, a percent at or below −100, a change and a percent of
 *     opposite sign, or one of them zero while the other is not.
 *
 * The first version also derived a missing change from the PREVIOUS quote's
 * prior close when both were stamped on the same New York date. That is exact
 * only when the instrument's reference close is the NYSE session's; crypto
 * pairs and futures roll theirs at other times (red-team Q145-R4), and a
 * missing change is rare, so it was removed rather than given a per-instrument
 * calendar.
 */
export function tickChange(tick: TickLike): SessionChange {
  if (!finite(tick.price) || tick.price <= 0) return NO_CHANGE
  const change = finite(tick.change) ? tick.change : null
  const changePct = finite(tick.changePct) ? tick.changePct : null
  if (change != null && tick.price - change <= 0) return NO_CHANGE
  if (changePct != null && changePct <= -100) return NO_CHANGE
  if (change != null && changePct != null) {
    const consistent = Math.sign(change) === Math.sign(changePct)
    return consistent ? { change, changePct } : NO_CHANGE
  }
  if (change != null) return { change, changePct: (change / (tick.price - change)) * 100 }
  if (changePct != null) return { change: tick.price - tick.price / (1 + changePct / 100), changePct }
  return NO_CHANGE
}

/** A live tick as the single-ticker stream delivers it (hooks/useLiveQuote). */
export interface LiveTick extends TickLike {
  volume?: number
  /** The VENDOR's stamp (Q-101), never the stream's emit time. */
  quoteTime: string | null
}

export interface StockQuoteState extends SessionChange {
  price: number
  marketCap: string
  quoteTime?: string | null
}

/** /stock/[ticker]: a tick replaces price and change; market cap comes only from the REST boot. */
export function mergeStockTick(prev: StockQuoteState | null, tick: LiveTick): StockQuoteState {
  return {
    price: tick.price,
    ...tickChange(tick),
    marketCap: prev?.marketCap || '—',
    quoteTime: tick.quoteTime,
  }
}

export interface SectorQuoteState extends SessionChange {
  price: number
  volume: number | null
  high52w: number | null
  low52w: number | null
  pe: number | null
  quoteTime?: string | null
}

/** /sector/[slug]: a tick replaces price, change and volume; the rest come only from the REST boot. */
export function mergeSectorTick(prev: SectorQuoteState | null, tick: LiveTick): SectorQuoteState {
  return {
    price: tick.price,
    ...tickChange(tick),
    volume: tick.volume ?? prev?.volume ?? null,
    high52w: prev?.high52w ?? null,
    low52w: prev?.low52w ?? null,
    pe: prev?.pe ?? null,
    quoteTime: tick.quoteTime,
  }
}

export interface LandingQuote extends SessionChange {
  ticker: string
  price: number
}

/** The landing page's per-ticker quote after a tick from the multiplexed stream. */
export function mergeLandingTick(ticker: string, tick: TickLike): LandingQuote {
  return { ticker, price: tick.price, ...tickChange(tick) }
}

/**
 * What the REST boot fetch (`/api/prices?tickers=X`) says about one ticker.
 *
 * Red-team Q145-R2: the route names a ticker it could not price in `unpriced`,
 * and nothing read it. Both single-ticker pages kept a pulsing skeleton for a
 * quote that was never coming. "Missing" is now a state with a reason.
 */
export type BootQuote<T> =
  | { kind: 'priced'; quote: T }
  | { kind: 'missing'; reason: string }

export const UNPRICED_REASON = 'No price from the market-data vendor for this ticker.'
export const ABSENT_REASON = 'The quote response did not include this ticker.'
export const FAILED_REASON = 'The quote failed to load; try again shortly.'

export function bootQuoteFrom<T extends { ticker: string }>(payload: unknown, ticker: string): BootQuote<T> {
  const body = (payload ?? {}) as { quotes?: unknown; unpriced?: unknown }
  // Red-team Q145-R2-3: the route canonicalises the symbol it was asked for —
  // /stock/vix asks for `VIX` and is answered as `^VIX` — so the page matches on
  // the SAME canonical form, not on the raw path segment.
  const names = new Set([ticker, normalizeTicker(ticker) ?? ticker])
  const quotes = Array.isArray(body.quotes) ? (body.quotes as T[]) : []
  const quote = quotes.find((q) => q != null && names.has(q.ticker))
  if (quote) return { kind: 'priced', quote }
  const unpriced: unknown[] = Array.isArray(body.unpriced) ? body.unpriced : []
  return { kind: 'missing', reason: unpriced.some((t) => typeof t === 'string' && names.has(t)) ? UNPRICED_REASON : ABSENT_REASON }
}
