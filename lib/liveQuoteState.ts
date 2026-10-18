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
 *   - An impossible pair is no change (red-team Q145-R6): a prior close at or
 *     below 0, a percent at or below −100, or a change and a percent of
 *     opposite sign.
 *
 * The first version also derived a missing change from the PREVIOUS quote's
 * prior close when both were stamped on the same New York date. That is exact
 * for US equities only — crypto rolls its day at 00:00 UTC and CME energy at
 * 18:00 ET (red-team Q145-R4) — and a missing change is rare, so it was
 * removed rather than given a per-instrument calendar.
 */
export function tickChange(tick: TickLike): SessionChange {
  if (!finite(tick.price) || tick.price <= 0) return NO_CHANGE
  const change = finite(tick.change) ? tick.change : null
  const changePct = finite(tick.changePct) ? tick.changePct : null
  if (change != null && tick.price - change <= 0) return NO_CHANGE
  if (changePct != null && changePct <= -100) return NO_CHANGE
  if (change != null && changePct != null) {
    return Math.sign(change) * Math.sign(changePct) < 0 ? NO_CHANGE : { change, changePct }
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
  const quotes = Array.isArray(body.quotes) ? (body.quotes as T[]) : []
  const quote = quotes.find((q) => q != null && q.ticker === ticker)
  if (quote) return { kind: 'priced', quote }
  const unpriced = Array.isArray(body.unpriced) ? body.unpriced : []
  return { kind: 'missing', reason: unpriced.includes(ticker) ? UNPRICED_REASON : ABSENT_REASON }
}
