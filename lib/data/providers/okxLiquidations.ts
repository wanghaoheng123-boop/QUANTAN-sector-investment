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
   * Counted but neither pairing — e.g. `posSide: net` (one-way mode), which
   * OKX documents; 0 of ~1,640 on 2026-09-28. In the total, in neither side.
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
  /** Rows OKX returned at all, and rows for this instrument — for the feed-problem check. */
  rowsReturned: number
  instrumentRows: number
  /** Details for this instrument whose price, size or time could not be read. */
  unreadable: number
}

/**
 * Pure summary of OKX `liquidation-orders` rows. Exported for tests.
 *
 * Side mapping (OKX public liquidation orders): a liquidated LONG is closed by
 * a forced SELL (`posSide: long`, `side: sell`); a liquidated SHORT by a forced
 * BUY. Any other pairing is counted as unclassified.
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
  const longLiq = flat.filter((x) => x.posSide === 'long' && x.side === 'sell')
  const shortLiq = flat.filter((x) => x.posSide === 'short' && x.side === 'buy')
  const buyVolume = shortLiq.reduce((s, x) => s + x.usd, 0)
  const sellVolume = longLiq.reduce((s, x) => s + x.usd, 0)
  const oldest = flat.reduce((m, x) => Math.min(m, x.time), Infinity)
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
    rowsReturned: rows.length,
    instrumentRows: mine.length,
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
export function liquidationFeedProblem(s: LiquidationSummary): string | null {
  if (s.rowsReturned > 0 && s.instrumentRows === 0) {
    return `OKX returned liquidation rows, but none for ${LIQ_INST_ID}.`
  }
  if (s.unreadable > 0) {
    return `OKX returned ${s.unreadable} liquidation record${s.unreadable === 1 ? '' : 's'} this panel could not read.`
  }
  if (s.totalLiquidations === 0) {
    return 'OKX returned no liquidations in the last 24h; a quiet market cannot be told apart from a feed problem here.'
  }
  return null
}
