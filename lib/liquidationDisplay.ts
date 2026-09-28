/**
 * Q-138 — what the BTC liquidations panel says, as pure functions so the
 * wording and the client's state transitions are testable on their own.
 *
 * Every number the panel showed was wrong in a different way:
 *   - volumes were 100× too large (contracts summed as coins — see
 *     lib/data/providers/okxLiquidations.ts);
 *   - "Large Trades (24h)" covered the last ~1.4 hours (this route reads one
 *     page of at most 100 liquidations) and ">$100k notional" had no filter
 *     behind it at all;
 *   - "Buy (Long Liq)" displayed SHORT liquidations and "Sell (Short Liq)" LONG
 *     ones — a forced buy closes a short;
 *   - the signals grid called the liquidation bias "OI Net Direction" (it is not
 *     open interest) and rendered LONG_BIAS — longs being force-SOLD — as "MORE
 *     AGG BUY VOLUME", the opposite of the data;
 *   - a failed feed rendered as "0 … $0.0M … NEUTRAL".
 */

import { LIQ_DETAIL_LIMIT, LIQ_INST_ID } from '@/lib/data/providers/okxLiquidations'

export interface LiqData {
  totalLiquidations: number | null
  buyLiquidations: number | null
  sellLiquidations: number | null
  buyVolume: number | null
  sellVolume: number | null
  netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL' | null
  windowStart?: string | null
  truncated?: boolean | null
  fetchedAt?: string
  degraded?: boolean
  userMessage?: string
  source?: string
}

export interface LiqCard { label: string; value: string; sub: string; color: string }

const RED = 'text-red-400'
const GREEN = 'text-green-400'
const AMBER = 'text-amber-400'
const MUTED = 'text-slate-400'

/**
 * What these figures are and are not. The REST endpoint this reads is not in
 * OKX's current v5 docs, so no completeness guarantee is claimed for it; the
 * note says so without attributing a quotation we have not verified.
 */
export const LIQ_SCOPE_NOTE =
  `OKX ${LIQ_INST_ID} only — not other contracts or venues, and OKX's public ` +
  'feed may not include every liquidation on the exchange. ' +
  'Notional is in USDT at the liquidation price OKX reports.'

/**
 * Notional with a unit that fits the magnitude, in the contract's settlement
 * currency (USDT — round 2: a "$" sat beside a note saying USDT); null is
 * unknown, never zero. Units are chosen AFTER rounding, so 999,960 reads
 * "1.00M USDT", not "1000.0K USDT".
 */
export function formatNotional(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 999_995_000) return `${(v / 1e9).toFixed(2)}B USDT`
  if (a >= 999_950) return `${(v / 1e6).toFixed(2)}M USDT`
  if (a >= 999.5) return `${(v / 1e3).toFixed(1)}K USDT`
  return `${v.toFixed(0)} USDT`
}

function count(n: number | null | undefined, noun: string): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * The window the numbers actually cover. When the page cap was hit, that is
 * the span back to the oldest liquidation returned — not a day. The cap is
 * this route's single page, so the label says so rather than blaming OKX.
 */
export function liquidationWindowLabel(liq: Pick<LiqData, 'windowStart' | 'fetchedAt' | 'truncated'> | null): string {
  if (!liq || liq.truncated == null) return 'window unknown'
  if (!liq.truncated) return 'last 24h'
  const start = liq.windowStart ? Date.parse(liq.windowStart) : NaN
  const end = liq.fetchedAt ? Date.parse(liq.fetchedAt) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return `latest ${LIQ_DETAIL_LIMIT} only`
  const hours = (end - start) / 3_600_000
  const span = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.max(1, Math.round(hours * 60))}m`
  return `latest ${LIQ_DETAIL_LIMIT} only · last ${span}`
}

/** The liquidation bias in words. LONG_BIAS means LONGS were force-sold. */
export function liquidationBias(netDirection: LiqData['netDirection'] | undefined): { value: string; color: string } {
  switch (netDirection) {
    case 'LONG_BIAS': return { value: 'Longs liquidated more', color: RED }
    case 'SHORT_BIAS': return { value: 'Shorts liquidated more', color: GREEN }
    case 'NEUTRAL': return { value: 'Balanced', color: MUTED }
    default: return { value: '—', color: MUTED }
  }
}

/** The four cards on the Liquidations tab. */
export function liquidationCards(liq: LiqData | null): LiqCard[] {
  const bias = liquidationBias(liq?.netDirection)
  return [
    {
      label: 'Liquidations',
      value: liq?.totalLiquidations == null ? '—' : String(liq.totalLiquidations),
      sub: liquidationWindowLabel(liq),
      color: AMBER,
    },
    {
      label: 'Long liquidations (forced sells)',
      value: formatNotional(liq?.sellVolume),
      sub: count(liq?.sellLiquidations, 'order'),
      color: RED,
    },
    {
      label: 'Short liquidations (forced buys)',
      value: formatNotional(liq?.buyVolume),
      sub: count(liq?.buyLiquidations, 'order'),
      color: GREEN,
    },
    { label: 'Net bias', value: bias.value, sub: 'by notional, same window', color: bias.color },
  ]
}

/** An unknown, stated — every figure null, with the reason and the attempt time. */
export function unknownLiq(userMessage: string, attemptedAt?: string): LiqData {
  return {
    totalLiquidations: null, buyLiquidations: null, sellLiquidations: null,
    buyVolume: null, sellVolume: null, netDirection: null, windowStart: null, truncated: null,
    degraded: true, userMessage, ...(attemptedAt ? { fetchedAt: attemptedAt } : {}),
  }
}

/**
 * A client-side failure in words a user can act on. Round 2: the raw text
 * leaked an internal path ("/api/crypto/btc/liquidations → invalid JSON
 * (HTTP 504)") and codes like "rate_limited".
 */
export function friendlyFailure(message: string): string {
  const http = /HTTP (\d{3})/.exec(message)
  if (/rate.?limit/i.test(message) || http?.[1] === '429') return 'too many requests — try again shortly'
  if (http) return `server error ${http[1]}`
  return 'network error'
}

/** Parse, don't validate: an `ok` body that is not a liquidation payload is a failure. */
export function isLiqPayload(data: unknown): data is LiqData {
  if (data == null || typeof data !== 'object') return false
  const t = (data as Record<string, unknown>).totalLiquidations
  return t === null || (typeof t === 'number' && Number.isFinite(t))
}

type FetchResult = { ok: true; data: unknown } | { ok: false; message: string }

/**
 * The client's transition for the liquidation FIGURES after one fetch.
 * Red-team round 1 MEDIUM-1: failures the route never sees — the rate
 * limiter's 429, a platform 5xx, the browser's own network error — used to
 * leave the LAST GOOD numbers on screen with nothing on the panel saying so.
 * They now stay only if marked. A route answer (including a degraded one)
 * always replaces what was there. Round 2: an `ok` body that is not a payload
 * (an empty 200) is a failure, and every unknown carries its attempt time.
 */
export function nextLiqState(prev: LiqData | null, result: FetchResult, attemptedAt: string): LiqData {
  if (result.ok && isLiqPayload(result.data)) return result.data
  const reason = result.ok ? 'unreadable response' : friendlyFailure(result.message)
  if (!prev || prev.totalLiquidations == null) {
    return unknownLiq(`Liquidation data could not be loaded (${reason}).`, attemptedAt)
  }
  return {
    ...prev,
    degraded: true,
    userMessage: `The latest refresh failed (${reason}); these figures are from the last successful load.`,
  }
}

/**
 * "Last updated" only when there are figures to date; a response carrying no
 * figures has only an attempt time. Red-team round 1 LOW: the panel read "Last
 * updated: just now" beside "Liquidation feed failed to load."
 */
export function liquidationFreshnessPrefix(liq: LiqData | null): string {
  return liq?.totalLiquidations == null ? 'Last attempt' : 'Last updated'
}
