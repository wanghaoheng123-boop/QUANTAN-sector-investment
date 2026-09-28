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
 * 2026-09-28: limit 1/5/20/100 returned exactly that many details, in one row).
 * 100 is the documented maximum. When the cap is hit, the response covers only
 * the most recent `LIQ_DETAIL_LIMIT` liquidations — on 2026-09-28 about 1.4
 * hours — and the panel's old "(24h)" label overstated its window ~17×.
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
  /** Liquidation orders counted (within 24h of `now`, of what OKX returned). */
  totalLiquidations: number
  /** Short positions liquidated — forced BUYS (`posSide: short`, `side: buy`). */
  buyLiquidations: number
  /** Long positions liquidated — forced SELLS (`posSide: long`, `side: sell`). */
  sellLiquidations: number
  /** USD notional of short liquidations: Σ bkPx × sz × ctVal. `bkPx` is the bankruptcy price. */
  buyVolume: number
  /** USD notional of long liquidations. */
  sellVolume: number
  /** LONG_BIAS = more long notional liquidated than short; SHORT_BIAS the reverse. */
  netDirection: 'LONG_BIAS' | 'SHORT_BIAS' | 'NEUTRAL'
  /** Oldest liquidation counted (ISO), or null when none were. */
  windowStart: string | null
  /** True when OKX returned its maximum, so older liquidations exist that were not seen. */
  truncated: boolean
}

/**
 * Pure summary of OKX `liquidation-orders` rows. Exported for tests.
 *
 * Side mapping (OKX public liquidation orders): a liquidated LONG is closed by
 * a forced SELL (`posSide: long`, `side: sell`); a liquidated SHORT by a forced
 * BUY. Details that match neither pairing are counted in `totalLiquidations`
 * only.
 */
export function summariseLiquidations(rows: readonly OkxLiqRow[], now: number): LiquidationSummary {
  const details = rows.filter((r) => r.instId === LIQ_INST_ID).flatMap((r) => r.details ?? [])
  const flat: Array<{ usd: number; side: string; posSide: string; time: number }> = []
  for (const d of details) {
    const price = parseFloat(d.bkPx ?? '')
    const contracts = parseFloat(d.sz ?? '')
    const time = parseInt(String(d.ts ?? d.time ?? ''), 10)
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(contracts) || contracts <= 0) continue
    if (!Number.isFinite(time) || now - time > ONE_DAY_MS) continue
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
    buyVolume,
    sellVolume,
    netDirection: sellVolume > buyVolume ? 'LONG_BIAS' : buyVolume > sellVolume ? 'SHORT_BIAS' : 'NEUTRAL',
    windowStart: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
    truncated: details.length >= LIQ_DETAIL_LIMIT,
  }
}
