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
import { finiteNumber } from '@/lib/vendorNumber'

export interface BtcPriceSnapshot {
  price: number
  /** Vendor's price timestamp in Unix ms; null when it was not supplied. */
  quoteTime: number | null
  /** Null when the source gives no 24h reference. Never 0 for "unknown". */
  change24h: number | null
  changePct24h: number | null
  high24h: number | null
  low24h: number | null
  volume24h: number | null
}

const num = finiteNumber

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

/** Coinbase Exchange ticker `time` is a UTC ISO timestamp, not receipt time. */
const coinbaseTime = (v: unknown): number | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) return null
  const ms = Date.parse(v)
  // Date.parse can normalize impossible dates (e.g. February 30) instead of
  // refusing them. Retain no timestamp when its calendar fields do not agree.
  return Number.isFinite(ms) && ms > 0 && new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19) ? ms : null
}

/** A Coinbase `ticker` message (strings for numbers), or null without a usable price. */
export function snapshotFromCoinbaseTicker(message: unknown): BtcPriceSnapshot | null {
  const d = record(message)
  const price = positive(d?.price)
  if (d == null || price == null) return null
  const open24 = positive(d.open_24h)
  const { change, changePct } = tickChange({ price, change: open24 != null ? price - open24 : null, changePct: null })
  return {
    price,
    quoteTime: coinbaseTime(d.time),
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
  return { price, quoteTime: null, change24h: change, changePct24h: changePct, high24h: null, low24h: null, volume24h: nonNegative(b.usd_24h_vol) }
}

/** The `/api/crypto/btc/quote` body. */
export function snapshotFromQuoteRoute(body: unknown): BtcPriceSnapshot | null {
  const d = record(body)
  const price = positive(d?.price)
  if (d == null || price == null) return null
  const { change, changePct } = tickChange({ price, change: num(d.change24h), changePct: num(d.changePct24h) })
  return {
    price,
    quoteTime: positive(d.quoteTime),
    change24h: change,
    changePct24h: changePct,
    high24h: positive(d.high24h),
    low24h: positive(d.low24h),
    volume24h: nonNegative(d.volume24h),
  }
}

/**
 * Which source delivered the header's price, its vendor time, and when it
 * arrived. Receipt time measures transport activity, never price freshness.
 *
 * Red-team F1 (Q-156/Q-157, design invariant I2): the header's LIVE badge
 * followed the Kraken CANDLE socket, not the price, and after one Coinbase tick
 * the REST fallback was switched off for good — so a dead price feed froze the
 * header beside a pulsing LIVE. The badge now follows the price feed itself.
 */
export type BtcPriceSource = 'coinbase' | 'quote-route' | 'coingecko'
export interface BtcPriceFeed {
  source: BtcPriceSource
  receivedAt: number
  quoteTime: number | null
}

/**
 * Maximum age of the Coinbase trade's VENDOR timestamp before its price is
 * STALE. Receiving an old ticker cannot make that ticker live again.
 */
export const LIVE_MAX_AGE_MS = 30_000

/**
 * How long since receipt of a REST snapshot before it is STALE. This measures
 * fallback activity only: its vendor price timestamp is unknown and disclosed
 * in the badge title. The existing fallback cadence is 60 s after 120 s
 * without a fresh socket price.
 */
export const DELAYED_MAX_AGE_MS = 5 * 60_000

export interface FeedBadge {
  state: 'connecting' | 'live' | 'delayed' | 'stale'
  label: string
  title: string
}

const age = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

const SOURCE_NAME: Record<BtcPriceSource, string> = {
  coinbase: 'Coinbase ticker',
  'quote-route': 'CoinGecko snapshot (via this site)',
  coingecko: 'CoinGecko snapshot (direct)',
}

/** The header's feed badge at `nowMs`. */
export function priceFeedBadge(feed: BtcPriceFeed | null, nowMs: number): FeedBadge {
  if (feed == null) return { state: 'connecting', label: 'CONNECTING', title: 'No BTC price has been received yet.' }
  const receiptMs = nowMs - feed.receivedAt
  const receipt = `${SOURCE_NAME[feed.source]}, received ${age(receiptMs)} ago`
  if (feed.source === 'coinbase') {
    if (feed.quoteTime == null || !Number.isFinite(feed.quoteTime) || feed.quoteTime <= 0 || feed.quoteTime > nowMs || feed.quoteTime > feed.receivedAt) {
      return { state: 'stale', label: 'STALE · time unknown', title: `${receipt}. The vendor price timestamp is missing or invalid; price freshness is unknown.` }
    }
    const ms = nowMs - feed.quoteTime
    const from = `${SOURCE_NAME[feed.source]}, vendor price ${age(ms)} old; received ${age(receiptMs)} ago`
    if (ms <= LIVE_MAX_AGE_MS) return { state: 'live', label: 'LIVE', title: from }
    return { state: 'stale', label: `STALE · ${age(ms)}`, title: `${from}. The figure shown may be out of date.` }
  }
  if (receiptMs >= 0 && receiptMs <= DELAYED_MAX_AGE_MS) {
    return { state: 'delayed', label: 'DELAYED', title: `${receipt}. Vendor price time is unknown. The live ticker is not connected.` }
  }
  return { state: 'stale', label: `STALE · ${age(receiptMs)}`, title: `${receipt}. Vendor price time is unknown. No newer price has arrived; the figure shown may be out of date.` }
}

/** Fallback suppression uses exactly the displayed vendor-freshness decision. */
export function hasFreshVendorPrice(feed: BtcPriceFeed, nowMs: number): boolean {
  return priceFeedBadge(feed, nowMs).state === 'live'
}
