/**
 * Q-138 — what the BTC liquidations panel says, as pure functions so the
 * wording and the client's state transitions are testable in node (jsdom
 * component tests are CI-only on this machine).
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
  unclassifiedLiquidations?: number | null
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
 * Money with a unit that fits the magnitude; null is unknown, never $0.
 * Units are chosen AFTER rounding, so 999,960 reads "$1.00M", not "$1000.0K".
 */
export function formatUsdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 999_995_000) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 999_950) return `$${(v / 1e6).toFixed(2)}M`
  if (a >= 999.5) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
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
  const unclassified = liq?.unclassifiedLiquidations
  return [
    {
      label: 'Liquidations',
      value: liq?.totalLiquidations == null ? '—' : String(liq.totalLiquidations),
      sub: liquidationWindowLabel(liq) + (unclassified ? ` · ${unclassified} unclassified` : ''),
      color: AMBER,
    },
    {
      label: 'Long liquidations (forced sells)',
      value: formatUsdCompact(liq?.sellVolume),
      sub: count(liq?.sellLiquidations, 'order'),
      color: RED,
    },
    {
      label: 'Short liquidations (forced buys)',
      value: formatUsdCompact(liq?.buyVolume),
      sub: count(liq?.buyLiquidations, 'order'),
      color: GREEN,
    },
    { label: 'Net bias', value: bias.value, sub: 'by USDT notional, same window', color: bias.color },
  ]
}

/** An unknown, stated — every figure null, with the reason. */
export function unknownLiq(userMessage: string): LiqData {
  return {
    totalLiquidations: null, buyLiquidations: null, sellLiquidations: null, unclassifiedLiquidations: null,
    buyVolume: null, sellVolume: null, netDirection: null, windowStart: null, truncated: null,
    degraded: true, userMessage,
  }
}

/**
 * The client's state transition after one fetch. Red-team MEDIUM-1: failures
 * the route never sees — the rate limiter's 429, a platform 5xx, the browser's
 * own network error — used to leave the LAST GOOD numbers on screen with
 * nothing on the panel saying so. They now stay only if marked: same figures,
 * `degraded`, and a message that says they are from the last successful load.
 * A route answer (including a degraded one) always replaces what was there.
 */
export function nextLiqState(
  prev: LiqData | null,
  result: { ok: true; data: unknown } | { ok: false; message: string },
): LiqData {
  if (result.ok) return result.data as LiqData
  if (!prev || prev.totalLiquidations == null) {
    return unknownLiq(`Liquidation data could not be loaded (${result.message}).`)
  }
  return {
    ...prev,
    degraded: true,
    userMessage: `The latest refresh failed (${result.message}); these figures are from the last successful load.`,
  }
}

/**
 * "Last updated" only when there are figures to date; a response carrying no
 * figures has only an attempt time. Red-team LOW: the panel read "Last
 * updated: just now" beside "Liquidation feed failed to load."
 */
export function liquidationFreshnessPrefix(liq: LiqData | null): string {
  return liq?.totalLiquidations == null ? 'Last attempt' : 'Last updated'
}
