/**
 * Q-157 — the BTC price header's snapshot, from each of its three sources.
 *
 * The feed turned every missing 24h figure into a measured-looking value: no
 * `open_24h` on a Coinbase ticker became a change of 0, the CoinGecko fallback
 * (which supplies a percent and no absolute change) sent `change24h: 0`, a
 * missing percent became 0.00%, and a missing 24h high or low became the
 * current price. BtcHeader then rendered "▲ 0.00%" — a flat day nobody
 * measured — the same defect Q-145 removed from the Yahoo quote producers.
 *
 * Missing is null here, and the header renders "—". The change pair goes
 * through `tickChange` (lib/liveQuoteState), the one rule for completing a
 * change from its other half and refusing an impossible pair.
 *
 * Pure and framework-free, so the client hook and the server route share it.
 */
import { tickChange } from '@/lib/liveQuoteState'

export interface BtcPriceSnapshot {
  price: number
  /** Null when the source gives no 24h reference. Never 0 for "unknown". */
  change24h: number | null
  changePct24h: number | null
  high24h: number | null
  low24h: number | null
  volume24h: number | null
}

/** A finite number from a number or a numeric string, else null. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const positive = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}

const nonNegative = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n >= 0 ? n : null
}

const record = (v: unknown): Record<string, unknown> | null =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** A Coinbase `ticker` message (strings for numbers), or null without a usable price. */
export function snapshotFromCoinbaseTicker(message: unknown): BtcPriceSnapshot | null {
  const d = record(message)
  const price = positive(d?.price)
  if (d == null || price == null) return null
  const open24 = positive(d.open_24h)
  const { change, changePct } = tickChange({ price, change: open24 != null ? price - open24 : null, changePct: null })
  return {
    price,
    change24h: change,
    changePct24h: changePct,
    high24h: positive(d.high_24h),
    low24h: positive(d.low_24h),
    volume24h: nonNegative(d.volume_24h),
  }
}

/** CoinGecko `simple/price` for bitcoin: a percent and no absolute change, no high or low. */
export function snapshotFromCoinGecko(body: unknown): BtcPriceSnapshot | null {
  const b = record(record(body)?.bitcoin)
  const price = positive(b?.usd)
  if (b == null || price == null) return null
  const { change, changePct } = tickChange({ price, change: null, changePct: num(b.usd_24h_change) })
  return { price, change24h: change, changePct24h: changePct, high24h: null, low24h: null, volume24h: nonNegative(b.usd_24h_vol) }
}

/** The `/api/crypto/btc/quote` body. */
export function snapshotFromQuoteRoute(body: unknown): BtcPriceSnapshot | null {
  const d = record(body)
  const price = positive(d?.price)
  if (d == null || price == null) return null
  const { change, changePct } = tickChange({ price, change: num(d.change24h), changePct: num(d.changePct24h) })
  return {
    price,
    change24h: change,
    changePct24h: changePct,
    high24h: positive(d.high24h),
    low24h: positive(d.low24h),
    volume24h: nonNegative(d.volume24h),
  }
}
