/**
 * Q-138 — what the BTC liquidations panel says, as pure functions so the
 * wording is testable in node (jsdom component tests are CI-only here).
 *
 * Every number the panel showed was wrong in a different way:
 *   - volumes were 100× too large (contracts summed as coins — see
 *     lib/data/providers/okxLiquidations.ts);
 *   - "Large Trades (24h)" covered the last ~1.4 hours (OKX returns at most 100
 *     liquidations) and ">$100k notional" had no filter behind it at all;
 *   - "Buy (Long Liq)" displayed SHORT liquidations and "Sell (Short Liq)" LONG
 *     ones — a forced buy closes a short;
 *   - the Signals grid called the liquidation bias "OI Net Direction" (it is not
 *     open interest) and rendered LONG_BIAS — longs being force-SOLD — as "MORE
 *     AGG BUY VOLUME", the opposite of the data;
 *   - a failed feed rendered as "0 … $0.0M … NEUTRAL".
 */

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

/** USD with a unit that fits the magnitude; null is unknown, never $0. */
export function formatUsdCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function count(n: number | null | undefined, noun: string): string {
  return n == null || !Number.isFinite(n) ? '—' : `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * The window the numbers actually cover. When OKX's cap was hit, that is the
 * span back to the oldest liquidation returned, not a day.
 */
export function liquidationWindowLabel(liq: Pick<LiqData, 'windowStart' | 'fetchedAt' | 'truncated'> | null): string {
  if (!liq || liq.truncated == null) return 'window unknown'
  if (!liq.truncated) return 'last 24h'
  const start = liq.windowStart ? Date.parse(liq.windowStart) : NaN
  const end = liq.fetchedAt ? Date.parse(liq.fetchedAt) : NaN
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'latest 100 only'
  const hours = (end - start) / 3_600_000
  const span = hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.max(1, Math.round(hours * 60))}m`
  return `last ${span} only (OKX returns the latest 100)`
}

/** The liquidation bias in words. LONG_BIAS means LONGS were force-sold. */
export function liquidationBias(netDirection: LiqData['netDirection'] | undefined): { value: string; signal: string; color: string } {
  switch (netDirection) {
    case 'LONG_BIAS': return { value: 'Longs liquidated more', signal: 'LONGS FORCE-SOLD', color: RED }
    case 'SHORT_BIAS': return { value: 'Shorts liquidated more', signal: 'SHORTS FORCE-BOUGHT', color: GREEN }
    case 'NEUTRAL': return { value: 'Balanced', signal: 'BALANCED', color: MUTED }
    default: return { value: '—', signal: 'N/A', color: MUTED }
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
    { label: 'Net bias', value: bias.value, sub: 'by USD notional, same window', color: bias.color },
  ]
}
