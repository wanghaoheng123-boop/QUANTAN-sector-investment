/**
 * Q-138 — pure summary of OKX public liquidation orders for BTC-USDT-SWAP.
 * Lives outside the route file because a Next.js App Router route may export
 * only its handlers and route config; `next build` rejects anything else.
 */

/**
 * Q-138 — the only instrument this route summarises. `uly=BTC-USDT` returns it
 * today, but the contract size below is specific to it, so rows for any other
 * instrument are dropped rather than scaled wrongly.
 */
export const LIQ_INST_ID = 'BTC-USDT-SWAP'

/**
 * Q-138 — OKX quotes a swap liquidation's `sz` in CONTRACTS, not coins. For
 * BTC-USDT-SWAP one contract is 0.01 BTC (linear, USDT-settled). Source:
 * GET https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP
 * → `ctVal: "0.01"`, `ctValCcy: "BTC"`, `ctType: "linear"` (checked 2026-09-28).
 *
 * The route used to sum `bkPx × sz` — contracts times price — so every USD
 * volume on the BTC liquidations panel was 100× too large ($101.7M displayed
 * against ~$1.02M real, measured 2026-09-28).
 */
export const BTC_USDT_SWAP_CT_VAL = 0.01

/**
 * OKX's `limit` caps the number of liquidation DETAILS returned (verified
 * 2026-09-28: limit 1/5/20/100 returned exactly that many details, in one row;
 * limit=150 returns error 51000). 100 is therefore the EMPIRICAL maximum — the
 * REST endpoint is not in OKX's current v5 docs, only its WebSocket channel is.
 * This route reads one page, so when the cap is hit the figures cover only the
 * latest `LIQ_DETAIL_LIMIT` liquidations — about 1.4 hours on 2026-09-28, when
 * OKX logged ~1,640 in the trailing 24h. Paging with `after` would widen it;
 * that is a feature, not this fix, and the window is stated instead.
 */
export const LIQ_DETAIL_LIMIT = 100

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Q-138 round 2: a feed whose NEWEST liquidation is older than this is treated
 * as frozen. Measured null, 2026-09-28: the largest gap between consecutive
 * BTC-USDT-SWAP liquidations over a full 24h (1,734 records) was 132 minutes.
 * 6h is ~2.7× that. One day of data — revisit if it ever fires on a live feed.
 */
export const LIQ_FROZEN_AFTER_MS = 6 * 60 * 60 * 1000

type OkxLiqDetail = {
  bkPx?: string
  sz?: string
  side?: string
  posSide?: string
  time?: string
  ts?: string
}

export type OkxLiqRow = { instId?: string; details?: OkxLiqDetail[] }

export type LiquidationSummary = {
  /** Liquidation orders counted (within 24h of `now`, of what OKX returned), classified or not. */
  totalLiquidations: number
  /** Short positions liquidated — forced BUYS (`posSide: short`, `side: buy`). */
  buyLiquidations: number
  /** Long positions liquidated — forced SELLS (`posSide: long`, `side: sell`). */
  sellLiquidations: number
  /**
   * Counted but CONTRADICTORY — a long closed by a buy, a short by a sell, or
   * an unknown `posSide`. Never observed; `liquidationFeedProblem` degrades on
   * any. (`posSide: net`, one-way mode, is NOT contradictory: it is classified
   * by `side` — red-team round 2 HIGH-1.)
   */
  unclassifiedLiquidations: number
  /** USDT notional of short liquidations: Σ bkPx × sz × ctVal, at OKX's reported liquidation price. */
  buyVolume: number
  /** USDT notional of long liquidations. */
  sellVolume: number
  /** LONG_BIAS = more long notional liquidated than short; SHORT_BIAS the reverse. */
  netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL'
  /** Oldest liquidation counted (ISO), or null when none were. */
  windowStart: string | null
  /** True when OKX returned its maximum, so older liquidations exist that were not seen. */
  truncated: boolean
  /** Newest liquidation counted (ms), or null — for the frozen-feed check. */
  newestAt: number | null
  /** Rows OKX returned at all, rows and details for this instrument — for the feed-problem check. */
  rowsReturned: number
  instrumentRows: number
  detailsReturned: number
  /** Details for this instrument whose price, size or time could not be read. */
  unreadable: number
}

/**
 * Pure summary of OKX `liquidation-orders` rows. Exported for tests.
 *
 * Side mapping (OKX public liquidation orders): a liquidated LONG is closed by
 * a forced SELL, a liquidated SHORT by a forced BUY. `posSide` is `long` or
 * `short` in long/short mode and `net` in one-way mode (OKX field docs); in
 * one-way mode `side` alone says which way the position was, so `net` is
 * classified by `side`. A `long` with `side: buy` (or a `short` with `sell`,
 * or any other `posSide`) is contradictory and counted as unclassified.
 */
export function summariseLiquidations(rows: readonly OkxLiqRow[], now: number): LiquidationSummary {
  const mine = rows.filter((r) => r.instId === LIQ_INST_ID)
  const details = mine.flatMap((r) => r.details ?? [])
  const flat: Array<{ usd: number; side: string; posSide: string; time: number }> = []
  let unreadable = 0
  for (const d of details) {
    const price = parseFloat(d.bkPx ?? '')
    const contracts = parseFloat(d.sz ?? '')
    const time = parseInt(String(d.ts ?? d.time ?? ''), 10)
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(contracts) || contracts <= 0 || !Number.isFinite(time)) {
      unreadable += 1
      continue
    }
    if (now - time > ONE_DAY_MS) continue
    flat.push({
      usd: price * contracts * BTC_USDT_SWAP_CT_VAL,
      side: String(d.side ?? ''),
      posSide: String(d.posSide ?? ''),
      time,
    })
  }
  const longLiq = flat.filter((x) => x.side === 'sell' && (x.posSide === 'long' || x.posSide === 'net'))
  const shortLiq = flat.filter((x) => x.side === 'buy' && (x.posSide === 'short' || x.posSide === 'net'))
  const buyVolume = shortLiq.reduce((s, x) => s + x.usd, 0)
  const sellVolume = longLiq.reduce((s, x) => s + x.usd, 0)
  const oldest = flat.reduce((m, x) => Math.min(m, x.time), Infinity)
  const newest = flat.reduce((m, x) => Math.max(m, x.time), -Infinity)
  return {
    totalLiquidations: flat.length,
    buyLiquidations: shortLiq.length,
    sellLiquidations: longLiq.length,
    unclassifiedLiquidations: flat.length - longLiq.length - shortLiq.length,
    buyVolume,
    sellVolume,
    netDirection: sellVolume > buyVolume ? 'LONG_BIAS' : buyVolume > sellVolume ? 'SHORT_BIAS' : 'NEUTRAL',
    windowStart: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    // Judged on what OKX RETURNED, not on what survived the 24h filter.
    truncated: details.length >= LIQ_DETAIL_LIMIT,
    newestAt: Number.isFinite(newest) ? newest : null,
    rowsReturned: rows.length,
    instrumentRows: mine.length,
    detailsReturned: details.length,
    unreadable,
  }
}

/**
 * Q-138 red-team HIGH-1: a `code: '0'` response is not automatically a
 * measurement. If the schema drifts (a renamed field, a missing `instId`) the
 * summariser drops every detail and the panel would render "0 · Balanced" — a
 * calm market nobody measured, on an endpoint OKX no longer documents. OKX
 * logged ~1,640 BTC-USDT-SWAP liquidations in the trailing 24h on 2026-09-28,
 * so zero counted is not a plausible reading either. Each case returns the
 * reason to show the user; null means the summary can be displayed.
 */
export function liquidationFeedProblem(s: LiquidationSummary, now: number): string | null {
  const plural = (n: number) => (n === 1 ? '' : 's')
  if (s.rowsReturned > 0 && s.instrumentRows === 0) {
    return `OKX returned liquidation rows, but none for ${LIQ_INST_ID}.`
  }
  if (s.unreadable > 0) {
    return `OKX returned ${s.unreadable} liquidation record${plural(s.unreadable)} this panel could not read.`
  }
  if (s.unclassifiedLiquidations > 0) {
    return `OKX returned ${s.unclassifiedLiquidations} liquidation record${plural(s.unclassifiedLiquidations)} whose side contradicts the position.`
  }
  if (s.totalLiquidations === 0) {
    // Round 2: say what actually happened. Records dated outside the window
    // (e.g. timestamps in seconds) are not "no liquidations".
    return s.detailsReturned > 0
      ? `OKX returned ${s.detailsReturned} liquidation record${plural(s.detailsReturned)}, none dated within the last 24h.`
      : 'OKX returned no liquidations; a quiet market cannot be told apart from a feed problem here.'
  }
  if (s.newestAt != null && now - s.newestAt > LIQ_FROZEN_AFTER_MS) {
    const h = ((now - s.newestAt) / 3_600_000).toFixed(1)
    return `The newest liquidation OKX returned is ${h}h old; the feed may be frozen.`
  }
  return null
}
